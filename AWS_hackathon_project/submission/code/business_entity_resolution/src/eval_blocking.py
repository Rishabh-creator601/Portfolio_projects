"""Blocking diagnostics on training data: recall ceiling vs. candidate-set size.

python src/eval_blocking.py --data <dataset_dir> --work <work_dir> [--sample 200000]
"""
import argparse
import time

import polars as pl

from blocking import BlockingConfig, generate_candidates
from data import load_split, load_truth, macro_f05


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--work", required=True)
    ap.add_argument("--sample", type=int, default=200_000)
    ap.add_argument("--top-k", type=int, nargs="+", default=[10])
    ap.add_argument("--max-df", type=int, nargs="+", default=[400])
    a = ap.parse_args()
    s1, tgt = load_split(a.work, "train")
    truth = load_truth(a.data, s1, tgt)
    s1s = s1.sample(a.sample, seed=0) if a.sample else s1
    ids = s1s["rid"]
    truth_s = truth.filter(pl.col("s1_rid").is_in(ids.implode()))
    print(f"S1 sample {len(ids)}, true pairs {truth_s.height}")
    for mdf in a.max_df:
        for k in a.top_k:
            t = time.time()
            cfg = BlockingConfig(top_k=k, max_df=mdf)
            c = generate_candidates(s1s, {"S2": tgt.filter(pl.col("src") == "S2"),
                                          "S3": tgt.filter(pl.col("src") == "S3")}, cfg, log=lambda *_: None)
            hit = c.join(truth_s, on=["s1_rid", "t_rid"]).height
            ceil = macro_f05(c.join(truth_s, on=["s1_rid", "t_rid"]).select("s1_rid", "t_rid"), truth_s, ids)
            # recall by rank budget
            by_k = {kk: c.filter(pl.col("rank") <= kk).join(truth_s, on=["s1_rid", "t_rid"]).height / truth_s.height
                    for kk in (3, 5, 6, 8, 10, 15, 20) if kk <= k}
            print(f"max_df={mdf} top_k={k}: cands/S1={c.height / len(ids):.2f} pair_recall={hit / truth_s.height:.4f} "
                  f"f05_ceiling={ceil:.4f} recall@k={ {kk: round(v, 4) for kk, v in by_k.items()} } "
                  f"({time.time() - t:.0f}s)", flush=True)


if __name__ == "__main__":
    main()
