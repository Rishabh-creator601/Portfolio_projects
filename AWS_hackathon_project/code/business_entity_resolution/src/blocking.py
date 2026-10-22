"""Scalable candidate generation (blocking) via an inverted index of rare keys.

Every record emits a handful of cheap string keys (all prefixed by country):
  n:<tok>        core-name token
  k:<skel>       consonant skeleton of a name token (typos / transliteration)
  b:<s1|s2>      every pair of sorted name skeletons (order- and noise-word-invariant)
  c:<concat>     name tokens concatenated / website handle ("royalfoods")
  a:<tok>        address word (len >= 3)
  d:<num>        address number
  q:<num|tok>    first address number x address word
  r:<skel|num>   name skeleton x first address number
  e:<tok|tok>    adjacent address-word pair
  (extra_keys=True, v5)
  f:<name>       full name (sorted skeletons) - finds generic names when the target has no address
  g:<name|tok>   full name / name-skeleton pair x one of the last 3 address words (city area)
  h:<num|tok|tok> first address number x adjacent address-word pair (house number + street)

Keys whose posting list in the target source is longer than `max_df` are
dropped (stop-keys), so a Source-1 record is only ever compared with target
records that share at least one *rare* key -- never an all-pairs scan. The
join is processed in chunks of Source-1 records, so memory is bounded.

Pairs are scored with a sum of IDF weights of shared keys (name and address
parts kept separately) and only the top-k per target source are kept.
"""
from dataclasses import dataclass

import numpy as np
import polars as pl


@dataclass
class BlockingConfig:
    top_k: int = 10          # per S1 record, per target source
    max_df: int = 400        # stop-key threshold in target source (per country)
    rel_min: float = 0.0     # keep if score >= rel_min * best score (per source)
    chunk: int = 10_000     # S1 records per join batch
    extra_keys: bool = False  # v5 keys f/g/h (see module docstring)


# kind codes: 0 n, 1 k, 2 b, 3 c, 10 f (name) | 4 a, 5 q, 6 d, 8 e, 11 h (address) | 7 r, 9 g (name x address)
KIND_W = [1.0, 0.6, 1.0, 1.5, 0.7, 1.0, 0.4, 1.0, 0.8, 1.5, 1.2, 1.2]
NAME_KINDS = [0, 1, 2, 3, 10]
SRC_T = pl.Enum(["S2", "S3"])
ADDR_KINDS = [4, 5, 6, 8, 11]


def _split(col):
    return pl.col(col).str.split(" ").list.eval(pl.element().filter(pl.element().str.len_chars() > 0))


def make_keys(df: pl.DataFrame, chunk: int = 500_000, extra: bool = False, keep=None) -> pl.DataFrame:
    """df needs: rid (u32), country, ntoks, nmain, skel, web, atoks, anums.
    Built in row chunks and hashed immediately: memory = 13 bytes per key.
    keep: optional frame of keys; other keys are dropped per chunk (they can never join)."""
    parts = []
    for i in range(0, df.height, chunk):
        k = _make_keys(df.slice(i, chunk), extra)
        parts.append(k if keep is None else k.join(keep, on="key", how="semi"))
    return pl.concat(parts)


def _pairs(col, max_items=6):
    """All unordered pairs of the first `max_items` (already sorted) list items."""
    from itertools import combinations
    exprs = [pl.col(col).list.get(i, null_on_oob=True) + "|" + pl.col(col).list.get(j, null_on_oob=True)
             for i, j in combinations(range(max_items), 2)]
    return pl.concat_list(exprs).list.drop_nulls()


def _emit(df, kind, col):
    return (df.select("rid", "cty", pl.col(col).alias("v")).explode("v").drop_nulls("v")
            .filter(pl.col("v").str.len_chars() > 0)
            .select("rid", "cty", pl.lit(kind, dtype=pl.UInt8).alias("kind"), "v"))


def _make_keys(df: pl.DataFrame, extra: bool = False) -> pl.DataFrame:
    alpha = pl.element().filter((pl.element().str.len_chars() >= 3) & ~pl.element().str.contains(r"^\d+$"))
    base = df.select(
        "rid",
        pl.col("country").str.to_lowercase().str.strip_chars().alias("cty"),
        _split("ntoks").list.eval(pl.element().filter(pl.element().str.len_chars() >= 2)).alias("nt"),
        _split("skel").list.eval(pl.element().filter(pl.element().str.len_chars() >= 2))
        .list.unique().list.sort().alias("sk"),
        pl.concat_list(pl.col("nmain").str.replace_all(" ", ""),
                       pl.col("ntoks").str.replace_all(" ", ""), "web")
        .list.eval(pl.element().filter(pl.element().str.len_chars() >= 5)).list.unique().alias("cc"),
        _split("atoks").list.eval(alpha).alias("at"),
        _split("anums").list.first().alias("n0"),
        _split("anums").alias("an"),
    ).with_columns(
        _pairs("sk").alias("skp"),
        pl.col("at").list.slice(0, pl.col("at").list.len() - 1).alias("at_a"),
        pl.col("at").list.slice(1).alias("at_b"),
    )
    parts = [
        _emit(base, 0, "nt"),
        _emit(base.with_columns(pl.col("sk").list.eval(pl.element().filter(pl.element().str.len_chars() >= 3))), 1, "sk"),
        _emit(base, 2, "skp"),
        _emit(base, 3, "cc"),
        _emit(base, 4, "at"),
        _emit(base, 6, "an"),
    ]
    withnum = base.filter(pl.col("n0").is_not_null())
    q = withnum.select("rid", "cty", "n0", "at").explode("at").drop_nulls("at")
    parts.append(q.select("rid", "cty", pl.lit(5, dtype=pl.UInt8).alias("kind"),
                          (pl.col("n0") + "|" + pl.col("at")).alias("v")))
    r = withnum.select("rid", "cty", "n0", pl.col("sk").list.head(6)).explode("sk").drop_nulls("sk")
    parts.append(r.select("rid", "cty", pl.lit(7, dtype=pl.UInt8).alias("kind"),
                          (pl.col("sk") + "|" + pl.col("n0")).alias("v")))
    e = base.select("rid", "cty", "at_a", "at_b").explode("at_a", "at_b").drop_nulls("at_a")
    parts.append(e.select("rid", "cty", pl.lit(8, dtype=pl.UInt8).alias("kind"),
                          (pl.col("at_a") + "|" + pl.col("at_b")).alias("v")))
    if extra:
        parts += _extra_keys(base)
    keys = pl.concat(parts)
    return (keys.select("rid", "kind",
                        (pl.col("cty") + ":" + pl.col("kind").cast(pl.Utf8) + ":" + pl.col("v")).hash().alias("key"))
            .unique(["rid", "key"]))


def _extra_keys(base):
    b = base.filter(pl.col("sk").list.len() > 0).with_columns(
        pl.col("sk").list.join("_").alias("nf"), pl.col("at").list.tail(3).alias("city"))
    f = b.select("rid", "cty", pl.lit(10, dtype=pl.UInt8).alias("kind"), pl.col("nf").alias("v"))
    g = (b.select("rid", "cty", pl.concat_list(pl.col("nf"), _pairs("sk", 4)).list.unique().alias("nm"), "city")
         .explode("nm").explode("city").drop_nulls(["nm", "city"])
         .select("rid", "cty", pl.lit(9, dtype=pl.UInt8).alias("kind"), (pl.col("nm") + "|" + pl.col("city")).alias("v")))
    h = (base.filter(pl.col("n0").is_not_null()).select("rid", "cty", "n0", "at_a", "at_b")
         .explode("at_a", "at_b").drop_nulls("at_a")
         .select("rid", "cty", pl.lit(11, dtype=pl.UInt8).alias("kind"),
                 (pl.col("n0") + "|" + pl.col("at_a") + "|" + pl.col("at_b")).alias("v")))
    return [f, g, h]


def _score_pairs(qc, kt, cfg):
    return (qc.join(kt, on="key", suffix="_t")
            .with_columns((pl.col("idf") * pl.col("kind").replace_strict(list(range(len(KIND_W))), KIND_W,
                                                                         return_dtype=pl.Float32)).alias("w"),
                          pl.col("kind").is_in(NAME_KINDS).alias("is_name"),
                          pl.col("kind").is_in(ADDR_KINDS).alias("is_addr"))
            .group_by("rid", "rid_t")
            .agg(pl.col("w").sum().alias("score"),
                 pl.col("w").filter(pl.col("is_name")).sum().alias("name_score"),
                 pl.col("w").filter(pl.col("is_addr")).sum().alias("addr_score"),
                 pl.len().alias("n_keys"))
            .with_columns(pl.col("score").rank("ordinal", descending=True).over("rid").alias("rank"),
                          pl.col("score").max().over("rid").alias("best"))
            .filter((pl.col("rank") <= cfg.top_k) & (pl.col("score") >= cfg.rel_min * pl.col("best")))
            .select(pl.col("rid").cast(pl.UInt32).alias("s1_rid"), pl.col("rid_t").cast(pl.UInt32).alias("t_rid"),
                    pl.col("score").cast(pl.Float32), pl.col("name_score").cast(pl.Float32),
                    pl.col("addr_score").cast(pl.Float32), pl.col("n_keys").cast(pl.UInt16),
                    pl.col("rank").cast(pl.UInt8)))


def generate_candidates(s1: pl.DataFrame, targets: dict, cfg: BlockingConfig, out_dir: str,
                        file_rows: int = 100_000, log=print) -> int:
    """Stream candidates to parquet files out_dir/{src}_{i:04d}.parquet, where file i covers
    S1 rids [i*file_rows, (i+1)*file_rows). Returns the number of S1 chunks.
    Memory: key tables + one join batch of `cfg.chunk` S1 records."""
    import os
    os.makedirs(out_dir, exist_ok=True)
    n_files = (int(s1.get_column("rid").max()) + file_rows) // file_rows
    k1 = make_keys(s1, extra=cfg.extra_keys)
    for src, t in targets.items():
        kt = make_keys(t, extra=cfg.extra_keys, keep=k1.select("key").unique())
        dft = kt.group_by("key").agg(pl.len().alias("df")).filter(pl.col("df") <= cfg.max_df)
        dft = dft.with_columns((np.log(t.height) - pl.col("df").cast(pl.Float64).log()).cast(pl.Float32).alias("idf"))
        kt = kt.join(dft.select("key", "idf"), on="key", how="inner")
        q = k1.join(dft.select("key"), on="key", how="semi").sort("rid")
        del dft
        for f in range(n_files):
            path = os.path.join(out_dir, f"{src}_{f:04d}.parquet")
            lo_f, hi_f = f * file_rows, (f + 1) * file_rows
            parts = []
            for lo in range(lo_f, hi_f, cfg.chunk):
                qc = q.filter(pl.col("rid").is_between(lo, min(lo + cfg.chunk, hi_f) - 1))
                if qc.height:
                    parts.append(_score_pairs(qc, kt, cfg))
            res = pl.concat(parts) if parts else _score_pairs(q.head(0), kt, cfg)
            res.with_columns(pl.lit(src, dtype=SRC_T).alias("src")).write_parquet(path)
            log(f"  blocking {src}: file {f + 1}/{n_files}, pairs {res.height}")
        del kt, q
    return n_files
