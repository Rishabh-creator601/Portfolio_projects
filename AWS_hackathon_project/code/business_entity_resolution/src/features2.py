"""Second-generation features, computed on stage-A survivors only (cheap).

* IDF-weighted token overlap for names and addresses: a shared rare token is strong
  evidence, an unmatched rare token (e.g. "TN Fund" vs "XN Fund") strong counter-evidence.
  Token document frequencies are computed per split from its own records (unsupervised).
* Numeric house-number distance (812 vs 814 = neighbour, 812 vs 5000 = unrelated).
* Sibling features (need stage-B probabilities): how this candidate compares with the
  other candidates of the same S1 entity, and how similar it is to the S1's other
  confident candidates (records of one entity resemble each other).
"""
import os

import numpy as np
import polars as pl
from rapidfuzz import fuzz, process


def _toks(col):
    return pl.col(col).fill_null("").str.split(" ").list.eval(
        pl.element().filter(pl.element().str.len_chars() > 0)).list.unique()


def idf_tables(work, split):
    """Token -> idf for name tokens and address tokens over all records of a split."""
    pn, pa = os.path.join(work, f"{split}_idf_name.parquet"), os.path.join(work, f"{split}_idf_addr.parquet")
    if not (os.path.exists(pn) and os.path.exists(pa)):
        from data import slim_records
        p1, pt = slim_records(work, split)
        recs = pl.concat([pl.scan_parquet(p1).select("ntoks", "atoks"),
                          pl.scan_parquet(pt).select("ntoks", "atoks")]).collect()
        n = recs.height
        for col, path in (("ntoks", pn), ("atoks", pa)):
            (recs.select(_toks(col).alias("tok")).explode("tok").drop_nulls()
             .group_by("tok").len("df")
             .with_columns((np.log(n) - pl.col("df").cast(pl.Float64).log()).cast(pl.Float32).alias("idf"))
             .select("tok", "idf").write_parquet(path))
        del recs
    return pl.read_parquet(pn), pl.read_parquet(pa)


def _weighted(p, c1, c2, idf, prefix):
    """IDF sums over common / only-1 / only-2 token sets, per pair row."""
    maxidf = float(idf["idf"].max())
    base = p.select(pl.int_range(pl.len(), dtype=pl.UInt32).alias("_i"),
                    _toks(c1).alias("a"), _toks(c2).alias("b"))
    base = base.with_columns(pl.col("a").list.set_intersection("b").alias("common"),
                             pl.col("a").list.set_difference("b").alias("only1"),
                             pl.col("b").list.set_difference("a").alias("only2"))
    out = base.select("_i")
    for part in ("common", "only1", "only2"):
        agg = (base.select("_i", pl.col(part).alias("tok")).explode("tok").drop_nulls("tok")
               .join(idf, on="tok", how="left").with_columns(pl.col("idf").fill_null(maxidf))
               .group_by("_i").agg(pl.col("idf").sum().alias(f"{prefix}_{part}_sum"),
                                   pl.col("idf").max().alias(f"{prefix}_{part}_max")))
        out = out.join(agg, on="_i", how="left")
    out = out.sort("_i").fill_null(0.0)
    tot = out[f"{prefix}_common_sum"] + out[f"{prefix}_only1_sum"] + out[f"{prefix}_only2_sum"]
    return out.drop("_i").with_columns((out[f"{prefix}_common_sum"] / tot.clip(1e-6)).alias(f"{prefix}_wjacc"))


def extra_features(p: pl.DataFrame, idf_name, idf_addr) -> pl.DataFrame:
    """p: survivors with record fields attached (features.attach)."""
    wn = _weighted(p, "ntoks_1", "ntoks_2", idf_name, "wn")
    wa = _weighted(p, "atoks_1", "atoks_2", idf_addr, "wa")
    num = lambda c: pl.col(c).fill_null("").str.split(" ").list.first().cast(pl.Int64, strict=False)
    nf = p.select(num("anums_1").alias("x"), num("anums_2").alias("y")).select(
        (pl.col("x") - pl.col("y")).abs().cast(pl.Float32).alias("num_absdiff"),
        ((pl.col("x") - pl.col("y")).abs() / pl.max_horizontal("x", "y").clip(1)).cast(pl.Float32).alias("num_reldiff"),
    )
    a1 = p.get_column("anums_1").fill_null("").to_list()
    a2 = p.get_column("anums_2").fill_null("").to_list()
    nf = nf.with_columns(pl.Series("num_str_ratio", process.cpdist(a1, a2, scorer=fuzz.ratio, workers=-1,
                                                                    dtype=np.float32)))
    return pl.concat([wn, wa, nf], how="horizontal")


def sibling_features(k: pl.DataFrame, p_name: pl.DataFrame, pb: np.ndarray) -> pl.DataFrame:
    """k: (s1_rid, t_rid, src) survivors; p_name: (t_rid, ntoks_2, atoks_2) of the same rows;
    pb: stage-B probability (out-of-fold at training time)."""
    d = k.select("s1_rid", "t_rid", "src").with_columns(pl.Series("pb", pb),
                                                         p_name.get_column("ntoks_2").fill_null(""),
                                                         p_name.get_column("atoks_2").fill_null(""),
                                                         pl.int_range(pl.len(), dtype=pl.UInt32).alias("_i"))
    f = d.select(
        "_i",
        pl.col("pb").rank("ordinal", descending=True).over("s1_rid", "src").cast(pl.UInt8).alias("pb_rank_src"),
        pl.col("pb").rank("ordinal", descending=True).over("s1_rid").cast(pl.UInt8).alias("pb_rank"),
        (pl.col("pb").max().over("s1_rid", "src") - pl.col("pb")).alias("pb_gap_src"),
        (pl.col("pb") > 0.5).sum().over("s1_rid").alias("n_conf"),
        pl.col("pb").sum().over("s1_rid").alias("pb_sum"),
        (pl.col("pb").sum().over("s1_rid") - pl.col("pb")).alias("pb_sum_others"),
        ((pl.col("pb") > 0.5) & (pl.col("src") == "S2")).sum().over("s1_rid").alias("n_conf_s2"),
        ((pl.col("pb") > 0.5) & (pl.col("src") == "S3")).sum().over("s1_rid").alias("n_conf_s3"),
    )
    # similarity to the S1's OTHER confident candidates
    conf = d.filter(pl.col("pb") > 0.5).select("s1_rid", pl.col("_i").alias("_j"),
                                               pl.col("ntoks_2").alias("n_o"), pl.col("atoks_2").alias("a_o"))
    pr = d.select("s1_rid", "_i", "ntoks_2", "atoks_2").join(conf, on="s1_rid").filter(pl.col("_i") != pl.col("_j"))
    if pr.height:
        # batched: converting millions of strings to Python lists at once spikes memory
        sn, sa = [], []
        for i in range(0, pr.height, 500_000):
            b = pr.slice(i, 500_000)
            sn.append(process.cpdist(b["ntoks_2"].to_list(), b["n_o"].to_list(), scorer=fuzz.token_set_ratio,
                                     workers=-1, dtype=np.float32))
            sa.append(process.cpdist(b["atoks_2"].to_list(), b["a_o"].to_list(), scorer=fuzz.token_set_ratio,
                                     workers=-1, dtype=np.float32))
        sn, sa = np.concatenate(sn), np.concatenate(sa)
        pr = pr.select("_i")
        sib = (pr.with_columns(pl.Series("sn", sn), pl.Series("sa", sa))
               .group_by("_i").agg(pl.col("sn").max().alias("sib_name_max"), pl.col("sn").mean().alias("sib_name_mean"),
                                   pl.col("sa").max().alias("sib_addr_max"), pl.col("sa").mean().alias("sib_addr_mean")))
        f = f.join(sib, on="_i", how="left")
    else:
        f = f.with_columns(*[pl.lit(None, pl.Float32).alias(c) for c in
                             ("sib_name_max", "sib_name_mean", "sib_addr_max", "sib_addr_mean")])
    return f.sort("_i").drop("_i")
