"""Read-only provenance-backed recipe ingredient normalization index (LIMIT-01 mitigation).

Does NOT modify `processed/recipes_cleaned.csv`, `processed/ingredient_details.csv`,
or the fitted ML artifact (`recipe_tfidf_lsa_v1.npz`). Every canonical mapping keeps
explicit source-to-normalized provenance and flags unreliable/fragmented entries so
recipes with ambiguous LIMIT-01 strings are never falsely promoted to CAN_COOK_NOW.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
import re
from typing import Any

from src.recipe_food_availability import source_availability
from src.recipe_requirements import _SEASONINGS, _LIQUID_OR_PREPARED_PROTEIN, _TITLE_FOODS

# Strictly OPT-IN staple families: ONLY activated when user explicitly confirms
# the corresponding basic ingredient (water / salt / pepper / vegetable oil / olive oil).
CONFIRMED_STAPLE_FAMILIES: dict[str, frozenset[str]] = {
    "water": frozenset({
        "water", "cold water", "warm water", "hot water", "boiling water", "filtered water", "ice water",
    }),
    "salt": frozenset({
        "salt", "kosher salt", "sea salt", "fine sea salt", "coarse kosher salt",
        "table salt", "iodized salt", "flaky sea salt", "coarse salt",
    }),
    "pepper": frozenset({
        "pepper", "black pepper", "ground black pepper", "ground pepper",
        "freshly ground black pepper", "cracked black pepper",
    }),
    "vegetable oil": frozenset({
        "vegetable oil", "canola oil", "cooking oil", "neutral oil",
        "sunflower oil", "corn oil", "grapeseed oil", "safflower oil",
    }),
    "olive oil": frozenset({
        "olive oil", "extra virgin olive oil", "extra-virgin olive oil",
    }),
}

BASIC_STAPLE_CANONICALS: frozenset[str] = frozenset(CONFIRMED_STAPLE_FAMILIES.keys())

_STAPLE_TOKEN_TO_FAMILY: dict[str, str] = {
    variant: fam
    for fam, variants in CONFIRMED_STAPLE_FAMILIES.items()
    for variant in variants
}

# Mechanical/prep suffixes safe to strip ONLY when the resulting base exists in catalog vocab.
_SAFE_PREP_SUFFIX_RE = re.compile(
    r"^(?P<base>.+?)(?:\s*,\s*(?:"
    r"(?:finely |coarsely |roughly |thinly |thickly |freshly |well )?"
    r"(?:chopped|sliced|diced|cubed|minced|grated|crushed|beaten|melted|softened|"
    r"divided|trimmed|cored|seeded|stemmed|pitted|peeled|deveined|halved|quartered|"
    r"rinsed|drained|toasted|sifted|patted dry|at room temperature)"
    r"|stem and center ribs discarded(?: and leaf torn)?"
    r"|tough stem and center ribs cut off and discarded"
    r"|keeping stem end intact"
    r"|each cut into (?:\d+|six) wedges"
    r"|white and greens? separated|green and white parts separated"
    r"))+$",
    re.I,
)

_TOMATO_WEDGES_RE = re.compile(r"^(?P<food>(?:plum )?tomato)\s*,\s*each cut into (?:\d+|six) wedges$", re.I)

# Data quality guards: prevent LIMIT-01 leaked tools/fragments from passing CAN_COOK_NOW.
_CONTAINER_OR_TOOL_FRAGMENT_RE = re.compile(
    r"\b(?:jar|qt\.?|quart|pint|gallon|thermometer|skillet|roasting pan|baking dish|loaf pan|"
    r"saucepan|blender|food processor|immersion|sous[ -]vide|steamer|pie plate|masher|cheesecloth|"
    r"parchment|aluminum foil|rack|skewers?|wok|spice mill|mandoline)\b",
    re.I,
)
_BROKEN_FRAGMENT_RE = re.compile(
    r"(?:,\s*(?:and|or)\s*$|^\s*(?:and|or|plus|level tablespoons?|see note)\b|"
    r"\b(?:slice it|discard the seed)\b)",
    re.I,
)
_SWEETENER_OR_LIQUID_ONLY = frozenset({
    "sugar", "granulated sugar", "brown sugar", "light brown sugar", "dark brown sugar",
    "superfine sugar", "confectioners sugar", "powdered sugar", "honey", "maple syrup",
    "water", "cold water", "warm water", "hot water", "boiling water", "ice", "ice water",
    "vinegar", "distilled white vinegar", "apple cider vinegar", "white vinegar",
})
_NON_MEAL_DESSERT_OR_DRINK_RE = re.compile(
    r"\b(?:paletas?|popsicles?|ice\s+cream|sorbet|granita|candied|vodka|tequila|bourbon|whiskey|whisky|"
    r"rum|gin|cocktails?|margarita|martini|julep|smoothie|milkshake|brine|frosting|icing)\b",
    re.I,
)


@dataclass(frozen=True)
class TokenProvenance:
    raw_token: str
    normalized_token: str
    rule: str
    confidence: float
    reliable: bool


@dataclass(frozen=True)
class NormalizedRecipeRecord:
    index_pos: int
    row_id: str
    row_id_int: int
    recipe_name: str
    required_tokens: frozenset[str]
    clean_required_tokens: frozenset[str]
    optional_tokens: frozenset[str]
    note_tokens: frozenset[str]
    core_tokens: frozenset[str]
    core_raw_tokens: frozenset[str]
    seasoning_raw_tokens: frozenset[str]
    staple_family_by_raw: dict[str, str]
    equipment: tuple[str, ...]
    provenance_by_token: dict[str, TokenProvenance]
    canonical_to_raw_required: dict[str, tuple[str, ...]]
    # Precomputed per-token tuples for hot-loop scoring:
    # (raw_tok, norm_tok, prov_rule, prov_conf, staple_family)
    token_entries: tuple[tuple[str, str, str, float, str | None], ...]
    total_required: int
    core_count: int
    is_non_meal_dessert_or_drink: bool
    has_peeled_token: bool
    reliable_for_can_cook_now: bool
    unreliable_reasons: tuple[str, ...]


class NormalizedRecipeIndex:
    """In-memory, read-only normalized index with provenance for two-tier retrieval."""

    def __init__(self, service: Any) -> None:
        quality, lookup, bulk_by_rid = service._get_quality_requirements()
        self.quality = quality
        self.normalizer = service.pipeline.recommender.shared_normalizer
        q_index = quality.index
        id_to_name = q_index.id_to_name
        name_to_id = q_index.name_to_id
        vocab_set = set(name_to_id)
        recommendable = getattr(service, "_recommendable_recipe_ids", None)
        evidence_map = source_availability(service.root)

        title_food_set = _TITLE_FOODS | {
            "duck", "turkey", "lamb", "pork", "beef", "chicken",
            "shrimp", "salmon", "tuna", "cod", "tilapia",
        }
        title_food_words = sorted(title_food_set, key=lambda x: (-len(x), x))
        title_re = re.compile(
            r"(?<!\w)(?:" + "|".join(re.escape(w) + r"(?:es|s)?" for w in title_food_words) + r")(?!\w)",
            re.I,
        )

        self.records: list[NormalizedRecipeRecord] = []
        self.by_row_id: dict[str, NormalizedRecipeRecord] = {}
        self.postings: dict[str, list[int]] = defaultdict(list)
        self.stats = {
            "total_recommendable_recipes": 0,
            "limit01_note_recipes_cleaned": 0,
            "limit01_prep_normalized_tokens": 0,
            "limit01_unreliable_recipes_flagged": 0,
            "reliable_recipes_count": 0,
        }

        for q_idx, recipe in enumerate(q_index.recipes):
            rid = str(recipe.row_id)
            if recommendable is not None and rid not in recommendable:
                continue
            if not recipe.has_instructions:
                continue
            self.stats["total_recommendable_recipes"] += 1
            req = quality.requirements.recipes[q_idx]

            ev_proof = evidence_map.get(rid)
            ev_tools = ev_proof[0] if ev_proof else set()
            ev_preps = ev_proof[1] if ev_proof else {}
            ev_equip = list(ev_proof[2]) if ev_proof and ev_proof[2] else []
            combined_equip = sorted(set(req.equipment) | set(ev_equip))

            optional_toks = frozenset(id_to_name[i] for i in req.optional)
            note_toks = frozenset(id_to_name[i] for i in req.source_notes)
            if note_toks:
                self.stats["limit01_note_recipes_cleaned"] += 1

            # Exclude optional, explicit notes, and verified tool tokens from required food set
            req_toks_raw = {
                id_to_name[i]
                for i in req.required
                if i not in req.optional and i not in req.source_notes and id_to_name[i] not in ev_tools
            }
            if not req_toks_raw:
                continue

            prov_map: dict[str, TokenProvenance] = {}
            canon_to_raw: dict[str, list[str]] = defaultdict(list)
            unreliable_reasons: list[str] = []

            for raw_tok in sorted(req_toks_raw):
                prov = self._normalize_required_token(raw_tok, vocab_set, ev_preps)
                prov_map[raw_tok] = prov
                canon_to_raw[prov.normalized_token].append(raw_tok)
                if prov.rule != "exact_canonical":
                    self.stats["limit01_prep_normalized_tokens"] += 1
                if not prov.reliable:
                    unreliable_reasons.append(f"{prov.rule}:{raw_tok}")

            # Core tokens computed consistently with _enrich_readiness_and_missing_core
            raw_core_names = {id_to_name[j] for j in (req.core | req.source_identity)}
            bulk_tokens = bulk_by_rid.get(rid, set())
            title_hits: set[str] = set()
            for m in title_re.finditer(recipe.recipe_name.lower()):
                w = m.group(0)
                if w in title_food_set:
                    title_hits.add(w)
                elif w.endswith("es") and w[:-2] in title_food_set:
                    title_hits.add(w[:-2])
                elif w.endswith("s") and w[:-1] in title_food_set:
                    title_hits.add(w[:-1])

            core_canon: set[str] = set()
            core_raw: set[str] = set()
            seasoning_raw: set[str] = set()
            staple_fam_raw: dict[str, str] = {}
            for raw_tok in req_toks_raw:
                norm_tok = quality.normalize(raw_tok)
                norm_canon = prov_map[raw_tok].normalized_token
                fam = (
                    _STAPLE_TOKEN_TO_FAMILY.get(raw_tok.casefold().strip())
                    or _STAPLE_TOKEN_TO_FAMILY.get(norm_canon.casefold().strip())
                )
                if fam:
                    staple_fam_raw[raw_tok] = fam
                if norm_tok in _SEASONINGS or name_to_id.get(norm_tok) in quality.requirements.seasonings:
                    seasoning_raw.add(raw_tok)
                    continue
                is_core = (raw_tok in raw_core_names) or (norm_tok in raw_core_names) or (norm_tok in bulk_tokens)
                if not is_core and title_hits and not _LIQUID_OR_PREPARED_PROTEIN.search(norm_tok):
                    tok_words = set(re.findall(r"[a-z]+", norm_tok))
                    if tok_words & title_hits:
                        is_core = True
                if is_core:
                    core_canon.add(norm_canon)
                    core_raw.add(raw_tok)

            if not core_raw and all(
                (t in seasoning_raw)
                or (t in staple_fam_raw)
                or (prov_map[t].normalized_token in _SWEETENER_OR_LIQUID_ONLY)
                for t in req_toks_raw
            ):
                unreliable_reasons.append("unreliable_brine_or_seasoning_only")

            reliable = len(unreliable_reasons) == 0
            if not reliable:
                self.stats["limit01_unreliable_recipes_flagged"] += 1
            else:
                self.stats["reliable_recipes_count"] += 1

            token_entries = tuple(
                (
                    raw_tok,
                    prov_map[raw_tok].normalized_token,
                    prov_map[raw_tok].rule,
                    prov_map[raw_tok].confidence,
                    staple_fam_raw.get(raw_tok),
                )
                for raw_tok in sorted(req_toks_raw)
            )
            is_non_meal = bool(
                _NON_MEAL_DESSERT_OR_DRINK_RE.search(recipe.recipe_name)
                or any(_NON_MEAL_DESSERT_OR_DRINK_RE.search(tok) for tok in canon_to_raw)
            )
            has_peeled = any("peeled" in t for t in req_toks_raw)
            pos = len(self.records)
            rec = NormalizedRecipeRecord(
                index_pos=pos,
                row_id=rid,
                row_id_int=int(rid),
                recipe_name=recipe.recipe_name,
                required_tokens=frozenset(req_toks_raw),
                clean_required_tokens=frozenset(canon_to_raw.keys()),
                optional_tokens=optional_toks,
                note_tokens=note_toks,
                core_tokens=frozenset(core_canon),
                core_raw_tokens=frozenset(core_raw),
                seasoning_raw_tokens=frozenset(seasoning_raw),
                staple_family_by_raw=staple_fam_raw,
                equipment=tuple(combined_equip),
                provenance_by_token=prov_map,
                canonical_to_raw_required={k: tuple(v) for k, v in canon_to_raw.items()},
                token_entries=token_entries,
                total_required=len(req_toks_raw),
                core_count=len(core_canon),
                is_non_meal_dessert_or_drink=is_non_meal,
                has_peeled_token=has_peeled,
                reliable_for_can_cook_now=reliable,
                unreliable_reasons=tuple(unreliable_reasons),
            )
            self.records.append(rec)
            self.by_row_id[rid] = rec

            # Index under exact canonical required tokens + verified normalized tokens
            indexed_keys = set(req_toks_raw) | set(canon_to_raw.keys())
            for k in indexed_keys:
                self.postings[k].append(pos)

        self.postings = {k: tuple(v) for k, v in self.postings.items()}  # type: ignore[assignment]

    def _normalize_required_token(
        self,
        raw_tok: str,
        vocab_set: set[str],
        ev_preps: dict[str, tuple[str, str]],
    ) -> TokenProvenance:
        norm_q = self.quality.normalize(raw_tok)
        if _CONTAINER_OR_TOOL_FRAGMENT_RE.search(raw_tok):
            return TokenProvenance(raw_tok, norm_q or raw_tok, "unreliable_container_fragment", 0.4, False)
        if _BROKEN_FRAGMENT_RE.search(raw_tok):
            return TokenProvenance(raw_tok, norm_q or raw_tok, "unreliable_text_fragment", 0.4, False)

        # Source-backed shrimp or tomato preparation verified from ingredient_details.csv
        if raw_tok in ev_preps:
            food = ev_preps[raw_tok][0]
            return TokenProvenance(raw_tok, food, "source_verified_prep", 0.96, True)
        m_tw = _TOMATO_WEDGES_RE.fullmatch(raw_tok)
        if m_tw:
            return TokenProvenance(raw_tok, m_tw.group("food").lower(), "verified_tomato_wedges", 0.96, True)
        if norm_q in {"shrimp peeled deveined", "shrimp, peeled, deveined"}:
            return TokenProvenance(raw_tok, "shrimp, peeled, deveined", "verified_shrimp_peeled", 0.98, True)

        # Safe trailing mechanical prep strip only when resulting base is an exact catalog token
        m_prep = _SAFE_PREP_SUFFIX_RE.fullmatch(norm_q)
        if m_prep:
            base = m_prep.group("base").strip()
            if base in vocab_set and base != norm_q:
                return TokenProvenance(raw_tok, base, "mechanical_prep_stripped", 0.92, True)

        # Ambiguous unparsed `or`-compounds remain lower-confidence for CAN_COOK_NOW
        if re.search(r"\bor\b", norm_q) and norm_q not in vocab_set:
            return TokenProvenance(raw_tok, norm_q, "ambiguous_or_compound", 0.65, False)

        if norm_q != raw_tok:
            return TokenProvenance(raw_tok, norm_q, "punctuation_or_qty_normalized", 0.95, True)
        return TokenProvenance(raw_tok, raw_tok, "exact_canonical", 1.0, True)

    @staticmethod
    def match_staple_family(token: str, confirmed_staple_set: frozenset[str]) -> str | None:
        """Return matching user-confirmed staple key if token belongs to its family."""
        fam = _STAPLE_TOKEN_TO_FAMILY.get(token.casefold().strip())
        if fam and fam in confirmed_staple_set:
            return fam
        return None
