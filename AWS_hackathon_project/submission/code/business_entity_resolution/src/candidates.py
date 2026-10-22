"""Disk-backed candidate tables + context features.

Blocking writes one parquet per (target source, S1-rid range). Context features:
  * per-S1 (score_rel, n_cands_src, n_cands, is_s3): computed inside a chunk, since a
    chunk holds every candidate of its S1 records.
  * per-target "reverse" features (rev_rank, rev_n, rev_rel): need all S1 competing for
    the same target record (each S2/S3 record matches at most one S1), so they are
    computed once over a slim 3-column table and joined back chunk by chunk.
"""
import glob
import os

import polars as pl

from blocking import generate_candidates

FILE_ROWS = 100_000


def build(split, s1, tgt, cfg, work, log=print):
    d = os.path.join(work, f"{split}_cands_k{cfg.top_k}_df{cfg.max_df}")
    done = os.path.join(d, "_DONE")
    if not os.path.exists(done):
        targets = {"S2": tgt.filter(pl.col("src") == "S2"), "S3": tgt.filter(pl.col("src") == "S3")}
        generate_candidates(s1, targets, cfg, d, file_rows=FILE_ROWS, log=log)
        slim = pl.scan_parquet(glob.glob(os.path.join(d, "S*_*.parquet"))).select(
            "s1_rid", "t_rid", "score").collect()
        rev = slim.with_columns(
            pl.col("score").rank("min", descending=True).over("t_rid").cast(pl.UInt16).alias("rev_rank"),
            pl.len().over("t_rid").cast(pl.UInt16).alias("rev_n"),
            (pl.col("score") / pl.col("score").max().over("t_rid")).cast(pl.Float32).alias("rev_rel"),
        ).drop("score").sort("s1_rid")
        rev.write_parquet(os.path.join(d, "rev.parquet"))
        log(f"  {split} candidates: {slim.height} pairs")
        del slim, rev
        open(done, "w").close()
    return d


class Chunks:
    """Iterate candidate chunks (all candidates of an S1-rid range) with context features."""

    def __init__(self, d):
        self.d = d
        self.files = sorted({os.path.basename(p).split("_")[1] for p in glob.glob(os.path.join(d, "S2_*.parquet"))})
        self.rev_path = os.path.join(d, "rev.parquet")   # read lazily per chunk (bounded memory)

    def __len__(self):
        return len(self.files)

    def load(self, i, s1_subset=None) -> pl.DataFrame:
        f = self.files[i]
        c = pl.concat([pl.read_parquet(os.path.join(self.d, f"{s}_{f}")) for s in ("S2", "S3")])
        if s1_subset is not None:
            c = c.filter(pl.col("s1_rid").is_in(s1_subset))
        if c.height == 0:
            return None
        lo, hi = int(i * FILE_ROWS), int((i + 1) * FILE_ROWS)
        rev = pl.scan_parquet(self.rev_path).filter(pl.col("s1_rid").is_between(lo, hi - 1)).collect()
        c = c.join(rev, on=["s1_rid", "t_rid"], how="left")
        return c.with_columns(
            (pl.col("src") == "S3").cast(pl.Int8).alias("is_s3"),
            (pl.col("score") / pl.col("score").max().over("s1_rid", "src")).cast(pl.Float32).alias("score_rel"),
            pl.len().over("s1_rid", "src").cast(pl.UInt16).alias("n_cands_src"),
            pl.len().over("s1_rid").cast(pl.UInt16).alias("n_cands"),
        )

    def __iter__(self):
        for i in range(len(self)):
            c = self.load(i)
            if c is not None:
                yield c
