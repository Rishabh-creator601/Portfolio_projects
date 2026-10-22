"""Learn a native-script -> Latin word dictionary from training matches.

For every ground-truth pair (S1 record, S2/S3 record) where the S2/S3 name
contains Indic-script words and has the same number of words as the S1 name,
words are aligned by position. The most frequent Latin word for each native
word (seen >= MIN_COUNT times, with >= MIN_SHARE of its alignments) is kept.
Only training data is used.
"""
import json
import re
from collections import Counter, defaultdict

import pandas as pd

MIN_COUNT = 2
MIN_SHARE = 0.5
_NATIVE = re.compile(r"[ऀ-෿]")
_PUNCT = re.compile(r"[^\wऀ-෿]+")


def _words(s):
    return [w for w in _PUNCT.sub(" ", s).split() if w]


def learn(s1: pd.DataFrame, others: pd.DataFrame, gt: pd.DataFrame) -> dict:
    name1 = dict(zip(s1["entity_id"], s1["business_name"]))
    nameo = dict(zip(others["entity_id"], others["business_name"]))
    counts = defaultdict(Counter)
    for sid, lst in zip(gt["source1_entity_id"], gt["matched_entity_ids"]):
        if not lst:
            continue
        w1 = _words(name1.get(sid, "").lower())
        for oid in lst.split(","):
            n = nameo.get(oid, "")
            if not _NATIVE.search(n):
                continue
            w2 = _words(n)
            if len(w2) != len(w1):
                continue
            for a, b in zip(w2, w1):
                if _NATIVE.search(a) and not _NATIVE.search(b):
                    counts[a][b] += 1
    out = {}
    for a, c in counts.items():
        b, n = c.most_common(1)[0]
        if n >= MIN_COUNT and n / sum(c.values()) >= MIN_SHARE:
            out[a] = b
    return out


def save(d: dict, path: str):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False)


def load(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)
