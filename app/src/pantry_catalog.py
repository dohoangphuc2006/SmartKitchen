"""Verified Pantry Ingredient Catalog loader, search, and disambiguation helper."""
from __future__ import annotations

from functools import lru_cache
import json
from pathlib import Path
import re
import unicodedata
from typing import Any

ROOT = Path(__file__).resolve().parents[1]

_QUANTITY_PREFIX_RE = re.compile(
    r"^(\d+(?:\s+\d+/\d+|/\d+|[.,]\d+)?(?:\s*(?:-|\u2013|to)\s*\d+(?:[.,]\d+)?)?"
    r"(?:\s*(?:quả|qua|trái|trai|củ|cu|nhánh|nhanh|tép|tep|cây|cay|bó|bo|bát|bat|chén|chen|"
    r"miếng|mieng|lát|lat|khúc|khuc|bắp|bap|con|hộp|hop|gói|goi|bịch|bich|lon|chai|lọ|lo|"
    r"muỗng canh|muỗng cà phê|thìa canh|thìa cà phê|muỗng|thìa|grams?|gr|g|kg|ml|lít|lit|l|"
    r"cups?|tbsps?|tsps?|oz|lbs?))?)\s+(?:of\s+)?(.+)$",
    re.IGNORECASE,
)


def strip_diacritics(value: str) -> str:
    text = unicodedata.normalize("NFD", str(value or ""))
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    text = text.replace("đ", "d").replace("Đ", "D")
    return " ".join(text.casefold().replace("_", " ").split())


def norm_query(value: str) -> str:
    text = unicodedata.normalize("NFC", str(value or ""))
    return " ".join(text.casefold().replace("_", " ").split())


class PantryCatalog:
    def __init__(self, root: Path = ROOT):
        self.root = Path(root)
        path = self.root / "config/pantry_ingredient_catalog.json"
        if path.is_file():
            data = json.loads(path.read_text(encoding="utf-8"))
        else:
            data = {
                "schema_version": "smartkitchen.pantry_catalog.v1",
                "total_recommendable_items": 0,
                "categories": [],
                "items": [],
                "ambiguous_concepts": {},
                "pantry_aliases": {},
                "display_variants_en": {},
            }
        self.raw = data
        self.categories: list[dict[str, Any]] = data.get("categories", [])
        self.items: list[dict[str, Any]] = data.get("items", [])
        self.ambiguous_concepts: dict[str, dict[str, Any]] = data.get("ambiguous_concepts", {})
        self.pantry_aliases: dict[str, str] = data.get("pantry_aliases", {})
        self.display_variants_en: dict[str, str] = data.get("display_variants_en", {})

        self.by_canonical: dict[str, dict[str, Any]] = {
            item["canonical_name"]: item for item in self.items
        }
        self.ambiguous_by_trigger: dict[str, dict[str, Any]] = {}
        for concept in self.ambiguous_concepts.values():
            for trigger in concept.get("triggers", []):
                self.ambiguous_by_trigger[norm_query(trigger)] = concept
                self.ambiguous_by_trigger[strip_diacritics(trigger)] = concept

        # Precompute search index fields per item for sub-millisecond search
        self._search_index: list[tuple[dict[str, Any], str, str, list[str], list[str], list[str]]] = []
        for item in self.items:
            vi_norm = norm_query(item["display_name_vi"])
            vi_ascii = strip_diacritics(item["display_name_vi"])
            en_norm = norm_query(item["display_name_en"])
            aliases_vi_norm = [norm_query(a) for a in item.get("aliases_vi", [])]
            aliases_vi_ascii = [strip_diacritics(a) for a in item.get("aliases_vi", [])]
            aliases_en_norm = [norm_query(a) for a in item.get("aliases_en", [])]
            self._search_index.append((
                item,
                vi_norm,
                vi_ascii,
                [en_norm, *aliases_en_norm],
                aliases_vi_norm,
                aliases_vi_ascii,
            ))
        self._search_index.sort(key=lambda row: (-row[0].get("recipe_count", 0), row[1]))

    def extract_quantity_prefix(self, raw_query: str) -> tuple[str, str]:
        trimmed = unicodedata.normalize("NFC", str(raw_query or "")).strip()
        if not trimmed:
            return "", ""
        match = _QUANTITY_PREFIX_RE.match(trimmed)
        if match and match.group(2).strip():
            return match.group(1).strip(), match.group(2).strip()
        return "", trimmed

    def search(
        self,
        query: str = "",
        *,
        category: str | None = None,
        limit: int = 24,
        offset: int = 0,
    ) -> dict[str, Any]:
        limit = max(1, min(int(limit), 200))
        offset = max(0, int(offset))
        qty_prefix, food_query = self.extract_quantity_prefix(query)
        q_norm = norm_query(food_query)
        q_ascii = strip_diacritics(food_query)

        ambiguous_match = None
        if q_norm:
            ambiguous_match = self.ambiguous_by_trigger.get(q_norm) or self.ambiguous_by_trigger.get(q_ascii)

        if not q_norm:
            filtered = [
                row[0] for row in self._search_index
                if not category or category == "all" or row[0].get("category") == category
            ]
            total = len(filtered)
            return {
                "query": query,
                "detected_quantity": qty_prefix,
                "food_query": food_query,
                "category": category or "all",
                "total": total,
                "offset": offset,
                "limit": limit,
                "ambiguous_match": None,
                "items": filtered[offset : offset + limit],
            }

        scored: list[tuple[int, int, str, dict[str, Any]]] = []
        for item, vi_norm, vi_ascii, en_list, aliases_vi_norm, aliases_vi_ascii in self._search_index:
            if category and category != "all" and item.get("category") != category:
                continue
            rank = 0
            if q_norm == vi_norm or q_norm in en_list or q_norm in aliases_vi_norm:
                rank = 100
            elif q_ascii and (q_ascii == vi_ascii or q_ascii in aliases_vi_ascii):
                rank = 95
            elif vi_norm.startswith(q_norm) or any(e.startswith(q_norm) for e in en_list):
                rank = 85 + max(0, 8 - max(0, len(vi_norm) - len(q_norm)))
            elif q_ascii and (vi_ascii.startswith(q_ascii) or any(a.startswith(q_ascii) for a in aliases_vi_ascii)):
                rank = 80 + max(0, 8 - max(0, len(vi_ascii) - len(q_ascii)))
            elif any(a.startswith(q_norm) for a in aliases_vi_norm):
                rank = 75
            elif f" {q_norm}" in f" {vi_norm}" or any(f" {q_norm}" in f" {a}" for a in aliases_vi_norm):
                rank = 65
            elif q_ascii and (f" {q_ascii}" in f" {vi_ascii}" or any(f" {q_ascii}" in f" {a}" for a in aliases_vi_ascii)):
                rank = 60
            elif any(f" {q_norm}" in f" {e}" for e in en_list):
                rank = 55
            elif q_norm in vi_norm or any(q_norm in a for a in aliases_vi_norm) or any(q_norm in e for e in en_list):
                rank = 40
            elif q_ascii and (q_ascii in vi_ascii or any(q_ascii in a for a in aliases_vi_ascii)):
                rank = 35

            if rank > 0:
                scored.append((-rank, -item.get("recipe_count", 0), vi_norm, item))

        scored.sort(key=lambda x: (x[0], x[1], x[2]))
        matched_items = [row[3] for row in scored]
        total = len(matched_items)
        return {
            "query": query,
            "detected_quantity": qty_prefix,
            "food_query": food_query,
            "category": category or "all",
            "total": total,
            "offset": offset,
            "limit": limit,
            "ambiguous_match": ambiguous_match,
            "items": matched_items[offset : offset + limit],
        }

    def public_summary(self) -> dict[str, Any]:
        return {
            "schema_version": self.raw.get("schema_version", "smartkitchen.pantry_catalog.v1"),
            "total_items": len(self.items),
            "total_recommendable_items": len(self.items),
            "categories": self.categories,
            "ambiguous_concepts": self.ambiguous_concepts,
            "items": self.items,
        }


@lru_cache(maxsize=4)
def get_pantry_catalog(root: str = str(ROOT)) -> PantryCatalog:
    return PantryCatalog(Path(root))
