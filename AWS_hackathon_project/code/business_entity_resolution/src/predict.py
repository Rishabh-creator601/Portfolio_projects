"""Step 3: test inference with the saved models -> output/*.tsv

python src/predict.py --data <dataset_dir> --work <work_dir> --out <output_dir>

Uses work/model_a.txt, work/model_b.txt and work/decision.json written by pipeline.py.
Candidates are processed in slices of S1 records so memory stays bounded.
"""
import argparse
import gc
import json
import os
import time

import lightgbm as lgb
import numpy as np
import polars as pl

import candidates as C
from blocking import BlockingConfig
from data import load_rows, load_split
from features import attach, build_features

T0 = time.time()


def log(msg):
    print(f"[{time.time() - T0:7.0f}s] {msg}", flush=True)


def _rss_gb():
    try:
        import psutil
        return psutil.Process().memory_info().rss / 2 ** 30
    except Exception:
        return float("nan")


def stage_a_filter(keys, pa, thr, keep_k):
    r = (keys.select("s1_rid", "src").with_columns(pl.Series("pa", pa))
         .with_columns(pl.col("pa").rank("ordinal", descending=True).over("s1_rid", "src").alias("ra")))
    return ((r["pa"] >= thr) & (r["ra"] <= keep_k)).to_numpy()


def decide(scores: pl.DataFrame, thr: float, gate: float) -> pl.DataFrame:
    """prob >= thr; each target record to at most one S1 (its best); singleton gate."""
    d = scores.filter(pl.col("pb") >= thr).sort("pb", descending=True).unique("t_rid", keep="first")
    return d.filter(pl.col("pb").max().over("s1_rid") >= gate)


def write_outputs(s1, tgt, cand_pairs, pred, out):
    os.makedirs(out, exist_ok=True)
    tid = tgt.select(pl.col("rid").alias("t_rid"), pl.col("entity_id").alias("tid"))
    base = s1.select(pl.col("rid").alias("s1_rid"), pl.col("entity_id").alias("source1_entity_id"))

    def agg(df, name):
        g = (df.join(tid, on="t_rid").group_by("s1_rid")
             .agg(pl.col("tid").unique(maintain_order=True).str.join(",").alias(name)))
        return (base.join(g, on="s1_rid", how="left").with_columns(pl.col(name).fill_null(""))
                .select("source1_entity_id", name))

    # quote_style="never": empty lists must be written as truly empty fields, not ""
    agg(cand_pairs, "candidate_entity_ids").write_csv(os.path.join(out, "candidate_pairs.tsv"),
                                                      separator="\t", quote_style="never")
    agg(pred, "matched_entity_ids").write_csv(os.path.join(out, "matching_results.tsv"),
                                             separator="\t", quote_style="never")


def score_split(split, work, cfg, mA, mB, dec, slice_s1=10_000, only=None):
    """Blocking (cached) -> per-slice features -> stage A filter -> stage B probs."""
    d = os.path.join(work, f"{split}_cands_k{cfg.top_k}_df{cfg.max_df}")
    if not os.path.exists(os.path.join(d, "_DONE")):
        s1, tgt = load_split(work, split)
        C.build(split, s1, tgt, cfg, work, log=log)
        del s1, tgt
        gc.collect()
    chunks = C.Chunks(d)
    from data import slim_records
    slim_records(work, split)
    sdir = os.path.join(work, f"{split}_scores")
    os.makedirs(sdir, exist_ok=True)
    todo = [i for i in range(len(chunks))
            if not os.path.exists(os.path.join(sdir, f"{i:04d}.parquet"))]   # resumable
    if only is None:
        # score each chunk in a fresh subprocess so memory is fully released between chunks
        import subprocess
        import sys
        for i in todo:
            subprocess.run([sys.executable, os.path.abspath(__file__), "--work", work, "--split", split,
                            "--top-k", str(cfg.top_k), "--max-df", str(cfg.max_df), "--chunk", str(i)],
                           check=True)
            log(f"  {split} chunk {i + 1}/{len(chunks)} done")
        s1, tgt = load_split(work, split)
        return s1, tgt, pl.read_parquet(os.path.join(sdir, "*.parquet"))
    for i in todo:
        if i != only:
            continue
        path = os.path.join(sdir, f"{i:04d}.parquet")
        c = chunks.load(i)
        if c is None:
            pl.DataFrame(schema={"s1_rid": pl.UInt32, "t_rid": pl.UInt32, "pb": pl.Float64}).write_parquet(path)
            continue
        # load only this chunk's records -> small joins, bounded memory
        s1c, tgc = load_rows(work, split, c.get_column("s1_rid").unique(), c.get_column("t_rid").unique())
        ids = c.get_column("s1_rid").unique().sort()
        out = []
        for j in range(0, len(ids), slice_s1):
            part = c.filter(pl.col("s1_rid").is_in(ids[j:j + slice_s1].implode()))
            p = attach(part, s1c, tgc)
            k, X = p.select("s1_rid", "t_rid", "src"), build_features(p)
            del p
            m = stage_a_filter(k, mA.predict(X.select(dec["feats_a"]).to_numpy().astype(np.float32)),
                               dec["thr_a"], dec["keep_k"])
            k, X = k.filter(pl.Series(m)), X.filter(pl.Series(m))
            out.append(k.select("s1_rid", "t_rid").with_columns(
                pl.Series("pb", mB.predict(X.select(dec["feats_b"]).to_numpy().astype(np.float32)))))
            del k, X
        pl.concat(out).write_parquet(path)
        del c, s1c, tgc, out
        s1 = tgt = None
        gc.collect()
        log(f"  {split} chunk {i + 1}/{len(chunks)} scored (rss {_rss_gb():.1f} GB)")
    return None, None, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data")
    ap.add_argument("--split", default="test")
    ap.add_argument("--chunk", type=int, default=None, help="internal: score one chunk and exit")
    ap.add_argument("--work", required=True)
    ap.add_argument("--out", default="output")
    ap.add_argument("--top-k", type=int, default=20)
    ap.add_argument("--max-df", type=int, default=300)
    a = ap.parse_args()
    cfg = BlockingConfig(top_k=a.top_k, max_df=a.max_df)
    dec = json.load(open(os.path.join(a.work, "decision.json")))
    mA = lgb.Booster(model_file=os.path.join(a.work, "model_a.txt"))
    mB = lgb.Booster(model_file=os.path.join(a.work, "model_b.txt"))
    s1, tgt, scores = score_split(a.split, a.work, cfg, mA, mB, dec, only=a.chunk)
    if a.chunk is not None:
        return
    scores.write_parquet(os.path.join(a.work, "test_scores.parquet"))
    pred = decide(scores, dec["thr"], dec["gate"])
    write_outputs(s1, tgt, scores, pred, a.out)
    log(f"test: cands/S1={scores.height / s1.height:.2f}, matched pairs={pred.height}, "
        f"non-empty S1={pred.get_column('s1_rid').n_unique()}/{s1.height}")


if __name__ == "__main__":
    main()
