# Business Entity Resolution — Team Out of Bounds

Pipeline: **normalise → rare-key inverted-index blocking → stage-A LightGBM candidate filter → stage-B LightGBM matcher → macro-F0.5-tuned decoding**.
Only the provided training/test data is used — no external data, APIs, geocoding or pretrained models.
The only model is LightGBM (MIT licence).

## Environment

```bash
python -m pip install -r requirements.txt     # Python 3.11
```

Tested on Windows 11, 12-core CPU, 16 GB RAM, no GPU. End-to-end ≈ 2 hours.
Memory is bounded by streaming: candidates are written to disk in chunks and test
inference scores each chunk in a fresh subprocess (peak ≈ 6 GB).

## Reproduce end-to-end

`<DATA>` is the `dataset/` folder that contains `train/` and `test/`
(e.g. `student_resource/dataset`). Run from this folder:

```bash
# 1. learn the transliteration dictionary (train only) + normalise all 6 source files -> work/*.parquet
python src/run_prep.py --data <DATA> --work work

# 2. blocking (train + test), stage-A/B training, holdout tuning, test inference
#    -> output/matching_results.tsv, output/candidate_pairs.tsv
#    (models and tuned thresholds are saved to work/model_a.txt, work/model_b.txt, work/decision.json)
python src/pipeline.py --data <DATA> --work work --out output
```

Optional:

```bash
# re-run only test inference with the saved models (resumable)
python src/predict.py --data <DATA> --work work --out output

# independent validation + error analysis on 20k unseen training entities
python src/analyze.py --data <DATA> --work work

# blocking recall vs candidate-set size
python src/eval_blocking.py --data <DATA> --work work --sample 100000 --top-k 20 --max-df 300
```

Validate the outputs with the organisers' script:

```bash
python utils/validate_submission.py --matching output/matching_results.tsv \
    --candidate output/candidate_pairs.tsv --test-dir <DATA>/test --check-ids
```

## Source layout (`src/`)

| file | purpose |
| --- | --- |
| `run_prep.py` | entry point 1: transliteration dictionary + parallel normalisation |
| `pipeline.py` | entry point 2: train, tune on holdout, predict test, write outputs |
| `predict.py` | test inference with saved models; chunked, resumable, one subprocess per chunk |
| `analyze.py` | independent validation and error analysis |
| `translit.py` | learns native-script (Indic) → Latin word dictionary from aligned training pairs |
| `normalize.py` | names/addresses: transliteration, legal forms, honorifics, aliases (DBA/formerly/née), websites, EN/IN/FR address abbreviations, states, city aliases, numbers, consonant skeletons |
| `prep.py` | multiprocess normalisation, parquet cache |
| `blocking.py` | rare-key inverted index (country-partitioned, IDF-weighted, stop-keys), top-k per source, streamed to disk |
| `candidates.py` | chunked candidate tables + per-S1 and reverse-competition context features |
| `features.py` | vectorised pair features (rapidfuzz `cpdist`, polars set ops) |
| `data.py` | loading helpers and the exact macro-F0.5 metric |
| `eval_blocking.py` | blocking diagnostics |

Key settings: retrieval top-20 per source, stop-key threshold 300; stage A keeps p ≥ 0.02 and rank ≤ 5 per source;
stage B threshold 0.65 with one-S1-per-target decoding. Seeds are fixed (42).
