"""Đánh giá mô hình YOLO, so sánh baseline và phân tích lỗi (Thành viên 1, giai đoạn 7-8).

Chạy:  python cv/evaluate.py
- Đánh giá mọi mô hình có trong runs/*/weights/best.pt trên valid + test  -> reports/model_comparison.csv
- Chọn mô hình tốt nhất (mAP50-95 trên valid) -> models/best.pt
- Metrics, per-class, confusion matrix, PR/F1/P/R curve, training curves  -> reports/, reports/figures/
- Error analysis: class nhầm, FP, FN, vật thể nhỏ, bị che, ảnh tối, nền phức tạp -> reports/error_analysis.md
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
from PIL import Image, ImageDraw, ImageFilter
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
PLOTS = ["confusion_matrix_normalized.png", "confusion_matrix.png", "BoxPR_curve.png", "BoxF1_curve.png",
         "BoxP_curve.png", "BoxR_curve.png", "val_batch0_pred.jpg", "val_batch0_labels.jpg"]


def iou(a, b):
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / u if u > 0 else 0


def overlap_ratio(a, b):
    """Tỉ lệ diện tích của a bị b phủ lên (dùng ước lượng vật thể bị che)."""
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    area = (a[2] - a[0]) * (a[3] - a[1])
    return ix * iy / area if area > 0 else 0


def xywh2xyxy(x, y, w, h):
    return [x - w / 2, y - h / 2, x + w / 2, y + h / 2]


# ------------------------------------------------------------------ training curves
def training_curves(run: Path):
    csv = run / "results.csv"
    if not csv.exists():
        return None
    df = pd.read_csv(csv)
    df.columns = [c.strip() for c in df.columns]
    fig, ax = plt.subplots(2, 3, figsize=(15, 8))
    for a, cols, t in zip(ax.flat,
                          [["train/box_loss", "val/box_loss"], ["train/cls_loss", "val/cls_loss"],
                           ["train/dfl_loss", "val/dfl_loss"], ["metrics/precision(B)", "metrics/recall(B)"],
                           ["metrics/mAP50(B)"], ["metrics/mAP50-95(B)"]],
                          ["Box loss", "Classification loss", "DFL loss", "Precision / Recall (val)",
                           "mAP@0.5 (val)", "mAP@0.5:0.95 (val)"]):
        for c in cols:
            if c in df:
                a.plot(df["epoch"], df[c], label=c)
        a.set_title(t); a.set_xlabel("epoch"); a.legend(fontsize=8); a.grid(alpha=.3)
    plt.suptitle(f"Training curves - {run.name}")
    plt.tight_layout(); plt.savefig(FIGS / f"training_curves_{run.name}.png", dpi=130); plt.close()
    shutil.copy(csv, REPORTS / f"results_{run.name}.csv")
    if (run / "args.yaml").exists():
        shutil.copy(run / "args.yaml", REPORTS / f"train_args_{run.name}.yaml")
    return {"epochs_run": int(df["epoch"].iloc[-1]),
            "train_minutes": round(float(df["time"].iloc[-1]) / 60, 1) if "time" in df else None,
            "best_epoch": int(df.loc[df["metrics/mAP50-95(B)"].idxmax(), "epoch"])}


# ------------------------------------------------------------------ metrics
def evaluate(model, split, tag, names, plots=False):
    m = model.val(data=str(DATA), split="val" if split == "valid" else split, project=str(RUNS),
                  name=f"eval_{tag}_{split}", exist_ok=True, plots=plots, verbose=False)
    if plots:
        out = RUNS / f"eval_{tag}_{split}"
        for f in PLOTS:
            if (out / f).exists():
                shutil.copy(out / f, FIGS / f"{split}_{f}")
    per = []
    for i, c in enumerate(m.ap_class_index):
        p, r, ap50, ap = m.class_result(i)
        per.append({"class": names[int(c)], "precision": round(p, 4), "recall": round(r, 4),
                    "mAP50": round(ap50, 4), "mAP50-95": round(ap, 4)})
    res = {"precision": float(m.box.mp), "recall": float(m.box.mr),
           "mAP50": float(m.box.map50), "mAP50-95": float(m.box.map),
           "inference_ms_per_img": round(float(m.speed.get("inference", 0)), 2)}
    return res, pd.DataFrame(per)


# ------------------------------------------------------------------ error analysis
def error_analysis(model, names, split="test"):
    root = Path(yaml.safe_load(DATA.read_text(encoding="utf-8"))["path"])
    idir, ldir = root / split / "images", root / split / "labels"
    gt_rows, fp_rows, img_rows = [], [], []
    conf_pairs = Counter()
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
            g = im.convert("L")
            brightness = float(np.asarray(g).mean())
            edges = float(np.asarray(g.resize((320, 320)).filter(ImageFilter.FIND_EDGES)).mean())
        r = model.predict(str(p), conf=CONF, verbose=False)[0]
        preds = [(int(c), (b / np.array([W, H, W, H])).tolist(), float(s))
                 for c, b, s in zip(r.boxes.cls, r.boxes.xyxy.cpu().numpy(), r.boxes.conf)]
        used = set()
        n_err = 0
        for gi, (gc, gb) in enumerate(gts):
            occl = max([overlap_ratio(gb, ob) for gj, (_, ob) in enumerate(gts) if gj != gi] or [0])
            best, bj = 0, None
            for j, (pc, pb, _) in enumerate(preds):
                if j not in used and (v := iou(gb, pb)) > best:
                    best, bj = v, j
            status = "FN"
            if bj is not None and best >= IOU_MATCH:
                used.add(bj)
                if preds[bj][0] == gc:
                    status = "TP"
                else:
                    status = "WRONG_CLASS"
                    conf_pairs[(names[gc], names[preds[bj][0]])] += 1
            n_err += status != "TP"
            gt_rows.append({"image": p.name, "class": names[gc], "area": (gb[2] - gb[0]) * (gb[3] - gb[1]),
                            "occlusion": occl, "brightness": brightness, "edges": edges,
                            "n_objects": len(gts), "status": status, "box": gb})
        for j, (pc, pb, sc) in enumerate(preds):
            if j not in used:
                n_err += 1
                fp_rows.append({"image": p.name, "class": names[pc], "conf": sc, "box": pb})
        img_rows.append({"image": p.name, "errors": n_err, "path": str(p)})

    gt = pd.DataFrame(gt_rows)
    fp = pd.DataFrame(fp_rows, columns=["image", "class", "conf", "box"])
    gt["hit"] = gt.status == "TP"
    n_pred = int(gt.hit.sum() + (gt.status == "WRONG_CLASS").sum() + len(fp))

    def recall_table(col, bins, labels):
        g = gt.assign(group=pd.cut(gt[col], bins=bins, labels=labels, include_lowest=True))
        t = g.groupby("group", observed=False).hit.agg(["count", "mean"])
        return [f"| {k} | {int(v['count'])} | {v['mean']:.3f} |" for k, v in t.iterrows()]

    qa = gt.area.quantile([1 / 3, 2 / 3]).tolist()
    qb = gt.drop_duplicates("image").brightness.quantile(.25)
    qe = gt.drop_duplicates("image").edges.median()
    L = [f"# Error analysis ({split}, conf={CONF}, IoU>={IOU_MATCH})", "",
         f"- Ground-truth objects: {len(gt)} | Predictions: {n_pred}",
         f"- TP: {int(gt.hit.sum())} | Sai class: {int((gt.status == 'WRONG_CLASS').sum())} | "
         f"Bỏ sót (FN): {int((gt.status == 'FN').sum())} | Dự đoán thừa (FP): {len(fp)}",
         f"- Precision (cấp object) = {gt.hit.sum() / max(n_pred, 1):.3f} | Recall = {gt.hit.mean():.3f}", "",
         "## 1. Vật thể nhỏ (chia 3 nhóm theo diện tích box/ảnh)", "", "| Nhóm | #GT | Recall |", "|---|---|---|",
         *recall_table("area", [0, qa[0], qa[1], 1], [f"nhỏ (<{qa[0]:.2%})", f"vừa ({qa[0]:.2%}-{qa[1]:.2%})", f"lớn (>{qa[1]:.2%})"]),
         "", "## 2. Vật thể bị che (tỉ lệ diện tích bị box khác phủ)", "", "| Nhóm | #GT | Recall |", "|---|---|---|",
         *recall_table("occlusion", [0, 0.05, 0.3, 1], ["không bị che (<5%)", "che một phần (5-30%)", "che nhiều (>30%)"]),
         "", f"## 3. Ảnh tối (25% ảnh tối nhất, độ sáng TB < {qb:.0f}/255)", "", "| Nhóm | #GT | Recall |", "|---|---|---|",
         *recall_table("brightness", [0, qb, 255], ["tối", "bình thường"]),
         "", f"## 4. Nền phức tạp (mật độ cạnh > trung vị {qe:.1f})", "", "| Nhóm | #GT | Recall |", "|---|---|---|",
         *recall_table("edges", [0, qe, 255], ["nền đơn giản", "nền phức tạp"]),
         "", "## 5. Ảnh đông vật thể (số object/ảnh)", "", "| Nhóm | #GT | Recall |", "|---|---|---|",
         *recall_table("n_objects", [0, 10, 20, 1000], ["≤10", "11-20", ">20"]),
         "", "## 6. Class bị bỏ sót nhiều nhất (FN + sai class)", ""]
    miss = gt[~gt.hit].groupby("class").size().sort_values(ascending=False)
    tot = gt.groupby("class").size()
    L += [f"- {k}: {v}/{tot[k]} ({v / tot[k]:.0%})" for k, v in miss.head(8).items()] or ["- không có"]
    L += ["", "## 7. Class dự đoán thừa nhiều nhất (False Positive)", ""]
    L += [f"- {k}: {v}" for k, v in fp["class"].value_counts().head(8).items()] or ["- không có"]
    L += ["", "## 8. Cặp class bị nhầm nhiều nhất (thật → dự đoán)", ""]
    L += [f"- {a} → {b}: {v}" for (a, b), v in conf_pairs.most_common(8)] or ["- không có"]
    L += ["", "Ảnh minh họa lỗi: `figures/error_examples.png` (xanh lá = GT đúng, xanh dương = bỏ sót/sai class, đỏ = dự đoán thừa)."]
    (REPORTS / "error_analysis.md").write_text("\n".join(L), encoding="utf-8")
    pd.DataFrame([{"true": a, "pred": b, "count": v} for (a, b), v in conf_pairs.most_common()],
                 columns=["true", "pred", "count"]).to_csv(REPORTS / "confusions.csv", index=False)
    gt.drop(columns=["box"]).to_csv(REPORTS / f"error_details_{split}.csv", index=False)

    # Ảnh minh họa 6 ảnh nhiều lỗi nhất
    worst = sorted(img_rows, key=lambda x: -x["errors"])[:6]
    fig, axes = plt.subplots(2, 3, figsize=(18, 12))
    for a in axes.flat:
        a.axis("off")
    for a, w in zip(axes.flat, worst):
        im = Image.open(w["path"]).convert("RGB"); d = ImageDraw.Draw(im); Wd, Hd = im.size
        lw = max(2, Wd // 250)
        sc = lambda b: [b[0] * Wd, b[1] * Hd, b[2] * Wd, b[3] * Hd]
        for _, g in gt[gt.image == w["image"]].iterrows():
            d.rectangle(sc(g.box), outline="lime" if g.hit else "blue", width=lw)
            if not g.hit:
                d.text((g.box[0] * Wd + 3, g.box[1] * Hd + 3), g["class"], fill="cyan")
        for _, f in fp[fp.image == w["image"]].iterrows():
            d.rectangle(sc(f.box), outline="red", width=lw)
            d.text((f.box[0] * Wd + 3, f.box[3] * Hd - 12), f"{f['class']} {f.conf:.2f}", fill="red")
        a.imshow(im); a.set_title(f"{w['image'][:30]} - {w['errors']} lỗi", fontsize=9)
    plt.tight_layout(); plt.savefig(FIGS / "error_examples.png", dpi=100); plt.close()
    print("\n".join(L))


# ------------------------------------------------------------------ main
def main():
    REPORTS.mkdir(exist_ok=True); FIGS.mkdir(parents=True, exist_ok=True)
    if not DATA.exists():
        sys.exit("Thiếu data_checked.yaml - chạy cv/audit_dataset.py trước.")
    runs = sorted(p.parent.parent for p in RUNS.glob("*/weights/best.pt"))
    if not runs:
        if (ROOT / "models" / "best.pt").exists():
            runs = [None]
        else:
            sys.exit("Không tìm thấy mô hình nào - chạy train.py trước.")

    rows, results = [], {}
    for run in runs:
        w = (run / "weights" / "best.pt") if run else ROOT / "models" / "best.pt"
        tag = run.name if run else "models"
        model = YOLO(str(w))
        info = {"run": tag, "weights_MB": round(w.stat().st_size / 1e6, 1),
                "params_M": round(sum(p.numel() for p in model.model.parameters()) / 1e6, 2)}
        info.update(training_curves(run) or {} if run else {})
        for split in ("valid", "test"):
            m, _ = evaluate(model, split, tag, model.names)
            info.update({f"{split}_{k}": round(v, 4) for k, v in m.items()})
        rows.append(info); results[tag] = (w, info)
        print(info)
    comp = pd.DataFrame(rows).sort_values("valid_mAP50-95", ascending=False)
    comp.to_csv(REPORTS / "model_comparison.csv", index=False)

    best_tag = comp.iloc[0]["run"]
    best_w = results[best_tag][0]
    (ROOT / "models").mkdir(exist_ok=True)
    if best_w.resolve() != (ROOT / "models" / "best.pt").resolve():
        shutil.copy(best_w, ROOT / "models" / "best.pt")
    model = YOLO(str(ROOT / "models" / "best.pt"))
    names = model.names

    final = {"selected_model": best_tag, "selection_rule": "mAP50-95 cao nhất trên tập valid",
             **{k: v for k, v in results[best_tag][1].items()}}
    for split in ("valid", "test"):
        m, per = evaluate(model, split, "final", names, plots=True)
        final[split] = m
        per.to_csv(REPORTS / f"per_class_metrics_{split}.csv", index=False)
    if (FIGS / f"training_curves_{best_tag}.png").exists():
        shutil.copy(FIGS / f"training_curves_{best_tag}.png", FIGS / "training_curves.png")
    (REPORTS / "metrics.json").write_text(json.dumps(final, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    error_analysis(model, names, "test")
    print("\nSo sánh mô hình:\n", comp.to_string(index=False))
    print(f"\nMô hình được chọn: {best_tag} -> models/best.pt. Xem thư mục reports/")


if __name__ == "__main__":
    main()
