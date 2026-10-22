"""Cross-encoder for business record pairs (runs on Kaggle GPU).

Base model: microsoft/mdeberta-v3-base (MIT, 280M params) - larger second cross-encoder.
fine-tuned as a pair classifier: input "[S1 name | S1 address] [SEP] [candidate name | address]".
Multilingual, so it reads Latin, Devanagari, Kannada, Tamil, ... and French directly.

Input dataset (made by src/export_kaggle.py):
  train_pairs.parquet (s1_rid, t_rid, y, part), test_pairs.parquet (s1_rid, t_rid),
  {train,test}_{s1,t}_text.parquet (rid, name, addr)
Trains on part == "ce"; scores part == "lgb" (features for the final LightGBM) and all test pairs.
Outputs (/kaggle/working): ce2_train_lgb.parquet, ce2_test.parquet (s1_rid, t_rid, ce), model/.
"""
import glob
import math
import os
import time

import numpy as np
import polars as pl
import torch
from torch.utils.data import DataLoader, Dataset
from transformers import AutoModelForSequenceClassification, AutoTokenizer, get_linear_schedule_with_warmup

MODEL = "microsoft/mdeberta-v3-base"
MAX_LEN = 96
BS_TRAIN, BS_PRED = 128, 512
LR, EPOCHS, MAX_TRAIN = 3e-5, 1, 900_000
SEED = 42
T0 = time.time()
torch.manual_seed(SEED)


def log(m):
    print(f"[{time.time() - T0:7.0f}s] {m}", flush=True)


IN = os.path.dirname(glob.glob("/kaggle/input/**/train_pairs.parquet", recursive=True)[0])
OUT = "/kaggle/working"
dev = torch.device("cuda")
n_gpu = torch.cuda.device_count()
log(f"input {IN}, GPUs {n_gpu}: {[torch.cuda.get_device_name(i) for i in range(n_gpu)]}")


def with_text(pairs, split):
    s1 = pl.read_parquet(f"{IN}/{split}_s1_text.parquet").select(
        pl.col("rid").alias("s1_rid"), (pl.col("name") + " | " + pl.col("addr")).alias("a"))
    t = pl.read_parquet(f"{IN}/{split}_t_text.parquet").select(
        pl.col("rid").alias("t_rid"), (pl.col("name") + " | " + pl.col("addr")).alias("b"))
    return pairs.join(s1, on="s1_rid", how="left").join(t, on="t_rid", how="left").with_columns(
        pl.col("a").fill_null(""), pl.col("b").fill_null(""))


class Pairs(Dataset):
    def __init__(self, a, b, y=None):
        self.a, self.b, self.y = a, b, y

    def __len__(self):
        return len(self.a)

    def __getitem__(self, i):
        return i


tok = AutoTokenizer.from_pretrained(MODEL)


def collate_fn(ds):
    def f(idx):
        enc = tok([ds.a[i] for i in idx], [ds.b[i] for i in idx], truncation=True, max_length=MAX_LEN,
                  padding=True, return_tensors="pt")
        if ds.y is not None:
            enc["labels"] = torch.tensor([ds.y[i] for i in idx], dtype=torch.float32)
        return enc
    return f


model = AutoModelForSequenceClassification.from_pretrained(MODEL, num_labels=1, torch_dtype=torch.float32).float().to(dev)
net = torch.nn.DataParallel(model) if n_gpu > 1 else model

# ---------------------------------------------------------------- train
tr = with_text(pl.read_parquet(f"{IN}/train_pairs.parquet"), "train")
ce = tr.filter(pl.col("part") == "ce").sample(fraction=1.0, shuffle=True, seed=SEED)
val = ce.head(50_000)
ce = ce.slice(50_000).head(MAX_TRAIN)
log(f"train pairs {ce.height} (pos {ce['y'].mean():.3f}), val {val.height}")
ds = Pairs(ce["a"].to_list(), ce["b"].to_list(), ce["y"].to_list())
dl = DataLoader(ds, batch_size=BS_TRAIN, shuffle=True, collate_fn=collate_fn(ds), num_workers=2)
opt = torch.optim.AdamW(model.parameters(), lr=LR, weight_decay=0.01)
steps = EPOCHS * len(dl)
sch = get_linear_schedule_with_warmup(opt, int(0.06 * steps), steps)
scaler = torch.amp.GradScaler('cuda')
lossf = torch.nn.BCEWithLogitsLoss()
net.train()
for ep in range(EPOCHS):
    for s, batch in enumerate(dl):
        y = batch.pop("labels").to(dev)
        batch = {k: v.to(dev) for k, v in batch.items()}
        with torch.autocast("cuda", dtype=torch.float16):
            logits = net(**batch).logits.squeeze(-1)
            loss = lossf(logits.float(), y)
        opt.zero_grad(set_to_none=True)
        scaler.scale(loss).backward()
        scaler.unscale_(opt)
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        scaler.step(opt)
        scaler.update()
        sch.step()
        if s % 500 == 0:
            log(f"epoch {ep} step {s}/{len(dl)} loss {loss.item():.4f}")
model.save_pretrained(f"{OUT}/model")
tok.save_pretrained(f"{OUT}/model")


# ---------------------------------------------------------------- predict
@torch.no_grad()
def predict(a, b):
    net.eval()
    order = np.argsort([len(x) + len(y) for x, y in zip(a, b)])      # length-sorted batches
    a_s, b_s = [a[i] for i in order], [b[i] for i in order]
    ds = Pairs(a_s, b_s)
    dl = DataLoader(ds, batch_size=BS_PRED, shuffle=False, collate_fn=collate_fn(ds), num_workers=2)
    out = []
    for s, batch in enumerate(dl):
        batch = {k: v.to(dev) for k, v in batch.items()}
        with torch.autocast("cuda", dtype=torch.float16):
            out.append(net(**batch).logits.squeeze(-1).float().cpu().numpy())
        if s % 1000 == 0:
            log(f"  predict batch {s}/{len(dl)}")
    p = np.empty(len(a), dtype=np.float32)
    p[order] = np.concatenate(out)
    return p


pv = predict(val["a"].to_list(), val["b"].to_list())
yv = val["y"].to_numpy()
acc = ((pv > 0) == (yv > 0.5)).mean()
ll = np.mean(np.logaddexp(0, -pv) * yv + np.logaddexp(0, pv) * (1 - yv))
log(f"validation accuracy {acc:.4f}, logloss {ll:.4f}")

lg = tr.filter(pl.col("part") == "lgb")
lg.select("s1_rid", "t_rid").with_columns(pl.Series("ce", predict(lg["a"].to_list(), lg["b"].to_list()))) \
    .write_parquet(f"{OUT}/ce2_train_lgb.parquet")
log("scored lgb part")
del tr, ce, lg

te = with_text(pl.read_parquet(f"{IN}/test_pairs.parquet"), "test")
CH = 2_000_000
parts = []
for i in range(0, te.height, CH):
    c = te.slice(i, CH)
    parts.append(c.select("s1_rid", "t_rid").with_columns(pl.Series("ce", predict(c["a"].to_list(), c["b"].to_list()))))
    log(f"test scored {min(i + CH, te.height)}/{te.height}")
pl.concat(parts).write_parquet(f"{OUT}/ce2_test.parquet")
log("done")
