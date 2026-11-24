"""Offline Vietnamese display cache. Canonical ML names, IDs and scores stay intact."""
from __future__ import annotations

from collections import defaultdict
import csv
from functools import lru_cache
import json
from pathlib import Path
import unicodedata

ROOT = Path(__file__).resolve().parents[1]


def display_key(value: str) -> str:
    return " ".join(unicodedata.normalize("NFC", value).casefold().replace("_", " ").split())


class Localization:
    def __init__(self, root: Path = ROOT):
        self.root = Path(root)
        self.ingredients = {}
        self.titles = {}
        self.titles_by_name = {}
        self.recipe_titles = {}
        self.reviewed_ingredients = {}
        self.reviewed_titles_by_name = {}
        ingredient_path = self.root / "processed/ingredient_display_vi.csv"
        if ingredient_path.is_file():
            with ingredient_path.open(encoding="utf-8-sig", newline="") as stream:
                for row in csv.DictReader(stream):
                    if row['display_name_vi']:
                        self.ingredients[row['canonical_name']] = row['display_name_vi']
                        if row.get('review_status') == 'reviewed':
                            self.reviewed_ingredients[row['canonical_name']] = row['display_name_vi']
        curated = json.loads((self.root / "config/ingredient_display_vi.json").read_text(encoding="utf-8"))
        self.ingredients.update(curated)
        self.reviewed_ingredients.update(curated)
        title_path = self.root / "processed/recipe_titles_vi.csv"
        if title_path.is_file():
            with title_path.open(encoding="utf-8-sig", newline="") as stream:
                for row in csv.DictReader(stream):
                    if row["recipe_name_vi"]:
                        self.titles[row["recipe_id"]] = row["recipe_name_vi"]
                        self.recipe_titles[row["recipe_id"]] = row["recipe_name_en"]
                        self.titles_by_name[row["recipe_name_en"]] = row["recipe_name_vi"]
                        if row.get('review_status') == 'reviewed':
                            self.reviewed_titles_by_name[row['recipe_name_en']] = row['recipe_name_vi']
        # Curated title overrides also work while a full cache is being built.
        overrides = json.loads((self.root / "config/recipe_title_overrides_vi.json").read_text(encoding="utf-8"))
        self.titles_by_name.update(overrides)
        self.reviewed_titles_by_name.update(overrides)
        mapping = json.loads((self.root / "mapping/ingredient_mapping.json").read_text(encoding="utf-8"))
        aliases = json.loads((self.root / "mapping/ingredient_aliases.json").read_text(encoding="utf-8"))
        english_aliases = {display_key(k): v for k, v in mapping.items()}
        for canonical, variants in aliases.items():
            for variant in [canonical, *variants]:
                english_aliases.setdefault(display_key(variant), canonical)
        reverse = defaultdict(set)
        # Only reviewed entries are eligible for manual reverse input. Machine
        # output can conflate distinct foods and must never alter scoring input.
        for english, vietnamese in curated.items():
            target = english_aliases.get(display_key(english), english)
            reverse[display_key(vietnamese)].add(target)
        self.reverse = {k: next(iter(v)) for k, v in reverse.items() if len(v) == 1}
        self.conflicts = {k: sorted(v) for k, v in reverse.items() if len(v) > 1}
        # Canonicalization for UI duplicate detection shares established mapping/aliases.
        self.english_aliases = english_aliases
        self.pantry_aliases = {}
        catalog_path = self.root / "config/pantry_ingredient_catalog.json"
        if catalog_path.is_file():
            catalog_data = json.loads(catalog_path.read_text(encoding="utf-8"))
            for en_var, vi_disp in catalog_data.get("display_variants_en", {}).items():
                self.ingredients.setdefault(en_var, vi_disp)
                self.reviewed_ingredients.setdefault(en_var, vi_disp)
            for alias_key, target_canon in catalog_data.get("pantry_aliases", {}).items():
                dk = display_key(alias_key)
                if dk not in self.conflicts:
                    self.pantry_aliases.setdefault(dk, target_canon)
                    if dk not in self.reverse and dk not in self.english_aliases:
                        self.reverse[dk] = target_canon
        overrides_path = self.root / "config/pantry_alias_overrides_v1.json"
        if overrides_path.is_file():
            overrides_data = json.loads(overrides_path.read_text(encoding="utf-8"))
            for alias_key, target_canon in overrides_data.get("pantry_aliases", {}).items():
                dk = display_key(alias_key)
                if dk not in self.conflicts:
                    self.pantry_aliases[dk] = target_canon
                    self.reverse[dk] = target_canon
        self.ingredients_by_key = {display_key(k): v for k, v in self.ingredients.items()}

    def get_ingredient_vi(self, name: str) -> str:
        if name in self.ingredients:
            return self.ingredients[name]
        key = display_key(name)
        alias_target = self.english_aliases.get(key)
        if alias_target and alias_target in self.ingredients:
            return self.ingredients[alias_target]
        return self.ingredients_by_key.get(key, name)

    def get_recipe_title_vi(self, recipe_id, recipe_name: str) -> str:
        key = str(recipe_id)
        if self.recipe_titles.get(key) == recipe_name:
            return self.titles[key]
        return self.titles_by_name.get(recipe_name, recipe_name)

    def canonical_input(self, name: str) -> str:
        key = display_key(name)
        # A conflicting Vietnamese phrase stays unknown; never pick a random target.
        if key in self.conflicts:
            return name.strip()
        return self.reverse.get(key, self.english_aliases.get(key, name.strip()))

    def public_dictionary(self):
        # Presentation only: never silently put auto_unreviewed text in primary UI.
        # Original machine cache and canonical-input behavior remain unchanged.
        from src.pantry_catalog import get_pantry_catalog

        return {"version": 2, "ingredients": self.reviewed_ingredients,
                "recipe_titles": self.reviewed_titles_by_name,
                "display_policy": "reviewed_or_source_english",
                "manual_aliases": {**self.english_aliases, **self.reverse},
                "ambiguous_inputs": sorted(self.conflicts),
                "pantry_catalog": get_pantry_catalog(str(self.root)).public_summary()}


@lru_cache(maxsize=4)
def get_localization(root: str = str(ROOT)) -> Localization:
    return Localization(Path(root))


def get_ingredient_vi(name: str) -> str:
    return get_localization().get_ingredient_vi(name)


def get_recipe_title_vi(recipe_id, recipe_name: str) -> str:
    return get_localization().get_recipe_title_vi(recipe_id, recipe_name)


def localize_ingredient_list(items: list[str]) -> list[str]:
    return [get_ingredient_vi(name) for name in items]


def localize_recommendation(recipe: dict) -> dict:
    """Add display fields to a copy; all original canonical fields are preserved."""
    return {**recipe, "recipe_name_vi": get_recipe_title_vi(recipe["recipe_id"], recipe["recipe_name"]),
            "matched_ingredients_vi": localize_ingredient_list(recipe["matched_ingredients"]),
            "missing_ingredients_vi": localize_ingredient_list(recipe["missing_ingredients"])}
