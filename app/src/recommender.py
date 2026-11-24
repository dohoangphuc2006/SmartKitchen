"""Recommendation baseline theo nguyên liệu cho Smart Kitchen.

Ba metric trên vector nhị phân được tính từ tập chỉ số nguyên liệu thưa;
không tạo ma trận đặc 13.501 x 27.929 trong RAM.
"""

from __future__ import annotations

import json
import logging
import math
import re
from collections import defaultdict
from dataclasses import dataclass
from functools import cached_property, lru_cache
from pathlib import Path
from typing import Any, Callable, Iterable

import pandas as pd


LOG = logging.getLogger(__name__)
DEFAULT_ROOT = Path(__file__).resolve().parent.parent
METHODS = ("match_ratio", "jaccard", "cosine", "final")
CONTENT_METHODS = ("overlap", "binary_cosine", "tfidf_cosine")


@dataclass(frozen=True)
class ScoringConfig:
    match_ratio_weight: float = 0.35
    jaccard_weight: float = 0.20
    cosine_weight: float = 0.20
    user_coverage_weight: float = 0.25
    missing_penalty_weight: float = 0.15
    min_match_ratio: float = 0.25
    min_matched_ingredients: int = 2
    ready_only: bool = False
    deduplicate_titles: bool = True

    def __post_init__(self) -> None:
        weights = (self.match_ratio_weight, self.jaccard_weight,
                   self.cosine_weight, self.user_coverage_weight)
        if any(x < 0 for x in weights) or not math.isclose(sum(weights), 1.0):
            raise ValueError("Các trọng số score phải không âm và có tổng bằng 1")
        if not 0 <= self.min_match_ratio <= 1:
            raise ValueError("min_match_ratio phải nằm trong [0, 1]")
        if self.missing_penalty_weight < 0 or self.min_matched_ingredients < 1:
            raise ValueError("Penalty/min_matched_ingredients không hợp lệ")


@dataclass(frozen=True)
class Recipe:
    row_id: str
    recipe_name: str
    ingredient_ids: frozenset[int]
    ready_for_mapping: bool
    has_instructions: bool = True


@dataclass
class RecipeIndex:
    recipes: list[Recipe]
    id_to_name: list[str]
    name_to_id: dict[str, int]
    postings: dict[int, tuple[int, ...]]
    total_source_rows: int
    skipped_rows: int
    ready_recipe_count: int
    source_columns: list[str]


def normalized(value: str) -> str:
    """Chỉ chuẩn hóa cách viết để tra cứu; không thay giá trị trong các file nguồn."""
    return " ".join(re.sub(r"[_‐‑‒–—-]+", " ", value.lower().strip()).split())


def load_mapping(root: Path = DEFAULT_ROOT) -> tuple[dict[str, str], dict[str, str]]:
    root = Path(root)
    json_path = root / "mapping" / "ingredient_mapping.json"
    csv_path = root / "mapping" / "ingredient_mapping.csv"
    alias_path = root / "mapping" / "ingredient_aliases.json"
    for path in (json_path, csv_path, alias_path):
        if not path.is_file():
            raise FileNotFoundError(f"Thiếu file Giai đoạn 3: {path}")
    mapping = json.loads(json_path.read_text(encoding="utf-8"))
    aliases = json.loads(alias_path.read_text(encoding="utf-8"))
    rows = pd.read_csv(csv_path, dtype=str, keep_default_na=False)
    required = {"yolo_class", "standard_ingredient", "match_type"}
    if not required.issubset(rows.columns):
        raise ValueError(f"ingredient_mapping.csv thiếu cột: {sorted(required - set(rows.columns))}")
    expected = dict(zip(rows.loc[rows.match_type != "UNMATCHED", "yolo_class"],
                        rows.loc[rows.match_type != "UNMATCHED", "standard_ingredient"]))
    if mapping != expected or any(not target for target in mapping.values()):
        raise ValueError("ingredient_mapping.json khác CSV hoặc có đích rỗng")
    alias_lookup: dict[str, str] = {}
    for canonical, variants in aliases.items():
        for variant in variants + [canonical]:
            key = normalized(variant)
            if key in alias_lookup and alias_lookup[key] != canonical:
                raise ValueError(f"Alias nhập nhằng: {variant}")
            alias_lookup[key] = canonical
    LOG.info("Đã nạp %d class YOLO có mapping", len(mapping))
    return mapping, alias_lookup


def load_recipes(root: Path = DEFAULT_ROOT, *, normalize_ingredient: Callable[[str], str] | None = None) -> RecipeIndex:
    path = Path(root) / "processed" / "recipes_cleaned.csv"
    if not path.is_file():
        raise FileNotFoundError(f"Thiếu file Giai đoạn 2: {path}")
    required = {"row_id", "recipe_name", "ingredients_clean", "ready_for_mapping"}
    header = pd.read_csv(path, nrows=0).columns.tolist()
    if not required.issubset(header):
        raise ValueError(f"recipes_cleaned.csv thiếu cột: {sorted(required - set(header))}")
    data = pd.read_csv(path, usecols=list(required | ({'instructions'} & set(header))),
                       dtype=str, keep_default_na=False)
    if data["row_id"].eq("").any() or data["row_id"].duplicated().any():
        raise ValueError("row_id rỗng hoặc trùng trong recipes_cleaned.csv")

    # ID nguyên liệu và postings là biểu diễn nhị phân thưa dùng cho cả ba metric.
    names: list[str] = []
    name_to_id: dict[str, int] = {}
    postings_lists: dict[int, list[int]] = defaultdict(list)
    recipes: list[Recipe] = []
    skipped = ready = 0
    for row in data.itertuples(index=False):
        row_id = str(row.row_id)
        try:
            ingredient_names = json.loads(row.ingredients_clean)
            if not isinstance(ingredient_names, list) or not all(isinstance(x, str) for x in ingredient_names):
                raise ValueError("không phải list[str]")
        except (json.JSONDecodeError, TypeError, ValueError) as exc:
            LOG.warning("Bỏ qua recipe row_id=%s: ingredients_clean lỗi (%s)", row_id, exc)
            skipped += 1
            continue
        title = str(row.recipe_name).strip()
        clean_names = {normalize_ingredient(x) if normalize_ingredient else x for x in ingredient_names if x}
        clean_names.discard("")
        if not title or not clean_names:
            LOG.warning("Bỏ qua recipe row_id=%s: tên/ingredients rỗng", row_id)
            skipped += 1
            continue
        item_ids = set()
        for name in clean_names:
            if name not in name_to_id:
                name_to_id[name] = len(names)
                names.append(name)
            item_ids.add(name_to_id[name])
        recipe_index = len(recipes)
        for ingredient_id in item_ids:
            postings_lists[ingredient_id].append(recipe_index)
        is_ready = row.ready_for_mapping == "True"
        ready += is_ready
        recipes.append(Recipe(row_id, title, frozenset(item_ids), is_ready,
                              bool(getattr(row, 'instructions', 'available').strip())))
    LOG.info("Đã nạp %d/%d recipe, bỏ qua %d; %d có ready_for_mapping=True",
             len(recipes), len(data), skipped, ready)
    return RecipeIndex(recipes, names, name_to_id,
                       {k: tuple(v) for k, v in postings_lists.items()},
                       len(data), skipped, ready, header)


def normalize_user_ingredients(
    user_ingredients: Iterable[str | dict[str, Any]] | None,
    mapping: dict[str, str],
    alias_lookup: dict[str, str],
    recipe_vocabulary: set[str],
    direct_lookup: dict[str, set[str]] | None = None,
) -> tuple[list[str], list[str]]:
    if user_ingredients is None:
        return [], ["Input nguyên liệu rỗng"]
    if isinstance(user_ingredients, (str, dict)):
        user_ingredients = [user_ingredients]
    if direct_lookup is None:
        direct_lookup = defaultdict(set)
        for name in recipe_vocabulary:
            direct_lookup[normalized(name)].add(name)
    class_lookup = {normalized(key): target for key, target in mapping.items()}
    names: set[str] = set()
    warnings: list[str] = []
    for item in user_ingredients:
        if isinstance(item, dict):
            raw = item.get("class", item.get("name", ""))
        elif isinstance(item, str):
            raw = item
        else:
            warnings.append(f"Bỏ qua input không hợp lệ: {type(item).__name__}")
            continue
        if not isinstance(raw, str) or not raw.strip():
            warnings.append("Bỏ qua tên nguyên liệu rỗng")
            continue
        key = normalized(raw)
        target = class_lookup.get(key) or alias_lookup.get(key)
        if target is None:
            direct = direct_lookup.get(key, set())
            if len(direct) == 1:
                target = next(iter(direct))
            elif len(direct) > 1:
                warnings.append(f"Tên nhập '{raw}' nhập nhằng trong vocabulary; đã bỏ qua")
                continue
        if target is None:
            if key in {'beef', 'beef meat'}:
                warnings.append(f"'{raw}' chưa xác định phần thịt; hãy nhập phần cụ thể nếu biết (ví dụ: beef chuck).")
            else:
                warnings.append(f"Không có mapping/vocabulary cho '{raw}'; đã bỏ qua")
            continue
        if target not in recipe_vocabulary:
            warnings.append(f"'{raw}' map tới '{target}' nhưng không có trong Recipe Dataset; đã bỏ qua")
            continue
        names.add(target)
    if not names and not warnings:
        warnings.append("Input nguyên liệu rỗng")
    return sorted(names), warnings


def calculate_match_ratio(matched_count: int, recipe_count: int) -> float:
    return matched_count / recipe_count if recipe_count else 0.0


def calculate_jaccard(matched_count: int, user_count: int, recipe_count: int) -> float:
    union = user_count + recipe_count - matched_count
    return matched_count / union if union else 0.0


def calculate_cosine(matched_count: int, user_count: int, recipe_count: int) -> float:
    denominator = math.sqrt(user_count * recipe_count)
    return matched_count / denominator if denominator else 0.0


def calculate_final_score(match_ratio: float, jaccard: float, cosine: float,
                          user_coverage: float,
                          config: ScoringConfig = ScoringConfig()) -> float:
    missing_penalty = 1.0 - match_ratio
    base = (config.match_ratio_weight * match_ratio
            + config.jaccard_weight * jaccard
            + config.cosine_weight * cosine
            + config.user_coverage_weight * user_coverage)
    return max(0.0, base - config.missing_penalty_weight * missing_penalty)


def load_scoring_config(root: Path = DEFAULT_ROOT) -> ScoringConfig:
    """Nạp cấu hình chốt Stage 5; không thay đổi dữ liệu hoặc baseline Stage 4 đã lưu."""
    path = Path(root) / "config" / "recommendation_config.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError("Cấu hình phải là JSON object")
        return ScoringConfig(**data)
    except (OSError, json.JSONDecodeError, TypeError, ValueError) as exc:
        raise ValueError(f"Không thể nạp recommendation_config.json: {exc}") from exc


class Recommender:
    def __init__(self, root: Path = DEFAULT_ROOT):
        self.root = Path(root).resolve()
        self.default_config = load_scoring_config(self.root)
        self.mapping, self.alias_lookup = load_mapping(self.root)
        self.index = load_recipes(self.root)
        self.recipe_vocabulary = set(self.index.name_to_id)
        self.direct_lookup: dict[str, set[str]] = defaultdict(set)
        for name in self.index.name_to_id:
            self.direct_lookup[normalized(name)].add(name)

    @cached_property
    def shared_normalizer(self):
        from src.recipe_quality import IngredientNormalizer
        return IngredientNormalizer(self)

    @cached_property
    def tfidf_weights(self) -> tuple[tuple[float, ...], tuple[float, ...]]:
        # Recipes and pantry use ingredient presence (binary TF). Fit smoothed
        # IDF on the available catalog, then use the same weights on the query.
        count = len(self.index.recipes)
        squared = tuple((1 + math.log((1 + count) / (1 + len(self.index.postings[i])))) ** 2
                        for i in range(len(self.index.id_to_name)))
        norms = tuple(math.sqrt(math.fsum(squared[i] for i in recipe.ingredient_ids))
                      for recipe in self.index.recipes)
        return squared, norms

    def candidate_indices(self, user_ids: set[int]) -> set[int]:
        """Union of the postings for ingredients that the pantry actually has."""
        return {idx for ingredient in user_ids for idx in self.index.postings[ingredient]}

    def recommend(self, user_ingredients: Iterable[str | dict[str, Any]] | None,
                  top_n: int = 5, method: str = "final",
                  config: ScoringConfig | None = None,
                  return_diagnostics: bool = False,
                  *, legacy_normalization: bool = False,
                  eligible_recipe_ids: set[str] | None = None) -> list[dict] | dict:
        if method not in METHODS + CONTENT_METHODS:
            raise ValueError(f"method phải thuộc {METHODS + CONTENT_METHODS}")
        if top_n < 0:
            raise ValueError("top_n phải >= 0")
        config = config or self.default_config
        content_method = method in CONTENT_METHODS
        if legacy_normalization:
            user_names, warnings = normalize_user_ingredients(
                user_ingredients, self.mapping, self.alias_lookup,
                self.recipe_vocabulary, self.direct_lookup)
            unresolved_ingredients: list[dict] = []
            normalization_details: list[dict] = []
        else:
            parsed = self.shared_normalizer.normalize_pantry(
                user_ingredients, vocabulary=self.recipe_vocabulary)
            user_names = parsed["normalized_ingredients"]
            warnings = list(parsed["warnings"])
            unresolved_ingredients = parsed["unresolved_ingredients"]
            normalization_details = parsed["items"]
        candidate_count = 0
        qualified: list[dict] = []
        if user_names and top_n:
            user_ids = {self.index.name_to_id[name] for name in user_names}
            group_count = (
                len(user_ids)
                if legacy_normalization
                else self.shared_normalizer.count_ingredient_groups(user_names)
            )
            # Với một nhóm nguyên liệu đầu vào (ví dụ: nhiều phần thịt gà) vẫn cho phép
            # một match. Từ hai nhóm khác nhau trở lên, cần ít nhất hai match.
            effective_min_matched = min(group_count, config.min_matched_ingredients)
            candidate_indices = self.candidate_indices(user_ids)
            candidate_count = len(candidate_indices)
            if method == "tfidf_cosine":
                squared_idf, recipe_norms = self.tfidf_weights
                pantry_norm = math.sqrt(math.fsum(squared_idf[i] for i in user_ids))
            for idx in candidate_indices:
                recipe = self.index.recipes[idx]
                if eligible_recipe_ids is not None and recipe.row_id not in eligible_recipe_ids:
                    continue
                if content_method and not recipe.has_instructions:
                    continue
                if config.ready_only and not recipe.ready_for_mapping:
                    continue
                matched_ids = user_ids & recipe.ingredient_ids
                matched_count = len(matched_ids)
                recipe_count = len(recipe.ingredient_ids)
                match_ratio = calculate_match_ratio(matched_count, recipe_count)
                if matched_count < effective_min_matched or match_ratio < config.min_match_ratio:
                    continue
                jaccard = calculate_jaccard(matched_count, len(user_ids), recipe_count)
                cosine = calculate_cosine(matched_count, len(user_ids), recipe_count)
                user_coverage = matched_count / len(user_ids)
                final_score = calculate_final_score(match_ratio, jaccard, cosine,
                                                    user_coverage, config)
                missing_ids = recipe.ingredient_ids - user_ids
                if method == "tfidf_cosine":
                    score = math.fsum(squared_idf[i] for i in matched_ids) / (pantry_norm * recipe_norms[idx])
                    score = min(1.0, score)  # floating-point roundoff on identical vectors
                else:
                    score = {"match_ratio": match_ratio, "jaccard": jaccard, "cosine": cosine,
                             "final": final_score, "overlap": matched_count, "binary_cosine": cosine}[method]
                row = {
                    "recipe_id": recipe.row_id,
                    "recipe_name": recipe.recipe_name,
                    "score": score,
                    "match_ratio": match_ratio,
                    "jaccard": jaccard,
                    "cosine": cosine,
                    "user_coverage": user_coverage,
                    "final_score": final_score,
                    "matched_count": matched_count,
                    "missing_count": len(missing_ids),
                    "matched_ingredients": sorted(self.index.id_to_name[x] for x in matched_ids),
                    "missing_ingredients": sorted(self.index.id_to_name[x] for x in missing_ids),
                    "ready_for_mapping": recipe.ready_for_mapping,
                }
                if method == "tfidf_cosine":
                    key_ids = sorted(matched_ids, key=lambda i: (-squared_idf[i], self.index.id_to_name[i]))
                    row['key_matches'] = [self.index.id_to_name[i] for i in key_ids[:3]]
                qualified.append(row)
            qualified.sort(key=lambda row: (-row["score"], -row["matched_count"],
                                            row["missing_count"], int(row["recipe_id"])))
        if not qualified:
            warnings.append("Không có recipe đạt ngưỡng phù hợp")
        if (method == "final" or content_method) and config.deduplicate_titles:
            # Đa dạng hóa Top-N: giữ món có score cao nhất cho mỗi tên chuẩn hóa.
            seen_titles: set[str] = set()
            result = []
            for row in qualified:
                title_key = " ".join(row["recipe_name"].casefold().split())
                if title_key in seen_titles:
                    continue
                seen_titles.add(title_key)
                result.append(row)
                if len(result) == top_n:
                    break
        else:
            result = qualified[:top_n]
        if return_diagnostics:
            empty_reason = None
            if not result:
                if not top_n:
                    empty_reason = "TOP_N_ZERO"
                elif not user_names:
                    empty_reason = "NO_RECOGNIZED_INGREDIENTS"
                else:
                    empty_reason = "NO_CANDIDATE_PASSED_ELIGIBILITY"
            return {"recommendations": result, "normalized_ingredients": user_names,
                    "unresolved_ingredients": unresolved_ingredients,
                    "normalization_details": normalization_details,
                    "warnings": warnings, "candidate_count": candidate_count,
                    "qualified_count": len(qualified), "method": method,
                    "empty_reason": empty_reason}
        for message in warnings:
            LOG.warning(message)
        return result


@lru_cache(maxsize=4)
def _engine(root: str) -> Recommender:
    return Recommender(Path(root))


def recommend_recipes(user_ingredients: Iterable[str | dict[str, Any]] | None,
                      top_n: int = 5, *, root: Path = DEFAULT_ROOT,
                      method: str = "final", config: ScoringConfig | None = None,
                      return_diagnostics: bool = False) -> list[dict] | dict:
    """API tối giản; trả list Top-N hoặc kèm warning nếu bật diagnostics."""
    return _engine(str(Path(root).resolve())).recommend(
        user_ingredients, top_n, method, config, return_diagnostics)
