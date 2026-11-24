"""Source-bound AI display candidates. Structural checks are NOT human review."""
import hashlib
import json
import re
import unicodedata

from src.instruction_translation_validation import source_hash, steps, validate_translation, normalize_quantities

VERSION = 'recipe-detail-vi-v1'
SUSPICIOUS = re.compile(r'<\s*/?\s*(?:script|img|iframe)|javascript:|bộ phận sinh dục|\b(?:undefined|null)\b', re.I)
NEG_EN = re.compile(r"\b(?:not|no|never|neither|without|cannot|can't|won't|don't|doesn't|isn't|aren't|shouldn't)\b", re.I)
NEG_VI = re.compile(r'\b(?:không|đừng|chưa|tránh|để hở|để trần)\b', re.I)
EXTRA_UNITS = {
    'quart': (r'\bquarts?\b', r'\bquarts?\b'),
    'day': (r'\bdays?\b', r'\bngày\b'),
    'week': (r'\bweeks?\b', r'\btuần\b'),
    'month': (r'\bmonths?\b', r'\btháng\b'),
    'ounce': (r'\b(?:ounces?|oz)\b', r'\b(?:ounces?|oz)\b'),
}


def recipe_hash(name, ingredients, instructions):
    value = json.dumps([name, list(ingredients), instructions], ensure_ascii=False, separators=(',', ':'))
    return source_hash(value)


def quantities(text):
    normalized = normalize_quantities(text)
    return re.findall(r'\d+(?:[.,]\d+)?(?:\s*/\s*\d+)?', normalized)


def check_text(en, vi):
    errors = []
    if not isinstance(vi, str) or not vi.strip():
        return ['empty_translation']
    if SUSPICIOUS.search(vi):
        errors.append('suspicious_content')
    if en.strip().casefold() == vi.strip().casefold():
        errors.append('unchanged_english')
    if len(vi) < .55 * len(en) or len(vi) > 4.5 * max(1, len(en)):
        errors.append('length_or_truncation')
    if quantities(en) != quantities(vi):
        errors.append('fraction_or_quantity_structure')
    if len(NEG_EN.findall(en.replace('’', "'"))) > len(NEG_VI.findall(vi)):
        errors.append('possible_negation_loss')
    for unit, (original, translated) in EXTRA_UNITS.items():
        if len(re.findall(original, en, re.I)) != len(re.findall(translated, vi, re.I)):
            errors.append('unit_' + unit)
    for source_word, target in [('half', r'nửa'), ('quarter', r'tư|quarter'), ('two', r'hai')]:
        if re.search(r'\b' + source_word + r'\b', en, re.I) and not re.search(target, vi, re.I):
            errors.append('possible_number_word_loss_' + source_word)
    if re.search(r'\b(?:refrigerat\w*|chill\w*|freez\w*|frozen)\b', en, re.I) and not re.search(r'lạnh|tủ mát|nước đá|đông', vi, re.I):
        errors.append('possible_cold_storage_loss')
    if re.search(r'\bcarefully\b', en, re.I) and not re.search(r'cẩn thận|thận trọng', vi, re.I):
        errors.append('possible_caution_loss')
    words = vi.casefold().split()
    if any(words[i:i+6] == words[i+6:i+12] for i in range(max(0, len(words)-11))):
        errors.append('repetition')
    return errors


def validate_candidate(item, record):
    errors = {}
    source = item.get('source', {})
    bound = (source.get('recipe_name') == record.recipe_name and
             source.get('ingredients') == list(record.ingredients) and
             source.get('instructions') == record.instructions and
             item.get('source_instructions_sha256') == source_hash(record.instructions) and
             item.get('source_sha256') == recipe_hash(record.recipe_name, record.ingredients, record.instructions))
    if not bound or item.get('review_status') != 'auto_unreviewed' or not item.get('translation_source') or not item.get('version'):
        return {}, {'record': ['source_binding_or_provenance_invalid']}
    result = {}
    title = item.get('recipe_name_vi', '')
    title_errors = check_text(record.recipe_name, title)
    if not title_errors:
        result['title'] = title
    else:
        errors['title'] = title_errors
    ingredients = item.get('ingredients_vi')
    if not isinstance(ingredients, list) or len(ingredients) != len(record.ingredients):
        errors['ingredients'] = ['ingredient_count_mismatch']
    else:
        issues = []
        # Reuse existing numeric/unit checks for EACH complete ingredient line.
        for i, (en, vi) in enumerate(zip(record.ingredients, ingredients)):
            issues.extend(f'line_{i+1}:{e}' for e in check_text(en, vi))
            from src.instruction_translation_validation import numeric_signature, unit_signature
            if isinstance(vi, str) and (numeric_signature(en) != numeric_signature(vi) or unit_signature(en) != unit_signature(vi)):
                issues.append(f'line_{i+1}:numeric_or_unit_mismatch')
        if issues:
            errors['ingredients'] = issues
        else:
            result['ingredients'] = ingredients
    vi_steps = item.get('instruction_steps_vi', [])
    if not isinstance(vi_steps, list) or not all(isinstance(s, str) for s in vi_steps):
        vi_steps = []
    text = '\n'.join(vi_steps)
    translated, issues = validate_translation({
        'source_instructions_sha256': source_hash(record.instructions),
        'review_status': 'auto_unreviewed', 'translation_source': item['translation_source'],
        'instructions_vi': text, 'instruction_steps_vi': json.dumps(vi_steps, ensure_ascii=False)}, record.instructions)
    issues.extend(f'step_{i+1}:{e}' for i, (en, vi) in enumerate(zip(steps(record.instructions), vi_steps)) for e in check_text(en, vi))
    if issues:
        errors['instructions'] = issues
    else:
        result['instructions'] = translated
    result['source'] = item['translation_source']
    result['version'] = item['version']
    result['field_sources'] = {}
    # Local OPUS-MT produced semantically broken cooking instructions in this run.
    # Passing numeric signatures is insufficient; keep those fields quarantined.
    for field in ['title', 'ingredients', 'instructions']:
        provider = item.get('field_providers', {}).get(field, item['translation_source'])
        result['field_sources'][field] = provider
        if 'opus' in provider.casefold() or 'argos' in provider.casefold():
            result.pop(field, None)
            errors.setdefault(field, []).append('offline_model_semantic_quarantine')
    if result.get('instructions'):
        result['instructions']['source'] = result['field_sources']['instructions']
    return result, errors
