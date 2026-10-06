"""Module nhận diện nguyên liệu bằng YOLO (Thành viên 1 bàn giao).

Output chuẩn truyền sang Recommendation System:
    {"ingredients": [{"name": "tomato", "confidence": 0.95, "count": 2}, ...]}

Dùng từ dòng lệnh:  python -m core.detector duong_dan_anh.jpg
"""
import json
import sys
from pathlib import Path

from PIL import Image

_ROOT = Path(__file__).resolve().parent.parent
_CANDIDATES = [_ROOT / "models" / "best.pt", _ROOT / "runs" / "ingredients" / "weights" / "best.pt"]
MODEL_PATH = next((p for p in _CANDIDATES if p.exists()), _CANDIDATES[0])
_model = None


def load_model(path: Path = MODEL_PATH):
    global _model
    if _model is None:
        if not Path(path).exists():
            raise FileNotFoundError(f"Chưa có trọng số mô hình: {path}. Chạy train.py hoặc cv/evaluate.py trước.")
        from ultralytics import YOLO
        _model = YOLO(str(path))
    return _model


def detect(image: Image.Image, conf: float = 0.25, iou: float = 0.5):
    """Trả về (danh sách {name, count, max_conf}, ảnh đã vẽ khung RGB) - dùng cho giao diện."""
    model = load_model()
    res = model.predict(image, conf=conf, iou=iou, verbose=False)[0]
    names = res.names
    agg = {}
    for cls, c in zip(res.boxes.cls.tolist(), res.boxes.conf.tolist()):
        n = names[int(cls)]
        d = agg.setdefault(n, {"name": n, "count": 0, "max_conf": 0.0})
        d["count"] += 1
        d["max_conf"] = max(d["max_conf"], c)
    annotated = Image.fromarray(res.plot()[..., ::-1])  # BGR -> RGB
    items = sorted(agg.values(), key=lambda x: -x["count"])
    return items, annotated


def detect_ingredients(image, conf: float = 0.25, iou: float = 0.5) -> dict:
    """Nhận PIL.Image hoặc đường dẫn ảnh; trả về dict theo chuẩn giao tiếp giữa 2 module."""
    if not isinstance(image, Image.Image):
        image = Image.open(image).convert("RGB")
    items, _ = detect(image, conf=conf, iou=iou)
    return {"ingredients": [{"name": i["name"], "confidence": round(i["max_conf"], 4), "count": i["count"]}
                            for i in sorted(items, key=lambda x: -x["max_conf"])]}


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("Cách dùng: python -m core.detector <anh.jpg> [conf]")
    out = detect_ingredients(sys.argv[1], float(sys.argv[2]) if len(sys.argv) > 2 else 0.25)
    print(json.dumps(out, ensure_ascii=False, indent=2))
