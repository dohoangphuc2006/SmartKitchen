"""Huấn luyện YOLO nhận diện nguyên liệu (Thành viên 1, giai đoạn 7).

Chạy (sau khi đã chạy cv/audit_dataset.py để có data_checked.yaml):
    python train.py --model yolov8n.pt --name baseline_v8n --epochs 30   # baseline nhỏ
    python train.py --model yolov8s.pt --name ingredients  --epochs 30   # mô hình chính
Kết quả: runs/<name>/weights/best.pt, runs/<name>/results.csv, reports/train_config_<name>.yaml
Sau đó chạy  python cv/evaluate.py  để đánh giá, so sánh và chép mô hình tốt nhất sang models/best.pt.
"""
import argparse
import sys
import time
from pathlib import Path

import yaml
from ultralytics import YOLO

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data_checked.yaml"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="yolov8s.pt", help="yolov8n.pt / yolov8s.pt / yolo11n.pt ...")
    ap.add_argument("--name", default="ingredients", help="tên thư mục trong runs/")
    ap.add_argument("--epochs", type=int, default=30)
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--patience", type=int, default=15)
    ap.add_argument("--force", action="store_true", help="train lại dù đã có best.pt")
    args = ap.parse_args()

    if not DATA.exists():
        sys.exit("Thiếu data_checked.yaml - hãy chạy: python cv/audit_dataset.py")
    out = ROOT / "runs" / args.name
    if (out / "weights" / "best.pt").exists() and not args.force:
        sys.exit(f"Đã có {out / 'weights' / 'best.pt'} - dùng --force để train lại.")

    t0 = time.time()
    YOLO(args.model).train(
        data=str(DATA), epochs=args.epochs, imgsz=args.imgsz, batch=args.batch, workers=args.workers,
        patience=args.patience, device=0, project=str(ROOT / "runs"), name=args.name,
        exist_ok=True, plots=True, seed=0, deterministic=True,
    )
    minutes = (time.time() - t0) / 60

    # Lưu tham số huấn luyện vào reports/ (runs/ không đưa lên git)
    (ROOT / "reports").mkdir(exist_ok=True)
    cfg = {"model": args.model, "data": DATA.name, "epochs": args.epochs, "imgsz": args.imgsz,
           "batch": args.batch, "patience": args.patience, "optimizer": "auto (ultralytics)",
           "train_minutes": round(minutes, 1)}
    (ROOT / "reports" / f"train_config_{args.name}.yaml").write_text(yaml.safe_dump(cfg, sort_keys=False), encoding="utf-8")
    print(f"Xong sau {minutes:.1f} phút. Tiếp theo: python cv/evaluate.py")


if __name__ == "__main__":
    main()
