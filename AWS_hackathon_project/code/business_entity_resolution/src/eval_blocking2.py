"""Blocking recall check from the cached work/ tables (no raw dataset needed): v4 keys vs v5 extra keys.

python src/eval_blocking2.py --work <work_dir> [--sample 100000] [--top-k 20] [--max-df 300]
"""
import argparse
import os
import tempfile
import time

import polars as pl

from blocking import BlockingConfig, generate_candidates
from data import macro_f05


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", required=True)
    ap.add_argument("--sample", type=int, default=100_000)
    ap.add_argument("--top-k", type=int, default=20)
    ap.add_argument("--max-df", type=int, default=300)
    ap.add_argument("--modes", nargs="+", default=["base", "extra"])
    a = ap.parse_args()
    s1 = pl.read_parquet(os.path.join(a.work, "train_rec_s1.parquet"))
    tgt = pl.read_parquet(os.path.join(a.work, "train_rec_t.parquet"))
    s1s = s1.sample(a.sample, seed=0)
    del s1
    ids = s1s["rid"]
    truth = pl.read_parquet(os.path.join(a.work, "train_truth.parquet")).filter(pl.col("s1_rid").is_in(ids.implode()))
    print(f"S1 sample {len(ids)}, true pairs {truth.height}", flush=True)
    targets = {s: tgt.filter(pl.col("src") == s) for s in ("S2", "S3")}
    del tgt
    for mode in a.modes:
        t = time.time()
        cfg = BlockingConfig(top_k=a.top_k, max_df=a.max_df, extra_keys=(mode == "extra"))
        with tempfile.TemporaryDirectory() as d:
            generate_candidates(s1s, targets, cfg, d, file_rows=10_000_000, log=lambda *_: None)
            c = pl.read_parquet(os.path.join(d, "*.parquet"))
        hitp = c.join(truth, on=["s1_rid", "t_rid"])
        by_k = {k: round(c.filter(pl.col("rank") <= k).join(truth, on=["s1_rid", "t_rid"]).height / truth.height, 4)
                for k in (5, 10, 15, 20, 30, 40) if k <= a.top_k}
        print(f"{mode}: cands/S1={c.height / len(ids):.2f} pair_recall={hitp.height / truth.height:.4f} "
              f"f05_ceiling={macro_f05(hitp.select('s1_rid', 't_rid'), truth, ids):.4f} recall@k={by_k} "
              f"({time.time() - t:.0f}s)", flush=True)


if __name__ == "__main__":
    main()
