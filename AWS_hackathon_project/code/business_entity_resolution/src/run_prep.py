"""Step 1: learn the transliteration dictionary and normalise all sources.

python src/run_prep.py --data <dataset_dir> --work <work_dir>
"""
import argparse
import os
import time

import pandas as pd

import prep
import translit


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--work", required=True)
    a = ap.parse_args()
    os.makedirs(a.work, exist_ok=True)
    tpath = os.path.join(a.work, "translit.json")
    if not os.path.exists(tpath):
        r = lambda p: pd.read_csv(os.path.join(a.data, p), sep="\t", dtype=str, keep_default_na=False)
        d = translit.learn(r("train/train_source1.tsv"),
                           pd.concat([r("train/train_source2.tsv"), r("train/train_source3.tsv")]),
                           r("train/train_ground_truth.tsv"))
        translit.save(d, tpath)
    d = translit.load(tpath)
    print(f"translit dict: {len(d)} words", flush=True)
    for sp in ("train", "test"):
        for i in (1, 2, 3):
            t = time.time()
            df = prep.prepare_file(os.path.join(a.data, sp, f"{sp}_source{i}.tsv"),
                                   os.path.join(a.work, f"{sp}_s{i}.parquet"), d)
            print(f"{sp} source{i}: {len(df)} rows, {time.time() - t:.0f}s", flush=True)


if __name__ == "__main__":
    main()
