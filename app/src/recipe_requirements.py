"""Conservative ingredient roles and preparation evidence from the source catalog."""
from collections import defaultdict
import csv
from dataclasses import dataclass
from fractions import Fraction
from hashlib import file_digest
import json
import re

from src.recommender import normalized

_EQUIPMENT_LABEL = re.compile(r'^(?:special\s+)?equipment\s*:\s*', re.I)
_PIE_PLATE = r'(?:(?:a |an )?(?:standard )?(?:\d+(?:[ -]\d+/\d+)?(?:-inch|"|-diameter|"-diameter) )?(?:glass |deep-dish )?pie plate)'
_MASHER = r'(?:(?:a )?potato (?:masher|ricer))'
_CHEESECLOTH = (r'(?:(?:a |an |\d+ )?(?:(?:\d+-inch )?(?:layers?|sheets?|squares?|pieces?) of )?'
                r'cheesecloth(?: \(optional\))?)')
_NAMED_TOOL = rf'(?:{_PIE_PLATE}|{_MASHER}|{_CHEESECLOTH})'
_NAMED_TOOL_LIST = re.compile(rf'{_NAMED_TOOL}(?:\s*[,;]\s*{_NAMED_TOOL}| (?:and|or) {_NAMED_TOOL})*\.?', re.I)
_TOOL_ONLY = re.compile(
    r'(?:belgian or standard )?waffle maker|(?:\d+ )?metal skewers?'
    r'(?: or \d+ wooden skewers?(?: soaked in water at least \d+ hours?)?)?', re.I)
_OPTIONAL = re.compile(r'^(?P<item>.+?)\s*\(optional\)\s*\.?$', re.I)
_SOURCE_NOTE = re.compile(
    r'^\*+\s*(?:available\b|(?:a|an)\s+[^.]+\b(?:is )?available\b)'
    r'|^furikake,\s+a dried blend\b[^.]+\bcan be found at\b', re.I,
)
_OPTIONAL_PREP = re.compile(r',\s*\**\s*(?:(?:finely|thinly|coarsely)\s+)?'
                            r'(?:chopped|sliced|minced|diced)$', re.I)
_BULK_IDENTITY = re.compile(
    r'^(?:(?:skinless|boneless|whole|ground|fresh|dried|thin)\s+)*'
    r'(?:corned beef|ground beef|beef chuck|chicken|pork shoulder|pork belly|pork ribs|pork tenderloin|pork chops|'
    r'black bass|sea bass|rice noodles?)\b', re.I,
)
_PACKED_WEIGHT = re.compile(r'^\s*\d+\s*\(\s*(\d+)\b[^)]*\b(?:lb\.?|pounds?)\)', re.I)
_LIQUID_OR_PREPARED_PROTEIN = re.compile(r'\b(?:broth|stock|bouillon|fat|seasoning|sauce|powder)\b', re.I)
_MIXED_LINE = re.compile(r'[,;]|\b(?:and|or|plus|with)\b', re.I)
_FRESH_LIME_JUICE = re.compile(
    r'\b(?:freshly squeezed lime juice|juice of (?:\d+(?:\s*/\s*\d+)?|one|two) limes?)\b', re.I)
_SHRIMP_PREPARATION = re.compile(r'\bshrimp\s*,\s*peeled\s*(?:,|and)\s*deveined\b', re.I)
_INSTRUCTION_TOOLS = {
    'sous vide machine': re.compile(r'\b(?:clip|attach|set|preheat|using|turn on)\b[^.!?\r\n]{0,75}\b'
                                   r'(?:sous[ -]vide machine|immersion circulator)\b', re.I),
    'steamer basket': re.compile(r'\b(?:fit|insert|place)\s+(?:a|the)\s+steamer basket\b', re.I),
}
_SEASONINGS = frozenset({
    'salt', 'kosher salt', 'sea salt', 'fine sea salt', 'coarse kosher salt', 'table salt',
    'iodized salt', 'flaky sea salt', 'black pepper', 'ground black pepper', 'ground pepper',
    'freshly ground black pepper', 'ground white pepper', 'white pepper', 'paprika',
    'smoked paprika', 'ground cinnamon', 'ground cumin', 'cayenne', 'dried oregano',
})
_TITLE_FOODS = frozenset({
    'apple', 'banana', 'bean', 'beef', 'bread', 'cabbage', 'carrot', 'cheese', 'chicken',
    'chocolate', 'corn', 'crab', 'cucumber', 'egg', 'eggplant', 'garlic', 'goat cheese',
    'ham', 'lime', 'mushroom', 'oat', 'onion', 'pasta', 'pea', 'peach', 'pear', 'pork',
    'potato', 'rice', 'salmon', 'shrimp', 'spinach', 'strawberry', 'sweet potato',
    'tofu', 'tomato', 'tuna', 'zucchini',
})
_BULK_ONLY = frozenset({'waxy potato', 'russet potato', 'yukon gold potato', 'tortilla',
                        'dime sized tortilla pieces or tortilla chips', 'all purpose flour'})
_BULK_QUANTITY = {'': 2, 'g': 100, 'kg': .1, 'lb': .25, 'oz': 4, 'cup': 1}


def source_role(raw):
    text = ' '.join(raw.split())
    if _EQUIPMENT_LABEL.match(text) or _TOOL_ONLY.fullmatch(text) or _NAMED_TOOL_LIST.fullmatch(text):
        return 'equipment'
    if _SOURCE_NOTE.match(text):
        return 'note'
    optional = _OPTIONAL.fullmatch(text)
    if optional and not _MIXED_LINE.search(_OPTIONAL_PREP.sub('', optional['item'])):
        return 'optional'
    return 'required'


def ingredient_source_role(row):
    """Recognize explicit equipment before the Stage 2 generic note status."""
    role = source_role(row['ingredient_raw'])
    if row['status'] == 'equipment' or role == 'equipment':
        return 'equipment'
    if row['status'] in {'noningredient_note', 'section_heading'}:
        return 'note'
    return role


def bulk_food(name, quantity, unit):
    if name not in _TITLE_FOODS | _BULK_ONLY or unit not in _BULK_QUANTITY or not quantity:
        return False
    try:
        return sum(Fraction(part) for part in quantity.split()) >= _BULK_QUANTITY[unit]
    except (ValueError, ZeroDivisionError):
        return False


def source_bulk_identity(name, raw, quantity, unit):
    """Recognize a few measurable, solid foods from required catalog lines."""
    words = normalized(name.replace(',', ' '))
    if not _BULK_IDENTITY.match(words) or _LIQUID_OR_PREPARED_PROTEIN.search(words):
        return False
    packed = _PACKED_WEIGHT.match(raw)
    if packed and int(packed[1]) >= 1:
        return True
    if unit not in {'g', 'kg', 'lb', 'oz'} or not quantity:
        return False
    try:
        return sum(Fraction(part) for part in quantity.split()) >= _BULK_QUANTITY[unit]
    except (ValueError, ZeroDivisionError):
        return False


@dataclass(frozen=True)
class RecipeRequirements:
    required: frozenset[int]
    core: frozenset[int]
    optional: frozenset[int]
    equipment: tuple[str, ...]
    verified_lime_juice: str | None
    source_required: frozenset[int] = frozenset()
    source_identity: frozenset[int] = frozenset()
    source_notes: frozenset[int] = frozenset()


class CatalogRequirements:
    def __init__(self, root, index, normalize):
        folder = root / 'processed'
        manifest = json.loads((folder / 'stage2_manifest.json').read_text(encoding='utf-8'))['outputs']
        for name in ('recipes_cleaned.csv', 'ingredient_details.csv'):
            with (folder / name).open('rb') as stream:
                if file_digest(stream, 'sha256').hexdigest() != manifest[name]:
                    raise ValueError(f'Catalog ingredient evidence checksum mismatch: {name}')

        names = index.id_to_name
        ids = index.name_to_id
        self.seasonings = frozenset(ids[x] for x in _SEASONINGS if x in ids)
        rows = defaultdict(lambda: defaultdict(list))
        equipment = defaultdict(set)
        bulk = defaultdict(set)
        source_identity = defaultdict(set)
        rewrites = {}
        with (folder / 'ingredient_details.csv').open(encoding='utf-8-sig', newline='') as stream:
            for row in csv.DictReader(stream):
                raw = row['ingredient_raw']
                role = ingredient_source_role(row)
                if role == 'equipment' and raw.strip():
                    equipment[row['row_id']].add(_EQUIPMENT_LABEL.sub('', raw).strip())
                token = row['ingredient_clean']
                if not token:
                    continue
                if token not in rewrites:
                    rewrites[token] = ids.get(normalize(token))
                item = rewrites[token]
                if item is not None:
                    rows[row['row_id']][item].append((role, row['component_raw']))
                    if role == 'required' and bulk_food(names[item], row['quantity'], row['unit']):
                        bulk[row['row_id']].add(item)
                    if role == 'required' and source_bulk_identity(names[item], raw, row['quantity'], row['unit']):
                        source_identity[row['row_id']].add(item)

        with (folder / 'recipes_cleaned.csv').open(encoding='utf-8-sig', newline='') as stream:
            for row in csv.DictReader(stream):
                for tool, pattern in _INSTRUCTION_TOOLS.items():
                    if pattern.search(row['instructions']):
                        equipment[row['row_id']].add(tool)

        families = defaultdict(set)
        for parent, variants in normalize.families.items():
            if parent in _TITLE_FOODS:
                for variant in variants:
                    families[variant].add(parent)
        # A title food is a conservative proxy for a core ingredient. Unknown
        # roles still count as required food in the readiness and shopping caps.
        title_words = '|'.join(re.escape(x) + r'(?:es|s)?' for x in sorted(_TITLE_FOODS, key=lambda x: (-len(x), x)))
        title_pattern = re.compile(rf'(?<!\w)(?:{title_words})(?!\w)')
        requirements = []
        required_postings = defaultdict(set)
        shrimp, cleaned_shrimp = ids.get('shrimp'), ids.get('shrimp peeled deveined')
        for idx, recipe in enumerate(index.recipes):
            evidence = rows.get(recipe.row_id, {})
            optional = frozenset(i for i in recipe.ingredient_ids if evidence.get(i)
                                 and all(role == 'optional' for role, _ in evidence[i]))
            tools = {i for i in recipe.ingredient_ids if evidence.get(i)
                     and all(role == 'equipment' for role, _ in evidence[i])}
            notes = frozenset(i for i in recipe.ingredient_ids if evidence.get(i)
                              and all(role == 'note' for role, _ in evidence[i]))
            required = recipe.ingredient_ids - optional - tools - notes
            shrimp_upgraded = False
            if (shrimp in required and cleaned_shrimp is not None and evidence.get(shrimp)
                    and all(_SHRIMP_PREPARATION.search(raw) for _, raw in evidence[shrimp])):
                required = (required - {shrimp}) | {cleaned_shrimp}
                shrimp_upgraded = True
            title = set(title_pattern.findall(normalized(recipe.recipe_name)))
            # Match the same token boundaries again for irregular plural endings.
            concepts = {food for food in _TITLE_FOODS if food in title or food + 's' in title or food + 'es' in title}
            core = frozenset(i for i in required - self.seasonings
                             if i in bulk[recipe.row_id] or names[i] in concepts
                             or families.get(names[i], set()) & concepts)
            juice = ids.get('lime juice')
            juice_lines = evidence.get(juice, ())
            compatible = next((raw for _, raw in juice_lines), None) if (
                juice in required and juice_lines and all(_FRESH_LIME_JUICE.search(raw) for _, raw in juice_lines)
            ) else None
            source_required = frozenset(i for i in required if any(
                role == 'required' for role, _ in evidence.get(i, ())
            ) or (shrimp_upgraded and i == cleaned_shrimp and any(
                role == 'required' for role, _ in evidence.get(shrimp, ())
            )))
            requirements.append(RecipeRequirements(required, core, optional,
                                                    tuple(sorted(equipment.get(recipe.row_id, ()))), compatible,
                                                    source_required, required & source_identity[recipe.row_id],
                                                    notes))
            for ingredient in required - self.seasonings:
                required_postings[ingredient].add(idx)
        self.recipes = tuple(requirements)
        self.postings = {key: frozenset(values) for key, values in required_postings.items()}
