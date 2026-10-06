"""Lưu thực đơn yêu thích (JSON cục bộ)."""
import json
from pathlib import Path

PATH = Path(__file__).resolve().parent.parent / "data" / "favorites.json"


def load():
    if PATH.exists():
        return json.loads(PATH.read_text(encoding="utf-8"))
    return []


def _save(items):
    PATH.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")


def add(recipe: dict):
    items = load()
    if not any(i["name"] == recipe["name"] for i in items):
        items.append(recipe)
        _save(items)


def remove(name: str):
    _save([i for i in load() if i["name"] != name])
