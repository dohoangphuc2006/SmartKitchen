"""Khởi tạo detector/recommender một lần và gọi lại Stage 6 pipeline."""

from __future__ import annotations

import json
import logging
import sys
from dataclasses import dataclass, replace
from pathlib import Path
from threading import Lock
import time


ROOT = Path(__file__).resolve().parents[2]
LOG = logging.getLogger(__name__)
PRODUCT_STAPLE_POLICY = {
    "policy_name": "explicit_pantry_required_no_implicit_assumptions",
    "staples_checked": ["water", "salt", "pepper", "cooking_oil"],
    "assumed_present_for_can_cook_now": False,
    "excluded_from_missing_core_ingredients": True,
    "offline_eval_core_v2_note": (
        "Offline CORE_V2 evaluation rubric classifies water, salt, pepper, and cooking oil under "
        "_ALWAYS_SUPPORT_STAPLES only for core-missing diagnostics; product runtime NEVER assumes them present for CAN_COOK_NOW."
    ),
    "description_vi": (
        "Chính sách nguyên liệu nền (nước, muối, tiêu, dầu ăn): sản phẩm KHÔNG tự giả định có sẵn; "
        "nếu công thức yêu cầu nhưng chưa có trong pantry thì món vẫn ở trạng thái NEEDS_ADDITIONAL_INGREDIENTS "
        "và liệt kê rõ trong danh sách cần thêm (tách riêng khỏi missing_core_ingredients)."
    ),
    "description_en": (
        "Staple policy (water, salt, pepper, cooking oil): the product does NOT assume these staples on hand; "
        "missing required staples keep the recipe in NEEDS_ADDITIONAL_INGREDIENTS and list them under missing_ingredients "
        "(while excluding them from missing_core_ingredients)."
    ),
}
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from detector_adapter import Member1Detector  # noqa: E402
from smart_kitchen_pipeline import _pipeline, run_smart_kitchen_pipeline  # noqa: E402
from src.localization import get_localization  # noqa: E402
from src.recipe_repository import RecipeRepository  # noqa: E402
from src.object_detection import detect_objects  # noqa: E402
from core.detection_scope import ABSTENTION_NOTICE, DECISION_FIELDS, FULL30_PROFILES, PRECISION_GUARD, load_scope  # noqa: E402
from src.detection_to_ingredient import DetectionAdapter, IntegrationConfig  # noqa: E402


@dataclass(frozen=True)
class AppConfig:
    top_n: int
    max_upload_mb: int
    allowed_extensions: tuple[str, ...]
    detector_root: Path

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024


def load_app_config(root: Path = ROOT) -> AppConfig:
    """Đọc một nguồn config chung, không rải hằng số trong route/frontend."""
    root = Path(root).resolve()
    data = json.loads((root / "config" / "app_config.json").read_text(encoding="utf-8"))
    top_n = data["top_n"]
    max_upload_mb = data["max_upload_mb"]
    allowed = data["allowed_extensions"]
    if (isinstance(top_n, bool) or not isinstance(top_n, int) or not 1 <= top_n <= 20 or
            isinstance(max_upload_mb, bool) or not isinstance(max_upload_mb, int) or
            not 1 <= max_upload_mb <= 100 or not isinstance(allowed, list) or not allowed or
            not all(isinstance(ext, str) and ext in {"jpg", "jpeg", "png", "webp"} for ext in allowed)):
        raise ValueError("config/app_config.json có giá trị không hợp lệ")
    # Bản final sử dụng detector/model được bàn giao ngay trong project.
    detector_root = Path(data["detector_root"])
    if not detector_root.is_absolute():
        detector_root = root / detector_root
    return AppConfig(top_n, max_upload_mb, tuple(allowed), detector_root.resolve())


class SmartKitchenService:
    def __init__(self, root: Path = ROOT, *, profile=None, class_aware_nms=False,
                 recipe_first=False, with_yolo=False, ranking_method='final'):
        self.root = Path(root).resolve()
        self.config = load_app_config(self.root)
        self.recipe_first = recipe_first
        self.ranking_method = ranking_method
        self.detector = self.scope = None
        # _pipeline có cache; request kế tiếp không nạp lại recipe/mapping/recommender.
        self.pipeline = _pipeline(str(self.root))
        if ranking_method in {'quality_overlap', 'quality_hybrid'}:
            from src.recipe_quality import RecipeQualityRecommender

            self.quality_recommender = RecipeQualityRecommender(self.pipeline.recommender)
        elif ranking_method in {'ml_tfidf', 'ml_lsa'}:
            from src.ml_recommender import MLRecipeRecommender
            from src.recipe_quality import RecipeQualityRecommender

            quality = RecipeQualityRecommender(self.pipeline.recommender)
            self.quality_recommender = quality
            self.ml_recommender = MLRecipeRecommender.load(self.root, quality_recommender=quality)
        if not recipe_first:
            self._attach_detector(profile, class_aware_nms=class_aware_nms)
        elif with_yolo:
            try:
                self._attach_detector(PRECISION_GUARD)
            except Exception:
                LOG.exception('YOLO tùy chọn không khả dụng. Tiếp tục với pantry thủ công.')
        self.recipe_repository = RecipeRepository(self.root)
        self._recommendable_recipe_ids = frozenset(
            str(recipe_id) for recipe_id, row in self.recipe_repository.records.items()
            if row.recipe_name.strip() and row.ingredients and row.instructions.strip()
        )
        self.model_loaded = self.detector is not None
        self.recommender_loaded = bool(self.pipeline.recommender.index.recipes)
        self._lock = Lock()  # YOLO instance chia sẻ: serialize inference khi demo.
        self._frame_gate = Lock()
        self._last_frame_started = float('-inf')
        # Pre-warm canonical quality/core, Two-Tier normalized index, localization & ML matrix once at boot
        # so the very first user recommend request never pays a 3-16s cold init spike.
        try:
            self._get_quality_requirements()
            get_localization(str(self.root))
            tt = self._get_two_tier_recommender()
            if getattr(self, "ml_recommender", None) is None:
                tt._ensure_ml()
        except Exception:
            LOG.exception('Prewarm quality/two-tier requirements thất bại; sẽ nạp theo yêu cầu.')

    def _attach_detector(self, profile, *, class_aware_nms=False):
        scope = load_scope(profile, self.root, class_aware_nms=class_aware_nms)
        detector = Member1Detector(self.config.detector_root, project_root=self.root)
        model = detector.module.load_model()
        names = ({int(k): value for k, value in model.names.items()}
                 if isinstance(model.names, dict) else dict(enumerate(model.names)))
        if names != detector.official_names:
            raise ValueError("CLASS CONTRACT CONFLICT: model.names không khớp yolo_classes.csv")
        if scope:
            scope.verify_model(detector.module.MODEL_PATH, names, detector.module.MODEL_SHA256)
            if scope.profile == 'fridge11' and self.pipeline.config.detection_confidence_threshold != scope.confidence:
                raise ValueError('FRIDGE11 confidence config conflict; cần thống nhất .35')
            if scope.profile in FULL30_PROFILES:
                mapping = json.loads((self.root / 'mapping/fridge30_ingredient_mapping.json').read_text(encoding='utf-8'))
                expected = dict(self.pipeline.adapter.mapping, beef='beef')
                if mapping != expected or len(set(mapping.values())) != 30 or set(mapping) != set(scope.ontology.values()):
                    raise ValueError('FULL30 semantic mapping mismatch; never coerce beef to a cut')
                adapter = DetectionAdapter(self.root, IntegrationConfig(scope.confidence, self.config.top_n))
                adapter.mapping = dict(mapping)
                self.full30_mapping, self.full30_adapter = mapping, adapter
        detector.scope = scope
        self.scope, self.detector = scope, detector

    def analyze_image(self, path: Path) -> dict:
        with self._lock:
            if self.scope and self.scope.profile in FULL30_PROFILES:
                full_started=time.perf_counter()
                objects=detect_objects(self.detector,path)
                geometry = {k:objects[k] for k in ['boxes','image','detection_ms','raw_boxes','policy','scope','excluded_detections',*DECISION_FIELDS] if k in objects}
                if self.scope.profile == PRECISION_GUARD:
                    geometry['review_candidates'] = [dict(box, canonical_ingredient=self.full30_mapping[box['name']])
                                                     for box in geometry['review_candidates']]
                    return dict(status='NO_CONFIRMED_DETECTIONS', detected_ingredients=[], mapped_ingredients=[],
                                unmapped_ingredients=[], recommendations=[], warnings=[ABSTENTION_NOTICE],
                                processing_time_ms={'detection':objects['detection_ms'], 'adapter':0.,
                                                    'recommendation':0., 'total':round((time.perf_counter()-full_started)*1000,3)},
                                detection=geometry)
                adapter_started=time.perf_counter()
                adapted=self.full30_adapter.process_detections({'ingredients':objects['ingredients']})
                for item in adapted['detected_ingredients']:
                    item['canonical_ingredient']=self.full30_mapping[item['name']]
                warnings=adapted['warnings']+['Dự đoán chưa được xác nhận. Hãy kiểm tra/sửa pantry rồi xác nhận để gợi ý món.']
                if 'beef' in adapted['mapped_ingredients']:
                    warnings.append('Beef là thịt bò tổng quát; không tự coi là beef chuck hoặc ground beef. Vocabulary công thức hiện không có exact beef.')
                return dict(status='AWAITING_INGREDIENT_CONFIRMATION' if objects['ingredients'] else 'NO_DETECTIONS',
                    detected_ingredients=adapted['detected_ingredients'],mapped_ingredients=adapted['mapped_ingredients'],
                    unmapped_ingredients=adapted['unmapped_detections'],recommendations=[],warnings=warnings,
                    processing_time_ms={'detection':objects['detection_ms'],'adapter':round((time.perf_counter()-adapter_started)*1000,3),
                                        'recommendation':0.,'total':round((time.perf_counter()-full_started)*1000,3)},
                    detection=geometry)
            objects = {}
            def detection_with_geometry(image_path):
                objects.update(detect_objects(self.detector, image_path))
                return {'ingredients': objects['ingredients']}
            result = run_smart_kitchen_pipeline(
                image_path=path, detector=detection_with_geometry, top_n=self.config.top_n, root=self.root)
            if objects:
                result['detection'] = {k: objects[k] for k in ['boxes', 'image', 'detection_ms', 'raw_boxes', 'policy', 'scope', 'excluded_detections'] if k in objects}
            return result

    def detect_frame(self, image):
        """At most one inference and one live start/second globally per process.

        Reject rather than queue frames behind upload or another browser. No
        recommendation, filesystem writes or history are involved.
        """
        from backend.errors import ApiError
        if not self._frame_gate.acquire(blocking=False):
            raise ApiError(429, 'DETECTION_BUSY', 'Bộ nhận diện đang bận. Hãy chờ một chút.')
        try:
            if time.monotonic()-self._last_frame_started < 1.0:
                raise ApiError(429, 'FRAME_RATE_LIMIT', 'Đã đạt giới hạn nhận diện trực tiếp.')
            if not self._lock.acquire(blocking=False):
                raise ApiError(429, 'DETECTION_BUSY', 'Bộ nhận diện đang bận. Hãy chờ một chút.')
            try:
                self._last_frame_started = time.monotonic()
                result = detect_objects(self.detector, image)
                return {k: result[k] for k in ['boxes', 'image', 'detection_ms', 'raw_boxes', 'policy', 'scope', 'excluded_detections', *DECISION_FIELDS] if k in result}
            finally:
                self._lock.release()
        finally:
            self._frame_gate.release()

    def _get_two_tier_recommender(self):
        rec = getattr(self, '_two_tier_recommender', None)
        if rec is None:
            from src.two_tier_recommender import TwoTierRecommender

            rec = self._two_tier_recommender = TwoTierRecommender(self)
        return rec

    def recommend_ingredients(
        self,
        ingredients: list[str],
        top_n: int,
        ranking_method: str | None = None,
        *,
        two_tier: bool = False,
        confirmed_staples: list[str] | None = None,
    ) -> dict:
        """Reuse the loaded engine and its normalization; never invoke detection."""
        root = getattr(self, 'root', ROOT)
        local = get_localization(str(root))
        method = ranking_method or getattr(self, 'ranking_method', 'final')
        if two_tier and method in {'final', 'ml_tfidf', 'ml_lsa'}:
            return self._get_two_tier_recommender().recommend(
                ingredients,
                top_n=top_n,
                ranking_method=method,
                confirmed_staples=confirmed_staples,
                product_staple_policy=PRODUCT_STAPLE_POLICY,
            )
        values=[local.canonical_input(name) for name in ingredients]
        if method in {'ml_tfidf', 'ml_lsa'}:
            engine = getattr(self, 'ml_recommender', None)
            if engine is None:
                from src.ml_recommender import MLRecipeRecommender
                from src.recipe_quality import RecipeQualityRecommender

                quality = getattr(self, 'quality_recommender', None) or RecipeQualityRecommender(self.pipeline.recommender)
                self.quality_recommender = quality
                self.ml_recommender = engine = MLRecipeRecommender.load(root, quality_recommender=quality)
        elif method in {'quality_overlap', 'quality_hybrid'}:
            engine = getattr(self, 'quality_recommender', None)
            if engine is None:
                from src.recipe_quality import RecipeQualityRecommender

                self.quality_recommender = engine = RecipeQualityRecommender(self.pipeline.recommender)
        else:
            engine = self.pipeline.recommender
        scope=getattr(self,'scope',None)
        generic_beef = False
        if scope and scope.profile in FULL30_PROFILES:
            generic_beef=any(x.lower().replace('_',' ').strip() in {'beef','beef meat'} for x in values)
            values=[x for x in values if x.lower().replace('_',' ').strip() not in {'beef','beef meat'}]
        # A recommendation card must open its source recipe. Filter before
        # sorting and truncation so an unavailable detail cannot consume a slot.
        recommendable_ids = getattr(self, '_recommendable_recipe_ids', None)
        detail_gate = ({'eligible_recipe_ids': recommendable_ids}
                       if method in {'final', 'ml_tfidf', 'ml_lsa'} and recommendable_ids is not None else {})
        result = engine.recommend(values, top_n=top_n, method=method, return_diagnostics=True, **detail_gate)
        if generic_beef:
            result['normalized_ingredients']=sorted(set(result['normalized_ingredients'])|{'beef'})
            result['warnings'].append('Beef tổng quát được giữ trong pantry; chưa có exact recipe token, không được tính là phần cắt cụ thể. Nhập phần thịt nếu bạn biết.')
        elif (method in {'final', 'ml_tfidf', 'ml_lsa'} and top_n > 0
              and not result['recommendations'] and result['normalized_ingredients']
              and not result['unresolved_ingredients']):
            result = self._recommend_near_matches(engine, values, top_n, method, result)
        if method in {'final', 'ml_tfidf', 'ml_lsa'} and result['recommendations']:
            from src.recipe_food_availability import add_food_availability

            add_food_availability(root, result)
            self._enrich_readiness_and_missing_core(result)
            result['staple_policy'] = PRODUCT_STAPLE_POLICY
        elif method in {'final', 'ml_tfidf', 'ml_lsa'} and not result['recommendations']:
            result['empty_detail'] = self._build_empty_detail(result)
            result['staple_policy'] = PRODUCT_STAPLE_POLICY
        return result

    def _get_quality_requirements(self):
        quality = getattr(self, 'quality_recommender', None)
        if quality is None:
            from src.recipe_quality import RecipeQualityRecommender
            quality = self.quality_recommender = RecipeQualityRecommender(self.pipeline.recommender)
        lookup = getattr(self, '_quality_recipe_idx_by_id', None)
        if lookup is None:
            lookup = self._quality_recipe_idx_by_id = {
                str(r.row_id): i for i, r in enumerate(quality.index.recipes)
            }
        bulk_by_rid = getattr(self, '_bulk_core_by_rid', None)
        if bulk_by_rid is None:
            import csv
            import re
            from collections import defaultdict
            from src.recipe_requirements import ingredient_source_role

            weight_g = {'g': 1.0, 'gram': 1.0, 'grams': 1.0, 'kg': 1000.0, 'lb': 453.592, 'lbs': 453.592,
                        'pound': 453.592, 'pounds': 453.592, 'oz': 28.3495, 'ounce': 28.3495, 'ounces': 28.3495}
            raw_wt_re = re.compile(r'(\d+(?:\.\d+)?(?:\s+\d+/\d+)?|\d+/\d+)\s*[-\s]*(pounds?|lbs?|kilograms?|kg|ounces?|oz|grams?|g)\b', re.I)
            staple_skip = {'water', 'ice', 'salt', 'kosher salt', 'sea salt', 'sugar', 'granulated sugar',
                           'olive oil', 'extra virgin olive oil', 'vegetable oil', 'canola oil', 'butter',
                           'unsalted butter', 'salted butter', 'all purpose flour'}
            liquid_words = {'broth', 'stock', 'water', 'milk', 'cream', 'oil', 'vinegar', 'wine', 'beer', 'juice', 'sauce'}
            bulk_map = defaultdict(set)
            root = getattr(self, 'root', ROOT)
            with (root / 'processed' / 'ingredient_details.csv').open(encoding='utf-8-sig', newline='') as f:
                for row in csv.DictReader(f):
                    if ingredient_source_role(row) != 'required':
                        continue
                    unit = (row.get('unit') or '').lower().strip().rstrip('.')
                    qty_s = (row.get('quantity') or '').strip()
                    max_g = None
                    if unit in weight_g and qty_s:
                        try:
                            val = sum(float(p.split('/')[0]) / float(p.split('/')[1]) if '/' in p else float(p)
                                      for p in qty_s.split())
                            max_g = val * weight_g[unit]
                        except (ValueError, ZeroDivisionError):
                            max_g = None
                    raw_s = row.get('ingredient_raw') or ''
                    for m in raw_wt_re.finditer(raw_s):
                        u_raw = m.group(2).lower().rstrip('.')
                        if u_raw in weight_g:
                            try:
                                q_raw = sum(float(p.split('/')[0]) / float(p.split('/')[1]) if '/' in p else float(p)
                                            for p in m.group(1).split())
                                g_raw = q_raw * weight_g[u_raw]
                                if max_g is None or g_raw > max_g:
                                    max_g = g_raw
                            except (ValueError, ZeroDivisionError):
                                continue
                    if max_g is None or max_g < 100.0:
                        continue
                    tok = quality.normalize(row.get('ingredient_clean') or '')
                    if not tok or tok in staple_skip:
                        continue
                    if set(tok.split()) & liquid_words and not (set(tok.split()) & {'chicken', 'beef', 'pork', 'shrimp', 'salmon'}):
                        continue
                    bulk_map[str(row['row_id'])].add(tok)
            bulk_by_rid = self._bulk_core_by_rid = dict(bulk_map)
        return quality, lookup, bulk_by_rid

    def _enrich_readiness_and_missing_core(self, result: dict) -> None:
        import re
        from src.recipe_requirements import _SEASONINGS, _TITLE_FOODS, _LIQUID_OR_PREPARED_PROTEIN

        quality, lookup, bulk_by_rid = self._get_quality_requirements()
        index = quality.index
        names = index.id_to_name
        ids = index.name_to_id

        title_food_set = _TITLE_FOODS | {'duck', 'turkey', 'lamb', 'pork', 'beef', 'chicken', 'shrimp', 'salmon', 'tuna', 'cod', 'tilapia'}
        title_food_words = sorted(title_food_set, key=lambda x: (-len(x), x))
        title_re = re.compile(r'(?<!\w)(?:' + '|'.join(re.escape(w) + r'(?:es|s)?' for w in title_food_words) + r')(?!\w)', re.I)

        for recipe in result['recommendations']:
            rid = str(recipe['recipe_id'])
            avail = recipe.get('food_availability')
            eff_missing = list(avail['missing_ingredients'] if avail else recipe['missing_ingredients'])
            prepared_recipes = {
                item['recipe']
                for item in (recipe.get('verified_compatible_ingredients') or [])
                if isinstance(item, dict) and item.get('recipe')
            }
            eff_missing = [tok for tok in eff_missing if tok not in prepared_recipes]

            idx = lookup.get(rid)
            optional_names: set[str] = set()
            core_names: set[str] = set()
            if idx is not None:
                req = quality.requirements.recipes[idx]
                optional_names = {names[j] for j in req.optional}
                core_names = {names[j] for j in (req.core | req.source_identity)}
                if req.equipment and not recipe.get('required_equipment'):
                    recipe['required_equipment'] = list(req.equipment)

            title_text = recipe.get('recipe_name', '').lower()
            title_hits: set[str] = set()
            for m in title_re.finditer(title_text):
                w = m.group(0)
                if w in title_food_set:
                    title_hits.add(w)
                elif w.endswith('es') and w[:-2] in title_food_set:
                    title_hits.add(w[:-2])
                elif w.endswith('s') and w[:-1] in title_food_set:
                    title_hits.add(w[:-1])

            bulk_tokens = bulk_by_rid.get(rid, set())
            missing_core = []
            missing_seasonings = []
            required_missing = []
            for tok in eff_missing:
                norm_tok = quality.normalize(tok)
                if tok in optional_names or norm_tok in optional_names:
                    continue
                required_missing.append(tok)
                tok_id = ids.get(norm_tok) or ids.get(tok)
                is_seasoning = (norm_tok in _SEASONINGS) or (tok_id is not None and tok_id in quality.requirements.seasonings)
                if is_seasoning:
                    missing_seasonings.append(tok)
                    continue
                is_core = (tok in core_names) or (norm_tok in core_names) or (norm_tok in bulk_tokens)
                if not is_core and title_hits and not _LIQUID_OR_PREPARED_PROTEIN.search(norm_tok):
                    tok_words = set(re.findall(r'[a-z]+', norm_tok))
                    if tok_words & title_hits:
                        is_core = True
                if is_core:
                    missing_core.append(tok)

            recipe['missing_core_ingredients'] = sorted(set(missing_core))
            recipe['missing_seasonings'] = sorted(set(missing_seasonings))
            has_equipment = bool(recipe.get('required_equipment'))
            is_cookable_now = (len(required_missing) == 0 and not has_equipment)
            recipe['suggestion_status'] = 'pantry_match' if is_cookable_now else 'needs_ingredients'
            recipe['readiness_status'] = 'CAN_COOK_NOW' if is_cookable_now else 'NEEDS_ADDITIONAL_INGREDIENTS'

    def _suggest_empty_additions(self, norm_items: list[str], method: str, limit: int = 5) -> list[dict]:
        """Suggest common co-occurring ingredients from candidate recipes to help pass the shared filter."""
        if not norm_items:
            return []
        from collections import Counter

        root = getattr(self, 'root', ROOT)
        local = get_localization(str(root))
        curated_vi = getattr(self, '_curated_ingredient_vi', None)
        if curated_vi is None:
            curated_path = Path(root) / 'config' / 'ingredient_display_vi.json'
            curated_vi = self._curated_ingredient_vi = (
                json.loads(curated_path.read_text(encoding='utf-8')) if curated_path.is_file() else {}
            )
        base_rec = self.pipeline.recommender
        normalizer = base_rec.shared_normalizer
        use_quality = method in {'ml_tfidf', 'ml_lsa'} and getattr(self, 'quality_recommender', None) is not None
        index = self.quality_recommender.index if use_quality else base_rec.index
        user_ids = {index.name_to_id[t] for t in norm_items if t in index.name_to_id}
        if not user_ids:
            return []
        recommendable = getattr(self, '_recommendable_recipe_ids', None)
        cfg = base_rec.default_config
        min_ratio = cfg.min_match_ratio
        min_matched_cfg = cfg.min_matched_ingredients
        pantry_groups = {normalizer.token_to_cut_group.get(t.lower(), t.lower()) for t in norm_items}
        skip_tokens = {
            'water', 'ice', 'salt', 'kosher salt', 'sea salt', 'fine sea salt',
            'coarse kosher salt', 'table salt', 'iodized salt', 'flaky sea salt',
        }

        candidate_indices = {idx for uid in user_ids for idx in index.postings.get(uid, ())}
        co_counts: Counter[int] = Counter()
        unlock_counts: Counter[int] = Counter()
        for idx in candidate_indices:
            recipe = index.recipes[idx]
            if recommendable is not None and recipe.row_id not in recommendable:
                continue
            if not recipe.has_instructions or (cfg.ready_only and not recipe.ready_for_mapping):
                continue
            total = len(recipe.ingredient_ids)
            if not total:
                continue
            matched_now = len(user_ids & recipe.ingredient_ids)
            for tid in recipe.ingredient_ids - user_ids:
                co_counts[tid] += 1
                if (matched_now + 1) / total >= min_ratio:
                    tok = index.id_to_name[tid]
                    grp = normalizer.token_to_cut_group.get(tok.lower(), tok.lower())
                    eff_groups = len(pantry_groups | {grp})
                    if (matched_now + 1) >= min(eff_groups, min_matched_cfg):
                        unlock_counts[tid] += 1

        ranked: list[tuple[int, int, str, str]] = []
        for tid, cnt in co_counts.items():
            tok = index.id_to_name[tid]
            if tok in skip_tokens or tok not in curated_vi:
                continue
            grp = normalizer.token_to_cut_group.get(tok.lower(), tok.lower())
            if grp in pantry_groups:
                continue
            ranked.append((1 if unlock_counts[tid] > 0 else 0, cnt, tok, curated_vi[tok]))

        ranked.sort(key=lambda item: (-item[0], -item[1], item[2]))
        seen_vi: set[str] = set()
        suggestions: list[dict] = []
        for _, _, tok, vi_name in ranked:
            vi_key = vi_name.casefold()
            if vi_key in seen_vi:
                continue
            seen_vi.add(vi_key)
            suggestions.append({
                'canonical': tok,
                'display_vi': vi_name,
                'display_en': tok.replace('_', ' '),
            })
            if len(suggestions) >= limit:
                break
        return suggestions

    def _build_empty_detail(self, result: dict) -> dict:
        norm_items = result.get('normalized_ingredients') or []
        unresolved = result.get('unresolved_ingredients') or []
        candidate_count = int(result.get('candidate_count') or 0)
        qualified_count = int(result.get('qualified_count') or 0)
        method = str(result.get('method') or 'final')
        group_count = self.pipeline.recommender.shared_normalizer.count_ingredient_groups(norm_items)
        local = get_localization(str(getattr(self, 'root', ROOT)))
        suggested = self._suggest_empty_additions(norm_items, method) if (norm_items and candidate_count > 0) else []

        def _fmt_recognized_vi(items: list[str]) -> str:
            parts = []
            for tok in items:
                vi = local.get_ingredient_vi(tok)
                en = tok.replace('_', ' ')
                parts.append(f'{vi} ({en})' if vi.casefold() != en.casefold() else en)
            return ', '.join(parts)

        def _fmt_recognized_en(items: list[str]) -> str:
            return ', '.join(tok.replace('_', ' ') for tok in items)

        if not norm_items:
            if unresolved:
                reasons = {u.get('reason') for u in unresolved}
                if reasons & {'GENERIC_MEAT_CUT_UNSPECIFIED', 'GENERIC_VARIANT_UNSPECIFIED'}:
                    exp_vi = (
                        'Nguyên liệu hiện tại còn chung chung/chưa rõ loại cụ thể nên hệ thống không tự đoán sai. '
                        'Hãy chọn biến thể cụ thể (ví dụ: ớt hiểm, thịt bò xay, thịt ba chỉ, cá hồi) rồi thử lại.'
                    )
                    exp_en = (
                        'Entered ingredients are generic/unspecified variants and were kept unresolved to avoid mis-mapping. '
                        'Please select a specific type and try again.'
                    )
                else:
                    exp_vi = (
                        'Chưa có nguyên liệu nào khớp với từ điển công thức hiện tại. '
                        'Hãy kiểm tra lại tên nguyên liệu hoặc chọn từ danh mục 526 nguyên liệu.'
                    )
                    exp_en = (
                        'No entered ingredients matched the recipe catalog vocabulary. '
                        'Check spelling or pick ingredients from the 526-item catalog.'
                    )
            else:
                exp_vi = 'Danh sách nguyên liệu đang trống.'
                exp_en = 'Pantry list is empty.'
        elif group_count == 1 and candidate_count > 0:
            rec_vi = _fmt_recognized_vi(norm_items)
            rec_en = _fmt_recognized_en(norm_items)
            sugg_vi = ', '.join(s['display_vi'] for s in suggested) or 'tỏi, hành tây, trứng, hành lá, nước tương'
            sugg_en = ', '.join(s['display_en'] for s in suggested) or 'garlic, onion, egg, green onion, soy sauce'
            exp_vi = (
                f'Đã nhận diện nguyên liệu: {rec_vi}. '
                f'Tìm thấy {candidate_count} công thức liên quan nhưng chưa có công thức nào vượt điều kiện lọc chung '
                f'(tỉ lệ khớp ≥25% hoặc đủ điều kiện gợi ý gần phù hợp chỉ với 1 nhóm nguyên liệu). '
                f'Hãy thử thêm nguyên liệu đi kèm như: {sugg_vi}.'
            )
            exp_en = (
                f'Recognized ingredient(s): {rec_en}. '
                f'Found {candidate_count} related recipes, but none passed the shared eligibility filter (>=25% coverage) '
                f'or conservative pantry-staple near-match policy on its own. Try adding: {sugg_en}.'
            )
        elif result.get('empty_reason') == 'INSUFFICIENT_RECOGNIZED_BASIS':
            rec_vi = _fmt_recognized_vi(norm_items)
            rec_en = _fmt_recognized_en(norm_items)
            unr_names = ', '.join(
                str(u.get('extracted_name') or u.get('sub_item') or u.get('raw_line') or '').strip()
                for u in unresolved[:4]
                if str(u.get('extracted_name') or u.get('sub_item') or u.get('raw_line') or '').strip()
            )
            sugg_vi = ', '.join(s['display_vi'] for s in suggested) or 'tỏi, hành tây, trứng, cà chua, thịt gà'
            sugg_en = ', '.join(s['display_en'] for s in suggested) or 'garlic, onion, egg, tomato, chicken'
            exp_vi = (
                f'Các nguyên liệu chính ({unr_names or "chưa nhận diện"}) chưa có trong từ điển công thức chuẩn, '
                f'nên phần còn lại ({rec_vi}) chưa đủ cơ sở để gợi ý món phù hợp (tránh gợi ý món tráng miệng/đồ uống không liên quan). '
                f'Hãy chọn nguyên liệu cụ thể hơn từ danh mục hoặc thêm: {sugg_vi}.'
            )
            exp_en = (
                f'Key ingredients ({unr_names or "unresolved"}) are outside the canonical recipe vocabulary, '
                f'so the remaining items ({rec_en}) lack sufficient basis for a relevant meal (avoiding irrelevant dessert/drink matches). '
                f'Try selecting specific catalog items or adding: {sugg_en}.'
            )
        elif candidate_count > 0:
            rec_vi = _fmt_recognized_vi(norm_items)
            rec_en = _fmt_recognized_en(norm_items)
            sugg_vi = ', '.join(s['display_vi'] for s in suggested) or 'tỏi, hành tây, dầu ăn, muối, nước tương'
            sugg_en = ', '.join(s['display_en'] for s in suggested) or 'garlic, onion, oil, salt, soy sauce'
            exp_vi = (
                f'Đã nhận diện nguyên liệu: {rec_vi}. '
                f'Tìm thấy {candidate_count} công thức có chứa ít nhất 1 nguyên liệu nhưng 0 công thức vượt điều kiện lọc chung '
                f'(tối thiểu 2 nhóm khớp & ≥25% tỷ lệ khớp) hoặc bộ lọc gần phù hợp. '
                f'Hãy thử thêm nguyên liệu đi kèm như: {sugg_vi}.'
            )
            exp_en = (
                f'Recognized ingredient(s): {rec_en}. '
                f'Found {candidate_count} candidate recipes, but 0 passed the shared overlap threshold '
                f'(>=2 matched groups & >=25% coverage) or conservative near-match allowlist. Try adding: {sugg_en}.'
            )
        else:
            rec_vi = _fmt_recognized_vi(norm_items)
            rec_en = _fmt_recognized_en(norm_items)
            exp_vi = f'Đã nhận diện nguyên liệu: {rec_vi}, nhưng chưa có công thức nào chứa nguyên liệu này trong bộ dữ liệu.'
            exp_en = f'Recognized ingredient(s): {rec_en}, but no recipes in the dataset contained them.'

        return {
            'candidate_count': candidate_count,
            'qualified_count': qualified_count,
            'pantry_group_count': group_count,
            'unresolved_count': len(unresolved),
            'recognized_ingredients': list(norm_items),
            'suggested_additions': suggested,
            'explanation_vi': exp_vi,
            'explanation_en': exp_en,
        }

    def _recommend_near_matches(self, engine, values, top_n, method, strict_result):
        from src.recipe_fallback import FALLBACK_WARNING, eligible_fallback_recipes
        from src.recipe_quality import RecipeQualityRecommender

        quality = getattr(self, 'quality_recommender', None)
        if quality is None:
            quality = self.quality_recommender = RecipeQualityRecommender(self.pipeline.recommender)
        scoring_index = engine.index if method == 'final' else quality.index
        eligible = eligible_fallback_recipes(quality, strict_result['normalized_ingredients'], scoring_index)
        recommendable_ids = getattr(self, '_recommendable_recipe_ids', None)
        if recommendable_ids is not None:
            eligible = {rid: matches for rid, matches in eligible.items() if rid in recommendable_ids}
        if not eligible:
            return strict_result

        # Relax only the overlap gate. The recipe allowlist enforces the second
        # pass policy and the selected engine still computes its original score.
        ranker_values = list(values)
        if any('shrimp' in matches for matches in eligible.values()) and any(
            x in {'shrimp peeled deveined', 'shrimp, peeled, deveined'} for x in strict_result['normalized_ingredients']
        ):
            if 'shrimp' not in ranker_values:
                ranker_values.append('shrimp')
        gate = (dict(config=replace(engine.default_config, min_matched_ingredients=1, min_match_ratio=0))
                if method == 'final' else dict(mode='open'))
        result = engine.recommend(ranker_values, top_n=top_n, method=method, return_diagnostics=True,
                                  eligible_recipe_ids=set(eligible), **gate)
        if not result['recommendations']:
            return strict_result
        result['normalized_ingredients'] = list(strict_result['normalized_ingredients'])
        result['fallback_used'] = True
        result['warnings'].append(FALLBACK_WARNING)
        for recipe in result['recommendations']:
            recipe['suggestion_status'] = 'needs_ingredients' if recipe.get('missing_ingredients') else 'pantry_match'
            recipe['matched_core_ingredients'] = eligible[recipe['recipe_id']]
        return result

    def get_recipe_detail(self, recipe_id: int) -> dict:
        return self.recipe_repository.get_detail(recipe_id)
