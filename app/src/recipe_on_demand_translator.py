"""Strict, deterministic on-demand Vietnamese ingredient-line translator and local cache.

Only translates structured quantities, culinary units, preparation notes, and
known ingredients from config/ingredient_display_vi.json. Every generated entry
is source-SHA256 bound, checked through validate_candidate(), and marked
auto_unreviewed (never reviewed). Never invents ingredients, quantities, units,
or cooking steps.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from src.instruction_translation_validation import numeric_signature, source_hash, unit_signature
from src.recipe_detail_translation import check_text, quantities, recipe_hash, validate_candidate

PROVIDER_NAME = "ondemand_dictionary_v1"

UNIT_MAP: dict[str, str] = {
    "tablespoons": "muỗng canh",
    "tablespoon": "muỗng canh",
    "tbsps": "muỗng canh",
    "tbsp": "muỗng canh",
    "teaspoons": "muỗng cà phê",
    "teaspoon": "muỗng cà phê",
    "tsps": "muỗng cà phê",
    "tsp": "muỗng cà phê",
    "cups": "cốc",
    "cup": "cốc",
    "ounces": "ounce",
    "ounce": "ounce",
    "oz": "ounce",
    "pounds": "pound",
    "pound": "pound",
    "lbs": "pound",
    "lb": "pound",
    "quarts": "quart",
    "quart": "quart",
    "pints": "pint",
    "pint": "pint",
    "grams": "gram",
    "gram": "gram",
    "kilograms": "kg",
    "kilogram": "kg",
    "milliliters": "ml",
    "milliliter": "ml",
    "liters": "lít",
    "liter": "lít",
    "cloves": "tép",
    "clove": "tép",
    "slices": "lát",
    "slice": "lát",
    "pinches": "nhúm",
    "pinch": "nhúm",
    "cans": "lon",
    "can": "lon",
    "jars": "lọ",
    "jar": "lọ",
    "packages": "gói",
    "package": "gói",
    "pkgs": "gói",
    "pkg": "gói",
    "bunches": "bó",
    "bunch": "bó",
    "sprigs": "nhánh",
    "sprig": "nhánh",
    "stalks": "nhánh",
    "stalk": "nhánh",
    "heads": "búp",
    "head": "búp",
    "ears": "bắp",
    "ear": "bắp",
    "sticks": "thanh",
    "stick": "thanh",
    "drops": "giọt",
    "drop": "giọt",
    "dashes": "chút",
    "dash": "chút",
}

SIZE_MAP: dict[str, str] = {
    "extra-large": "cỡ rất lớn",
    "large": "cỡ lớn",
    "medium": "cỡ vừa",
    "small": "cỡ nhỏ",
}

PREP_PHRASES: list[tuple[str, str]] = [
    ("plus more for serving", "thêm khi dọn dùng"),
    ("at room temperature", "ở nhiệt độ phòng"),
    ("room temperature", "nhiệt độ phòng"),
    ("finely chopped", "băm nhuyễn"),
    ("coarsely chopped", "băm thô"),
    ("roughly chopped", "băm thô"),
    ("thinly sliced", "thái lát mỏng"),
    ("finely grated", "bào mịn"),
    ("freshly ground", "mới xay"),
    ("lightly beaten", "đánh nhẹ"),
    ("or to taste", "hoặc vừa khẩu vị"),
    ("to taste", "vừa khẩu vị"),
    ("for serving", "để dọn dùng"),
    ("for garnish", "để trang trí"),
    ("packed", "nén nhẹ"),
    ("chopped", "băm nhỏ"),
    ("minced", "băm nhỏ"),
    ("sliced", "thái lát"),
    ("diced", "thái hạt lựu"),
    ("grated", "bào nhuyễn"),
    ("shredded", "bào sợi"),
    ("crushed", "đập dập"),
    ("halved", "cắt đôi"),
    ("quartered", "cắt tư"),
    ("peeled", "gọt vỏ"),
    ("seeded", "bỏ hạt"),
    ("stemmed", "bỏ cuống"),
    ("trimmed", "cắt tỉa"),
    ("drained", "để ráo"),
    ("rinsed", "rửa sạch"),
    ("thawed", "rã đông"),
    ("melted", "đun chảy"),
    ("softened", "làm mềm"),
    ("chilled", "làm lạnh"),
    ("beaten", "đánh tan"),
    ("divided", "chia phần"),
    ("sifted", "rây mịn"),
    ("toasted", "rang thơm"),
    ("optional", "tùy chọn"),
]

PREFIX_RE = re.compile(
    r"^\s*(?P<qty>(?:\d+(?:\s+\d+/\d+|\.\d+|/\d+)?|[¼½¾⅓⅔⅛⅜⅝⅞])(?:\s*(?:-|to)\s*(?:\d+(?:\s+\d+/\d+|\.\d+|/\d+)?|[¼½¾⅓⅔⅛⅜⅝⅞]))?)"
    r"(?:\s+(?P<rest>.*))?$"
)


def _singular_variants(text: str) -> list[str]:
    clean = " ".join(text.lower().split())
    variants = [clean]
    if clean.endswith("ies") and len(clean) > 4:
        variants.append(clean[:-3] + "y")
    if clean.endswith("es") and len(clean) > 3:
        variants.append(clean[:-2])
    if clean.endswith("s") and len(clean) > 2:
        variants.append(clean[:-1])
    return variants


class OnDemandRecipeTranslator:
    """Deterministic dictionary-backed translator for missing ingredient details."""

    def __init__(self, root: Path, cache_path: Path | None = None) -> None:
        self.root = Path(root)
        self.dict_path = self.root / "config/ingredient_display_vi.json"
        self.cache_path = cache_path or (self.root / "processed/recipe_detail_vi_ondemand_cache.json")
        self.enabled = self.dict_path.is_file()
        self.display_map: dict[str, str] = {}
        if self.enabled:
            raw = json.loads(self.dict_path.read_text(encoding="utf-8"))
            self.display_map = {str(k).strip().lower(): str(v).strip() for k, v in raw.items() if str(v).strip()}
        self._prep_map = dict(PREP_PHRASES)

    def _lookup_ingredient(self, phrase: str) -> str | None:
        cleaned = re.sub(r"\s+", " ", phrase.strip(" ,.")).lower()
        if not cleaned:
            return None
        for variant in _singular_variants(cleaned):
            if variant in self.display_map:
                return self.display_map[variant]
        return None

    def _translate_prep_segment(self, seg: str) -> tuple[str, bool]:
        low = re.sub(r"\s+", " ", seg.strip()).lower()
        if low in self._prep_map:
            return self._prep_map[low], True
        return seg.strip(), False

    def translate_line(self, line: str) -> tuple[str, bool]:
        """Translate an ingredient line if quantities/units/terms map safely."""
        original = line.strip()
        if not original:
            return original, False
        parts = [p.strip() for p in original.split(",") if p.strip()]
        head = parts[0] if parts else original
        tail = parts[1:]

        match = PREFIX_RE.match(head)
        qty_vi = ""
        rest = head
        changed = False
        if match:
            qty_raw = match.group("qty").strip()
            qty_vi = re.sub(r"\s+to\s+", " đến ", qty_raw, flags=re.IGNORECASE)
            if qty_vi != qty_raw:
                changed = True
            rest = (match.group("rest") or "").strip()

        # Optional leading parenthetical size, e.g. "(14-ounce) can tomatoes"
        paren_prefix = ""
        paren_m = re.match(r"^\(([^)]+)\)\s*(.*)$", rest)
        if paren_m:
            inner = paren_m.group(1).strip()
            rest = paren_m.group(2).strip()
            inner_vi = inner
            for en_u, vi_u in UNIT_MAP.items():
                if re.search(rf"\b{re.escape(en_u)}\b", inner, flags=re.IGNORECASE):
                    inner_vi = re.sub(rf"\b{re.escape(en_u)}\b", vi_u, inner, flags=re.IGNORECASE)
                    break
            paren_prefix = f"({inner_vi})"

        unit_vi = ""
        size_vi = ""
        tokens = rest.split()
        idx = 0
        if idx < len(tokens):
            tok = tokens[idx].lower().strip(".")
            if tok in UNIT_MAP:
                unit_vi = UNIT_MAP[tok]
                changed = True
                idx += 1
        if idx < len(tokens) and tokens[idx].lower() == "of":
            idx += 1
        if idx < len(tokens) and tokens[idx].lower() in SIZE_MAP:
            size_vi = SIZE_MAP[tokens[idx].lower()]
            changed = True
            idx += 1

        ing_phrase = " ".join(tokens[idx:]).strip()
        ing_vi = self._lookup_ingredient(ing_phrase) if ing_phrase else None
        if ing_vi is not None:
            changed = True
            body = ing_vi
        else:
            # Handle optional leading "fresh " if the base noun maps cleanly.
            fresh_m = re.match(r"^fresh(?:ly)?\s+(.+)$", ing_phrase, flags=re.IGNORECASE)
            base_vi = self._lookup_ingredient(fresh_m.group(1)) if fresh_m else None
            if base_vi is not None:
                body = f"{base_vi} tươi"
                changed = True
            else:
                body = ing_phrase

        head_parts = [p for p in [qty_vi, paren_prefix, unit_vi, body, size_vi] if p]
        translated_head = " ".join(head_parts).strip() if head_parts else original

        translated_tail = []
        for seg in tail:
            t_seg, seg_changed = self._translate_prep_segment(seg)
            changed = changed or seg_changed
            translated_tail.append(t_seg)

        candidate_line = ", ".join([translated_head, *translated_tail]) if translated_tail else translated_head
        if (
            not changed
            or quantities(original) != quantities(candidate_line)
            or numeric_signature(original) != numeric_signature(candidate_line)
            or unit_signature(original) != unit_signature(candidate_line)
            or check_text(original, candidate_line)
        ):
            return original, False
        return candidate_line, True

    def build_ingredient_candidate(self, record: Any) -> dict[str, Any] | None:
        """Build and validate a cached recipe-detail-vi-v1 ingredient entry."""
        if not self.enabled or not getattr(record, "ingredients", None):
            return None
        lines: list[str] = []
        for line in record.ingredients:
            translated, changed = self.translate_line(line)
            if not changed:
                return None
            lines.append(translated)

        item = {
            "version": "recipe-detail-vi-v1",
            "schema_version": "recipe-detail-vi-v1",
            "recipe_id": record.recipe_id,
            "translation_source": PROVIDER_NAME,
            "source_sha256": recipe_hash(record.recipe_name, record.ingredients, record.instructions),
            "source_instructions_sha256": source_hash(record.instructions),
            "source": {
                "recipe_name": record.recipe_name,
                "ingredients": list(record.ingredients),
                "instructions": record.instructions,
            },
            "review_status": "auto_unreviewed",
            "reviewed_by": None,
            "reviewer": None,
            "reviewed_at": None,
            "ingredients_vi": lines,
            "field_providers": {"ingredients": PROVIDER_NAME},
            "field_sources": {"ingredients": PROVIDER_NAME},
        }
        accepted, errors = validate_candidate(item, record)
        if not accepted.get("ingredients") or errors.get("ingredients"):
            return None
        self._persist_item(item)
        return accepted

    def _persist_item(self, item: dict[str, Any]) -> None:
        try:
            self.cache_path.parent.mkdir(parents=True, exist_ok=True)
            if self.cache_path.is_file():
                payload = json.loads(self.cache_path.read_text(encoding="utf-8"))
                recipes = [r for r in payload.get("recipes", []) if int(r.get("recipe_id", -1)) != int(item["recipe_id"])]
            else:
                recipes = []
            recipes.append(item)
            recipes.sort(key=lambda row: int(row["recipe_id"]))
            out = {
                "schema_version": "recipe-detail-vi-v1",
                "policy": "ondemand_dictionary_translations_are_auto_unreviewed",
                "recipes": recipes,
            }
            self.cache_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
        except OSError:
            pass
