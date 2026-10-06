"""Sinh công thức bằng LLM (Google Gemini, tùy chọn). Cần biến môi trường GEMINI_API_KEY."""
import json
import os
import urllib.request

from .ingredients import vi_name

MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")


def available() -> bool:
    return bool(os.environ.get("GEMINI_API_KEY"))


def generate_recipe(pantry_days: dict, servings: int, preference: str = ""):
    """pantry_days: {key: số ngày còn lại}. Trả về dict công thức hoặc ném lỗi."""
    key = os.environ["GEMINI_API_KEY"]
    lines = [f"- {vi_name(k)} (còn {d} ngày)" for k, d in pantry_days.items()]
    prompt = (
        "Bạn là đầu bếp. Dựa trên nguyên liệu trong tủ lạnh dưới đây, hãy đề xuất 1 món ăn Việt/quốc tế "
        f"cho {servings} người, ưu tiên dùng nguyên liệu sắp hết hạn. Chỉ được thêm gia vị cơ bản.\n"
        + "\n".join(lines) + (f"\nYêu cầu thêm: {preference}" if preference else "") +
        '\nTrả lời JSON: {"name":str,"time":int,"ingredients":[str],"steps":[str],"tips":str}'
    )
    body = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"responseMimeType": "application/json"},
    }).encode()
    req = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={key}",
        data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read())
    return json.loads(data["candidates"][0]["content"]["parts"][0]["text"])
