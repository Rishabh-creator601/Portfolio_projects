"""Normalise all source files once (multiprocess) and cache them as parquet.

Output columns per record:
  entity_id, country, business_name, business_address (raw)
  ntoks   : space-joined core name tokens (all alias sides)
  nmain   : core tokens of the first alias side
  nalt    : core tokens of the remaining alias sides ('' if none)
  skel    : space-joined consonant skeletons of ntoks
  web     : website/handle token if the name looks like a domain
  atoks   : space-joined normalised address tokens
  anums   : space-joined address numbers
"""
import os
from multiprocessing import Pool

import pandas as pd

import normalize as N

_DICT = None


def _init(translit_dict):
    N.TRANSLIT.update(translit_dict)


def _proc(chunk):
    names, addrs = chunk
    out = []
    for nm, ad in zip(names, addrs):
        toks, parts, web = N.core_tokens(nm)
        at, nums = N.addr_tokens(ad)
        out.append((
            " ".join(toks),
            " ".join(parts[0]) if parts else "",
            " ".join(w for p in parts[1:] for w in p),
            " ".join(N.skeleton(w) for w in toks),
            web,
            " ".join(at),
            " ".join(nums),
        ))
    return out


COLS = ["ntoks", "nmain", "nalt", "skel", "web", "atoks", "anums"]


def prepare_file(src_path, dst_path, translit_dict, workers=None, chunk=20000):
    if os.path.exists(dst_path):
        return pd.read_parquet(dst_path)
    df = pd.read_csv(src_path, sep="\t", dtype=str, keep_default_na=False)
    names, addrs = df["business_name"].tolist(), df["business_address"].tolist()
    chunks = [(names[i:i + chunk], addrs[i:i + chunk]) for i in range(0, len(df), chunk)]
    with Pool(workers or os.cpu_count(), initializer=_init, initargs=(translit_dict,)) as p:
        res = [r for part in p.map(_proc, chunks) for r in part]
    feats = pd.DataFrame(res, columns=COLS, index=df.index)
    df = pd.concat([df, feats], axis=1)
    df.to_parquet(dst_path, index=False)
    return df
