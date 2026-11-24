"""Ingredient retrieval experiments against the existing Stage 5 catalog."""
from __future__ import annotations

from collections import defaultdict
import json
import math
from pathlib import Path
import re
import unicodedata

from src.localization import get_localization
from src.recipe_requirements import CatalogRequirements
from src.recommender import Recommender, calculate_cosine, load_recipes, normalized

QUALITY_METHODS = ('quality_overlap', 'quality_binary', 'quality_tfidf', 'quality_hybrid')
_NUMBER = r'(?:\d+\s+\d+/\d+|\d+/\d+|\d+(?:[.,]\d+)?)'
_UNIT = (
    r'(?:grams?|g|kg|ml|l|cups?|tbsps?\.?|tsps?\.?|tablespoons?|teaspoons?|oz\.?|ounces?|lbs?\.?|pounds?'
    r'|quả|trái|củ|nhánh|tép|cây|bó|bát|chén|miếng|tai|vắt|ít|ổ|lát|khúc|bắp|con|hộp|gói|bịch|lon|chai|lọ'
    r'|muỗng canh|muỗng cà phê|thìa canh|thìa cà phê|muỗng|thìa)'
)
def _quantity_pattern(units):
    return re.compile(rf'^\s*(?P<qty>{_NUMBER}(?:\s*(?:-|–|to)\s*{_NUMBER})?)'
                      rf'(?:\s*(?P<unit>{units})(?=\s))?\s+(?:of\s+)?', re.IGNORECASE)


_QUANTITY = _quantity_pattern(_UNIT)
# These extra units and spellings are accepted by the manual pantry UI.
# Keep them out of the recipe feature parser used to build the fitted vocabulary.
_PANTRY_QUANTITY = _quantity_pattern(rf'(?:{_UNIT}|gr|lít|lit|qua|trai|cu|nhanh|tep)')
_PANTRY_SPELLINGS = {
    'trung': 'trứng', 'trung ga': 'trứng gà', 'thit ga': 'thịt gà',
    'ca chua': 'cà chua', 'ca rot': 'cà rốt', 'hanh la': 'hành lá',
    'hanh tay': 'hành tây', 'thit bo': 'thịt bò', 'thit bo xay': 'thịt bò xay',
    'ot hiem': 'ớt hiểm', 'ot chuong': 'ớt chuông', 'nuoc mam': 'nước mắm', 'sua': 'sữa',
    'uc ga': 'ức gà', 'toi': 'tỏi',
}
_LIME_JUICE = re.compile(rf'^juice of {_NUMBER} limes?$', re.IGNORECASE)
_MECHANICAL = r'(?:finely |coarsely |roughly |thinly |thickly )?(?:chopped|sliced|diced|cubed|minced|grated)'
_PREP = re.compile(rf'^(?:{_MECHANICAL} (.+)|(.+), {_MECHANICAL})$')
_VI_PREP_SUFFIX = re.compile(
    r'^(?P<base>.+?)\s+(?:chặt miếng|cắt khúc|thái lát|thái mỏng|bóc vỏ|lột vỏ|cắt miếng|đập dập|băm nhỏ)$',
    re.IGNORECASE,
)
_EN_COMMA_CLAUSE = re.compile(
    r'^(?:(?:finely |coarsely |roughly |thinly |thickly |freshly |well )?'
    r'(?:chopped|sliced|diced|cubed|minced|grated|peeled|deveined|shucked|halved|quartered|crushed|beaten'
    r'|melted|softened|divided|trimmed|cored|seeded|stemmed|rinsed|drained|toasted|sifted|optional|to taste|as needed)\b'
    r'|(?:and|or|plus|with|such as|preferably|about|into|cut|tails|leaf|stem|coarse|tough|skin|bone)\b)',
    re.IGNORECASE,
)


def _key(value):
    value = unicodedata.normalize('NFC', value)
    return normalized(re.sub(r'\s*,\s*', ', ', value)).strip()


class IngredientNormalizer:
    def __init__(self, baseline: Recommender):
        self.local = get_localization(str(baseline.root))
        self.baseline_vocabulary = set(baseline.recipe_vocabulary)
        self.direct_lookup = baseline.direct_lookup
        config = json.loads((baseline.root / 'config/recipe_quality_ingredients.json').read_text(encoding='utf-8'))
        self.aliases = dict(baseline.alias_lookup)
        self.aliases.update({_key(raw): canonical for raw, canonical in baseline.mapping.items()})
        for canonical, aliases in config['equivalents'].items():
            for alias in [canonical, *aliases]:
                key = _key(alias)
                existing = self.aliases.get(key)
                if existing and _key(existing) != _key(canonical):
                    raise ValueError(f'Conflicting ingredient alias: {alias!r}')
                self.aliases[key] = canonical
        self.generic_unresolved = {}
        for concept, variants in config.get('generic_unresolved', {}).items():
            for variant in [concept, *variants]:
                self.generic_unresolved[_key(variant)] = concept
        self.families = {self._plain(root): {self._plain(v) for v in values}
                         for root, values in config['families'].items()}
        self.related = defaultdict(set)
        for parent, variants in self.families.items():
            for variant in variants:
                self.related[parent].add(variant)
                self.related[variant].add(parent)
        for whole, parts in config['preparation_from_whole'].items():
            self.related[self._plain(whole)].update(map(self._plain, parts))
        self.prep_bases = (set(self.aliases.values()) | set(self.related)
                           | {token for group in self.related.values() for token in group})
        self.known_names = {_key(name) for name in baseline.recipe_vocabulary} | set(self.aliases) | {
            _key(name) for name in self.prep_bases
        }
        self.equivalent_sources = {
            canonical: list(aliases) for canonical, aliases in config['equivalents'].items()
        }
        catalog_path = baseline.root / 'config/pantry_ingredient_catalog.json'
        catalog_aliases = (
            json.loads(catalog_path.read_text(encoding='utf-8')).get('pantry_aliases', {})
            if catalog_path.is_file() else {}
        )
        overrides_path = baseline.root / 'config/pantry_alias_overrides_v1.json'
        overrides = (
            json.loads(overrides_path.read_text(encoding='utf-8'))
            if overrides_path.is_file() else {}
        )
        for concept, variants in overrides.get('generic_unresolved', {}).items():
            for variant in [concept, *variants]:
                self.generic_unresolved[_key(variant)] = concept
        override_aliases = {_key(k): v for k, v in overrides.get('pantry_aliases', {}).items()}
        self.pantry_override_keys = set(override_aliases)
        self.pantry_spellings = {
            **{_key(k): v for k, v in catalog_aliases.items() if _key(k) not in self.local.conflicts},
            **_PANTRY_SPELLINGS,
            **override_aliases,
        }
        self.pantry_known_names = (
            self.known_names
            | set(self.pantry_spellings)
            | {_key(v) for v in self.pantry_spellings.values()}
        )
        self.token_to_cut_group = {}
        for group_id, members in overrides.get('ingredient_cut_groups', {}).items():
            for member in members:
                self.token_to_cut_group[_key(member)] = group_id

    def count_ingredient_groups(self, tokens) -> int:
        groups = {self.token_to_cut_group.get(_key(token), _key(token)) for token in tokens if token}
        return len(groups)

    def _plain(self, value):
        key = _key(value)
        return self.aliases.get(key, key)

    def _food(self, value):
        token = self._plain(self.local.canonical_input(value))
        if _LIME_JUICE.fullmatch(token):
            return 'lime juice'
        preparation = _PREP.fullmatch(token)
        if preparation:
            base = self._plain(preparation[1] or preparation[2])
            if base in self.prep_bases:
                return base
        vi_prep = _VI_PREP_SUFFIX.fullmatch(value.strip())
        if vi_prep and _key(token) not in self.known_names:
            base_raw = vi_prep.group('base').strip()
            base_token = self._plain(self.local.canonical_input(base_raw))
            if (_key(base_token) in self.known_names
                    or _key(base_raw) in self.generic_unresolved
                    or _key(base_token) in self.generic_unresolved):
                return base_token
        return token

    def __call__(self, value):
        value = re.sub(r'(?<=\d)(?=[¼½¾⅓⅔⅛⅜⅝⅞])', ' ', value.strip())
        value = unicodedata.normalize('NFKC', value).replace('⁄', '/')
        # A numeric prefix is a quantity only when the remainder is a known food.
        match = _QUANTITY.match(value)
        if match:
            stripped = value[match.end():].strip()
            remainder = self._food(stripped)
            if _key(remainder) in self.known_names or _key(remainder) in self.generic_unresolved:
                return remainder
            if match.group('unit'):
                after_num = value[match.end('qty'):].strip()
                rem_num = self._food(after_num)
                if _key(rem_num) in self.known_names or _key(rem_num) in self.generic_unresolved:
                    return rem_num
        return self._food(value)

    def _pantry_food(self, value):
        return self._food(self.pantry_spellings.get(_key(value), value))

    def split_merged_line(self, raw_line: str) -> list[str]:
        text = unicodedata.normalize('NFC', raw_line).strip()
        if not text:
            return []
        if ',' not in text and ';' not in text:
            return [text]
        stripped_qty = _PANTRY_QUANTITY.sub('', unicodedata.normalize('NFKC', text).replace('⁄', '/'), count=1)
        for candidate in (text, stripped_qty):
            food = self._pantry_food(candidate)
            if (_key(candidate) in self.pantry_known_names
                    or _key(food) in self.pantry_known_names
                    or _key(candidate) in self.generic_unresolved
                    or _key(food) in self.generic_unresolved):
                return [text]
        parts = [p.strip() for p in re.split(r'[,;]+', text) if p.strip()]
        if len(parts) <= 1 or any(_EN_COMMA_CLAUSE.match(part) for part in parts[1:]):
            return [text]
        return parts

    def parse_item(self, sub_item: str, *, raw_line: str | None = None,
                   vocabulary: set[str] | None = None) -> dict:
        raw_line = sub_item if raw_line is None else raw_line
        vocab = self.baseline_vocabulary if vocabulary is None else vocabulary
        cleaned = re.sub(r'(?<=\d)(?=[¼½¾⅓⅔⅛⅜⅝⅞])', ' ', sub_item.strip())
        cleaned = unicodedata.normalize('NFKC', cleaned).replace('⁄', '/')
        match = _PANTRY_QUANTITY.match(cleaned)
        if match:
            qty = match.group('qty').strip()
            unit = (match.group('unit') or '').strip() or None
            after_qty = cleaned[match.end():].strip()
            if unit and _key(self._pantry_food(after_qty)) not in self.pantry_known_names:
                after_num = cleaned[match.end('qty'):].strip()
                if _key(self._pantry_food(after_num)) in self.pantry_known_names or _key(after_num) in self.generic_unresolved:
                    unit = None
                    after_qty = after_num
        else:
            qty, unit, after_qty = None, None, cleaned
        extracted_name = after_qty
        prep_note = None
        vi_prep = _VI_PREP_SUFFIX.fullmatch(after_qty)
        if vi_prep and _key(self._plain(self.local.canonical_input(after_qty))) not in self.pantry_known_names:
            extracted_name = vi_prep.group('base').strip()
            prep_note = after_qty[len(vi_prep.group('base')):].strip()

        key_extracted = _key(extracted_name)
        resolved_spelling = self.pantry_spellings.get(key_extracted, extracted_name)
        canonical_in = self.local.canonical_input(resolved_spelling)
        key_canonical_in = _key(canonical_in)
        if key_extracted not in self.pantry_override_keys and (
                key_extracted in self.local.conflicts or key_canonical_in in self.local.conflicts):
            return dict(
                raw_line=raw_line, sub_item=sub_item, quantity=qty, unit=unit,
                extracted_name=extracted_name, prep_note=prep_note, canonical=None,
                status='UNRESOLVED', reason='AMBIGUOUS_ALIAS',
                warning=f"UNRESOLVED '{sub_item}': tên nguyên liệu '{extracted_name}' nhập nhằng trong từ điển; đã bỏ qua",
            )

        token = self(sub_item)
        if (match and token not in vocab) or resolved_spelling != extracted_name or key_extracted in self.pantry_override_keys:
            pantry_token = self._pantry_food(extracted_name)
            if (pantry_token in vocab
                    or _key(pantry_token) in self.pantry_known_names
                    or _key(pantry_token) in self.generic_unresolved
                    or pantry_token in self.equivalent_sources):
                token = pantry_token
        key_token = _key(token)
        concept = (self.generic_unresolved.get(key_extracted)
                   or self.generic_unresolved.get(_key(resolved_spelling))
                   or self.generic_unresolved.get(key_canonical_in)
                   or self.generic_unresolved.get(key_token))
        if concept and token not in vocab:
            reason = 'GENERIC_MEAT_CUT_UNSPECIFIED' if concept in {'beef', 'pork'} else 'GENERIC_VARIANT_UNSPECIFIED'
            if concept == 'beef':
                warning = (f"UNRESOLVED '{sub_item}': '{extracted_name}' (beef) chưa xác định phần thịt; "
                           f"hãy nhập phần cụ thể nếu biết (ví dụ: beef chuck, ground beef).")
            elif concept == 'pork':
                warning = (f"UNRESOLVED '{sub_item}': '{extracted_name}' (pork) chưa xác định phần thịt; "
                           f"hãy nhập phần cụ thể nếu biết (ví dụ: thịt heo xay / ground pork, thịt ba rọi / pork belly, sườn heo / pork ribs).")
            elif concept == 'chili':
                warning = (f"UNRESOLVED '{sub_item}': '{extracted_name}' (chili) chưa rõ loại ớt; "
                           f"hãy chọn loại cụ thể (ví dụ: ớt hiểm / thai chile, ớt chuông đỏ / red bell pepper, ớt sừng / red chile).")
            elif concept == 'fish':
                warning = (f"UNRESOLVED '{sub_item}': '{extracted_name}' (fish) chưa rõ loại cá; "
                           f"hãy nhập tên cá cụ thể (ví dụ: cá hồi / salmon, cá tuyết / cod fillet, cá ngừ / tuna steak, cá rô phi / tilapia fillet).")
            elif concept == 'onion_generic':
                warning = (f"UNRESOLVED '{sub_item}': '{extracted_name}' chưa rõ loại hành; "
                           f"hãy nhập cụ thể (ví dụ: hành tây / onion, hành lá / green onion, hành tím / shallot).")
            else:
                warning = f"UNRESOLVED '{sub_item}': '{extracted_name}' ({concept}) chưa xác định loại cụ thể trong bộ công thức."
            return dict(
                raw_line=raw_line, sub_item=sub_item, quantity=qty, unit=unit,
                extracted_name=extracted_name, prep_note=prep_note, canonical=None,
                concept=concept, status='UNRESOLVED', reason=reason, warning=warning,
            )

        resolved = token if token in vocab else None
        if resolved is None:
            direct = self.direct_lookup.get(key_token, set()) & vocab
            if len(direct) == 1:
                resolved = next(iter(direct))
            elif len(direct) > 1:
                exact_space = {
                    v for v in direct
                    if v.replace('_', ' ').lower() == token.replace('_', ' ').lower()
                }
                if len(exact_space) == 1:
                    resolved = next(iter(exact_space))
                else:
                    return dict(
                        raw_line=raw_line, sub_item=sub_item, quantity=qty, unit=unit,
                        extracted_name=extracted_name, prep_note=prep_note, canonical=None,
                        status='UNRESOLVED', reason='AMBIGUOUS_VOCABULARY',
                        warning=f"UNRESOLVED '{sub_item}': tên nhập '{extracted_name}' nhập nhằng trong vocabulary; đã bỏ qua",
                    )
        if resolved is None and token in self.equivalent_sources:
            equiv_hits = [a for a in self.equivalent_sources[token] if a in vocab]
            if equiv_hits:
                resolved = equiv_hits[0]

        if resolved is not None:
            return dict(
                raw_line=raw_line, sub_item=sub_item, quantity=qty, unit=unit,
                extracted_name=extracted_name, prep_note=prep_note, canonical=resolved,
                status='RESOLVED', reason=None, warning=None,
            )

        return dict(
            raw_line=raw_line, sub_item=sub_item, quantity=qty, unit=unit,
            extracted_name=extracted_name, prep_note=prep_note, canonical=None,
            status='UNRESOLVED', reason='NO_CANONICAL_RECIPE_TOKEN',
            warning=f"UNRESOLVED '{sub_item}': không có nguyên liệu chuẩn tương ứng đáng tin cậy cho '{extracted_name}'",
        )

    def normalize_pantry(self, user_ingredients, *, vocabulary: set[str] | None = None) -> dict:
        if user_ingredients is None:
            return dict(normalized_ingredients=[], unresolved_ingredients=[], items=[],
                        warnings=['Input nguyên liệu rỗng'])
        if isinstance(user_ingredients, (str, dict)):
            user_ingredients = [user_ingredients]
        vocab = self.baseline_vocabulary if vocabulary is None else vocabulary
        resolved_names: set[str] = set()
        unresolved_items: list[dict] = []
        all_items: list[dict] = []
        warnings: list[str] = []
        for entry in user_ingredients:
            if isinstance(entry, dict):
                raw = entry.get('class', entry.get('name', ''))
            elif isinstance(entry, str):
                raw = entry
            else:
                warnings.append(f'Bỏ qua input không hợp lệ: {type(entry).__name__}')
                continue
            if not isinstance(raw, str) or not raw.strip():
                warnings.append('Bỏ qua tên nguyên liệu rỗng')
                continue
            for sub_item in self.split_merged_line(raw):
                parsed = self.parse_item(sub_item, raw_line=raw, vocabulary=vocab)
                all_items.append(parsed)
                if parsed['status'] == 'RESOLVED':
                    resolved_names.add(parsed['canonical'])
                else:
                    unresolved_items.append(parsed)
                    if parsed.get('warning'):
                        warnings.append(parsed['warning'])
        if not resolved_names and not warnings:
            warnings.append('Input nguyên liệu rỗng')
        return dict(
            normalized_ingredients=sorted(resolved_names),
            unresolved_ingredients=unresolved_items,
            items=all_items,
            warnings=warnings,
        )


class RecipeQualityRecommender(Recommender):
    def __init__(self, baseline: Recommender):
        self.root: Path = baseline.root
        self.default_config = baseline.default_config
        self.normalize = IngredientNormalizer(baseline)
        self.index = load_recipes(self.root, normalize_ingredient=self.normalize)
        self.requirements = CatalogRequirements(self.root, self.index, self.normalize)
        ids = self.index.name_to_id
        self.quality_vocabulary = set(ids)
        self.related_ids = {ids[name]: frozenset(ids[value] for value in values if value in ids)
                            for name, values in self.normalize.related.items() if name in ids}

    def recommend(self, user_ingredients, top_n=5, method='quality_hybrid', return_diagnostics=False):
        if method not in QUALITY_METHODS or top_n < 0:
            raise ValueError('Unknown quality ranker or negative top_n')
        ids = self.index.name_to_id
        names = self.index.id_to_name
        parsed = self.normalize.normalize_pantry(user_ingredients, vocabulary=self.quality_vocabulary)
        pantry = {ids[token] for token in parsed['normalized_ingredients'] if token in ids}
        warnings = list(parsed['warnings'])
        diagnostics = dict(
            recommendations=[],
            normalized_ingredients=sorted(names[i] for i in pantry),
            unresolved_ingredients=parsed['unresolved_ingredients'],
            normalization_details=parsed['items'],
            warnings=warnings,
            candidate_count=0,
            qualified_count=0,
            method=method,
        )
        if not pantry or not top_n:
            diagnostics['empty_reason'] = 'NO_RECOGNIZED_INGREDIENTS' if not pantry else 'TOP_N_ZERO'
            return diagnostics if return_diagnostics else []

        # An uncertain variant never creates a recommendation by itself.
        related = defaultdict(set)
        for item in pantry:
            for variant in self.related_ids.get(item, frozenset()) - pantry:
                related[variant].add(item)
        pantry_food = pantry - self.requirements.seasonings
        candidates = {idx for item in pantry_food for idx in self.requirements.postings.get(item, ())}
        required_matches = min(len(pantry_food), self.default_config.min_matched_ingredients)
        lime, juice = ids.get('lime'), ids.get('lime juice')
        if method == 'quality_tfidf':
            squared, norms = self.tfidf_weights
            pantry_norm = math.sqrt(math.fsum(squared[i] for i in pantry))
        qualified = []
        for idx in candidates:
            recipe = self.index.recipes[idx]
            if not recipe.has_instructions or (self.default_config.ready_only and not recipe.ready_for_mapping):
                continue
            needs = self.requirements.recipes[idx]
            exact = pantry & needs.required
            exact_food = exact - self.requirements.seasonings
            if not exact_food:
                continue
            missing = needs.required - exact
            remaining = pantry - exact
            verified = []
            if needs.verified_lime_juice and lime in remaining and juice in missing:
                verified.append({'pantry': names[lime], 'recipe': names[juice], 'evidence': needs.verified_lime_juice})
                remaining.remove(lime)
                missing -= {juice}
            core_missing = missing & needs.core
            if len(missing) > 6 or len(core_missing) > 2:
                continue
            conditional = []
            pending = set()
            for item in sorted(missing & related.keys(), key=names.__getitem__):
                available = related[item] & remaining
                if available:
                    source = min(available, key=names.__getitem__)
                    conditional.append({'pantry': names[source], 'recipe': names[item]})
                    remaining.remove(source)
                    pending.add(item)
            available_food = len(exact_food) + len(verified)
            if not missing and not needs.equipment:
                group = 'A'
            elif (len(missing) <= 3 and len(core_missing) <= 1 and available_food >= required_matches
                  and not conditional and not needs.equipment):
                group = 'B'
            elif available_food + len(conditional) >= required_matches:
                group = 'C'
            else:
                continue

            overlap = len(exact) + len(verified)
            size = len(needs.required)
            if method == 'quality_overlap':
                score = overlap
            elif method == 'quality_binary':
                score = calculate_cosine(overlap, len(pantry), size)
            elif method == 'quality_tfidf':
                score = min(1., math.fsum(squared[i] for i in exact) / (pantry_norm * norms[idx]))
            else:
                score = (.40 * available_food / len(pantry_food) + .30 * overlap / size
                         + .20 / (1 + len(missing)) + .10 / (1 + len(core_missing)))
            row = dict(
                recipe_id=recipe.row_id, recipe_name=recipe.recipe_name, score=score,
                match_ratio=len(exact) / size, readiness_group=group,
                quantity_status='not_checked', pantry_food_used_count=available_food,
                pantry_food_count=len(pantry_food),
                matched_count=len(exact), missing_count=len(missing),
                matched_ingredients=sorted(names[i] for i in exact),
                missing_ingredients=sorted(names[i] for i in missing), conditional_ingredients=conditional,
                verified_compatible_ingredients=verified,
                unavailable_ingredients=sorted(names[i] for i in missing - pending),
                missing_core_ingredients=sorted(names[i] for i in core_missing),
                missing_seasonings=sorted(names[i] for i in missing & self.requirements.seasonings),
                optional_ingredients=sorted(names[i] for i in needs.optional),
                required_equipment=list(needs.equipment),
                suggestion_status='needs_ingredients' if missing else 'pantry_match',
            )
            qualified.append((row, needs.required))
        qualified.sort(key=lambda item: (item[0]['readiness_group'], -item[0]['score'],
                                         len(item[0]['missing_core_ingredients']), item[0]['missing_count'],
                                         -item[0]['matched_count'], int(item[0]['recipe_id'])))
        seen, ready_sets = set(), set()
        for row, required in qualified:
            title = normalized(row['recipe_name'])
            if title in seen or (row['readiness_group'] == 'A' and required in ready_sets):
                continue
            seen.add(title)
            if row['readiness_group'] == 'A':
                ready_sets.add(required)
            diagnostics['recommendations'].append(row)
            if len(diagnostics['recommendations']) == top_n:
                break
        diagnostics.update(candidate_count=len(candidates), qualified_count=len(qualified),
                           empty_reason=None if qualified else 'NO_CANDIDATE_WITH_SUFFICIENT_SUPPORT')
        if not qualified:
            warnings.append('Chưa tìm được món đủ khớp và cần ít nguyên liệu bổ sung. Hãy nhập rõ loại nguyên liệu hoặc phần thịt nếu biết.')
        return diagnostics if return_diagnostics else diagnostics['recommendations']
