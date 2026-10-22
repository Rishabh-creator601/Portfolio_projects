"""Loading helpers shared by the pipeline steps."""
import os

import numpy as np
import polars as pl


def load_split(work, split):
    """Returns (s1, tgt) polars frames with integer row ids.
    tgt concatenates source2 and source3 with a `src` column and global rid."""
    s1 = pl.read_parquet(os.path.join(work, f"{split}_s1.parquet"))
    s2 = pl.read_parquet(os.path.join(work, f"{split}_s2.parquet")).with_columns(pl.lit("S2").alias("src"))
    s3 = pl.read_parquet(os.path.join(work, f"{split}_s3.parquet")).with_columns(pl.lit("S3").alias("src"))
    s1 = _slim(s1).with_row_index("rid")
    tgt = _slim(pl.concat([s2, s3])).with_row_index("rid")
    return s1, tgt


NATIVE_RE = r"[ऀ-෿]"


def _slim(df: pl.DataFrame) -> pl.DataFrame:
    """Replace raw name/address strings by the few flags the features need (saves RAM)."""
    return df.with_columns(
        pl.col("business_name").str.contains(NATIVE_RE).cast(pl.Int8).alias("nat"),
        pl.col("business_address").str.contains(NATIVE_RE).cast(pl.Int8).alias("anat"),
        (pl.col("business_address").str.strip_chars().str.len_chars() == 0).cast(pl.Int8).alias("aempty"),
    ).drop("business_name", "business_address")


def load_truth(data_dir, s1: pl.DataFrame, tgt: pl.DataFrame) -> pl.DataFrame:
    """Ground-truth pairs as (s1_rid, t_rid)."""
    gt = pl.read_csv(os.path.join(data_dir, "train", "train_ground_truth.tsv"), separator="\t",
                     infer_schema=False, missing_utf8_is_empty_string=True)
    pairs = (gt.with_columns(pl.col("matched_entity_ids").str.split(","))
             .explode("matched_entity_ids")
             .filter(pl.col("matched_entity_ids").str.len_chars() > 0))
    pairs = (pairs.join(s1.select(pl.col("entity_id").alias("source1_entity_id"), pl.col("rid").alias("s1_rid")),
                        on="source1_entity_id")
             .join(tgt.select(pl.col("entity_id").alias("matched_entity_ids"), pl.col("rid").alias("t_rid")),
                   on="matched_entity_ids"))
    return pairs.select("s1_rid", "t_rid")


def macro_f05(pred: pl.DataFrame, truth: pl.DataFrame, s1_rids) -> float:
    """pred/truth: (s1_rid, t_rid) pair frames; s1_rids: evaluated S1 rows."""
    ids = pl.DataFrame({"s1_rid": np.asarray(s1_rids, dtype=np.uint32)})
    tp = pred.join(truth, on=["s1_rid", "t_rid"]).group_by("s1_rid").len("tp")
    npred = pred.group_by("s1_rid").len("np")
    ntrue = truth.group_by("s1_rid").len("nt")
    df = (ids.join(tp, on="s1_rid", how="left").join(npred, on="s1_rid", how="left")
          .join(ntrue, on="s1_rid", how="left").fill_null(0))
    p = df["tp"] / df["np"].clip(1)
    r = df["tp"] / df["nt"].clip(1)
    f = (1.25 * p * r / (0.25 * p + r)).fill_nan(0.0)
    f = pl.Series(np.where((df["nt"] == 0).to_numpy(), (df["np"] == 0).to_numpy().astype(float), f.to_numpy()))
    return float(f.mean())


def slim_records(work, split):
    """Write (once) slim, rid-indexed record files with only the normalised columns the
    features need; returns their paths. Keeps per-chunk loading small."""
    p1 = os.path.join(work, f"{split}_rec_s1.parquet")
    pt = os.path.join(work, f"{split}_rec_t.parquet")
    if not (os.path.exists(p1) and os.path.exists(pt)):
        s1, tgt = load_split(work, split)
        s1.write_parquet(p1, row_group_size=100_000)
        tgt.write_parquet(pt, row_group_size=100_000)
    return p1, pt


def load_rows(work, split, s1_rids, t_rids):
    """Load only the given rows (same rid numbering as load_split) -> bounded memory."""
    p1, pt = slim_records(work, split)
    s1_rids = pl.Series(np.asarray(s1_rids, dtype=np.uint32)).implode()
    t_rids = pl.Series(np.asarray(t_rids, dtype=np.uint32)).implode()
    s1 = pl.scan_parquet(p1).filter(pl.col("rid").is_in(s1_rids)).collect()
    tgt = pl.scan_parquet(pt).filter(pl.col("rid").is_in(t_rids)).collect()
    return s1, tgt
