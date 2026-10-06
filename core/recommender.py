"""Hệ thống gợi ý món: Content-based Filtering (TF-IDF + cosine) kết hợp ưu tiên nguyên liệu sắp hết hạn."""
import json
import math
from datetime import date
from pathlib import Path

from .ingredients import vi_name

RECIPES_PATH = Path(__file__).resolve().parent.parent / "data" / "recipes.json"
BASE_SERVINGS = 2  # khẩu phần chuẩn của công thức trong CSDL


def load_recipes():
    return json.loads(RECIPES_PATH.read_text(encoding="utf-8"))


def urgency(days_left: int) -> float:
    """Độ khẩn cấp 0..1: càng gần hạn càng cao (quá hạn = 1)."""
    if days_left <= 0:
        return 1.0
    return 1.0 / (1.0 + days_left / 3.0) * 1.5 if days_left <= 3 else max(0.0, 0.6 - days_left / 30)


def _idf(recipes):
    n = len(recipes)
    df = {}
    for r in recipes:
        for k in set(r["ingredients"]) | set(r["optional"]):
            df[k] = df.get(k, 0) + 1
    return {k: math.log((1 + n) / (1 + v)) + 1 for k, v in df.items()}


def recommend(pantry: dict, servings: int = 2, top_k: int = 8, min_coverage: float = 0.5, recipes=None):
    """
    pantry: {ingredient_key: expiry_date (datetime.date) | days_left (int)}
    Trả về list dict gồm công thức + điểm + nguyên liệu có/thiếu.
    """
    recipes = recipes or load_recipes()
    idf = _idf(recipes)
    today = date.today()
    days = {k: (v - today).days if isinstance(v, date) else int(v) for k, v in pantry.items()}
    urg = {k: min(1.0, urgency(d)) for k, d in days.items()}
    scale = servings / BASE_SERVINGS

    pvec = {k: idf.get(k, 1.0) for k in pantry}
    pnorm = math.sqrt(sum(v * v for v in pvec.values())) or 1.0

    results = []
    for r in recipes:
        req = r["ingredients"]
        # trọng số mỗi nguyên liệu bắt buộc = IDF (nguyên liệu đặc trưng quan trọng hơn)
        tot = sum(idf.get(k, 1) for k in req)
        have = [k for k in req if k in pantry]
        missing = [k for k in req if k not in pantry]
        cov = sum(idf.get(k, 1) for k in have) / tot
        if cov < min_coverage or not have:
            continue
        opt_have = [k for k in r["optional"] if k in pantry]
        # cosine giữa vector tủ lạnh và vector công thức (bắt buộc + tùy chọn)
        rvec = {k: idf.get(k, 1.0) for k in list(req) + r["optional"]}
        rnorm = math.sqrt(sum(v * v for v in rvec.values()))
        dot = sum(pvec[k] * rvec[k] for k in rvec if k in pvec)
        cos = dot / (pnorm * rnorm)
        used = have + opt_have
        urg_score = sum(urg[k] for k in used) / len(used) if used else 0.0
        score = 0.55 * cov + 0.25 * cos + 0.20 * urg_score + 0.02 * len(opt_have)
        results.append({
            **r,
            "score": round(score, 4),
            "coverage": round(cov, 3),
            "have": have, "missing": missing, "optional_have": opt_have,
            "urgent_used": [k for k in used if days[k] <= 3],
            "servings": servings,
            "scaled": {k: _fmt(v * scale) for k, v in req.items()},
        })
    results.sort(key=lambda x: (-x["score"], x["id"]))
    return results[:top_k]


def _fmt(x: float):
    """Làm tròn lên số nguyên (trứng, quả, củ... không chia lẻ được; gram/ml làm tròn gọn)."""
    return int(math.ceil(x - 1e-6))


def format_item(k: str, amount) -> str:
    return f"{vi_name(k)} ({amount})"
