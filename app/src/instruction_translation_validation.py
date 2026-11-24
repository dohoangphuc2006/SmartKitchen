"""Conservative cache checks, not a certification of translation meaning.

Exact source binding, step alignment, numeric and unit signatures catch stale,
truncated and some altered translations. Human review is still required for
actions, negation, culinary terms and number words. Never auto-promote to reviewed.
"""
from __future__ import annotations
from datetime import datetime
import hashlib
import json
import re
import unicodedata

def source_hash(text: str) -> str:
    return hashlib.sha256(text.encode('utf-8')).hexdigest()

def steps(text: str) -> list[str]:
    return [p.strip() for p in text.replace('\r\n', '\n').replace('\r', '\n').split('\n') if p.strip()]

def normalize_quantities(text: str) -> str:
    # NFKC alone turns 1½ into 11/2; keep the mixed-number boundary.
    text = re.sub(r'(?<=\d)([¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])', r' \1', text)
    return unicodedata.normalize('NFKC', text).replace('⁄', '/')


def numeric_signature(text: str) -> list[str]:
    text = normalize_quantities(text)
    return re.findall(r'\d+(?:[.,]\d+)?', text)

UNIT_PATTERNS = {
    'F': r'(?:°\s*F\b|\bdegrees?\s+F(?:ahrenheit)?\b|\bđộ\s+F\b)',
    'C': r'(?:°\s*C\b|\bdegrees?\s+C(?:elsius)?\b|\bđộ\s+C\b)',
    'minute': r'\b(?:minutes?|mins?|phút)\b',
    'hour': r'\b(?:hours?|hrs?|giờ)\b',
    'second': r'\b(?:seconds?|secs?|giây)\b',
    'tbsp': r'\b(?:tablespoons?|tbsp|muỗng canh|thìa canh)\b',
    'tsp': r'\b(?:teaspoons?|tsp|muỗng cà phê|thìa cà phê)\b',
    'cup': r'\b(?:cups?|cốc|chén)\b',
    'kg': r'\b(?:kilograms?|kg)\b',
    'g': r'\b(?:grams?|gam|g)\b',
    'ml': r'\b(?:milliliters?|millilitres?|ml)\b',
    'l': r'\b(?:liters?|litres?|lít)\b',
    'oz': r'\b(?:ounces?|oz)\b',
    'lb': r'\b(?:pounds?|lbs?)\b',
    'inch': r'\b(?:inches|inch)\b',
}

def unit_signature(text: str) -> dict[str, int]:
    def context(unit):
        value=text
        # These are food/action names, rather than extra measurement units.
        if unit=='hour':value=re.sub(r'\b(?:hẹn|bấm|đếm)\s+giờ\b','timer',value,flags=re.I)
        if unit=='cup':value=re.sub(r'\bngũ\s+cốc\b','cereal',value,flags=re.I)
        if unit=='lb':
            value=re.sub(r'(^|[.!?]\s+)(pound)(?=\s+(?:the\s+)?(?:chicken|meat|beef|pork|veal|turkey)\b)',r'\1flatten',value,flags=re.I|re.M)
        return value
    return {unit:len(re.findall(pattern,context(unit),re.I)) for unit,pattern in UNIT_PATTERNS.items()}

def validate_translation(row: dict, original: str) -> tuple[dict | None, list[str]]:
    errors = []
    if not original.strip():
        errors.append('missing_source')
    if row.get('source_instructions_sha256') != source_hash(original):
        errors.append('source_hash_mismatch_or_missing')
    status = row.get('review_status')
    if status not in {'auto_unreviewed', 'reviewed', 'untranslated'}:
        errors.append('invalid_status')
    text = row.get('instructions_vi', '').strip()
    if status == 'untranslated' and not text:
        if errors:
            return None, errors
        return {'text': None, 'steps': [], 'source': 'none', 'review_status': 'untranslated'}, []
    if not text or not row.get('translation_source', '').strip():
        errors.append('missing_translation_or_provenance')
    try:
        translated_steps = json.loads(row.get('instruction_steps_vi') or '[]')
        if (not isinstance(translated_steps, list) or
                not all(isinstance(s, str) and s.strip() for s in translated_steps)):
            raise ValueError()
    except (ValueError, TypeError):
        translated_steps = []
        errors.append('malformed_steps')
    if translated_steps != steps(text):
        errors.append('text_steps_mismatch')
    original_steps = steps(original)
    if len(translated_steps) != len(original_steps):
        errors.append('step_count_mismatch')
    for index, (en, vi) in enumerate(zip(original_steps, translated_steps)):
        if numeric_signature(en) != numeric_signature(vi):
            errors.append(f'numeric_mismatch_step_{index + 1}')
        if unit_signature(en) != unit_signature(vi):
            errors.append(f'unit_mismatch_step_{index + 1}')
    if status == 'reviewed':
        if not row.get('reviewer', '').strip() or not row.get('review_evidence', '').strip():
            errors.append('missing_review_audit')
        try:
            reviewed_at = datetime.fromisoformat(row.get('reviewed_at', ''))
            if reviewed_at.tzinfo is None:
                raise ValueError()
        except ValueError:
            errors.append('invalid_review_timestamp')
    if errors:
        return None, errors
    return {'text': text, 'steps': translated_steps, 'source': row['translation_source'],
            'review_status': status}, []
