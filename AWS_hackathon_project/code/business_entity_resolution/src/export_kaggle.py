"""Export stage-A candidate pairs + raw record text for the GPU cross-encoder (Kaggle).

python src/export_kaggle.py --work <work_dir> --out <kaggle_data_dir>

Writes (all parquet, zstd):
  train_pairs.parquet  s1_rid, t_rid, y, part   (part: "ce" -> cross-encoder training,
                                                  "lgb" -> scored by the cross-encoder and
                                                  used to train the final LightGBM)
  test_pairs.parquet   s1_rid, t_rid
  {split}_s1_text.parquet / {split}_t_text.parquet   rid, name, addr  (only rows used)
"""
import argparse
import glob
import os

import numpy as np
import polars as pl


def texts(work, split, s1_rids, t_rids, out):
    s1_rids = pl.Series(np.unique(s1_rids).astype(np.uint32)).implode()
    t_rids = pl.Series(np.unique(t_rids).astype(np.uint32)).implode()
    sel = lambda lf: lf.select("rid", pl.col("business_name").alias("name"), pl.col("business_address").alias("addr"))
    (sel(pl.scan_parquet(os.path.join(work, f"{split}_s1.parquet")).with_row_index("rid"))
     .filter(pl.col("rid").is_in(s1_rids)).collect()
     .write_parquet(os.path.join(out, f"{split}_s1_text.parquet"), compression="zstd"))
    p2 = os.path.join(work, f"{split}_s2.parquet")
    n2 = pl.scan_parquet(p2).select(pl.len()).collect().item()
    t2 = sel(pl.scan_parquet(p2).with_row_index("rid")).filter(pl.col("rid").is_in(t_rids)).collect()
    t3 = (sel(pl.scan_parquet(os.path.join(work, f"{split}_s3.parquet")).with_row_index("rid")
              .with_columns(pl.col("rid") + n2)).filter(pl.col("rid").is_in(t_rids)).collect())
    pl.concat([t2, t3]).write_parquet(os.path.join(out, f"{split}_t_text.parquet"), compression="zstd")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)

    files = [f for f in sorted(glob.glob(os.path.join(a.work, "train_surv", "*.parquet"))) if os.path.getsize(f) > 1000]
    tr = pl.concat([pl.read_parquet(f, columns=["s1_rid", "t_rid", "y"]) for f in files])
    sample = np.load(os.path.join(a.work, "train_surv_sample.npy"))
    ce_ids = np.random.default_rng(11).choice(sample, size=len(sample) // 2, replace=False)
    tr = tr.with_columns(pl.when(pl.col("s1_rid").is_in(pl.Series(ce_ids).implode()))
                         .then(pl.lit("ce")).otherwise(pl.lit("lgb")).alias("part"))
    tr.write_parquet(os.path.join(a.out, "train_pairs.parquet"), compression="zstd")
    np.save(os.path.join(a.work, "ce_train_ids.npy"), np.sort(ce_ids))
    texts(a.work, "train", tr["s1_rid"].to_numpy(), tr["t_rid"].to_numpy(), a.out)
    print("train pairs", tr.height, tr.group_by("part").len().to_dicts())

    te = pl.read_parquet(os.path.join(a.work, "test_scores", "*.parquet"), columns=["s1_rid", "t_rid"])
    te.write_parquet(os.path.join(a.out, "test_pairs.parquet"), compression="zstd")
    texts(a.work, "test", te["s1_rid"].to_numpy(), te["t_rid"].to_numpy(), a.out)
    print("test pairs", te.height)


if __name__ == "__main__":
    main()
