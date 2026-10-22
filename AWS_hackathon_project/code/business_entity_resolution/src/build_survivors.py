"""Build the stage-B training table: stage-A survivors with all features, for a sample
of training S1 entities. Candidate generation (retrieval + stage A) is unchanged.

python src/build_survivors.py --data <dataset_dir> --work <work_dir> [--n 600000]

One subprocess per candidate chunk keeps memory bounded. Output:
work/surv/<chunk>.parquet with keys, label y, stage-A prob pa, base + extra features
and the candidate name/address tokens (for sibling features).
"""
import argparse
import json
import os
import subprocess
import sys
import time

import lightgbm as lgb
import numpy as np
import polars as pl

import candidates as C
from data import load_rows, load_split, load_truth
from features import attach, build_features
from features2 import extra_features, idf_tables
from predict import stage_a_filter

T0 = time.time()


def log(m):
    print(f"[{time.time() - T0:7.0f}s] {m}", flush=True)


def one_chunk(a, i):
    dec = json.load(open(os.path.join(a.work, "decision.json")))
    mA = lgb.Booster(model_file=os.path.join(a.work, "model_a.txt"))
    idf_n, idf_a = idf_tables(a.work, a.split)
    d = os.path.join(a.work, f"{a.split}_cands_k20_df300")
    ch = C.Chunks(d)
    sample = pl.Series(np.load(os.path.join(a.work, f"{a.split}_surv_sample.npy"))).implode() \
        if a.split == "train" else None
    c = ch.load(i, sample)
    out = os.path.join(a.work, f"{a.split}_surv", f"{i:04d}.parquet")
    if c is None:
        pl.DataFrame().write_parquet(out)
        return
    s1c, tgc = load_rows(a.work, a.split, c["s1_rid"].unique(), c["t_rid"].unique())
    ids = c["s1_rid"].unique().sort()
    parts = []
    for j in range(0, len(ids), 10_000):          # slices keep memory bounded
        p = attach(c.filter(pl.col("s1_rid").is_in(ids[j:j + 10_000].implode())), s1c, tgc)
        X = build_features(p)
        pa = mA.predict(X.select(dec["feats_a"]).to_numpy().astype(np.float32))
        m = stage_a_filter(p.select("s1_rid", "t_rid", "src"), pa, dec["thr_a"], dec["keep_k"])
        ms = pl.Series(m)
        p, X = p.filter(ms), X.filter(ms)
        E = extra_features(p, idf_n, idf_a)
        parts.append(pl.concat([p.select("s1_rid", "t_rid", "src", "ntoks_2", "atoks_2"),
                                pl.DataFrame({"pa": pa[m].astype(np.float32)}), X, E], how="horizontal"))
        del p, X, E
    res = pl.concat(parts)
    if a.split == "train":
        tr = pl.read_parquet(os.path.join(a.work, "train_truth.parquet")).with_columns(pl.lit(1, pl.Int8).alias("y"))
        res = res.join(tr, on=["s1_rid", "t_rid"], how="left").with_columns(pl.col("y").fill_null(0))
    res.write_parquet(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data")
    ap.add_argument("--work", required=True)
    ap.add_argument("--split", default="train")
    ap.add_argument("--n", type=int, default=600_000)
    ap.add_argument("--chunk", type=int, default=None)
    a = ap.parse_args()
    if a.chunk is not None:
        return one_chunk(a, a.chunk)

    os.makedirs(os.path.join(a.work, f"{a.split}_surv"), exist_ok=True)
    if a.split == "train":
        tp = os.path.join(a.work, "train_truth.parquet")
        sp = os.path.join(a.work, "train_surv_sample.npy")
        if not (os.path.exists(tp) and os.path.exists(sp)):
            s1, tgt = load_split(a.work, "train")
            load_truth(a.data, s1, tgt).write_parquet(tp)
            n1 = s1.height
            del s1, tgt
            # exclude entities used to train the stage-A model (pipeline.py sample, seed 42)
            used = np.random.default_rng(42).choice(n1, size=250_000, replace=False)
            rest = np.setdiff1d(np.arange(n1), used)
            np.save(sp, np.sort(np.random.default_rng(123).choice(rest, size=a.n, replace=False)).astype(np.uint32))
    idf_tables(a.work, a.split)
    n_chunks = len(C.Chunks(os.path.join(a.work, f"{a.split}_cands_k20_df300")))
    for i in range(n_chunks):
        out = os.path.join(a.work, f"{a.split}_surv", f"{i:04d}.parquet")
        if os.path.exists(out):
            continue
        subprocess.run([sys.executable, os.path.abspath(__file__), "--work", a.work, "--split", a.split,
                        "--chunk", str(i)], check=True)
        log(f"survivors chunk {i + 1}/{n_chunks} done")


if __name__ == "__main__":
    main()
