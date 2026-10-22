"""Step 2: blocking -> stage-A filter -> stage-B matcher -> decision rule -> outputs.

python src/pipeline.py --data <dataset_dir> --work <work_dir> --out <output_dir>

Candidate generation is a cascade:
  1. rare-key inverted index retrieves up to top_k records per target source (blocking.py)
  2. stage-A filter: a small LightGBM on cheap similarity features keeps pairs with
     p_A >= thr_A and rank_A <= keep_k per source.  -> candidate_pairs.tsv
Stage-B: the full LightGBM matcher scores only stage-A survivors; a macro-F0.5
tuned decision rule (+ one-S1-per-target constraint) gives matching_results.tsv.

Training: block ALL train S1 (so competition-based context features match test
conditions), featurize a sample of S1 entities; 80% fit / 20% holdout (by S1).
Stage-A predictions on the fit part are out-of-fold, so stage-B trains on the
same distribution of survivors it sees at inference.
"""
import argparse
import json
import os
import time

import lightgbm as lgb
import numpy as np
import polars as pl
from sklearn.model_selection import GroupKFold

from blocking import BlockingConfig
import candidates as C
import predict as P
from data import load_split, load_truth, macro_f05
from features import attach, build_features

SEED = 42
THREADS = os.cpu_count()
PARAMS_A = dict(objective="binary", learning_rate=0.1, num_leaves=63, min_child_samples=100,
                feature_fraction=0.9, bagging_fraction=0.7, bagging_freq=1, verbose=-1, seed=SEED,
                num_threads=THREADS)
PARAMS_B = dict(objective="binary", learning_rate=0.05, num_leaves=127, min_child_samples=50,
                feature_fraction=0.8, bagging_fraction=0.8, bagging_freq=1, lambda_l2=1.0,
                verbose=-1, seed=SEED, num_threads=THREADS)
ROUNDS_A, ROUNDS_B = 300, 1000
# cheap features for the stage-A filter
FEATS_A = ["score", "name_score", "addr_score", "n_keys", "rank", "is_s3", "score_rel", "n_cands_src",
           "rev_rank", "rev_n", "rev_rel", "n_tsort", "n_tset", "n_skel_tset", "n_concat_ratio",
           "a_tset", "d_jacc", "d_common", "n_jacc", "a_jacc", "nat2", "aempty1", "aempty2"]
T0 = time.time()


def log(msg):
    print(f"[{time.time() - T0:7.0f}s] {msg}", flush=True)


def featurize(c, s1, tgt):
    p = attach(c, s1, tgt)
    return p.select("s1_rid", "t_rid", "src"), build_features(p)


def stage_a_filter(keys: pl.DataFrame, pa: np.ndarray, thr: float, keep_k: int) -> np.ndarray:
    """Boolean mask of pairs surviving stage A."""
    r = (keys.select("s1_rid", "src").with_columns(pl.Series("pa", pa))
         .with_columns(pl.col("pa").rank("ordinal", descending=True).over("s1_rid", "src").alias("ra")))
    return ((r["pa"] >= thr) & (r["ra"] <= keep_k)).to_numpy()


def decide(keys: pl.DataFrame, prob: np.ndarray, thr: float) -> pl.DataFrame:
    """Keep pairs with prob >= thr; each target record goes to at most one S1 (its best)."""
    d = keys.select("s1_rid", "t_rid").with_columns(pl.Series("p", prob)).filter(pl.col("p") >= thr)
    return d.sort("p", descending=True).unique("t_rid", keep="first")


def empty_gate(pred: pl.DataFrame, gate: float) -> pl.DataFrame:
    """Drop all matches of an S1 whose best probability is below `gate` (singleton guard)."""
    return pred.filter(pl.col("p").max().over("s1_rid") >= gate)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--work", required=True)
    ap.add_argument("--out", default="output")
    ap.add_argument("--train-s1", type=int, default=250_000)
    ap.add_argument("--top-k", type=int, default=20)
    ap.add_argument("--max-df", type=int, default=300)
    ap.add_argument("--recall-loss", type=float, default=0.003,
                    help="max holdout pair-recall loss allowed for stage A vs. blocking")
    ap.add_argument("--skip-test", action="store_true")
    a = ap.parse_args()
    cfg = BlockingConfig(top_k=a.top_k, max_df=a.max_df)
    rng = np.random.default_rng(SEED)

    # ================= train
    s1, tgt = load_split(a.work, "train")
    truth = load_truth(a.data, s1, tgt)
    log(f"train: S1={s1.height} targets={tgt.height} true pairs={truth.height}")
    chunks = C.Chunks(C.build("train", s1, tgt, cfg, a.work, log=log))
    log("train blocking done")

    sample = rng.choice(s1.height, size=min(a.train_s1, s1.height), replace=False).astype(np.uint32)
    hold = np.sort(sample[: len(sample) // 5])
    samp = pl.Series(sample).implode()
    ks, Xs = [], []
    for i in range(len(chunks)):
        ci = chunks.load(i, samp)
        if ci is not None:
            k, x = featurize(ci, s1, tgt)
            ks.append(k); Xs.append(x)
        log(f"  train features chunk {i + 1}/{len(chunks)}")
    keys, X = pl.concat(ks), pl.concat(Xs)
    del ks, Xs, chunks
    y = (keys.join(truth.with_columns(pl.lit(1, pl.Int8).alias("y")), on=["s1_rid", "t_rid"], how="left")
         .get_column("y").fill_null(0).to_numpy())
    is_hold = keys.get_column("s1_rid").is_in(pl.Series(hold).implode()).to_numpy()
    feats_b = X.columns
    XA = X.select(FEATS_A).to_numpy().astype(np.float32)
    XB = X.to_numpy().astype(np.float32)
    del X
    log(f"train pairs {len(y)} pos={y.sum()} features A={len(FEATS_A)} B={len(feats_b)}")
    truth_h = truth.filter(pl.col("s1_rid").is_in(pl.Series(hold).implode()))
    fit = ~is_hold

    # ---- stage A: OOF on fit part, model on full fit part for holdout
    pa = np.zeros(len(y))
    groups = keys.get_column("s1_rid").to_numpy()
    fit_idx = np.where(fit)[0]
    for f, (tr, va) in enumerate(GroupKFold(3).split(fit_idx, groups=groups[fit_idx])):
        m = lgb.train(PARAMS_A, lgb.Dataset(XA[fit_idx[tr]], y[fit_idx[tr]]), ROUNDS_A)
        pa[fit_idx[va]] = m.predict(XA[fit_idx[va]])
    mA = lgb.train(PARAMS_A, lgb.Dataset(XA[fit], y[fit], feature_name=FEATS_A), ROUNDS_A)
    pa[is_hold] = mA.predict(XA[is_hold])
    log("stage A trained")

    kh = keys.filter(pl.Series(is_hold))
    tot = truth_h.height
    blk_recall = kh.join(truth_h, on=["s1_rid", "t_rid"]).height / tot
    n_hold = len(hold)
    rows = []
    for keep_k in (3, 4, 5, 6, 8):
        for thr in (0.0, 0.005, 0.01, 0.02, 0.05, 0.1):
            mask = stage_a_filter(kh, pa[is_hold], thr, keep_k)
            rec = y[is_hold][mask].sum() / tot
            rows.append((keep_k, thr, mask.sum() / n_hold, rec))
    log(f"holdout blocking recall (top_k={cfg.top_k}): {blk_recall:.4f}, cands/S1={len(kh) / n_hold:.2f}")
    for r in rows:
        log(f"  stageA keep_k={r[0]} thr={r[1]}: cands/S1={r[2]:.2f} recall={r[3]:.4f}")
    ok = [r for r in rows if r[3] >= blk_recall - a.recall_loss]
    keep_k, thr_a = min(ok, key=lambda r: r[2])[:2] if ok else (8, 0.0)
    log(f"chosen stage A: keep_k={keep_k} thr={thr_a}")

    # ---- stage B on survivors
    surv = np.zeros(len(y), bool)
    kfit = keys.filter(pl.Series(fit))
    surv[fit] = stage_a_filter(kfit, pa[fit], thr_a, keep_k)
    surv[is_hold] = stage_a_filter(kh, pa[is_hold], thr_a, keep_k)
    trn = fit & surv
    mB = lgb.train(PARAMS_B, lgb.Dataset(XB[trn], y[trn], feature_name=feats_b), ROUNDS_B)
    hs = is_hold & surv
    pb = mB.predict(XB[hs])
    kh_s = keys.filter(pl.Series(hs))
    ceiling = macro_f05(kh_s.join(truth_h, on=["s1_rid", "t_rid"]).select("s1_rid", "t_rid"), truth_h, hold)
    res = {}
    for thr in np.round(np.arange(0.3, 0.91, 0.05), 2):
        base = decide(kh_s, pb, thr)
        for gate in (0.0, 0.6, 0.7, 0.8, 0.9):
            if gate and gate <= thr:
                continue
            res[(float(thr), gate)] = macro_f05(empty_gate(base, gate), truth_h, hold)
    best = max(res, key=res.get)
    log(f"holdout: cands/S1={hs.sum() / n_hold:.2f}, F0.5 ceiling={ceiling:.4f}")
    log("holdout F0.5 grid: " + ", ".join(f"{k}:{v:.4f}" for k, v in sorted(res.items())))
    log(f"BEST (thr, gate) {best} -> holdout macro F0.5 = {res[best]:.4f}")
    imp = sorted(zip(mB.feature_importance("gain"), feats_b), reverse=True)
    log("top B features: " + ", ".join(n for _, n in imp[:15]))
    summary = dict(blocking_recall=blk_recall, stage_a=dict(keep_k=keep_k, thr=thr_a),
                   cands_per_s1=float(hs.sum() / n_hold), ceiling=ceiling,
                   best=list(best), best_f05=res[best], grid={str(k): v for k, v in res.items()},
                   stage_a_grid=rows)
    with open(os.path.join(a.work, "holdout_results.json"), "w") as f:
        json.dump(summary, f, indent=1)
    if a.skip_test:
        return

    # ---- refit B on all sampled survivors (A stays fitted on fit part to keep its OOF-like behaviour)
    mB = lgb.train(PARAMS_B, lgb.Dataset(XB[surv], y[surv], feature_name=feats_b), ROUNDS_B)
    mA.save_model(os.path.join(a.work, "model_a.txt"))
    mB.save_model(os.path.join(a.work, "model_b.txt"))
    del XA, XB, s1, tgt, keys, truth   # free train data before test inference subprocesses
    import gc
    gc.collect()
    json.dump(dict(keep_k=keep_k, thr_a=thr_a, thr=best[0], gate=best[1], feats_a=FEATS_A,
                   feats_b=feats_b), open(os.path.join(a.work, "decision.json"), "w"), indent=1)

    # ================= test (same code path as predict.py)
    dec = json.load(open(os.path.join(a.work, "decision.json")))
    s1t, tgtt, scores = P.score_split("test", a.work, cfg, mA, mB, dec)
    scores.write_parquet(os.path.join(a.work, "test_scores.parquet"))
    pred = P.decide(scores, dec["thr"], dec["gate"])
    P.write_outputs(s1t, tgtt, scores, pred, a.out)
    log(f"test: cands/S1={scores.height / s1t.height:.2f}, matched pairs={pred.height}, "
        f"non-empty S1={pred.get_column('s1_rid').n_unique()}/{s1t.height}")


if __name__ == "__main__":
    main()
