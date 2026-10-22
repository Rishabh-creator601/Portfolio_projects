"""Independent validation + error analysis with the FINAL saved models.

Scores N train S1 entities that were NOT in the model's training sample, reports
macro F0.5 (overall and per country) and prints example false merges / misses.

python src/analyze.py --data <dataset_dir> --work <work_dir> [--n 20000]
"""
import argparse
import json
import os

import lightgbm as lgb
import numpy as np
import polars as pl

import candidates as C
from data import load_rows, load_split, load_truth, macro_f05
from features import attach, build_features
from predict import decide, stage_a_filter

SEED = 42


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--work", required=True)
    ap.add_argument("--n", type=int, default=20_000)
    ap.add_argument("--train-s1", type=int, default=250_000)
    a = ap.parse_args()
    dec = json.load(open(os.path.join(a.work, "decision.json")))
    mA = lgb.Booster(model_file=os.path.join(a.work, "model_a.txt"))
    mB = lgb.Booster(model_file=os.path.join(a.work, "model_b.txt"))

    s1, tgt = load_split(a.work, "train")
    truth = load_truth(a.data, s1, tgt)
    n1 = s1.height
    # reproduce the training sample (same RNG calls as pipeline.py) and exclude it
    sample = np.random.default_rng(SEED).choice(n1, size=min(a.train_s1, n1), replace=False)
    rest = np.setdiff1d(np.arange(n1), sample)
    ev = np.sort(np.random.default_rng(7).choice(rest, size=a.n, replace=False)).astype(np.uint32)
    country = s1.select("rid", "country")
    del s1, tgt

    d = [p for p in os.listdir(a.work) if p.startswith("train_cands_")][0]
    ch = C.Chunks(os.path.join(a.work, d))
    evs = pl.Series(ev).implode()
    parts = []
    for i in range(len(ch)):
        c = ch.load(i, evs)
        if c is None:
            continue
        s1c, tgc = load_rows(a.work, "train", c["s1_rid"].unique(), c["t_rid"].unique())
        p = attach(c, s1c, tgc)
        k, X = p.select("s1_rid", "t_rid", "src"), build_features(p)
        m = stage_a_filter(k, mA.predict(X.select(dec["feats_a"]).to_numpy().astype(np.float32)),
                           dec["thr_a"], dec["keep_k"])
        k, X = k.filter(pl.Series(m)), X.filter(pl.Series(m))
        parts.append(k.select("s1_rid", "t_rid").with_columns(
            pl.Series("pb", mB.predict(X.select(dec["feats_b"]).to_numpy().astype(np.float32)))))
    scores = pl.concat(parts)
    pred = decide(scores, dec["thr"], dec["gate"])
    tr = truth.filter(pl.col("s1_rid").is_in(evs))
    res = {"n": a.n, "cands_per_s1": scores.height / a.n,
           "stageA_pair_recall": scores.join(tr, on=["s1_rid", "t_rid"]).height / tr.height,
           "ceiling": macro_f05(scores.join(tr, on=["s1_rid", "t_rid"]).select("s1_rid", "t_rid"), tr, ev),
           "macro_f05": macro_f05(pred.select("s1_rid", "t_rid"), tr, ev)}
    cty = country.filter(pl.col("rid").is_in(evs))
    for cn in cty["country"].unique().to_list():
        ids = cty.filter(pl.col("country") == cn)["rid"].to_numpy()
        f = lambda df: df.filter(pl.col("s1_rid").is_in(pl.Series(ids).implode()))
        res[f"macro_f05_{cn}"] = macro_f05(f(pred).select("s1_rid", "t_rid"), f(tr), ids)
    # precision / recall of pairs
    tp = pred.join(tr, on=["s1_rid", "t_rid"]).height
    res["pair_precision"] = tp / max(1, pred.height)
    res["pair_recall"] = tp / tr.height
    sing = np.setdiff1d(ev, tr["s1_rid"].unique().to_numpy())
    res["singletons"] = len(sing)
    res["singleton_acc"] = 1 - pred.filter(pl.col("s1_rid").is_in(pl.Series(sing).implode()))["s1_rid"].n_unique() / max(1, len(sing))
    print(json.dumps(res, indent=1))
    json.dump(res, open(os.path.join(a.work, "independent_eval.json"), "w"), indent=1)

    # ---- examples
    fp = pred.join(tr, on=["s1_rid", "t_rid"], how="anti").sample(25, seed=1)
    fn = tr.join(pred, on=["s1_rid", "t_rid"], how="anti")
    fn = fn.join(scores, on=["s1_rid", "t_rid"], how="left").sample(25, seed=1)
    raw = lambda f, rids: (pl.scan_parquet(os.path.join(a.work, f)).with_row_index("rid")
                           .filter(pl.col("rid").is_in(pl.Series(rids).implode()))
                           .select("rid", "business_name", "business_address").collect())
    n2 = pl.scan_parquet(os.path.join(a.work, "train_s2.parquet")).select(pl.len()).collect().item()

    def show(df, title):
        print(f"\n===== {title}")
        r1 = raw("train_s1.parquet", df["s1_rid"])
        t = df["t_rid"].to_numpy()
        r2 = pl.concat([raw("train_s2.parquet", t[t < n2]),
                        raw("train_s3.parquet", t[t >= n2] - n2).with_columns(pl.col("rid") + n2)])
        for row in df.iter_rows(named=True):
            x = r1.filter(pl.col("rid") == row["s1_rid"]).row(0, named=True)
            y = r2.filter(pl.col("rid") == row["t_rid"]).row(0, named=True)
            pb = row.get("pb")
            print(f"[p={pb if pb is None else round(pb, 2)}] {x['business_name']} | {x['business_address']}\n"
                  f"      -> {y['business_name']} | {y['business_address']}")
    show(fp, "FALSE MERGES (predicted, not true)")
    show(fn, "MISSED MATCHES (true, not predicted; p=None means lost in candidate generation)")


if __name__ == "__main__":
    main()
