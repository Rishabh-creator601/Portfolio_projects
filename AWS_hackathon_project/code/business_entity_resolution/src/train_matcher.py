"""Train and compare matcher variants on the cached survivor table (build_survivors.py).

python src/train_matcher.py --data <dataset_dir> --work <work_dir> [--save]

Variants (same 80/20 split by S1 entity, exact macro F0.5 on the holdout):
  B0  base features                        (the submitted model's feature set)
  B1  base + extra features (IDF overlaps, house-number distance)
  C   B1 + sibling features built from out-of-fold B1 probabilities (second round)
With --save, the chosen models are refit on all rows and saved with decision_v2.json.
"""
import argparse
import glob
import json
import os
import time

import lightgbm as lgb
import numpy as np
import polars as pl
from sklearn.model_selection import GroupKFold

from data import macro_f05
from features2 import sibling_features

T0 = time.time()
PARAMS = dict(objective="binary", learning_rate=0.05, num_leaves=127, min_child_samples=50,
              feature_fraction=0.8, bagging_fraction=0.8, bagging_freq=1, lambda_l2=1.0,
              verbose=-1, seed=42, num_threads=os.cpu_count())
ROUNDS = 1200
META = {"s1_rid", "t_rid", "src", "ntoks_2", "atoks_2", "y", "pa"}
EXTRA_PREFIX = ("wn_", "wa_", "num_")


def log(m):
    print(f"[{time.time() - T0:7.0f}s] {m}", flush=True)


def decide(k, p, thr):
    d = k.select("s1_rid", "t_rid").with_columns(pl.Series("p", p)).filter(pl.col("p") >= thr)
    return d.sort("p", descending=True).unique("t_rid", keep="first")


def best_threshold(k, p, truth, ids):
    res = {float(t): macro_f05(decide(k, p, t).select("s1_rid", "t_rid"), truth, ids)
           for t in np.round(np.arange(0.3, 0.91, 0.025), 3)}
    t = max(res, key=res.get)
    return t, res[t]


def oof(X, y, groups, n_folds=4):
    p = np.zeros(len(y))
    for tr, va in GroupKFold(n_folds).split(X, y, groups):
        p[va] = lgb.train(PARAMS, lgb.Dataset(X[tr], y[tr]), ROUNDS).predict(X[va])
    return p


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data")
    ap.add_argument("--work", required=True)
    ap.add_argument("--save", action="store_true")
    a = ap.parse_args()
    files = [f for f in sorted(glob.glob(os.path.join(a.work, "train_surv", "*.parquet"))) if os.path.getsize(f) > 1000]
    df = pl.concat([pl.read_parquet(f) for f in files], how="diagonal_relaxed")
    sample = np.load(os.path.join(a.work, "train_surv_sample.npy"))
    truth = pl.read_parquet(os.path.join(a.work, "train_truth.parquet"))
    truth = truth.filter(pl.col("s1_rid").is_in(pl.Series(sample).implode()))
    base_cols = [c for c in df.columns if c not in META and not c.startswith(EXTRA_PREFIX)]
    extra_cols = [c for c in df.columns if c.startswith(EXTRA_PREFIX)]
    log(f"rows {df.height}, S1 sample {len(sample)}, base {len(base_cols)}, extra {len(extra_cols)}")

    rng = np.random.default_rng(0)
    hold_ids = np.sort(rng.choice(sample, size=len(sample) // 5, replace=False))
    is_hold = df["s1_rid"].is_in(pl.Series(hold_ids).implode()).to_numpy()
    fit = ~is_hold
    y = df["y"].to_numpy()
    k = df.select("s1_rid", "t_rid", "src")
    kh = k.filter(pl.Series(is_hold))
    truth_h = truth.filter(pl.col("s1_rid").is_in(pl.Series(hold_ids).implode()))
    ceil = macro_f05(kh.join(truth_h, on=["s1_rid", "t_rid"]), truth_h, hold_ids)
    log(f"holdout S1 {len(hold_ids)}, ceiling {ceil:.4f}")

    results = {}
    X0 = df.select(base_cols).to_numpy().astype(np.float32)
    m0 = lgb.train(PARAMS, lgb.Dataset(X0[fit], y[fit]), ROUNDS)
    results["B0_base"] = best_threshold(kh, m0.predict(X0[is_hold]), truth_h, hold_ids)
    log(f"B0 base: {results['B0_base']}")
    del X0, m0

    b1_cols = base_cols + extra_cols
    X1 = df.select(b1_cols).to_numpy().astype(np.float32)
    m1 = lgb.train(PARAMS, lgb.Dataset(X1[fit], y[fit], feature_name=b1_cols), ROUNDS)
    p1h = m1.predict(X1[is_hold])
    results["B1_extra"] = best_threshold(kh, p1h, truth_h, hold_ids)
    log(f"B1 +extra: {results['B1_extra']}")
    imp = sorted(zip(m1.feature_importance("gain"), b1_cols), reverse=True)
    log("B1 top features: " + ", ".join(n for _, n in imp[:20]))

    # second round: OOF B1 probs on the fit part, B1(fit) probs on holdout
    groups = df["s1_rid"].to_numpy()
    pb = np.zeros(len(y))
    fi = np.where(fit)[0]
    pb[fi] = oof(X1[fi], y[fi], groups[fi])
    pb[is_hold] = p1h
    S = sibling_features(k, df.select("ntoks_2", "atoks_2"), pb)
    c_cols = b1_cols + ["pb"] + S.columns
    XC = np.hstack([X1, pb[:, None].astype(np.float32), S.to_numpy().astype(np.float32)])
    mc = lgb.train(PARAMS, lgb.Dataset(XC[fit], y[fit], feature_name=c_cols), ROUNDS)
    results["C_sibling"] = best_threshold(kh, mc.predict(XC[is_hold]), truth_h, hold_ids)
    log(f"C +sibling: {results['C_sibling']}")
    json.dump({kk: list(v) for kk, v in results.items()} | {"ceiling": ceil},
              open(os.path.join(a.work, "matcher_results.json"), "w"), indent=1)

    if a.save:
        best = max(results, key=lambda r: results[r][1])
        log(f"saving variant {best}")
        m1 = lgb.train(PARAMS, lgb.Dataset(X1, y, feature_name=b1_cols), ROUNDS)
        m1.save_model(os.path.join(a.work, "model_b1.txt"))
        dec = json.load(open(os.path.join(a.work, "decision.json")))
        dec2 = dict(keep_k=dec["keep_k"], thr_a=dec["thr_a"], feats_a=dec["feats_a"], feats_b1=b1_cols,
                    variant=best, thr=results[best][0])
        if best == "C_sibling":
            pb_all = oof(X1, y, groups)          # OOF on all rows for the second-round model
            S = sibling_features(k, df.select("ntoks_2", "atoks_2"), pb_all)
            XC = np.hstack([X1, pb_all[:, None].astype(np.float32), S.to_numpy().astype(np.float32)])
            lgb.train(PARAMS, lgb.Dataset(XC, y, feature_name=c_cols), ROUNDS).save_model(
                os.path.join(a.work, "model_c.txt"))
            dec2["feats_c"] = c_cols
        json.dump(dec2, open(os.path.join(a.work, "decision_v2.json"), "w"), indent=1)
        log("saved")


if __name__ == "__main__":
    main()
