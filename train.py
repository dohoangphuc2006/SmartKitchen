"""Huấn luyện YOLOv8 nhận diện nguyên liệu trên dataset SmartKitchen.

Chạy:  python train.py --epochs 50 --model yolov8s.pt
Kết quả: models/best.pt  + runs/ (đồ thị, confusion matrix, metrics)
"""
import argparse
import shutil
from pathlib import Path

import yaml
from ultralytics import YOLO

ROOT = Path(__file__).resolve().parent
DATASET = ROOT.parent / "SmartKitchen"


def build_data_yaml() -> Path:
    """Tạo data.yaml với đường dẫn tuyệt đối (file gốc của Roboflow dùng đường dẫn tương đối sai)."""
    src = yaml.safe_load((DATASET / "data.yaml").read_text(encoding="utf-8"))
    cfg = {
        "path": str(DATASET),
        "train": "train/images",
        "val": "valid/images",
        "test": "test/images",
        "nc": src["nc"],
        "names": src["names"],
    }
    out = ROOT / "data_local.yaml"
    out.write_text(yaml.safe_dump(cfg, allow_unicode=True), encoding="utf-8")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="yolov8s.pt")
    ap.add_argument("--epochs", type=int, default=50)
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()

    data = build_data_yaml()
    model = YOLO(args.model)
    best_in_runs = ROOT / "runs" / "ingredients" / "weights" / "best.pt"
    if not best_in_runs.exists():
        model.train(
            data=str(data), epochs=args.epochs, imgsz=args.imgsz, batch=args.batch,
            workers=args.workers, device=0, project=str(ROOT / "runs"), name="ingredients",
            exist_ok=True, patience=15, plots=True, save=True
        )
    else:
        print("Đã tìm thấy mô hình huấn luyện, bỏ qua bước train.")

    best = best_in_runs
    (ROOT / "models").mkdir(exist_ok=True)
    shutil.copy(best, ROOT / "models" / "best.pt")

    # Đánh giá trên tập test
    best_model = YOLO(str(ROOT / "models" / "best.pt"))
    m = best_model.val(data=str(data), split="test", project=str(ROOT / "runs"),
                       name="test_eval", exist_ok=True)
    print(f"TEST  mAP50={m.box.map50:.3f}  mAP50-95={m.box.map:.3f}  "
          f"P={m.box.mp:.3f}  R={m.box.mr:.3f}")


if __name__ == "__main__":
    main()
