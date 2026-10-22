"""Final matcher (v2): LightGBM round 1 -> sibling features -> LightGBM round 2,
optionally with GPU cross-encoder scores as extra features. Writes the submission.

python src/final_model.py --data <dataset_dir> --work <work_dir> --out <output_dir> [--ce ce ce2]

  --ce (none)  : trains on all 600k sampled training entities (train_surv) without transformer scores
  --ce ce ce2  : uses cross-encoder scores (from kaggle/*.py) as features; trains on the "lgb" half of
                 the sample, the entities the cross-encoders did NOT train on (no leakage)
Validation: 20% of the training entities (grouped by S1), exact macro F0.5.
The candidate set (stage-A survivors, candidate_pairs.tsv) is unchanged.
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
from predict import write_outputs

T0 = time.time()
PARAMS = dict(objective="binary", learning_rate=0.05, num_leaves=127, min_child_samples=50,
              feature_fraction=0.8, bagging_fraction=0.8, bagging_freq=1, lambda_l2=1.0,
              verbose=-1, seed=42, num_threads=os.cpu_count())
ROUNDS = 1200
META = {"s1_rid", "t_rid", "src", "ntoks_2", "atoks_2", "y", "pa"}


def log(m):
    print(f"[{time.time() - T0:7.0f}s] {m}", flush=True)


def load_surv(work, split):
    files = [f for f in sorted(glob.glob(os.path.join(work, f"{split}_surv", "*.parquet"))) if os.path.getsize(f) > 1000]
    return pl.concat([pl.read_parquet(f) for f in files], how="diagonal_relaxed")


def add_ce(df, work, split, names):
    for n in names:
        tag = "train_lgb" if split == "train" else "test"
        s = pl.read_parquet(os.path.join(work, "ce", f"{n}_{tag}.parquet")).rename({"ce": n})
        df = df.join(s, on=["s1_rid", "t_rid"], how="left")
    return df


def decide(k, p, thr):
    d = k.select("s1_rid", "t_rid").with_columns(pl.Series("p", p)).filter(pl.col("p") >= thr)
    return d.sort("p", descending=True).unique("t_rid", keep="first")


def tune(k, p, truth, ids):
    res = {float(t): macro_f05(decide(k, p, t).select("s1_rid", "t_rid"), truth, ids)
           for t in np.round(np.arange(0.3, 0.91, 0.025), 3)}
    t = max(res, key=res.get)
    return t, res[t]


def oof(X, y, groups, n_folds=4):
    p = np.zeros(len(y))
    for tr, va in GroupKFold(n_folds).split(X, y, groups):
        p[va] = lgb.train(PARAMS, lgb.Dataset(X[tr], y[tr]), ROUNDS).predict(X[va])
    return p


def round2_matrix(df, X1, pb):
    S = sibling_features(df.select("s1_rid", "t_rid", "src"), df.select("ntoks_2", "atoks_2"), pb)
    return np.hstack([X1, pb[:, None].astype(np.float32), S.to_numpy().astype(np.float32)]), ["pb"] + S.columns


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--work", required=True)
    ap.add_argument("--out", default="output")
    ap.add_argument("--ce", nargs="*", default=[])
    ap.add_argument("--skip-test", action="store_true")
    a = ap.parse_args()

    tr = load_surv(a.work, "train")
    sample = np.load(os.path.join(a.work, "train_surv_sample.npy"))
    if a.ce:   # only entities the cross-encoders did not train on
        ce_ids = np.load(os.path.join(a.work, "ce_train_ids.npy"))
        sample = np.setdiff1d(sample, ce_ids)
        tr = tr.filter(pl.col("s1_rid").is_in(pl.Series(sample).implode()))
        tr = add_ce(tr, a.work, "train", a.ce)
    truth = pl.read_parquet(os.path.join(a.work, "train_truth.parquet"))
    truth = truth.filter(pl.col("s1_rid").is_in(pl.Series(sample).implode()))
    f1 = [c for c in tr.columns if c not in META]
    log(f"train rows {tr.height}, entities {len(sample)}, features {len(f1)} (ce: {a.ce})")

    hold = np.sort(np.random.default_rng(0).choice(sample, size=len(sample) // 5, replace=False))
    is_hold = tr["s1_rid"].is_in(pl.Series(hold).implode()).to_numpy()
    fit = ~is_hold
    y = tr["y"].to_numpy()
    groups = tr["s1_rid"].to_numpy()
    X1 = tr.select(f1).to_numpy().astype(np.float32)
    tr = tr.select("s1_rid", "t_rid", "src", "ntoks_2", "atoks_2")   # keep only what round 2 needs
    import gc
    gc.collect()
    k = tr.select("s1_rid", "t_rid", "src")
    kh = k.filter(pl.Series(is_hold))
    truth_h = truth.filter(pl.col("s1_rid").is_in(pl.Series(hold).implode()))

    # ---- validation of the full two-round procedure
    pb = np.zeros(len(y))
    fi = np.where(fit)[0]
    pb[fi] = oof(X1[fi], y[fi], groups[fi])
    m1 = lgb.train(PARAMS, lgb.Dataset(X1[fit], y[fit]), ROUNDS)
    pb[is_hold] = m1.predict(X1[is_hold])
    r1 = tune(kh, pb[is_hold], truth_h, hold)
    X2, f2x = round2_matrix(tr, X1, pb)
    m2 = lgb.train(PARAMS, lgb.Dataset(X2[fit], y[fit]), ROUNDS)
    r2 = tune(kh, m2.predict(X2[is_hold]), truth_h, hold)
    log(f"validation: round1 {r1}, round2 {r2}")
    thr = r2[0]
    json.dump({"ce": a.ce, "round1": r1, "round2": r2, "entities": len(sample)},
              open(os.path.join(a.work, f"final_val_{'_'.join(a.ce) or 'noce'}.json"), "w"), indent=1)
    if a.skip_test:
        return

    # ---- refit on all rows
    pb_all = oof(X1, y, groups)
    m1 = lgb.train(PARAMS, lgb.Dataset(X1, y, feature_name=f1), ROUNDS)
    X2, f2x = round2_matrix(tr, X1, pb_all)
    m2 = lgb.train(PARAMS, lgb.Dataset(X2, y, feature_name=f1 + f2x), ROUNDS)
    tag = "_".join(a.ce) or "noce"
    m1.save_model(os.path.join(a.work, f"final_r1_{tag}.txt"))
    m2.save_model(os.path.join(a.work, f"final_r2_{tag}.txt"))
    imp = sorted(zip(m2.feature_importance("gain"), f1 + f2x), reverse=True)
    log("round-2 top features: " + ", ".join(n for _, n in imp[:20]))
    del tr, X1, X2

    # ---- test (wait until every test chunk has been featurised; never score partial data)
    n_exp = len(glob.glob(os.path.join(a.work, "test_cands_k20_df300", "S2_*.parquet")))
    while len(glob.glob(os.path.join(a.work, "test_surv", "*.parquet"))) < n_exp:
        log("waiting for test survivor features ...")
        time.sleep(60)
    time.sleep(10)
    te = load_surv(a.work, "test")
    if a.ce:
        te = add_ce(te, a.work, "test", a.ce)
    Xt = te.select(f1).to_numpy().astype(np.float32)
    pt1 = m1.predict(Xt)
    Xt2, _ = round2_matrix(te, Xt, pt1)
    pt = m2.predict(Xt2)
    kt = te.select("s1_rid", "t_rid")
    kt.with_columns(pl.Series("p", pt)).write_parquet(os.path.join(a.work, f"test_final_{tag}.parquet"))
    pred = decide(kt, pt, thr)
    from data import load_split
    s1t, tgtt = load_split(a.work, "test")
    cand = pl.read_parquet(os.path.join(a.work, "test_scores", "*.parquet")).select("s1_rid", "t_rid")
    write_outputs(s1t, tgtt, cand, pred, a.out)
    log(f"test: threshold {thr}, matched pairs {pred.height}, non-empty S1 {pred['s1_rid'].n_unique()}/{s1t.height}")


if __name__ == "__main__":
    main()
