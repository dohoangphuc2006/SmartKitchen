"""Source-backed availability for recommendation cards, independent of model features."""
from collections import defaultdict
import csv
from functools import lru_cache
from hashlib import file_digest
import json
import re

from src.recipe_requirements import ingredient_source_role, _EQUIPMENT_LABEL, _SHRIMP_PREPARATION

_TOMATO_WEDGES = re.compile(r'(?P<food>(?:plum )?tomato), each cut into (?:\d+|six) wedges')
_SOURCE_WEDGES = re.compile(r',\s*each cut into (?:\d+|six) wedges\.?\s*$', re.I)


def token_key(value):
    return re.sub(r'\s*,\s*', ', ', ' '.join(value.casefold().split()))


@lru_cache(maxsize=4)
def source_availability(root):
    """Index only verified equipment and mechanical preparation evidence."""
    folder = root / 'processed'
    details = folder / 'ingredient_details.csv'
    manifest = json.loads((folder / 'stage2_manifest.json').read_text(encoding='utf-8'))
    with details.open('rb') as stream:
        if file_digest(stream, 'sha256').hexdigest() != manifest['outputs'][details.name]:
            raise ValueError('Catalog ingredient evidence checksum mismatch')
    equipment = defaultdict(set)
    tools = defaultdict(set)
    preparations = defaultdict(dict)
    conflicts = defaultdict(set)
    with details.open(encoding='utf-8-sig', newline='') as stream:
        for row in csv.DictReader(stream):
            rid, raw = row['row_id'], row['ingredient_raw']
            key = token_key(row['ingredient_clean'])
            role = ingredient_source_role(row)
            if role == 'equipment':
                equipment[rid].add(_EQUIPMENT_LABEL.sub('', raw).strip())
                if key:
                    tools[rid].add(key)
            elif key:
                form = _TOMATO_WEDGES.fullmatch(key)
                if role == 'required' and form and _SOURCE_WEDGES.search(raw):
                    preparations[rid][key] = (form['food'], raw)
                elif role == 'required' and key == 'shrimp' and _SHRIMP_PREPARATION.search(raw):
                    preparations[rid][key] = ('shrimp peeled deveined', raw)
                else:
                    conflicts[rid].add(key)
    return {
        rid: (tools.get(rid, set()) - conflicts.get(rid, set()) - preparations.get(rid, {}).keys(),
              {k: v for k, v in preparations.get(rid, {}).items()
               if k not in conflicts.get(rid, set()) and k not in tools.get(rid, set())},
              sorted(tool for tool in equipment.get(rid, ()) if tool))
        for rid in equipment.keys() | preparations.keys()
    }


def add_food_availability(root, result):
    """Attach verified facts without replacing the ranker's matched/missing tokens."""
    evidence = source_availability(root)
    pantry = set(map(token_key, result['normalized_ingredients']))
    if 'shrimp, peeled, deveined' in pantry:
        pantry.add('shrimp peeled deveined')
    for recipe in result['recommendations']:
        proof = evidence.get(str(recipe['recipe_id']))
        if proof is None:
            continue
        tools, forms, equipment = proof
        if equipment:
            recipe['required_equipment'] = equipment
        have, missing, prepared = {}, {}, []
        for field, bucket in (('matched_ingredients', have), ('missing_ingredients', missing)):
            for token in recipe[field]:
                key = token_key(token)
                if key in tools:
                    continue
                if key in forms:
                    food, raw = forms[key]
                    if food in pantry:
                        have[food] = food
                        prepared.append(dict(pantry=food, recipe=token, evidence=raw))
                        continue
                    # Retain the original required form when the base is absent.
                bucket[key] = token
        matched = sorted(have.values())
        missing_food = sorted(value for key, value in missing.items() if key not in have)
        if matched != recipe['matched_ingredients'] or missing_food != recipe['missing_ingredients']:
            recipe['food_availability'] = dict(matched_ingredients=matched, missing_ingredients=missing_food)
        if prepared:
            recipe['verified_compatible_ingredients'] = prepared
