"""Kho chi tiết công thức, tách biệt hoàn toàn khỏi logic xếp hạng.

Repository chỉ đọc dữ liệu đã làm sạch và các cache hiển thị tùy chọn. Trường
``instructions`` và danh sách nguyên liệu gốc được giữ nguyên; ``instruction_steps``
chỉ tách theo các đoạn xuống dòng đã có trong dataset.
"""

from __future__ import annotations

import ast
import csv
import json
import logging
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from src.instruction_translation_validation import validate_translation
from src.recipe_detail_translation import validate_candidate
from src.recipe_on_demand_translator import OnDemandRecipeTranslator


ROOT = Path(__file__).resolve().parents[1]
TRANSLATION_STATUSES = {"reviewed", "auto_unreviewed", "untranslated"}


class RecipeNotFoundError(LookupError):
    pass


class RecipeDetailUnavailableError(ValueError):
    pass


@dataclass(frozen=True)
class RecipeRecord:
    recipe_id: int
    recipe_name: str
    ingredients: tuple[str, ...]
    instructions: str


def split_instruction_steps(text: str) -> list[str]:
    """Tách đúng các đoạn nguồn; không tách câu hay sinh thêm nội dung."""
    return [part.strip() for part in text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
            if part.strip()]


def _read_rows(path: Path) -> list[dict[str, str]]:
    if not path.is_file():
        return []
    with path.open(encoding="utf-8-sig", newline="") as stream:
        return list(csv.DictReader(stream))


def _parse_ingredient_list(value: str, recipe_id: int) -> tuple[str, ...]:
    if not value.strip():
        return ()
    try:
        parsed = ast.literal_eval(value)
    except (SyntaxError, ValueError) as exc:
        raise ValueError(f"ingredients_raw lỗi ở row_id={recipe_id}") from exc
    if not isinstance(parsed, list) or not all(isinstance(item, str) for item in parsed):
        raise ValueError(f"ingredients_raw không phải list[str] ở row_id={recipe_id}")
    return tuple(item for item in parsed if item.strip())


class RecipeRepository:
    def __init__(self, root: Path = ROOT):
        self.root = Path(root).resolve()
        self.dataset_path = self.root / "processed" / "recipes_cleaned.csv"
        self.source_path = self.root / "data" / "recipes_raw" / "SOURCE.json"
        if not self.dataset_path.is_file() or not self.source_path.is_file():
            raise FileNotFoundError("Thiếu recipes_cleaned.csv hoặc SOURCE.json")

        source = json.loads(self.source_path.read_text(encoding="utf-8"))
        required_source = {"dataset_name", "source", "publisher", "original_content_source",
                           "license_as_declared_by_publishers", "license_url", "revision"}
        if not required_source.issubset(source):
            raise ValueError(f"SOURCE.json thiếu trường: {sorted(required_source - set(source))}")
        self.source = {
            "dataset_name": source["dataset_name"],
            "publisher": source["publisher"],
            "original_content_source": source["original_content_source"],
            "dataset_url": source["source"],
            "license": source["license_as_declared_by_publishers"],
            "license_url": source["license_url"],
            "revision": source["revision"],
            "source_level": "dataset",
        }

        rows = _read_rows(self.dataset_path)
        required = {"row_id", "recipe_name", "ingredients_raw", "instructions"}
        if not rows or not required.issubset(rows[0]):
            actual = set(rows[0]) if rows else set()
            raise ValueError(f"recipes_cleaned.csv thiếu trường: {sorted(required - actual)}")
        self.records: dict[int, RecipeRecord] = {}
        for row in rows:
            try:
                recipe_id = int(row["row_id"])
            except (TypeError, ValueError) as exc:
                raise ValueError(f"row_id không hợp lệ: {row.get('row_id')!r}") from exc
            if recipe_id in self.records:
                raise ValueError(f"row_id trùng: {recipe_id}")
            self.records[recipe_id] = RecipeRecord(
                recipe_id=recipe_id,
                recipe_name=row["recipe_name"],
                ingredients=_parse_ingredient_list(row["ingredients_raw"], recipe_id),
                instructions=row["instructions"],
            )

        self.title_translations = self._load_title_translations()
        curated_path = self.root / 'config/recipe_title_overrides_vi.json'
        self.curated_titles = json.loads(curated_path.read_text(encoding='utf-8')) if curated_path.is_file() else {}
        self.instruction_translations = self._load_instruction_translations()
        self.ondemand_translator = OnDemandRecipeTranslator(self.root)
        self.detail_candidates = self._load_detail_candidates()
        for name in [
            "recipe_detail_vi_ondemand_cache.json",
            "recipe_detail_vi_live_batch.json",
            "recipe_detail_vi_phase5_batch.json",
            "recipe_detail_vi_v6_batch.json",
        ]:
            supplemental = self.root / "processed" / name
            if supplemental.is_file():
                for rid, accepted in self._load_detail_candidates(supplemental).items():
                    self._merge_candidate(rid, accepted)

    def _merge_candidate(self, recipe_id: int, accepted: dict[str, Any]) -> None:
        existing = self.detail_candidates.setdefault(recipe_id, {})
        existing_sources = dict(existing.get("field_sources", {}))
        existing_sources.update(accepted.get("field_sources", {}))
        for key in ("title", "ingredients", "instructions"):
            if key in accepted and accepted[key]:
                existing[key] = accepted[key]
        if existing_sources:
            existing["field_sources"] = existing_sources
        if accepted.get("version"):
            existing["version"] = accepted["version"]

    def _load_detail_candidates(self, path=None):
        if path is None:
            path = self.root / 'processed/recipe_detail_vi_candidates.json'
            self.detail_candidate_issues = []
        if not path.is_file():
            return {}
        try:
            data = json.loads(path.read_text(encoding='utf-8'))
            rows = data['recipes']
            if not isinstance(rows, list):
                raise ValueError('recipes must be a list')
        except (OSError, ValueError, KeyError, TypeError):
            self.detail_candidate_issues.append({'recipe_id': None, 'record': ['invalid_cache_json']})
            return {}
        ids = [row.get('recipe_id') for row in rows if isinstance(row, dict)]
        counts = Counter(i for i in ids if isinstance(i, int) and not isinstance(i, bool))
        result = {}
        for item in rows:
            if not isinstance(item, dict):
                self.detail_candidate_issues.append({'recipe_id': None, 'record': ['invalid_record']})
                continue
            recipe_id = item.get('recipe_id')
            record = self.records.get(recipe_id) if isinstance(recipe_id, int) and not isinstance(recipe_id, bool) else None
            if not record or counts[recipe_id] != 1:
                self.detail_candidate_issues.append({'recipe_id': str(recipe_id), 'record': ['unknown_or_duplicate_id']})
                continue
            try:
                translated, errors = validate_candidate(item, record)
            except (ValueError, TypeError, AttributeError):
                translated, errors = {}, {'record': ['malformed_fields']}
            if errors:
                self.detail_candidate_issues.append({'recipe_id': recipe_id, **errors})
            if translated:
                result[recipe_id] = translated
        return result

    def _load_title_translations(self) -> dict[int, dict[str, Any]]:
        result: dict[int, dict[str, Any]] = {}
        path = self.root / "processed" / "recipe_titles_vi.csv"
        for row in _read_rows(path):
            try:
                recipe_id = int(row["recipe_id"])
            except (KeyError, TypeError, ValueError):
                continue
            status = row.get("review_status", "untranslated")
            record = self.records.get(recipe_id)
            if (record is None or record.recipe_name != row.get("recipe_name_en", "") or
                    status not in TRANSLATION_STATUSES):
                continue
            text = row.get("recipe_name_vi", "").strip() or None
            result[recipe_id] = {"text": text, "source": row.get("translation_source", "none") or "none",
                                 "review_status": status if text else "untranslated"}
        return result

    def _load_instruction_translations(self) -> dict[int, dict[str, Any]]:
        """Reject unsafe/stale optional cache rows and preserve English fallback."""
        path = self.root / "processed" / "recipe_instructions_vi.csv"
        self.instruction_translation_issues: list[dict[str, Any]] = []
        rows = _read_rows(path)
        if not rows:
            return {}
        ids = []
        for row in rows:
            try:
                ids.append(int(row.get('recipe_id', '')))
            except (ValueError, TypeError):
                ids.append(None)
        counts = Counter(ids)
        result: dict[int, dict[str, Any]] = {}
        for line, (row, recipe_id) in enumerate(zip(rows, ids), start=2):
            record = self.records.get(recipe_id)
            if record is None:
                errors, translation = ['invalid_or_unknown_recipe_id'], None
            elif counts[recipe_id] != 1:
                errors, translation = ['duplicate_recipe_id'], None
            else:
                # DictReader may supply None for truncated rows.
                translation, errors = validate_translation(
                    {key: value or '' for key, value in row.items() if key is not None}, record.instructions)
            if errors:
                self.instruction_translation_issues.append(
                    {'csv_record': line, 'recipe_id': recipe_id, 'errors': errors})
            else:
                result[recipe_id] = translation
        if self.instruction_translation_issues:
            logging.getLogger(__name__).warning('Rejected %d instruction translation cache rows; using English fallback',
                                              len(self.instruction_translation_issues))
        return result

    @property
    def stats(self) -> dict[str, int]:
        ready = sum(bool(record.recipe_name.strip() and record.ingredients and record.instructions.strip())
                    for record in self.records.values())
        effective = dict(self.instruction_translations)
        for rid, candidate in self.detail_candidates.items():
            if candidate.get('instructions') and effective.get(rid, {}).get('review_status') != 'reviewed':
                effective[rid] = candidate['instructions']
        instruction_translations = [row for row in effective.values() if row["text"]]
        return {
            "total_records": len(self.records),
            "detail_ready": ready,
            "title_translated_vi": sum(bool(row["text"]) for row in self.title_translations.values()),
            "instructions_translated_vi": len(instruction_translations),
            "instructions_reviewed_vi": sum(row["review_status"] == "reviewed" for row in instruction_translations),
            "instructions_auto_unreviewed_vi": sum(row["review_status"] == "auto_unreviewed"
                                                     for row in instruction_translations),
        }

    def display_catalog(self):
        """Presentation metadata only; never a candidate promotion or rank input."""
        if hasattr(self, '_display_catalog'):
            return self._display_catalog
        from collections import Counter
        counts = Counter(total_records=len(self.records))
        recipes = {}
        for rid in self.records:
            try:
                detail = self.get_detail(rid, allow_ondemand=False)
            except RecipeDetailUnavailableError:
                counts['source_detail_unavailable'] += 1
                continue
            counts['detail_ready'] += 1
            vi = detail['translations']['vi']
            title = bool(vi['recipe_name'] and vi['recipe_name_display_eligible'])
            ingredients = bool(vi['ingredients'] and len(vi['ingredients']) == len(detail['ingredients']))
            instructions = bool(vi['instructions'] and len(vi['instruction_steps']) == len(detail['instruction_steps']))
            for field, available in [('title', title), ('ingredients', ingredients), ('instructions', instructions)]:
                counts[field + '_vi_available'] += int(available)
                counts[field + '_english_fallback'] += int(not available)
                if available:
                    counts[field + '_' + vi[{'title':'recipe_name','ingredients':'ingredients','instructions':'instructions'}[field]+'_review_status']] += 1
            counts['fully_localized_vi'] += int(title and ingredients and instructions)
            if title or ingredients or instructions:
                recipes[str(rid)] = {'source_name': detail['recipe_name'],
                    'title': vi['recipe_name'] if title else None,
                    'title_status': vi['recipe_name_review_status'],
                    'ingredients_available': ingredients, 'instructions_available': instructions}
        counts['not_fully_localized_vi'] = counts['total_records'] - counts['fully_localized_vi']
        self._display_catalog = {'recipes': recipes, 'coverage': dict(counts),
            'policy': 'source_bound_display_candidates_are_not_human_review'}
        return self._display_catalog

    def get_detail(self, recipe_id: int, allow_ondemand: bool = True) -> dict[str, Any]:
        record = self.records.get(recipe_id)
        if record is None:
            raise RecipeNotFoundError(recipe_id)
        if not record.instructions.strip():
            raise RecipeDetailUnavailableError("Công thức này chưa có hướng dẫn trong dataset nguồn.")
        if not record.recipe_name.strip() or not record.ingredients:
            raise RecipeDetailUnavailableError("Công thức này thiếu tên hoặc danh sách nguyên liệu trong dataset nguồn.")
        title = self.title_translations.get(recipe_id, {"text": None, "source": "none",
                                                         "review_status": "untranslated"})
        instructions = self.instruction_translations.get(recipe_id, {"text": None, "steps": [],
                                                                       "source": "none",
                                                                       "review_status": "untranslated"})
        candidate = self.detail_candidates.get(recipe_id, {})
        if allow_ondemand and not candidate.get("ingredients"):
            ondemand = self.ondemand_translator.build_ingredient_candidate(record)
            if ondemand:
                self._merge_candidate(recipe_id, ondemand)
                candidate = self.detail_candidates.get(recipe_id, {})
        title_eligible = bool(title['text'] and title['review_status'] == 'reviewed')
        if not title_eligible and self.curated_titles.get(record.recipe_name):
            title = {'text': self.curated_titles[record.recipe_name], 'source': 'curated', 'review_status': 'reviewed'}
            title_eligible = True
        if not title_eligible and candidate.get('title'):
            title = {'text': candidate['title'], 'source': candidate['field_sources']['title'], 'review_status': 'auto_unreviewed'}
            title_eligible = True
        if instructions['review_status'] != 'reviewed' and candidate.get('instructions'):
            instructions = candidate['instructions']
        return {
            "success": True,
            "recipe_id": record.recipe_id,
            "recipe_name": record.recipe_name,
            "ingredients": list(record.ingredients),
            "instructions": record.instructions,
            "instruction_steps": split_instruction_steps(record.instructions),
            "language": "en",
            "translations": {
                "vi": {
                    "recipe_name": title["text"],
                    "recipe_name_source": title["source"],
                    "recipe_name_review_status": title["review_status"],
                    "recipe_name_display_eligible": title_eligible,
                    "ingredients": candidate.get('ingredients'),
                    "ingredients_source": candidate.get('field_sources', {}).get('ingredients', 'none') if candidate.get('ingredients') else 'none',
                    "ingredients_review_status": 'auto_unreviewed' if candidate.get('ingredients') else 'untranslated',
                    "translation_version": candidate.get('version'),
                    "instructions": instructions["text"],
                    "instruction_steps": instructions["steps"],
                    "instructions_source": instructions["source"],
                    "instructions_review_status": instructions["review_status"],
                }
            },
            "source": dict(self.source),
        }

