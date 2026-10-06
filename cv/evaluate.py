"""Đánh giá mô hình YOLO + phân tích lỗi (Thành viên 1, giai đoạn 7-8).

Chạy:  python cv/evaluate.py            (cần runs/ingredients/weights/best.pt hoặc models/best.pt)
Đầu ra:
  models/best.pt
  reports/metrics.json, reports/per_class_metrics.csv
  reports/figures/training_curves.png, confusion_matrix*.png, PR_curve.png, F1_curve.png (copy từ ultralytics)
  reports/error_analysis.md, reports/confusions.csv
"""
import json
import shutil
import sys
from collections import Counter
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import yaml
from PIL import Image
from ultralytics import YOLO

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = Path(__file__).resolve().parent.parent
REPORTS, FIGS = ROOT / "reports", ROOT / "reports" / "figures"
RUNS = ROOT / "runs"
DATA = ROOT / "data_checked.yaml"
IMG_EXT = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
CONF, IOU_MATCH = 0.25, 0.5


def find_weights() -> Path:
    for p in (RUNS / "ingredients" / "weights" / "best.pt", ROOT / "models" / "best.pt"):
        if p.exists():
            return p
    sys.exit("Không tìm thấy best.pt - hãy chạy train.py trước.")


def iou(a, b):
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / u if u > 0 else 0


def xywh2xyxy(x, y, w, h):
    return [x - w / 2, y - h / 2, x + w / 2, y + h / 2]


def training_curves():
    csv = RUNS / "ingredients" / "results.csv"
    if not csv.exists():
        return None
    df = pd.read_csv(csv)
    df.columns = [c.strip() for c in df.columns]
    fig, ax = plt.subplots(2, 3, figsize=(15, 8))
    for a, cols, t in zip(ax.flat,
                          [["train/box_loss", "val/box_loss"], ["train/cls_loss", "val/cls_loss"],
                           ["train/dfl_loss", "val/dfl_loss"], ["metrics/precision(B)", "metrics/recall(B)"],
                           ["metrics/mAP50(B)"], ["metrics/mAP50-95(B)"]],
                          ["Box loss", "Cls loss", "DFL loss", "Precision / Recall", "mAP@0.5", "mAP@0.5:0.95"]):
        for c in cols:
            if c in df:
                a.plot(df["epoch"], df[c], label=c.split("/")[-1])
        a.set_title(t); a.legend(); a.grid(alpha=.3)
    plt.tight_layout(); plt.savefig(FIGS / "training_curves.png", dpi=130); plt.close()
    train_time = float(df["time"].iloc[-1]) / 60 if "time" in df else None
    return {"epochs_run": int(df["epoch"].iloc[-1]), "train_minutes": train_time,
            "best_val_mAP50": float(df["metrics/mAP50(B)"].max())}


def evaluate_split(model, split, names):
    out = RUNS / f"eval_{split}"
    m = model.val(data=str(DATA), split="val" if split == "valid" else split, project=str(RUNS),
                  name=f"eval_{split}", exist_ok=True, plots=True, verbose=False)
    for f in ("confusion_matrix_normalized.png", "confusion_matrix.png", "PR_curve.png", "F1_curve.png"):
        if (out / f).exists():
            shutil.copy(out / f, FIGS / f"{split}_{f}")
    per = []
    for i, c in enumerate(m.ap_class_index):
        p, r, ap50, ap = m.class_result(i)
        per.append({"class": names[int(c)], "precision": p, "recall": r, "mAP50": ap50, "mAP50-95": ap})
    return ({"precision": float(m.box.mp), "recall": float(m.box.mr),
             "mAP50": float(m.box.map50), "mAP50-95": float(m.box.map)}, pd.DataFrame(per))


def error_analysis(model, names, split="test"):
    root = Path(yaml.safe_load(DATA.read_text(encoding="utf-8"))["path"])
    idir, ldir = root / split / "images", root / split / "labels"
    fn = Counter(); fp = Counter(); conf_pairs = Counter()
    size_tot, size_hit = Counter(), Counter()
    dark_tot = dark_hit = bright_tot = bright_hit = 0
    tp = n_gt = n_pred = 0
    for p in sorted(x for x in idir.iterdir() if x.suffix.lower() in IMG_EXT):
        lp = ldir / (p.stem + ".txt")
        gts = []
        if lp.exists():
            for l in lp.read_text(encoding="utf-8").splitlines():
                s = l.split()
                if len(s) == 5:
                    gts.append((int(s[0]), xywh2xyxy(*map(float, s[1:]))))
        with Image.open(p) as im:
            W, H = im.size
            dark = np.asarray(im.convert("L")).mean() < 90
        r = model.predict(str(p), conf=CONF, verbose=False)[0]
        preds = [(int(c), (b / np.array([W, H, W, H])).tolist(), float(s))
                 for c, b, s in zip(r.boxes.cls, r.boxes.xyxy.cpu().numpy(), r.boxes.conf)]
        used = set()
        for gc, gb in sorted(gts, key=lambda g: -(g[1][2] - g[1][0]) * (g[1][3] - g[1][1])):
            area = (gb[2] - gb[0]) * (gb[3] - gb[1])
            bucket = "small(<2%)" if area < .02 else "medium(2-15%)" if area < .15 else "large(>15%)"
            best, bj = 0, None
            for j, (pc, pb, _) in enumerate(preds):
                if j in used:
                    continue
                v = iou(gb, pb)
                if v > best:
                    best, bj = v, j
            n_gt += 1
            size_tot[bucket] += 1
            (dark_tot, bright_tot)
            if dark:
                dark_tot += 1
            else:
                bright_tot += 1
            if bj is not None and best >= IOU_MATCH:
                used.add(bj)
                if preds[bj][0] == gc:
                    tp += 1; size_hit[bucket] += 1
                    dark_hit += dark; bright_hit += (not dark)
                else:
                    conf_pairs[(names[gc], names[preds[bj][0]])] += 1; fn[names[gc]] += 1
            else:
                fn[names[gc]] += 1
        for j, (pc, _, _) in enumerate(preds):
            n_pred += 1
            if j not in used:
                fp[names[pc]] += 1
    rec = tp / max(n_gt, 1); prec = tp / max(n_pred, 1)
    lines = [f"# Error analysis ({split}, conf={CONF}, IoU>={IOU_MATCH})", "",
             f"- GT objects: {n_gt} | Predictions: {n_pred} | True positives: {tp}",
             f"- Precision (cấp object) = {prec:.3f} | Recall = {rec:.3f}", "",
             "## Recall theo kích thước vật thể", "", "| Nhóm | #GT | Recall |", "|---|---|---|"]
    for b in ("small(<2%)", "medium(2-15%)", "large(>15%)"):
        lines.append(f"| {b} | {size_tot[b]} | {size_hit[b] / max(size_tot[b], 1):.3f} |")
    lines += ["", "## Recall theo độ sáng ảnh", "", "| Nhóm | #GT | Recall |", "|---|---|---|",
              f"| Ảnh tối (mean<90) | {dark_tot} | {dark_hit / max(dark_tot, 1):.3f} |",
              f"| Ảnh sáng | {bright_tot} | {bright_hit / max(bright_tot, 1):.3f} |", "",
              "## Top class bị bỏ sót (False Negative)", ""]
    lines += [f"- {k}: {v}" for k, v in fn.most_common(8)] or ["- (không có)"]
    lines += ["", "## Top class dự đoán thừa (False Positive)", ""]
    lines += [f"- {k}: {v}" for k, v in fp.most_common(8)] or ["- (không có)"]
    lines += ["", "## Top cặp class bị nhầm (thật -> dự đoán)", ""]
    lines += [f"- {a} -> {b}: {v}" for (a, b), v in conf_pairs.most_common(8)] or ["- (không có)"]
    (REPORTS / "error_analysis.md").write_text("\n".join(lines), encoding="utf-8")
    pd.DataFrame([{"true": a, "pred": b, "count": v} for (a, b), v in conf_pairs.most_common()],
                 columns=["true", "pred", "count"]).to_csv(REPORTS / "confusions.csv", index=False)
    print("\n".join(lines))


def main():
    REPORTS.mkdir(exist_ok=True); FIGS.mkdir(exist_ok=True)
    if not DATA.exists():
        sys.exit("Thiếu data_checked.yaml - chạy cv/audit_dataset.py trước.")
    w = find_weights()
    (ROOT / "models").mkdir(exist_ok=True)
    if w != ROOT / "models" / "best.pt":
        shutil.copy(w, ROOT / "models" / "best.pt")
    model = YOLO(str(ROOT / "models" / "best.pt"))
    names = model.names

    result = {"weights": str(w.name), "train": training_curves()}
    for split in ("valid", "test"):
        m, per = evaluate_split(model, split, names)
        result[split] = m
        per.to_csv(REPORTS / f"per_class_metrics_{split}.csv", index=False)
        print(split, m)
    (REPORTS / "metrics.json").write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    error_analysis(model, names, "test")
    print("Xong. Xem thư mục", REPORTS)


if __name__ == "__main__":
    main()
