# Evaluation Limitations & Governance Boundaries (`EVALUATION_LIMITATIONS.md`)

- **Date:** `2026-11-16`
- **Overall Model Selection Decision:** **`MODEL_SELECTION_NOT_ESTABLISHED`**
- **Active Production Default:** `final` (Stage 5 Rule-based, default `ranking_method='final'` in [`SmartKitchenService`](../app/backend/services/smart_kitchen_service.py))
- **Experimental ML Modes:** `ml_tfidf`, `ml_lsa` (loaded from [`recipe_tfidf_lsa_v1.npz`](../app/models/recipe_ml/recipe_tfidf_lsa_v1.npz))

This document states the exact methodological, data, and governance boundaries separating verified engineering telemetry from unestablished human/generalization claims.

---

## 1. Strict 4-Layer Boundary Table

| Verification Layer | Current Status | What Can Be Claimed Truthfully | What Is Strictly Prohibited |
| :--- | :---: | :--- | :--- |
| **1. Objective Technical Metrics** | **VERIFIED** | Fill rate (`0.8444` on `DEV-36`), retrieval coverage (`94.44%`), lexical `match_ratio` (`0.3730` Stage 5 vs `0.3437` TF-IDF vs `0.3370` LSA), cold/warm latency (`8.14–11.13 ms` warm median), RSS memory (`343.95 MB` Stage 5 -> `390.31 MB` with ML, `588.97 MB` peak), intra-process (`540/540`) & restart (`108/108`) determinism, and SHA-256 artifact integrity. | Claiming higher `match_ratio` or lower Jaccard proves superior culinary utility to end users. |
| **2. Heuristic & Product-Policy Metrics** | **MEASURED (NON-GROUND-TRUTH)** | Structural `missing_core_ingredients` rates (`55.92%`–`71.05%` across production modes), offline `CORE_V2` ablation tradeoffs (`J1..J4` achieving `0.0000` `CORE_V2` violation on `DEV-16`), and strict `PRODUCT_STAPLE_POLICY` readiness rates (`CAN_COOK_NOW = 2.63%`, `NEEDS_ADDITIONAL_INGREDIENTS = 97.37%`). | Calling `missing_core_ingredients`, `CORE_V2`, or `match_ratio` "ground-truth relevance" or using offline `J1..J4` metrics to claim ML beats Stage 5. |
| **3. Human Evaluation** | **NOT VALIDATED (`QUALITY_FLAGGED`)** | `DEV_REVIEW_A_V2.json` (`TV2`: `167/167` scored `3`, `1` blank, `2` contradictions) and `DEV_REVIEW_B_V2.json` (`TV1`: `163/168` scored `3`) are frozen as invalid (`kappa = 0.0000`). Per Owner Decision, manual human review is bypassed for now. | Using `DEV_REVIEW_{A,B}_V2.json` scores to compute official `nDCG@5` or `P@5`, fabricating replacement labels, or hiding the `QUALITY_FLAGGED` status. |
| **4. Generalization / Model Selection** | **NOT ESTABLISHED (`0 / 30` HOLDOUT)** | Independent external holdout pantries stand at `0 / 30` (`BLOCKED_AWAITING_GENUINE_EXTERNAL_PANTRIES`). Development sets (`DEV-16` and `Phieu-20`) were used during pipeline design and alias tuning (`TV2` authored `19/20` `Phieu-20` pantries). | Promoting `ml_tfidf` or `ml_lsa` to production default, or claiming generalization beyond DEV cohorts. |

---

## 2. Model & Algorithm Limitations Observed in Evaluation

1. **Unsupervised Retrieval vs. Supervised Preference Modeling:**
   - `ml_tfidf` and `ml_lsa` are unsupervised vector-space rankers fit solely on co-occurrence structure over `13,489` canonical recipes (`27,431` vocabulary tokens).
   - `ml_lsa` (`TruncatedSVD`, `n_components=100`) captures `19.21%` of TF-IDF matrix variance (`explained_variance_ratio_sum`). On multi-ingredient or aromatic-heavy queries (`phieu14`, `phieu19`), projection onto 100 latent dimensions frequently dilutes anchor protein weights and elevates stylistically co-occurring dishes (`semantic drift`).
2. **Lack of Core-Ingredient Constraint in Active Production Pipeline:**
   - Because production `final`, `ml_tfidf`, and `ml_lsa` filter only on `min_match_ratio >= 0.25` and `effective_min_matched` without `CORE_V2` hero-ingredient verification, `55.92%` (`ml_tfidf`), `70.39%` (`final`), and `71.05%` (`ml_lsa`) of Top-5 returned slots on `DEV-36` flag at least one `missing_core_ingredient`.
   - Offline ablation (`J1..J4` in `ML_FIRST_ABLATION_RESULTS.json`) remains **experimental non-production** (`265–367 ms` unindexed latency in research harness vs `< 12 ms` production).
3. **Cold Initialization Latency on First Startup:**
   - First-time instantiation of `SmartKitchenService(recipe_first=True)` (including boot pre-warm of `_get_quality_requirements`) took `18.57 s` under Python `-B` no-bytecode mode, plus `3.69 s` on the very first `recommend_ingredients` query and `1.16 s` on the first ML call (lazy-load + SHA-256 verification of `recipe_tfidf_lsa_v1.npz`), before settling to `8.14–11.13 ms` warm median latency.

---

## 3. Data, Localization & Sample Size Limitations

1. **Non-Random Sample Composition (`N = 36` DEV Queries):**
   - `DEV-16` (`16` scenarios) and `Phieu-20` (`20` Vietnamese kitchen sheets) are purposive diagnostic cohorts, NOT an i.i.d. random sample from an independent user population (`19/20` `Phieu-20` queries share a single cluster `participant_id = "TV2"`).
2. **Corpus Provenance & Cut Granularity (`LIMIT-01`):**
   - The `13,489` clean recipes originate from an English-language Western/international recipe corpus. Unmapped regional Vietnamese ingredients (`cá lóc`, `rau ngổ, ngò gai`, `rau ngót rừng lạ`) return `UNRESOLVED`. Specific protein cuts (`chicken breast`, `chicken thigh`, `ground pork`) match exact catalog cut tokens (`2`, `6`, `76` candidates respectively) rather than rolling up to parent generic meat dishes, trading recall for cut-level fidelity.
3. **Quantity Checking Not Enforced:**
   - User pantry quantities (`200g thịt gà`, `2 quả trứng`) are preserved as display notes; matching and `CAN_COOK_NOW` evaluate token presence and equipment availability rather than gram/volume sufficiency.
