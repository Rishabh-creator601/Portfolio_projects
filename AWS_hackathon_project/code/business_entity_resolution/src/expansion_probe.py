"""Diagnostic: how many true pairs MISSED by candidate generation could be recovered by
query expansion (searching the target sources with an entity's already-matched records)?

Oracle version (upper bound): seeds = true matches that ARE in the stage-A candidate set.
For every seed record we emit the same rare keys as blocking and look up target records
sharing >= 1 rare key; a missed true pair counts as recoverable if it is retrieved within
the top-K by IDF score from any seed of its entity.

python src/expansion_probe.py --work <work_dir> [--n 20000]
"""
import argparse
import glob
import os

import numpy as np
import polars as pl

from blocking import KIND_W, make_keys


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", required=True)
    ap.add_argument("--n", type=int, default=20_000)
    ap.add_argument("--max-df", type=int, default=300)
    a = ap.parse_args()
    files = [f for f in sorted(glob.glob(os.path.join(a.work, "train_surv", "*.parquet"))) if os.path.getsize(f) > 1000]
    surv = pl.concat([pl.read_parquet(f, columns=["s1_rid", "t_rid", "y"]) for f in files])
    ids = np.random.default_rng(5).choice(surv["s1_rid"].unique().to_numpy(), size=a.n, replace=False)
    idl = pl.Series(ids).implode()
    surv = surv.filter(pl.col("s1_rid").is_in(idl))
    truth = pl.read_parquet(os.path.join(a.work, "train_truth.parquet")).filter(pl.col("s1_rid").is_in(idl))
    missed = truth.join(surv, on=["s1_rid", "t_rid"], how="anti")
    seeds = surv.filter(pl.col("y") == 1).select("s1_rid", "t_rid")
    print(f"entities {a.n}: true pairs {truth.height}, in candidates {truth.height - missed.height}, "
          f"missed {missed.height} ({missed.height / truth.height:.3%}); seeds {seeds.height}")

    rec_t = os.path.join(a.work, "train_rec_t.parquet")
    tgt = pl.read_parquet(rec_t, columns=["rid", "country", "ntoks", "nmain", "skel", "web", "atoks", "anums", "src"])
    # seed record keys (queries) and target key index (per source; country-prefixed like blocking)
    seed_rec = tgt.filter(pl.col("rid").is_in(seeds["t_rid"].unique().implode()))
    kq = make_keys(seed_rec).rename({"rid": "seed"})
    res = {}
    for src in ("S2", "S3"):
        t = tgt.filter(pl.col("src") == src)
        kt = make_keys(t)
        df = kt.group_by("key").agg(pl.len().alias("df")).filter(pl.col("df") <= a.max_df)
        df = df.with_columns((np.log(t.height) - pl.col("df").cast(pl.Float64).log()).alias("idf"))
        kt = kt.join(df.select("key", "idf"), on="key")
        hits = (kq.join(kt, on="key", suffix="_t")
                .with_columns((pl.col("idf") * pl.col("kind").replace_strict(list(range(9)), KIND_W,
                                                                             return_dtype=pl.Float64)).alias("w"))
                .group_by("seed", "rid").agg(pl.col("w").sum().alias("score"))
                .filter(pl.col("seed") != pl.col("rid"))
                .with_columns(pl.col("score").rank("ordinal", descending=True).over("seed").alias("rk")))
        res[src] = hits
        del kt, df
    hits = pl.concat(res.values()).join(seeds.rename({"t_rid": "seed"}), on="seed")
    for K in (3, 5, 10, 20):
        got = hits.filter(pl.col("rk") <= K).select("s1_rid", pl.col("rid").alias("t_rid")).unique()
        rec = missed.join(got, on=["s1_rid", "t_rid"]).height
        new = got.join(surv, on=["s1_rid", "t_rid"], how="anti").height
        print(f"top-{K} per seed: recovers {rec}/{missed.height} missed pairs ({rec / max(1, missed.height):.1%}); "
              f"new candidates per entity {new / a.n:.2f}")


if __name__ == "__main__":
    main()
