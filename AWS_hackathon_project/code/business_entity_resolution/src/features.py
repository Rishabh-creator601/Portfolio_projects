"""Vectorised pairwise + context features for candidate pairs.

String similarities use rapidfuzz.process.cpdist (C++, multi-threaded) over
aligned arrays; set features use polars list ops. No feature depends on the
country value, so the model transfers to countries unseen in training.
"""
import numpy as np
import polars as pl
from rapidfuzz import fuzz, process
from rapidfuzz.distance import JaroWinkler

NATIVE_RE = r"[ऀ-෿]"

REC_COLS = ["ntoks", "nmain", "nalt", "skel", "web", "atoks", "anums", "nat", "anat", "aempty"]


def _sim(a, b, scorer):
    return process.cpdist(a, b, scorer=scorer, workers=-1, dtype=np.float32)


def attach(cands: pl.DataFrame, s1: pl.DataFrame, tgt: pl.DataFrame) -> pl.DataFrame:
    """Join record fields onto pairs. s1/tgt have rid + REC_COLS; tgt rid is global over S2+S3."""
    l = s1.select(pl.col("rid").alias("s1_rid"), *[pl.col(c).alias(c + "_1") for c in REC_COLS])
    r = tgt.select(pl.col("rid").alias("t_rid"), *[pl.col(c).alias(c + "_2") for c in REC_COLS])
    return cands.join(l, on="s1_rid", how="left").join(r, on="t_rid", how="left")


CTX_COLS = ["score", "name_score", "addr_score", "n_keys", "rank", "is_s3", "score_rel",
            "n_cands_src", "n_cands", "rev_rank", "rev_n", "rev_rel"]


def add_context(c: pl.DataFrame) -> pl.DataFrame:
    """Context features computed over the FULL candidate table (all S1 competing),
    so they have the same distribution whether or not we later subsample.
    Each S2/S3 record matches at most one S1, hence the reverse (rev_*) features."""
    return c.with_columns(
        (pl.col("src") == "S3").cast(pl.Int8).alias("is_s3"),
        (pl.col("score") / pl.col("score").max().over("s1_rid", "src")).cast(pl.Float32).alias("score_rel"),
        pl.len().over("s1_rid", "src").cast(pl.UInt16).alias("n_cands_src"),
        pl.len().over("s1_rid").cast(pl.UInt16).alias("n_cands"),
        pl.col("score").rank("min", descending=True).over("t_rid").cast(pl.UInt16).alias("rev_rank"),
        pl.len().over("t_rid").cast(pl.UInt16).alias("rev_n"),
        (pl.col("score") / pl.col("score").max().over("t_rid")).cast(pl.Float32).alias("rev_rel"),
    )


def build_features(p: pl.DataFrame) -> pl.DataFrame:
    """p: candidates with record fields attached (see attach). Returns feature frame."""
    g = lambda c: p.get_column(c).fill_null("").to_list()
    n1, n2 = g("ntoks_1"), g("ntoks_2")
    m2, alt2 = g("nmain_2"), g("nalt_2")
    k1, k2 = g("skel_1"), g("skel_2")
    a1, a2 = g("atoks_1"), g("atoks_2")
    c1 = [s.replace(" ", "") for s in g("nmain_1")]
    c2 = [(w or s.replace(" ", "")) for s, w in zip(m2, g("web_2"))]

    F = {}
    F["n_ratio"] = _sim(n1, n2, fuzz.ratio)
    F["n_tsort"] = _sim(n1, n2, fuzz.token_sort_ratio)
    F["n_tset"] = _sim(n1, n2, fuzz.token_set_ratio)
    F["n_partial"] = _sim(n1, n2, fuzz.partial_ratio)
    F["n_jw"] = _sim(n1, n2, JaroWinkler.normalized_similarity)
    F["n_main_tsort"] = _sim(n1, m2, fuzz.token_sort_ratio)
    F["n_alt_tsort"] = _sim(n1, alt2, fuzz.token_sort_ratio)
    F["n_skel_tset"] = _sim(k1, k2, fuzz.token_set_ratio)
    F["n_skel_tsort"] = _sim(k1, k2, fuzz.token_sort_ratio)
    F["n_concat_ratio"] = _sim(c1, c2, fuzz.ratio)
    F["n_concat_partial"] = _sim(c1, c2, fuzz.partial_ratio)
    F["a_tset"] = _sim(a1, a2, fuzz.token_set_ratio)
    F["a_tsort"] = _sim(a1, a2, fuzz.token_sort_ratio)
    F["a_partial"] = _sim(a1, a2, fuzz.partial_ratio)
    F["a_ratio"] = _sim(a1, a2, fuzz.ratio)
    feats = pl.DataFrame(F)

    split = lambda c: pl.col(c).fill_null("").str.split(" ").list.eval(
        pl.element().filter(pl.element().str.len_chars() > 0))
    sets = p.select(
        split("ntoks_1").alias("t1"), split("ntoks_2").alias("t2"),
        split("atoks_1").alias("u1"), split("atoks_2").alias("u2"),
        split("anums_1").list.unique().alias("d1"), split("anums_2").list.unique().alias("d2"),
        pl.col("nat_2").alias("nat2"), pl.col("anat_2").alias("anat2"),
        pl.col("aempty_1").alias("aempty1"), pl.col("aempty_2").alias("aempty2"),
        (pl.col("nalt_2").fill_null("").str.len_chars() > 0).alias("has_alias2"),
        (pl.col("web_2").fill_null("").str.len_chars() > 0).alias("is_web2"),
    )
    inter = lambda a, b: pl.col(a).list.set_intersection(pl.col(b)).list.len()
    union = lambda a, b: pl.col(a).list.set_union(pl.col(b)).list.len()
    sf = sets.select(
        (inter("t1", "t2") / union("t1", "t2").clip(1)).alias("n_jacc"),
        inter("t1", "t2").alias("n_common"),
        (pl.col("t1").list.len() - inter("t1", "t2")).alias("n_only1"),
        (pl.col("t2").list.len() - inter("t1", "t2")).alias("n_only2"),
        pl.col("t1").list.len().alias("n_len1"), pl.col("t2").list.len().alias("n_len2"),
        (pl.col("t1").list.first() == pl.col("t2").list.first()).cast(pl.Int8).alias("n_first_eq"),
        (inter("u1", "u2") / union("u1", "u2").clip(1)).alias("a_jacc"),
        pl.col("u1").list.len().alias("a_len1"), pl.col("u2").list.len().alias("a_len2"),
        inter("d1", "d2").alias("d_common"),
        (inter("d1", "d2") / union("d1", "d2").clip(1)).alias("d_jacc"),
        pl.col("d1").list.len().alias("d_len1"), pl.col("d2").list.len().alias("d_len2"),
        (pl.col("d1").list.first() == pl.col("d2").list.first()).cast(pl.Int8).alias("d_first_eq"),
        pl.col("nat2").cast(pl.Int8), pl.col("anat2").cast(pl.Int8),
        pl.col("aempty1").cast(pl.Int8), pl.col("aempty2").cast(pl.Int8),
        pl.col("has_alias2").cast(pl.Int8), pl.col("is_web2").cast(pl.Int8),
    )

    ctx = p.select(pl.col("s1_rid").alias("_s"), pl.col("t_rid").alias("_t"), *CTX_COLS)
    out = pl.concat([ctx, feats, sf], how="horizontal")
    # second-order context: how this pair's name similarity compares to siblings
    out = out.with_columns(
        (pl.col("n_tsort") - pl.col("n_tsort").max().over("_s")).alias("n_tsort_gap"),
        (pl.col("a_tset") - pl.col("a_tset").max().over("_s")).alias("a_tset_gap"),
    ).drop("_s", "_t")
    return out.fill_nan(None)
