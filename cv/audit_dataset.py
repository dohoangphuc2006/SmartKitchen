"""Kiểm định toàn bộ dataset ảnh (Thành viên 1, giai đoạn 1-6).

Chạy:  python cv/audit_dataset.py
Đầu ra (thư mục reports/):
  class_stats.csv, imbalance_report.txt, image_stats.csv, broken_images.csv, label_errors.csv,
  exact_duplicates.csv, possible_near_duplicates.csv, data_leakage.csv, summary.md
  figures/*.png, và data_checked.yaml (ở thư mục gốc dự án)
Dataset gốc KHÔNG bị sửa.
"""
import hashlib
import json
import random
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import yaml
from PIL import Image, ImageDraw

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = Path(__file__).resolve().parent.parent
DATASET = ROOT.parent / "SmartKitchen"
REPORTS = ROOT / "reports"
FIGS = REPORTS / "figures"
SPLITS = {"train": "train", "valid": "valid", "test": "test"}
IMG_EXT = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
MIN_SIDE = 64          # ảnh nhỏ hơn mức này bị coi là bất thường
NEAR_DUP_HAMMING = 4   # dHash 64-bit: khoảng cách <= 4 coi là gần giống


def dhash(img: Image.Image) -> int:
    g = img.convert("L").resize((9, 8), Image.LANCZOS)
    a = np.asarray(g, dtype=np.int16)
    bits = (a[:, 1:] > a[:, :-1]).flatten()
    return int("".join("1" if b else "0" for b in bits), 2)


def md5(p: Path) -> str:
    return hashlib.md5(p.read_bytes()).hexdigest()


def main():
    REPORTS.mkdir(exist_ok=True)
    FIGS.mkdir(exist_ok=True)
    cfg = yaml.safe_load((DATASET / "data.yaml").read_text(encoding="utf-8"))
    names = cfg["names"]
    nc = len(names)
    assert nc == cfg["nc"], "nc trong data.yaml không khớp số tên class"

    img_rows, broken, label_errs, boxes = [], [], [], []
    hashes = {}  # (split, name) -> (md5, dhash)

    # ---------- Giai đoạn 1-3: quét ảnh + nhãn ----------
    for split in SPLITS:
        idir, ldir = DATASET / split / "images", DATASET / split / "labels"
        if not idir.exists():
            continue
        images = sorted(p for p in idir.iterdir() if p.suffix.lower() in IMG_EXT)
        stems = {p.stem for p in images}
        for lp in sorted(ldir.glob("*.txt")):           # label không có ảnh
            if lp.stem not in stems:
                label_errs.append((split, lp.name, 0, "label không có ảnh"))
        for p in images:
            size = p.stat().st_size
            w = h = 0
            reason = None
            if size == 0:
                reason = "ảnh 0 byte"
            else:
                try:
                    with Image.open(p) as im:
                        im.verify()
                    with Image.open(p) as im:
                        w, h = im.size
                        hashes[(split, p.name)] = (md5(p), dhash(im))
                    if min(w, h) < MIN_SIDE:
                        reason = f"ảnh quá nhỏ ({w}x{h})"
                except Exception as e:
                    reason = f"không đọc được: {type(e).__name__}"
            if reason:
                broken.append((split, p.name, reason))
            lp = ldir / (p.stem + ".txt")
            n_obj = 0
            if not lp.exists():
                label_errs.append((split, p.name, 0, "ảnh không có label"))
            else:
                lines = [l for l in lp.read_text(encoding="utf-8").splitlines() if l.strip()]
                if not lines:
                    label_errs.append((split, lp.name, 0, "label rỗng"))
                for i, line in enumerate(lines, 1):
                    parts = line.split()
                    if len(parts) != 5:
                        label_errs.append((split, lp.name, i, f"sai số cột ({len(parts)})"))
                        continue
                    try:
                        c = int(float(parts[0]))
                        x, y, bw, bh = map(float, parts[1:])
                    except ValueError:
                        label_errs.append((split, lp.name, i, "giá trị không phải số"))
                        continue
                    if not (0 <= c < nc):
                        label_errs.append((split, lp.name, i, f"class_id ngoài phạm vi ({c})"))
                        continue
                    if not all(0 <= v <= 1 for v in (x, y, bw, bh)):
                        label_errs.append((split, lp.name, i, "giá trị ngoài [0,1]"))
                        continue
                    if bw <= 0 or bh <= 0:
                        label_errs.append((split, lp.name, i, "bounding box rộng/cao <= 0"))
                        continue
                    n_obj += 1
                    boxes.append((split, p.name, c, x, y, bw, bh))
            img_rows.append({"split": split, "image": p.name, "width": w, "height": h,
                             "bytes": size, "n_objects": n_obj})

    imgs = pd.DataFrame(img_rows)
    bx = pd.DataFrame(boxes, columns=["split", "image", "cls", "x", "y", "w", "h"])
    imgs.to_csv(REPORTS / "image_stats.csv", index=False)
    pd.DataFrame(broken, columns=["split", "image", "reason"]).to_csv(REPORTS / "broken_images.csv", index=False)
    pd.DataFrame(label_errs, columns=["split", "file", "line", "error"]).to_csv(REPORTS / "label_errors.csv", index=False)

    # ---------- Giai đoạn 1: thống kê class ----------
    rows = []
    for c, n in enumerate(names):
        sub = bx[bx.cls == c]
        rows.append({"class_id": c, "class": n, "objects": len(sub), "images": sub.image.nunique() if len(sub) else 0,
                     **{f"objects_{s}": int((sub.split == s).sum()) for s in SPLITS}})
    cs = pd.DataFrame(rows)
    cs.to_csv(REPORTS / "class_stats.csv", index=False)
    mx, mn = cs.objects.max(), max(cs.objects.min(), 1)
    low = cs[cs.objects < 0.25 * cs.objects.median()]
    rep = [f"Tổng ảnh: {len(imgs)} | Tổng object: {len(bx)} | Số class: {nc}",
           f"Object/class: min={cs.objects.min()} ({cs.loc[cs.objects.idxmin(), 'class']}), "
           f"max={mx} ({cs.loc[cs.objects.idxmax(), 'class']}), median={cs.objects.median():.0f}",
           f"Imbalance ratio (max/min) = {mx / mn:.1f}",
           "Class hiếm (< 25% median): " + (", ".join(f"{r['class']}({r.objects})" for _, r in low.iterrows()) or "không có"),
           "Class không có mặt ở valid/test: " + (", ".join(cs[(cs.objects_valid == 0) | (cs.objects_test == 0)]["class"]) or "không có")]
    (REPORTS / "imbalance_report.txt").write_text("\n".join(rep), encoding="utf-8")

    # ---------- Giai đoạn 4: duplicate / leakage ----------
    keys = list(hashes)
    by_md5 = {}
    for k in keys:
        by_md5.setdefault(hashes[k][0], []).append(k)
    exact = [(m, *[f"{s}/{n}" for s, n in ks]) for m, ks in by_md5.items() if len(ks) > 1]
    exact_rows = [{"md5": m, "files": " | ".join(f)} for m, *f in exact]
    pd.DataFrame(exact_rows, columns=["md5", "files"]).to_csv(REPORTS / "exact_duplicates.csv", index=False)

    leak_rows = [{"type": "exact", "a": f"{a[0]}/{a[1]}", "b": f"{b[0]}/{b[1]}", "hamming": 0}
                 for ks in by_md5.values() for i, a in enumerate(ks) for b in ks[i + 1:] if a[0] != b[0]]

    arr = np.array([hashes[k][1] for k in keys], dtype=np.uint64)
    pop = np.array([bin(i).count("1") for i in range(256)], dtype=np.uint8)
    near_rows = []
    for i in range(len(keys) - 1):
        x = np.bitwise_xor(arr[i + 1:], arr[i])
        d = pop[x.view(np.uint8).reshape(-1, 8)].sum(axis=1)
        for j in np.nonzero(d <= NEAR_DUP_HAMMING)[0]:
            a, b = keys[i], keys[i + 1 + j]
            if hashes[a][0] == hashes[b][0]:
                continue  # đã tính ở exact
            row = {"a": f"{a[0]}/{a[1]}", "b": f"{b[0]}/{b[1]}", "hamming": int(d[j])}
            near_rows.append(row)
            if a[0] != b[0]:
                leak_rows.append({"type": "near", **row})
    pd.DataFrame(near_rows, columns=["a", "b", "hamming"]).to_csv(REPORTS / "possible_near_duplicates.csv", index=False)
    pd.DataFrame(leak_rows, columns=["type", "a", "b", "hamming"]).to_csv(REPORTS / "data_leakage.csv", index=False)
    n_exact_leak = sum(r["type"] == "exact" for r in leak_rows)
    n_near_leak = sum(r["type"] == "near" for r in leak_rows)

    # ---------- Giai đoạn 2/5: biểu đồ ----------
    sc = imgs.split.value_counts().reindex(list(SPLITS)).dropna()
    plt.figure(figsize=(5, 5))
    plt.pie(sc, labels=[f"{k} ({v})" for k, v in sc.items()], autopct="%1.1f%%")
    plt.title("Số ảnh Train / Valid / Test")
    plt.savefig(FIGS / "split_distribution.png", dpi=130, bbox_inches="tight"); plt.close()

    o = cs.sort_values("objects", ascending=False)
    fig, ax = plt.subplots(1, 2, figsize=(16, 6))
    ax[0].bar(o["class"], o.objects, color="steelblue"); ax[0].set_title("Số object theo class")
    ax[1].bar(o["class"], o.images, color="darkorange"); ax[1].set_title("Số ảnh chứa class")
    for a in ax:
        a.tick_params(axis="x", rotation=70)
    plt.tight_layout(); plt.savefig(FIGS / "class_distribution.png", dpi=130); plt.close()

    ok = imgs[imgs.width > 0]
    fig, ax = plt.subplots(1, 3, figsize=(16, 4.5))
    ax[0].scatter(ok.width, ok.height, s=6, alpha=.4); ax[0].set_xlabel("width"); ax[0].set_ylabel("height"); ax[0].set_title("Kích thước ảnh")
    ax[1].hist(ok.width / ok.height, bins=30); ax[1].set_title("Tỉ lệ khung hình (w/h)")
    ax[2].hist(imgs.n_objects, bins=range(0, int(imgs.n_objects.max()) + 2)); ax[2].set_title("Số object / ảnh")
    plt.tight_layout(); plt.savefig(FIGS / "image_size_distribution.png", dpi=130); plt.close()

    if len(bx):
        plt.figure(figsize=(6, 4))
        plt.hist(bx.w * bx.h, bins=50); plt.xlabel("diện tích box / diện tích ảnh"); plt.title("Kích thước bounding box")
        plt.savefig(FIGS / "bbox_area_distribution.png", dpi=130, bbox_inches="tight"); plt.close()

    # 16 ảnh mẫu có vẽ bbox
    random.seed(0)
    sample = random.sample(list(imgs[imgs.n_objects > 0].itertuples()), min(16, int((imgs.n_objects > 0).sum())))
    fig, axes = plt.subplots(4, 4, figsize=(16, 16))
    for a in axes.flat:
        a.axis("off")
    for a, r in zip(axes.flat, sample):
        im = Image.open(DATASET / r.split / "images" / r.image).convert("RGB")
        d = ImageDraw.Draw(im)
        W, H = im.size
        for b in bx[(bx.split == r.split) & (bx.image == r.image)].itertuples():
            x1, y1, x2, y2 = (b.x - b.w / 2) * W, (b.y - b.h / 2) * H, (b.x + b.w / 2) * W, (b.y + b.h / 2) * H
            d.rectangle([x1, y1, x2, y2], outline="red", width=max(2, W // 200))
            d.text((x1 + 3, y1 + 3), names[b.cls], fill="yellow")
        a.imshow(im); a.set_title(f"{r.split}/{r.image[:20]}", fontsize=7)
    plt.tight_layout(); plt.savefig(FIGS / "sample_bounding_boxes.png", dpi=110); plt.close()

    # ---------- Giai đoạn 6: làm sạch (không ghi đè dataset gốc) + data_checked.yaml ----------
    critical = len(broken) + len(label_errs)
    ready = critical == 0
    drop = {(s, n) for s, n, _ in broken}
    for ks in by_md5.values():                     # ảnh trùng hoàn toàn: giữ 1 bản
        ks = sorted(ks, key=lambda k: {"test": 0, "valid": 1, "train": 2}[k[0]])  # ưu tiên giữ ở test/valid
        drop.update(k for k in ks[1:] if k[0] == "train")
    for r in leak_rows:                            # ảnh gần giống lọt giữa các split: bỏ bản ở train
        for side in ("a", "b"):
            s, n = r[side].split("/", 1)
            if s == "train":
                drop.add((s, n))
    splits_dir = ROOT / "data" / "splits"
    splits_dir.mkdir(parents=True, exist_ok=True)
    train_clean = [str(DATASET / "train" / "images" / n) for s, n in zip(imgs.split, imgs.image)
                   if s == "train" and (s, n) not in drop]
    (splits_dir / "train_clean.txt").write_text("\n".join(train_clean) + "\n", encoding="utf-8")
    pd.DataFrame(sorted(drop), columns=["split", "image"]).to_csv(REPORTS / "removed_images.csv", index=False)
    checked = {"path": str(DATASET), "train": str(splits_dir / "train_clean.txt"),
               "val": "valid/images", "test": "test/images", "nc": nc, "names": names}
    (ROOT / "data_checked.yaml").write_text(yaml.safe_dump(checked, allow_unicode=True, sort_keys=False), encoding="utf-8")
    (REPORTS / "classes.txt").write_text("\n".join(names) + "\n", encoding="utf-8")  # danh sách class chuẩn bàn giao cho Người 2

    summary = {"images": len(imgs), "objects": len(bx), "classes": nc, "broken_images": len(broken),
               "label_errors": len(label_errs), "exact_duplicate_groups": len(exact),
               "near_duplicate_pairs": len(near_rows), "leakage_exact": n_exact_leak,
               "leakage_near": n_near_leak, "removed_from_train": len(drop),
               "train_images_clean": len(train_clean), "ready_for_training": ready}
    (REPORTS / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    md = ["# Dataset audit summary", "", "| Mục | Giá trị |", "|---|---|"] + [f"| {k} | {v} |" for k, v in summary.items()]
    md += ["", "## Imbalance", "```", *rep, "```",
           "", "## Data leakage", "", "Các cặp ảnh trùng/gần giống giữa các split (xem data_leakage.csv):", ""]
    md += [f"- {r['type']}: `{r['a']}` ↔ `{r['b']}` (hamming={r['hamming']})" for r in leak_rows] or ["- không có"]
    md += ["", f"Đã loại {len(drop)} ảnh khỏi tập train (trùng lặp/leakage) → `data/splits/train_clean.txt`. "
           "Dataset gốc giữ nguyên.", "", f"**READY FOR TRAINING: {'YES' if ready else 'NO'}**"]
    (REPORTS / "summary.md").write_text("\n".join(md), encoding="utf-8")

    print("\n".join(rep))
    print(json.dumps(summary, indent=2))
    print("READY FOR TRAINING:", "YES" if ready else "NO (xem broken_images.csv / label_errors.csv)")
    if n_exact_leak or n_near_leak:
        print(f"CANH BAO: {n_exact_leak} cap leakage chinh xac, {n_near_leak} cap gan giong giua cac split -> xem data_leakage.csv")


if __name__ == "__main__":
    main()
