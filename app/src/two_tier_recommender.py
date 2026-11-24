"""Two-tier recommendation engine (Tier A: CAN_COOK_NOW, Tier B: NEEDS_ADDITIONAL_INGREDIENTS).

Strictly enforces PRODUCT_STAPLE_POLICY: water, salt, pepper, and cooking oil are NEVER
assumed present unless explicitly present in the user's pantry or confirmed_staples.
Preserves the existing 25% eligibility pipeline untouched as the comparison baseline.
"""
from __future__ import annotations

from dataclasses import dataclass
import math
import re
from typing import Any

from src.ml_recommender import MODEL_VERSION
from src.recipe_normalized_index import (
    BASIC_STAPLE_CANONICALS,
    CONFIRMED_STAPLE_FAMILIES,
    NormalizedRecipeIndex,
    NormalizedRecipeRecord,
)
from src.recipe_requirements import _SEASONINGS
from src.recommender import (
    calculate_cosine,
    calculate_final_score,
    calculate_jaccard,
    calculate_match_ratio,
)

# Experimental weights combining active model similarity, matched primary ingredients,
# user pantry coverage, missing required ingredient count, match ratio, and normalization confidence.
# Explicitly marked unvalidated until independent human evaluation is completed.
EXPERIMENTAL_TIER_B_WEIGHTS: dict[str, float] = {
    "model_similarity": 0.25,
    "core_match_coverage": 0.20,
    "user_pantry_coverage": 0.20,
    "missing_required_efficiency": 0.15,
    "match_ratio": 0.12,
    "match_confidence": 0.08,
    "anchor_protein_match_bonus": 0.10,
    "missing_core_penalty": 0.28,
    "zero_core_when_missing_penalty": 0.14,
    "equipment_penalty": 0.18,
    "unreliable_limit01_penalty": 0.08,
    "missing_user_anchor_penalty": 0.35,
    "conflicting_anchor_penalty": 0.18,
    "missing_recipe_anchor_penalty": 0.12,
}

_UNRESOLVED_PRIMARY_PROTEIN_RE = re.compile(
    r"(?<!\w)(?:cá(?:\s+\w+)?|tôm|cua|ghẹ|mực|ốc|lươn|ếch|thịt(?:\s+\w+)?|sườn|ba rọi|nạc|bò|heo|lợn|"
    r"gà|vịt|ngan|ngỗng|fish|pork|beef|chicken|crab|eel|frog|duck|lamb|mutton|venison|clam|mussel)(?!\w)",
    re.I,
)

_ANCHOR_PROTEIN_TOKENS: frozenset[str] = frozenset({
    "chicken", "chicken breast", "boneless skinless chicken breast", "chicken thigh",
    "skinless boneless chicken thigh", "bone-in skin-on chicken thigh", "skin-on, bone-in chicken thigh",
    "chicken wing", "chicken drumstick", "chicken legs", "chicken tenders", "whole chicken",
    "ground chicken", "cooked chicken", "ground beef", "ground beef chuck", "beef chuck",
    "boneless beef chuck", "ground sirloin", "beef tenderloin", "flank steak", "skirt steak",
    "sirloin steak", "rib-eye steak", "rib eye steak", "new york strip steak", "beef brisket",
    "beef short ribs", "boneless beef short ribs", "corned beef", "veal", "lamb",
    "pork belly", "pork ribs", "ground pork", "ground pork shoulder", "pork shoulder",
    "boneless pork shoulder", "pork tenderloin", "boneless pork loin", "bone-in pork chops",
    "bone in pork chops", "bacon", "pancetta", "ham", "cooked ham", "chinese sausage",
    "duck", "duck breast", "duck legs", "turkey", "ground turkey", "ground lamb",
    "salmon", "salmon fillet", "skinless salmon fillet", "cod fillet", "halibut", "halibut fillet",
    "tuna", "tuna steak", "catfish fillet", "tilapia fillet", "snapper", "red snapper", "snapper fillet",
    "branzino", "sea bass", "shrimp", "shrimp peeled deveined", "shrimp, peeled, deveined",
    "shrimp in shell", "jumbo shrimp", "prawn", "prawns", "squid", "octopus",
    "sea scallop", "littleneck clam", "mussel",
    "tofu", "firm tofu", "extra-firm tofu", "extra firm tofu", "silken tofu",
})


@dataclass(frozen=True)
class EvaluatedCandidate:
    record: NormalizedRecipeRecord
    matched_canon: frozenset[str]
    matched_raw_set: frozenset[str]
    missing_count: int
    matched_core_count: int
    matched_primary_count: int
    matched_user_anchor: bool
    has_conflicting_anchor: bool
    is_non_meal_dessert_or_drink: bool
    match_ratio: float
    match_confidence: float
    min_confidence: float
    passes_baseline_25pct: bool
    is_tier_a: bool
    method_similarity: float
    ml_tfidf_cosine: float | None
    ml_lsa_cosine: float | None
    tier_score: float
    tier_factors: tuple[tuple[str, float], ...]


def _unresolved_has_primary_food(unresolved: list[dict[str, Any]]) -> bool:
    for item in unresolved:
        text = str(item.get("extracted_name") or item.get("sub_item") or item.get("raw_line") or "").strip()
        if text and _UNRESOLVED_PRIMARY_PROTEIN_RE.search(text):
            return True
    return False


class TwoTierRecommender:
    """Two-tier retrieval and experimental Tier B ranking over NormalizedRecipeIndex."""

    def __init__(self, service: Any) -> None:
        self.service = service
        self.norm_index = NormalizedRecipeIndex(service)
        self.normalizer = self.norm_index.normalizer
        self.quality = self.norm_index.quality
        self.base_recommender = service.pipeline.recommender
        self.vocab_set = set(self.quality.index.name_to_id)
        self._ml_row_to_idx: dict[str, int] | None = None

    def _ensure_ml(self) -> Any:
        ml = getattr(self.service, "ml_recommender", None)
        if ml is None:
            from src.ml_recommender import MLRecipeRecommender

            ml = self.service.ml_recommender = MLRecipeRecommender.load(
                self.service.root, quality_recommender=self.quality
            )
        if self._ml_row_to_idx is None:
            self._ml_row_to_idx = {
                str(rid): i for i, rid in enumerate(ml.model.recipe_row_ids)
            }
        return ml

    def _normalize_confirmed_staples(self, confirmed_staples: list[str] | None) -> list[str]:
        if not confirmed_staples:
            return []
        parsed = self.normalizer.normalize_pantry(confirmed_staples, vocabulary=self.vocab_set)
        valid = []
        seen: set[str] = set()
        for tok in parsed["normalized_ingredients"]:
            # Map common oil/salt/pepper variants back to their canonical staple family if applicable
            canonical = tok
            if tok in CONFIRMED_STAPLE_FAMILIES["salt"]:
                canonical = "salt"
            elif tok in CONFIRMED_STAPLE_FAMILIES["pepper"]:
                canonical = "pepper"
            elif tok in CONFIRMED_STAPLE_FAMILIES["water"]:
                canonical = "water"
            elif tok in CONFIRMED_STAPLE_FAMILIES["vegetable oil"]:
                canonical = "vegetable oil"
            elif tok in CONFIRMED_STAPLE_FAMILIES["olive oil"]:
                canonical = "olive oil"
            if canonical in BASIC_STAPLE_CANONICALS and canonical not in seen:
                seen.add(canonical)
                valid.append(canonical)
        return sorted(valid)

    def recommend(
        self,
        ingredients: list[str],
        *,
        top_n: int = 5,
        ranking_method: str = "final",
        confirmed_staples: list[str] | None = None,
        product_staple_policy: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        from src.localization import get_localization

        root = self.service.root
        local = get_localization(str(root))
        main_values = [local.canonical_input(x) for x in ingredients]
        parsed_main = self.normalizer.normalize_pantry(main_values, vocabulary=self.vocab_set)
        main_tokens = list(parsed_main["normalized_ingredients"])
        warnings = list(parsed_main["warnings"])
        unresolved = list(parsed_main["unresolved_ingredients"])

        confirmed_tokens = self._normalize_confirmed_staples(confirmed_staples)
        # Never use background staple checkboxes to manufacture results when no main
        # pantry ingredient could be resolved (e.g., empty / unresolved generic / OOV).
        if not main_tokens or not top_n:
            is_ml_req = ranking_method in {"ml_tfidf", "ml_lsa"}
            ml_obj = self._ensure_ml() if is_ml_req else None
            empty_res: dict[str, Any] = {
                "two_tier": True,
                "method": ranking_method,
                "normalized_ingredients": [],
                "main_ingredients": [],
                "confirmed_staples": confirmed_tokens,
                "unresolved_ingredients": unresolved,
                "warnings": warnings,
                "candidate_count": 0,
                "qualified_count": 0,
                "recommendations": [],
                "tier_a_recommendations": [],
                "tier_b_recommendations": [],
                "empty_reason": "NO_RECOGNIZED_INGREDIENTS" if not main_tokens else "TOP_N_ZERO",
                "tier_summary": {
                    "tier_a_total": 0,
                    "tier_b_total": 0,
                    "tier_a_returned": 0,
                    "tier_b_returned": 0,
                    "tier_b_below_25pct_returned": 0,
                    "limit01_blocked_from_tier_a": 0,
                    "confirmed_staples_used": confirmed_tokens,
                    "ranking_weights_experimental": dict(EXPERIMENTAL_TIER_B_WEIGHTS),
                },
                "staple_policy": product_staple_policy,
            }
            if is_ml_req and ml_obj is not None:
                empty_res["model_version"] = MODEL_VERSION
                empty_res["artifact_sha256"] = ml_obj.artifact_sha256
            empty_res["empty_detail"] = self.service._build_empty_detail(empty_res)
            return empty_res
        # User may also explicitly type salt/water/pepper/vegetable oil in main pantry:
        explicit_staple_set = frozenset(
            t for t in (set(main_tokens) | set(confirmed_tokens)) if t in BASIC_STAPLE_CANONICALS
        )
        effective_tokens = sorted(set(main_tokens) | set(confirmed_tokens))
        effective_set = set(effective_tokens)
        primary_user_set = effective_set - BASIC_STAPLE_CANONICALS

        # Expand shrimp peeled/deveined bidirectional compatibility safely
        has_peeled_shrimp = bool(effective_set & {"shrimp, peeled, deveined", "shrimp peeled deveined"})
        if has_peeled_shrimp:
            effective_set |= {"shrimp, peeled, deveined", "shrimp peeled deveined"}

        is_ml = ranking_method in {"ml_tfidf", "ml_lsa"}
        ml = self._ensure_ml() if is_ml else None
        tfidf_vec = lsa_vec = None
        if ml is not None and effective_tokens:
            q_ids, q_weights = ml.model.query_vector(effective_tokens)
            tfidf_vec = ml.model.tfidf_scores(q_ids, q_weights)
            lsa_vec = ml.model.lsa_scores(q_ids, q_weights)

        # Retrieve candidates from NormalizedRecipeIndex postings.
        # When user supplied primary (non-staple) ingredients, scan only postings of those
        # primary tokens (since candidates must match >=1 primary ingredient), avoiding
        # scanning 10k+ staple-only postings.
        if primary_user_set:
            lookup_keys = set(primary_user_set)
            if has_peeled_shrimp:
                lookup_keys |= {"shrimp", "shrimp, peeled, deveined", "shrimp peeled deveined"}
        else:
            lookup_keys = set(effective_set)
            for st in explicit_staple_set:
                lookup_keys |= CONFIRMED_STAPLE_FAMILIES[st]

        candidate_positions: set[int] = set()
        postings = self.norm_index.postings
        for key in lookup_keys:
            p_list = postings.get(key)
            if p_list:
                candidate_positions.update(p_list)

        cfg = self.base_recommender.default_config
        group_count = self.normalizer.count_ingredient_groups(effective_tokens)
        effective_min_matched = min(max(group_count, 1), cfg.min_matched_ingredients)
        user_count = max(len(effective_set), 1)
        primary_user_count = len(primary_user_set)
        user_anchors = primary_user_set & _ANCHOR_PROTEIN_TOKENS
        has_unresolved_protein = _unresolved_has_primary_food(unresolved)
        total_user_primary_items = primary_user_count + len(unresolved)
        savory_or_multi_context = total_user_primary_items >= 2 and (
            has_unresolved_protein or bool(user_anchors) or primary_user_count >= 3
        )
        cov_denom = min(max(primary_user_count, 1), 2)

        w_sim = EXPERIMENTAL_TIER_B_WEIGHTS["model_similarity"]
        w_core = EXPERIMENTAL_TIER_B_WEIGHTS["core_match_coverage"]
        w_user = EXPERIMENTAL_TIER_B_WEIGHTS["user_pantry_coverage"]
        w_miss = EXPERIMENTAL_TIER_B_WEIGHTS["missing_required_efficiency"]
        w_ratio = EXPERIMENTAL_TIER_B_WEIGHTS["match_ratio"]
        w_conf = EXPERIMENTAL_TIER_B_WEIGHTS["match_confidence"]
        w_anc = EXPERIMENTAL_TIER_B_WEIGHTS["anchor_protein_match_bonus"]
        w_mcore = EXPERIMENTAL_TIER_B_WEIGHTS["missing_core_penalty"]
        w_zcore = EXPERIMENTAL_TIER_B_WEIGHTS["zero_core_when_missing_penalty"]
        w_eq = EXPERIMENTAL_TIER_B_WEIGHTS["equipment_penalty"]
        w_rel = EXPERIMENTAL_TIER_B_WEIGHTS["unreliable_limit01_penalty"]
        w_miss_anc = EXPERIMENTAL_TIER_B_WEIGHTS["missing_user_anchor_penalty"]
        w_conf_anc = EXPERIMENTAL_TIER_B_WEIGHTS["conflicting_anchor_penalty"]
        w_mrec_anc = EXPERIMENTAL_TIER_B_WEIGHTS["missing_recipe_anchor_penalty"]

        limit01_blocked_tier_a = 0
        irrelevant_filtered_count = 0
        tier_a_pool: list[EvaluatedCandidate] = []
        tier_b_pool: list[EvaluatedCandidate] = []

        records = self.norm_index.records
        ml_row_to_idx = self._ml_row_to_idx if (ml is not None) else None
        for pos in candidate_positions:
            rec = records[pos]
            matched_raw_set: set[str] = set()
            matched_canon: set[str] = set()
            conf_sum = 0.0
            min_conf = 1.0
            matched_cnt = 0
            matched_primary_cnt = 0
            has_peeled_tok = rec.has_peeled_token if has_peeled_shrimp else False

            for raw_tok, norm_tok, prov_rule, prov_conf, staple_fam in rec.token_entries:
                is_direct = (raw_tok in effective_set) or (norm_tok in effective_set)
                is_shrimp_prep = (
                    not is_direct
                    and has_peeled_tok
                    and norm_tok == "shrimp"
                    and prov_rule in {"source_verified_prep", "exact_canonical"}
                )
                matched_fam = (staple_fam in explicit_staple_set) if (not is_direct and not is_shrimp_prep and staple_fam) else False

                if is_direct or is_shrimp_prep or matched_fam:
                    matched_raw_set.add(raw_tok)
                    matched_canon.add(norm_tok)
                    matched_cnt += 1
                    if norm_tok in primary_user_set or raw_tok in primary_user_set:
                        matched_primary_cnt += 1
                    tok_conf = prov_conf if is_direct else 0.95
                    conf_sum += tok_conf
                    if tok_conf < min_conf:
                        min_conf = tok_conf

            if not matched_cnt:
                continue
            if primary_user_set and matched_primary_cnt == 0:
                continue

            matched_user_anchor = bool(matched_canon & user_anchors) or (
                has_peeled_shrimp and ("shrimp" in matched_canon)
            )
            is_non_meal = rec.is_non_meal_dessert_or_drink

            # Prevent non-meal desserts/cocktails/smoothies/brines from surfacing on single-item
            # fruit/veg overlap inside multi-ingredient or unresolved-protein pantries.
            if savory_or_multi_context and matched_primary_cnt <= 1 and not matched_user_anchor and is_non_meal:
                irrelevant_filtered_count += 1
                continue
            # If user's primary protein (e.g., cá lóc) is unresolved and only 1 non-anchor
            # secondary ingredient resolved (e.g., ["cá lóc", "rau ngổ", "thơm"]), do not fabricate
            # weak 1-ingredient Tier B matches.
            if has_unresolved_protein and primary_user_count == 1 and not user_anchors and not matched_user_anchor:
                irrelevant_filtered_count += 1
                continue

            total_req = rec.total_required
            missing_cnt = total_req - matched_cnt
            match_ratio = matched_cnt / total_req
            avg_conf = conf_sum / matched_cnt

            missing_core_cnt = 0
            for t in rec.core_raw_tokens:
                if t not in matched_raw_set:
                    missing_core_cnt += 1

            matched_core_cnt = len(matched_canon & rec.core_tokens)
            passes_25pct = (matched_cnt >= effective_min_matched) and (match_ratio >= cfg.min_match_ratio)

            ml_tfidf_val: float | None = None
            ml_lsa_val: float | None = None
            if ml_row_to_idx is not None:
                m_idx = ml_row_to_idx.get(rec.row_id)
                if m_idx is not None:
                    ml_tfidf_val = float(tfidf_vec[m_idx]) if tfidf_vec is not None else 0.0
                    ml_lsa_val = float(lsa_vec[m_idx]) if lsa_vec is not None else 0.0
                else:
                    ml_tfidf_val, ml_lsa_val = 0.0, 0.0
                method_sim = ml_tfidf_val if ranking_method == "ml_tfidf" else ml_lsa_val
            else:
                jacc = calculate_jaccard(matched_cnt, user_count, total_req)
                cos = calculate_cosine(matched_cnt, user_count, total_req)
                ucov = matched_cnt / user_count
                method_sim = calculate_final_score(match_ratio, jacc, cos, ucov, cfg)

            zero_missing = missing_cnt == 0
            zero_equip = len(rec.equipment) == 0
            if zero_missing and zero_equip and not rec.reliable_for_can_cook_now:
                limit01_blocked_tier_a += 1
            is_tier_a = zero_missing and zero_equip and rec.reliable_for_can_cook_now and min_conf >= 0.90

            conflicting_anchor = bool(
                user_anchors and not matched_user_anchor and ((rec.core_tokens & _ANCHOR_PROTEIN_TOKENS) - user_anchors)
            )

            if is_tier_a:
                tier_score = float(method_sim)
                factors_tup: tuple[tuple[str, float], ...] = (
                    ("model_similarity", float(method_sim)),
                    ("matched_core_count", float(matched_core_cnt)),
                    ("missing_required_count", 0.0),
                    ("match_ratio", match_ratio),
                    ("match_confidence", avg_conf),
                )
            else:
                sim_norm = max(0.0, min(1.0, float(method_sim)))
                raw_core_cov = (
                    matched_core_cnt / rec.core_count
                    if rec.core_count
                    else (1.0 if matched_primary_cnt > 0 else 0.0)
                )
                # Scale core_cov on multi-item pantries so 1-token matches don't tie 2+-token matches
                core_cov = raw_core_cov * min(1.0, matched_primary_cnt / cov_denom) if primary_user_count >= 2 else raw_core_cov
                user_cov = (
                    matched_primary_cnt / primary_user_count
                    if primary_user_count
                    else (matched_cnt / user_count)
                )
                miss_core_ratio = (missing_core_cnt / rec.core_count) if rec.core_count else 0.0
                miss_eff = 1.0 / (1.0 + 0.25 * missing_cnt)
                anchor_bonus = w_anc if (matched_canon & _ANCHOR_PROTEIN_TOKENS) else 0.0
                no_core_pen = w_zcore if (matched_core_cnt == 0 and missing_core_cnt > 0) else 0.0
                equip_pen = w_eq if rec.equipment else 0.0
                rel_pen = w_rel if not rec.reliable_for_can_cook_now else 0.0
                miss_user_anc_pen = w_miss_anc if (user_anchors and not matched_user_anchor) else 0.0
                conf_anc_pen = w_conf_anc if conflicting_anchor else 0.0
                missing_recipe_anchor = (
                    missing_core_cnt > 0
                    and bool((rec.core_tokens - matched_canon) & _ANCHOR_PROTEIN_TOKENS)
                )
                mrec_anc_pen = w_mrec_anc if missing_recipe_anchor else 0.0
                tier_score = (
                    w_sim * sim_norm
                    + w_core * core_cov
                    + w_user * user_cov
                    + w_miss * miss_eff
                    + w_ratio * match_ratio
                    + w_conf * avg_conf
                    + anchor_bonus
                    - w_mcore * miss_core_ratio
                    - no_core_pen
                    - equip_pen
                    - rel_pen
                    - miss_user_anc_pen
                    - conf_anc_pen
                    - mrec_anc_pen
                )
                factors_tup = (
                    ("model_similarity", sim_norm),
                    ("core_match_coverage", core_cov),
                    ("user_pantry_coverage", user_cov),
                    ("missing_required_efficiency", miss_eff),
                    ("match_ratio", match_ratio),
                    ("match_confidence", avg_conf),
                    ("anchor_protein_match_bonus", anchor_bonus),
                    ("missing_core_penalty", miss_core_ratio),
                    ("equipment_penalty", equip_pen),
                    ("missing_user_anchor_penalty", miss_user_anc_pen),
                    ("conflicting_anchor_penalty", conf_anc_pen),
                    ("missing_recipe_anchor_penalty", mrec_anc_pen),
                )

            cand = EvaluatedCandidate(
                record=rec,
                matched_canon=frozenset(matched_canon),
                matched_raw_set=frozenset(matched_raw_set),
                missing_count=missing_cnt,
                matched_core_count=matched_core_cnt,
                matched_primary_count=matched_primary_cnt,
                matched_user_anchor=matched_user_anchor,
                has_conflicting_anchor=conflicting_anchor,
                is_non_meal_dessert_or_drink=is_non_meal,
                match_ratio=match_ratio,
                match_confidence=avg_conf,
                min_confidence=min_conf,
                passes_baseline_25pct=passes_25pct,
                is_tier_a=is_tier_a,
                method_similarity=float(method_sim),
                ml_tfidf_cosine=ml_tfidf_val,
                ml_lsa_cosine=ml_lsa_val,
                tier_score=float(tier_score),
                tier_factors=factors_tup,
            )
            if is_tier_a:
                tier_a_pool.append(cand)
            else:
                tier_b_pool.append(cand)

        # Tier B cohort discipline: avoid padding Top-5 with weak 1-token distractions or
        # conflicting animal proteins when stronger anchor/multi-ingredient matches exist.
        if tier_b_pool:
            if user_anchors and any(c.matched_user_anchor for c in tier_b_pool):
                filtered_b = [
                    c for c in tier_b_pool
                    if c.matched_user_anchor
                    or (c.matched_primary_count >= 2 and not c.has_conflicting_anchor)
                    or (c.matched_primary_count >= 3)
                ]
                if filtered_b:
                    irrelevant_filtered_count += len(tier_b_pool) - len(filtered_b)
                    tier_b_pool = filtered_b
            if primary_user_count >= 3 and any(c.matched_primary_count >= 2 for c in tier_b_pool):
                filtered_b = [
                    c for c in tier_b_pool
                    if c.matched_primary_count >= 2 or c.matched_user_anchor
                ]
                if filtered_b:
                    irrelevant_filtered_count += len(tier_b_pool) - len(filtered_b)
                    tier_b_pool = filtered_b

        tier_a_pool.sort(
            key=lambda c: (
                -round(c.method_similarity, 6),
                -c.matched_primary_count,
                -c.record.total_required,
                -c.match_confidence,
                c.record.row_id_int,
            )
        )
        tier_b_pool.sort(
            key=lambda c: (
                -round(c.tier_score, 6),
                -c.matched_core_count,
                c.missing_count,
                -round(c.method_similarity, 6),
                c.record.row_id_int,
            )
        )

        seen_titles: set[str] = set()
        tier_a_recs = self._take_top_dedup(
            tier_a_pool, top_n, seen_titles, "A",
            effective_set=effective_set, explicit_staple_set=explicit_staple_set, has_peeled_shrimp=has_peeled_shrimp,
        )
        tier_b_recs = self._take_top_dedup(
            tier_b_pool, top_n, seen_titles, "B",
            effective_set=effective_set, explicit_staple_set=explicit_staple_set, has_peeled_shrimp=has_peeled_shrimp,
        )
        combined = (tier_a_recs + tier_b_recs)[:top_n]

        empty_reason = None
        if not combined:
            if not top_n:
                empty_reason = "TOP_N_ZERO"
            elif not effective_tokens:
                empty_reason = "NO_RECOGNIZED_INGREDIENTS"
            elif irrelevant_filtered_count > 0:
                empty_reason = "INSUFFICIENT_RECOGNIZED_BASIS"
            else:
                empty_reason = "NO_CANDIDATE_PASSED_ELIGIBILITY"

        basis_status = "COMPLETE"
        basis_notice_vi = None
        basis_notice_en = None
        if unresolved and combined:
            basis_status = "PARTIAL_UNRESOLVED_INPUT"
            unr_names = ", ".join(
                str(u.get("extracted_name") or u.get("sub_item") or u.get("raw_line") or "").strip()
                for u in unresolved[:4]
                if str(u.get("extracted_name") or u.get("sub_item") or u.get("raw_line") or "").strip()
            )
            basis_notice_vi = (
                f"Lưu ý phạm vi: các nguyên liệu chưa có trong từ điển ({unr_names}) không tạo bằng chứng khớp giả; "
                "kết quả Tầng B bên dưới chỉ tham khảo theo phần nguyên liệu đã nhận diện."
            )
            basis_notice_en = (
                f"Scope notice: unrecognized items ({unr_names}) did not produce fabricated matches; "
                "Tier B suggestions below reflect only the recognized subset of your pantry."
            )

        tier_summary: dict[str, Any] = {
            "tier_a_total": len(tier_a_pool),
            "tier_b_total": len(tier_b_pool),
            "tier_a_returned": len(tier_a_recs),
            "tier_b_returned": len(tier_b_recs),
            "tier_b_below_25pct_returned": sum(1 for r in tier_b_recs if not r.get("passes_baseline_25pct")),
            "limit01_blocked_from_tier_a": limit01_blocked_tier_a,
            "irrelevant_filtered_count": irrelevant_filtered_count,
            "basis_status": basis_status,
            "confirmed_staples_used": confirmed_tokens,
            "ranking_weights_experimental": dict(EXPERIMENTAL_TIER_B_WEIGHTS),
        }
        if basis_notice_vi:
            tier_summary["basis_notice_vi"] = basis_notice_vi
            tier_summary["basis_notice_en"] = basis_notice_en

        result: dict[str, Any] = {
            "two_tier": True,
            "method": ranking_method,
            "normalized_ingredients": effective_tokens,
            "main_ingredients": main_tokens,
            "confirmed_staples": confirmed_tokens,
            "unresolved_ingredients": unresolved,
            "warnings": warnings,
            "candidate_count": len(candidate_positions),
            "qualified_count": len(tier_a_pool) + len(tier_b_pool),
            "recommendations": combined,
            "tier_a_recommendations": tier_a_recs,
            "tier_b_recommendations": tier_b_recs,
            "empty_reason": empty_reason,
            "tier_summary": tier_summary,
            "staple_policy": product_staple_policy,
        }
        if is_ml and ml is not None:
            result["model_version"] = MODEL_VERSION
            result["artifact_sha256"] = ml.artifact_sha256
        if not combined:
            result["empty_detail"] = self.service._build_empty_detail(result)
        elif not tier_a_recs and effective_tokens:
            unlock_sugg = self.service._suggest_empty_additions(effective_tokens, ranking_method)
            if unlock_sugg:
                result["tier_summary"]["suggested_additions"] = unlock_sugg
        return result

    @staticmethod
    def _take_top_dedup(
        pool: list[EvaluatedCandidate],
        limit: int,
        seen_titles: set[str],
        group: str,
        *,
        effective_set: set[str],
        explicit_staple_set: frozenset[str],
        has_peeled_shrimp: bool,
    ) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for c in pool:
            rec = c.record
            title_key = " ".join(rec.recipe_name.casefold().split())
            if title_key in seen_titles:
                continue
            seen_titles.add(title_key)

            verified_compat: list[dict[str, str]] = []
            has_peeled_tok = rec.has_peeled_token if has_peeled_shrimp else False
            for raw_tok, norm_tok, prov_rule, _prov_conf, staple_fam in rec.token_entries:
                if raw_tok not in c.matched_raw_set:
                    continue
                is_direct = (raw_tok in effective_set) or (norm_tok in effective_set)
                is_shrimp_prep = (
                    not is_direct
                    and has_peeled_tok
                    and norm_tok == "shrimp"
                    and prov_rule in {"source_verified_prep", "exact_canonical"}
                )
                if is_direct and prov_rule != "exact_canonical":
                    verified_compat.append({"pantry": norm_tok, "recipe": raw_tok, "evidence": prov_rule})
                elif is_shrimp_prep:
                    verified_compat.append({
                        "pantry": "shrimp, peeled, deveined",
                        "recipe": raw_tok,
                        "evidence": "verified_shrimp_prep",
                    })
                elif not is_direct and staple_fam and staple_fam in explicit_staple_set:
                    verified_compat.append({
                        "pantry": staple_fam,
                        "recipe": raw_tok,
                        "evidence": f"confirmed_staple_family:{staple_fam}",
                    })

            missing_req = sorted(t for t in rec.required_tokens if t not in c.matched_raw_set)
            missing_set = set(missing_req)
            missing_core = sorted(missing_set & rec.core_raw_tokens)
            missing_seas = sorted(missing_set & rec.seasoning_raw_tokens)

            rec_dict: dict[str, Any] = {
                "recipe_id": rec.row_id,
                "recipe_name": rec.recipe_name,
                "score": round(c.tier_score, 6),
                "method_similarity": round(c.method_similarity, 6),
                "match_ratio": round(c.match_ratio, 6),
                "matched_ingredients": sorted(c.matched_canon),
                "missing_ingredients": missing_req,
                "matched_count": len(c.matched_raw_set),
                "missing_count": c.missing_count,
                "missing_required_count": c.missing_count,
                "matched_core_count": c.matched_core_count,
                "missing_core_ingredients": missing_core,
                "missing_seasonings": missing_seas,
                "required_equipment": list(rec.equipment),
                "readiness_group": group,
                "readiness_status": "CAN_COOK_NOW" if c.is_tier_a else "NEEDS_ADDITIONAL_INGREDIENTS",
                "suggestion_status": "pantry_match" if c.is_tier_a else "needs_ingredients",
                "match_confidence": round(c.match_confidence, 4),
                "passes_baseline_25pct": c.passes_baseline_25pct,
                "reliable_for_can_cook_now": rec.reliable_for_can_cook_now,
                "ranking_factors": {k: round(v, 6) for k, v in c.tier_factors},
            }
            if verified_compat:
                rec_dict["verified_compatible_ingredients"] = verified_compat
            if c.ml_tfidf_cosine is not None:
                rec_dict["ml_tfidf_cosine"] = round(c.ml_tfidf_cosine, 6)
            if c.ml_lsa_cosine is not None:
                rec_dict["ml_lsa_cosine"] = round(c.ml_lsa_cosine, 6)
            out.append(rec_dict)
            if len(out) == limit:
                break
        return out
