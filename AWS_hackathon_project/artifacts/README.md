# Artifacts (v4, leaderboard F0.5 0.97051)

- `models/final_r1_ce_ce2.txt`, `models/final_r2_ce_ce2.txt`: LightGBM round-1 / round-2 matchers (69 features + sibling features), trained by `src/final_model.py --ce ce ce2`.
- `ce_scores/`: cross-encoder logits per (s1_rid, t_rid). `ce_*` = MiniLM-L12 multilingual, `ce2_*` = mDeBERTa-v3-base; `*_test` = all 9.03M test pairs, `*_train_lgb` = the matcher-training half.
- `logs/`: validation JSONs and run logs (blocking recall, expansion probe, final model).
- The fine-tuned mDeBERTa weights (1.1 GB) are not stored here; they are the output of the private Kaggle kernel `rishabh2007/bizer-crossencoder-mdeberta`.

The v4 submission files (uploaded to the leaderboard) are in `output_v4/`.

## Also here
- `test_final_ce_ce2.parquet`: v4 match probability `p` for every (s1_rid, t_rid) test pair (9.03M rows). Re-threshold without retraining:
  keep `p >= 0.725`, then keep the highest-`p` S1 per `t_rid` (see `decide()` in `src/final_model.py`).
- `v1/`: first submission (leaderboard 0.940467). `Out_of_Bounds_submission.zip` is the full v1 package (code + outputs);
  `model_a.txt` / `model_b.txt` are the v1 stage-A filter and stage-B matcher (LightGBM).
