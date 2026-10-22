# ML Challenge 2026: Business Entity Resolution Solution Template

**Team Name:** Out of Bounds  
**Team Members:** Rishabh Agarwal (Team Leader), Hariom Ji Rai, Jatin  
**Submission Date:** 26 September 2026

---

## 1. Executive Summary
We resolve Source-1 businesses against Sources 2/3 with a three-stage cascade. (1) A scalable **rare-key inverted index** (country-partitioned, IDF-weighted, order-, typo- and transliteration-robust name/address keys) retrieves a short list per source without any all-pairs comparison. (2) A light **LightGBM candidate filter** prunes it to **~4.4 candidates per Source-1 entity** (5.2 on test) while keeping 94.7% of true pairs. (3) A **LightGBM matcher** over 50 vectorised similarity and competition features, decoded with a **macro-F0.5-tuned threshold** and the constraint *"each S2/S3 record belongs to at most one S1"*. Validation macro F0.5 = **0.951** (holdout) / **0.952** (20k independent unseen entities), with 98.6% pair precision.

---

## 2. Methodology

### 2.1 Problem Analysis
EDA on 2.21M S1 / 5.03M S2 / 5.29M S3 training records (US 60%, India 40%; test adds France, 15% of test S1):

- **Match structure.** Only 5.6% of S1 entities are singletons; a matched entity has on average ~1.9 S2 and ~2.0 S3 records (up to 5 / 6). ~26% of S2/S3 records match no S1 (distractors). **Every S2/S3 record matches at most one S1** — exploited both as features and in decoding.
- **Name noise.** Legal-form swaps and reordering (`LLC Espinoza & Davis Industrials`), honorific / junk prefixes (`Sri`, `Smt`, `Dr`, `The`, `***`, `<<`, `--`), brackets, typos and look-alike substitutions (`Appare1s`, `8right`, `Hypntosis`), duplicated or appended generic words (`Center`, `Services`, `Enterprises`), aliases (`X DBA Y`, `Y formerly X`, `née`, `doing business as`), website / handle forms (`royalfoods.com`, `#empiremolecular`), and **Indic-script transliterations** — ~8% of S2/S3 names are written in Devanagari, Kannada, Tamil, Telugu, Gujarati… (`ಲೋಟಸ್ ಮಾರ್ಕೆಟಿಂಗ್ ಪ್ರೈವೇಟ್ ಲಿಮಿಟೆಡ್` = *Lotus Marketing Private Limited*; `प्रा. लि.` = *Pvt. Ltd.*).
- **Address noise.** Abbreviations (`St/Street/Saint`, `R./Rue`, `AV/Avenue`, `BD/Boulevard`), component reordering, missing components and ~3% empty addresses, state names vs codes vs native script (`MH` / `Maharashtra` / `महाराष्ट्र`), city renames (`Bombay`/`Mumbai`, `Poona`/`Pune`), house-number perturbations (`5425`→`1425`, `C-208`→`C-2-08`, leading zeros), `null` tokens, landmark phrases (`Near SBI ATM`).
- **Hard negatives.** Different businesses at the same (or neighbouring) address, identical names at different addresses, and true matches whose S2/S3 name is an unrelated alias sharing only the address.

### 2.2 Solution Strategy
**Approach Type:** Blocking + two-stage classifier cascade with a global one-owner assignment constraint (hybrid).  
**Core Innovation:**
1. A **data-only transliteration dictionary** (native word → Latin word, learned by aligning training pairs) plus **consonant skeletons**, making Indic-script and typo'd names matchable and blockable.
2. An inverted index of **combination keys** (every pair of name skeletons, name × house number, number × street word, adjacent address words) that stays sparse at billions-of-records scale and is robust to word reordering and inserted noise words.
3. A **learned candidate filter** so the audited candidate set is ~9× smaller than the retrieval output at a 0.3-point recall cost.
4. **Competition ("reverse") features and one-owner decoding** exploiting the fact that each S2/S3 record belongs to at most one S1.

---

## 3. Candidate Generation (Blocking)

**Normalisation** (identical for every country; country is never branched on): unidecode transliteration; native-script words mapped through the learned dictionary (1,312 words; covers 93% of native-script name tokens in test) with unidecode fallback; removal of legal forms (EN / IN / FR, e.g. `Inc, LLC, Pvt, Ltd, SARL, SAS, EURL, SCI, praa/li`), honorifics and stop-words; alias splitting (`DBA`, `formerly`, `née`, `doing business as`, `aka`…); website extraction; address abbreviation expansion (English, Indian, French), state / filler / unit-word removal, city-alias mapping, number extraction; consonant skeleton per token (`lotus`, `lootts` → `lts`).

**Keys** (each prefixed by the record's country label, hashed to 64 bits):

| kind | key | purpose |
|---|---|---|
| n | name token | rare names |
| k | name consonant skeleton | typos, transliteration |
| b | *every pair* of sorted name skeletons (first 6) | word-order and noise-word invariant; turns common words into rare combinations |
| c | concatenated name / website handle | `royalfoods.com`, `#empiremolecular` |
| a | address word | street / locality |
| d | address number | house / plot numbers |
| q | first number × address word | `5425|avenue`, `45|naraina` |
| r | name skeleton × first number | name + location, robust to address reformatting |
| e | adjacent address-word pair | `naraina|vihar` |

**Scalability.** A key whose posting list in the target source exceeds 300 records is dropped (stop-key). A Source-1 record is therefore only joined with records sharing at least one *rare* key; cost is proportional to Σ(posting-list lengths), never |S1|×|S2|. Joins run in polars in batches of 10k S1 records and are streamed to disk, so memory is bounded by the key tables plus one batch. The procedure is a plain map-reduce join (emit keys → group by key → join → aggregate by pair) and scales horizontally to billions of records.

**Retrieval scoring.** score = Σ IDF(key) × w(kind) over shared keys (name-part and address-part sums kept as features); top-20 per target source.

**Stage-A filter (final candidate set).** LightGBM (300 trees, 63 leaves) on 23 cheap features (retrieval score / parts / rank, reverse-competition features, token-set / skeleton / concatenation / address similarities, house-number overlap, flags). Keeps pairs with p_A ≥ 0.02 and rank ≤ 5 per source. The operating point was chosen on the holdout as the smallest candidate set losing ≤ 0.3 pt of pair recall:

| candidate set | cands / S1 | pair recall |
|---|---|---|
| retrieval top-20 per source | 39.9 | 95.0% |
| **stage A (submitted)** | **4.37** | **94.7%** |
| stage A, rank ≤ 3 | 3.97 | 90.1% |

- **Blocking keys used:** rare-key inverted index over name tokens, consonant skeletons, all name-skeleton pairs, concatenated names / websites, address words, numbers, number×word, name×number and adjacent address-word pairs; IDF-weighted; country-partitioned.
- **Candidate pairs generated:** train 88.1M retrieved → stage A ~4.4 per S1. **Test: 9,026,533 candidate pairs = 5.21 per Source-1 entity** (US 5.11, India 5.02, France 6.05), out of 1.73M × 9.97M possible pairs (reduction ratio > 99.9999%).
- **How we ensured true matches were not lost:** independent key families (a typo in the name still leaves address and name×number keys; an empty address still leaves name, skeleton-pair and website keys; native-script names are covered by the dictionary and skeletons); stage-A threshold chosen against an explicit recall-loss budget; the perfect-matcher macro-F0.5 ceiling of the final candidate set is 0.981.

---

## 4. Matching Model

**Features used (50):**
- **Name:** rapidfuzz ratio, token-sort, token-set, partial ratio and Jaro-Winkler on core names; similarity to each alias side of the candidate; skeleton token-set / token-sort; concatenated-name (website) ratio / partial; token Jaccard, common / unmatched token counts, first-token equality, token counts.
- **Address:** token-set, token-sort, partial and plain ratio; token Jaccard; house-number overlap, Jaccard and first-number equality; number counts; empty-address flags; native-script flags for the candidate name and address.
- **Blocking / context:** retrieval score and its name / address parts, number of shared keys, rank, score relative to the best candidate of the same S1 and source, number of candidates; **reverse competition** — rank of this S1 among all S1 records that retrieved the same target record, number of competitors, relative score; gap to the best sibling candidate on name and address similarity.
- Country is **never** used as a feature, so the model transfers to France (unseen in training).

Most important features (gain): house-number Jaccard, address token-set ratio, name partial ratio, name Jaro-Winkler, name ratio, candidate number count, unmatched candidate tokens, address Jaccard, common numbers, relative retrieval score.

**Model type:** LightGBM binary classifier (1,000 trees, 127 leaves, learning rate 0.05, feature / bagging fraction 0.8), trained on stage-A survivors of 250k randomly sampled training S1 entities (≈ 1.1M pairs). Training rows use **out-of-fold** stage-A scores (3-fold, grouped by S1) so the matcher sees the same survivor distribution as at inference. Retrieval runs over *all* 2.2M training S1 records so the competition features have test-like distributions.

**Threshold selection method:** grid search over (probability threshold, singleton gate) maximising the exact macro F0.5 on a 50k-entity holdout (grouped by S1). Decoding: keep pairs with p ≥ 0.65; each S2/S3 record is assigned only to its highest-probability S1; an S1 with no pair above threshold gets an empty list (a separate singleton gate did not help).

---

## 5. Results & Error Analysis

| evaluation | macro F0.5 | notes |
|---|---|---|
| Holdout (50k S1, models trained on the other 200k) | **0.951** | perfect-matcher ceiling 0.981 |
| Independent (20k S1 never used in training, final models) | **0.952** | US 0.958, India 0.944; pair precision 98.6%, pair recall 90.4%; singletons correctly left empty 93.9% |

- **F_0.5 Score (macro):** 0.951 (holdout), 0.952 (independent unseen sample).
- **Common false positives (wrong merges):**
  - *Neighbouring or same address, near-identical name, different entity* — e.g. `Dominguez Continental Genesis Inc, 812 Deerfield Rd` vs `… Co, 0814 Deerfield Rd`; `QF Bsp Inc, 4310 State Ave` vs `QF BSP L.L.C., 4312 State Ave`. House-number perturbation is also a common *true*-match noise, so these are intrinsically ambiguous.
  - *Exact name, empty candidate address* (`Midwest Western LLC` → `MIDWEST WESTERN | <empty>`), where the record belongs to another S1 with the same name.
  - *Same address, one differing name word* (`TN Fund` vs `XN Fund`, `DR Dairy` vs `DR Supply`, `Future Miracle` vs `Future Memorial`).
- **Common false negatives (missed matches):**
  - *Empty candidate address plus heavy name noise* (`Sweet Diner! Corporation Corporation | <empty>`, `SWATIPUSHP PRIVATE LIMITED PARTNERS | <empty>`) — often not even retrieved, since only generic name keys remain.
  - *Native-script names with very short addresses* (`गुरु हॉस्पिटैलिटी प्राइवेट लिमिटेड | SOUTH WEST DELHI, ROOM NO.1`).
  - *True matches with conflicting house numbers* (`658 Broadview Terrace` vs `65 Broadview Terrace`, `321 7th St` vs `121 7th St`) scored just below threshold — the mirror image of the false-positive class above.
  - *Alias-only names* (`Vantagebrix` for `Bombay Trading Pvt Ltd`) sharing only the address.

---

## 6. Conclusion
A carefully normalised, rare-key inverted index plus a learned filter yields a very small audited candidate set (≈ 5 per entity, > 99.9999% reduction) with a 0.98 F0.5 ceiling, and a gradient-boosted matcher with competition features and one-owner decoding reaches 0.95 macro F0.5 at 98.6% pair precision. The biggest lessons were that transliteration and combination keys matter more for recall than any single similarity measure, that the one-S1-per-record structure is a strong signal, and that at 22M records memory-bounded, streamed execution is as important as model quality. Remaining headroom lies in the house-number-perturbation cases and in empty-address records.

---

## Appendix

### A. Code Artefacts
`code/business_entity_resolution/` contains `README.md` (exact commands), `requirements.txt` (pinned: Python 3.11, polars, pandas, numpy, pyarrow, lightgbm, rapidfuzz, Unidecode) and `src/`:

| file | role |
|---|---|
| `run_prep.py` | **entry point 1**: learn transliteration dictionary (train only) and normalise all six source files (multiprocess) |
| `pipeline.py` | **entry point 2**: blocking → stage A → stage B training, holdout tuning, then test inference → `output/matching_results.tsv`, `output/candidate_pairs.tsv` |
| `predict.py` | test inference only, with the saved models (resumable, one subprocess per chunk for bounded memory) |
| `analyze.py` | independent validation and error analysis |
| `normalize.py`, `translit.py`, `prep.py` | normalisation, transliteration dictionary, parallel preprocessing |
| `blocking.py`, `candidates.py` | rare-key inverted index, streamed candidate tables, context features |
| `features.py`, `data.py` | vectorised pair features; loading helpers and exact macro-F0.5 metric |
| `eval_blocking.py` | recall-vs-candidate-size diagnostics |

Only the provided data is used — no external data, APIs, geocoding or pretrained models. The only model is LightGBM (MIT licence), far below the 8B-parameter limit. Hardware: 12-core CPU, 16 GB RAM, no GPU; end-to-end run time ≈ 2 hours.

### B. Additional Results
Blocking development (100k-entity sample, top-20 per source):

| key set | pair recall | recall @6 | F0.5 ceiling |
|---|---|---|---|
| initial (adjacent name pairs, no name×number) | 91.7% | 88.1% | 0.967 |
| + all skeleton pairs, name×number, address pairs, Indic legal forms, city aliases | 95.1% | 92.2% | 0.982 |

Test prediction profile: US 3.23, India 3.18, France 3.47 predicted matches per entity; empty predictions 6.1% / 6.3% / 4.4% (5.6% singletons in train).
