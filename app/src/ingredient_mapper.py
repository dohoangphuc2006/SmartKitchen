"""Giai đoạn 3: đối chiếu class YOLO với vocabulary nguyên liệu, chỉ đọc nguồn.

Chạy: python src/ingredient_mapper.py --root <thu_muc_du_an>
File mapping/yolo_class_source.yaml là bản sao nguyên byte của data_checked.yaml
tại commit cố định của Thành viên 1. Git blob SHA được kiểm tra trước khi xử lý.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import re
from collections import defaultdict
from difflib import SequenceMatcher
from pathlib import Path

import pandas as pd


LOG = logging.getLogger("ingredient_mapper")
REPO = "https://github.com/dohoangphuc2006/SmartKitchen"
COMMIT = "91b995eb1feac79b2eee6f1b36bff20e10a7b17b"
SOURCE_PATH = "data_checked.yaml"
SOURCE_BLOB_SHA = "fb278c11b75708252cfd5fc1bbe1a6785583f4e7"
CLASSES_TXT_BLOB_SHA = "2cf5818b6a49731a1e6381cbd564a246621ea597"
LOW_COVERAGE_PCT = 1.0

MAPPING_COLUMNS = [
    "class_id", "yolo_class", "standard_ingredient", "match_type",
    "confidence", "aliases", "review_required", "notes",
]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def git_blob_sha(path: Path) -> str:
    raw = path.read_bytes()
    return hashlib.sha1(f"blob {len(raw)}\0".encode() + raw).hexdigest()


def normalized(value: str) -> str:
    """Chuẩn hóa tạm cho phép so sánh; không ghi đè chuỗi nguồn."""
    return " ".join(re.sub(r"[_‐‑‒–—-]+", " ", value.lower().strip()).split())


def load_classes(path: Path) -> list[str]:
    if git_blob_sha(path) != SOURCE_BLOB_SHA:
        raise ValueError(f"Snapshot class khác Git blob chính thức: {path}")
    lines = path.read_text(encoding="utf-8-sig").splitlines()
    nc = None
    names: list[str] = []
    in_names = False
    for line in lines:
        if re.fullmatch(r"nc:\s*\d+\s*", line):
            nc = int(line.split(":", 1)[1].strip())
        elif line.strip() == "names:":
            in_names = True
        elif in_names and re.fullmatch(r"\s*-\s*[A-Za-z][A-Za-z0-9_-]*\s*", line):
            names.append(line.split("-", 1)[1].strip())
        elif in_names and line.strip():
            raise ValueError(f"Dòng tên class không hợp lệ: {line}")
    if nc is None or len(names) != nc or len(set(names)) != nc:
        raise ValueError("nc, số class hoặc tính duy nhất của class không hợp lệ")
    return names


def check_local_data_yaml(root: Path, classes: list[str]) -> str:
    """Đối chiếu bản Roboflow cục bộ nếu có, không dùng làm nguồn chính."""
    local = root / "Fridge detection.v1i.yolov8" / "data.yaml"
    if not local.exists():
        return "Không có data.yaml cục bộ để đối chiếu"
    import ast

    lines = local.read_text(encoding="utf-8-sig").splitlines()
    names_line = next((x for x in lines if x.startswith("names:")), None)
    if names_line is None:
        return "data.yaml cục bộ không có trường names"
    try:
        local_names = ast.literal_eval(names_line.split(":", 1)[1].strip())
    except (SyntaxError, ValueError):
        return "Không đọc được names trong data.yaml cục bộ"
    return "Trùng đủ 30 class và thứ tự" if local_names == classes else "KHÁC class/thứ tự so với nguồn chính thức"


def load_vocabulary(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path, dtype=str, keep_default_na=False)
    required = {"ingredient_clean", "count", "recipe_count"}
    if not required.issubset(df.columns):
        raise ValueError(f"Vocabulary thiếu cột: {sorted(required - set(df.columns))}")
    if df["ingredient_clean"].eq("").any() or df["ingredient_clean"].duplicated().any():
        raise ValueError("Vocabulary có tên rỗng hoặc trùng")
    for col in ("count", "recipe_count"):
        df[col] = pd.to_numeric(df[col], errors="raise").astype(int)
        if (df[col] < 0).any():
            raise ValueError(f"Cột {col} có giá trị âm")
    return df


def load_aliases(path: Path, vocab_names: set[str]) -> tuple[dict[str, list[str]], dict[str, str]]:
    aliases = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(aliases, dict):
        raise ValueError("ingredient_aliases.json phải là object")
    lookup: dict[str, str] = {}
    for canonical, variants in aliases.items():
        if canonical not in vocab_names or not isinstance(variants, list):
            raise ValueError(f"Alias canonical không có trong vocabulary: {canonical}")
        for variant in variants + [canonical]:
            key = normalized(variant)
            if key in lookup and lookup[key] != canonical:
                raise ValueError(f"Alias nhập nhằng: {variant}")
            lookup[key] = canonical
    return aliases, lookup


def fuzzy_score(a: str, b: str) -> float:
    # SequenceMatcher được dùng để gợi ý; score không bao giờ tự chấp nhận mapping.
    return round(100 * SequenceMatcher(None, normalized(a), normalized(b)).ratio(), 1)


def candidate_rows(yolo_class: str, vocab: pd.DataFrame) -> list[dict]:
    """Tạo hàng rà soát cho class chưa map, không chọn ứng viên theo score."""
    records = vocab[["ingredient_clean", "recipe_count"]].to_dict("records")
    ranked = sorted(
        ((fuzzy_score(yolo_class, r["ingredient_clean"]), r["ingredient_clean"], r["recipe_count"])
         for r in records),
        key=lambda x: (-x[0], -x[2], x[1]),
    )
    result = []
    seen = set()
    for score, name, _ in ranked:
        if score < 80 or len(result) == 5:
            break
        seen.add(name)
        result.append({"yolo_class": yolo_class, "candidate": name, "score": score,
                       "reason": "Fuzzy >= 90: ứng viên mạnh" if score >= 90 else "Fuzzy 80–89: cần rà soát ngữ nghĩa"})

    # 'beef' là class tổng quát; các tên bên dưới là bộ phận/chế phẩm khác nhau.
    # Luôn trình bày để người phụ trách quyết định cách biểu diễn, không tự ép map.
    if yolo_class == "beef":
        preferred = ["ground beef", "beef tenderloin", "beef brisket", "beef chuck", "beef short ribs"]
        present = set(vocab["ingredient_clean"])
        for name in preferred:
            if name in present and name not in seen:
                result.append({"yolo_class": yolo_class, "candidate": name,
                               "score": fuzzy_score(yolo_class, name),
                               "reason": "Biến thể thịt bò; không đồng nghĩa với class beef tổng quát"})
    if not result:
        result.append({"yolo_class": yolo_class, "candidate": "", "score": 0.0,
                       "reason": "Không có ứng viên đồng nghĩa đủ chắc chắn"})
    return result


def make_mapping(classes: list[str], vocab: pd.DataFrame, aliases: dict,
                 alias_lookup: dict) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    names = set(vocab["ingredient_clean"])
    by_normalized: dict[str, list[str]] = defaultdict(list)
    for name in names:
        by_normalized[normalized(name)].append(name)
    rows, unmatched, review = [], [], []
    for class_id, cls in enumerate(classes):
        key = normalized(cls)
        exact = [cls] if cls in names else sorted(by_normalized.get(key, []))
        matched, kind, confidence, note = "", "UNMATCHED", 0.0, ""
        if len(exact) == 1:
            matched, kind, confidence = exact[0], "EXACT", 1.0
            if cls != matched:
                note = "Khớp sau chuẩn hóa chữ thường/khoảng trắng/_/dấu gạch nối"
        elif len(exact) > 1:
            note = "Nhiều ingredient cùng dạng chuẩn hóa; cần chọn thủ công"
        elif key in alias_lookup:
            matched, kind, confidence = alias_lookup[key], "ALIAS", 0.99
            note = "Biến thể số nhiều hoặc đồng nghĩa tường minh"
        else:
            note = "Không có ingredient đồng nghĩa chắc chắn trong vocabulary"

        if kind == "UNMATCHED":
            unmatched.append({"class_id": class_id, "yolo_class": cls, "reason": note})
            review.extend(candidate_rows(cls, vocab))
            LOG.warning("Chưa map class %s", cls)

        variants = aliases.get(matched, []) if matched else []
        rows.append({"class_id": class_id, "yolo_class": cls,
                     "standard_ingredient": matched, "match_type": kind,
                     "confidence": f"{confidence:.2f}",
                     "aliases": "|".join(variants),
                     "review_required": kind == "UNMATCHED", "notes": note})
    return (pd.DataFrame(rows, columns=MAPPING_COLUMNS),
            pd.DataFrame(unmatched, columns=["class_id", "yolo_class", "reason"]),
            pd.DataFrame(review, columns=["yolo_class", "candidate", "score", "reason"]))


def make_conflicts(mapping: pd.DataFrame) -> pd.DataFrame:
    rows = []
    accepted = mapping[mapping["match_type"] != "UNMATCHED"]
    for target, group in accepted.groupby("standard_ingredient", sort=True):
        if len(group) > 1:
            rows.append({"conflict_type": "MANY_CLASSES_ONE_INGREDIENT",
                         "yolo_classes": "|".join(group["yolo_class"]),
                         "standard_ingredients": target,
                         "reason": "Nhiều class cùng đích; cần kiểm tra mất thông tin",
                         "status": "NEEDS_REVIEW"})
    # Các cặp cha/con không đụng cùng đích, nhưng dễ bị gộp sai ở bước tiếp theo.
    pairs = [("chicken", "chicken_breast"), ("cheese", "goat_cheese"),
             ("beef", "ground_beef")]
    lookup = mapping.set_index("yolo_class").to_dict("index")
    for broad, specific in pairs:
        if broad in lookup and specific in lookup:
            target_a = lookup[broad]["standard_ingredient"]
            target_b = lookup[specific]["standard_ingredient"]
            rows.append({"conflict_type": "POTENTIAL_INFORMATION_LOSS",
                         "yolo_classes": f"{broad}|{specific}",
                         "standard_ingredients": "|".join(x for x in [target_a, target_b] if x),
                         "reason": "Quan hệ tổng quát/cụ thể; giữ class riêng, không gộp tự động",
                         "status": "DOCUMENTED" if target_a and target_b else "NEEDS_REVIEW"})
    return pd.DataFrame(rows, columns=["conflict_type", "yolo_classes",
                                       "standard_ingredients", "reason", "status"])


def count_recipes(path: Path, mapped_names: set[str]) -> tuple[int, dict[int, int], dict[str, int], int, int]:
    df = pd.read_csv(path, usecols=["row_id", "ingredients_clean", "ready_for_mapping"],
                     dtype=str, keep_default_na=False)
    if df["row_id"].eq("").any() or df["row_id"].duplicated().any():
        raise ValueError("row_id trong recipes_cleaned không duy nhất")
    per_ingredient = {name: 0 for name in mapped_names}
    thresholds = {1: 0, 2: 0, 3: 0}
    ready_total = ready_with_match = 0
    for row in df.itertuples(index=False):
        try:
            ingredients = json.loads(row.ingredients_clean)
        except (json.JSONDecodeError, TypeError) as exc:
            raise ValueError(f"ingredients_clean không phải JSON ở row_id={row.row_id}") from exc
        if not isinstance(ingredients, list) or not all(isinstance(x, str) for x in ingredients):
            raise ValueError(f"ingredients_clean không phải list[str] ở row_id={row.row_id}")
        present = set(ingredients) & mapped_names
        for name in present:
            per_ingredient[name] += 1
        for threshold in thresholds:
            thresholds[threshold] += len(present) >= threshold
        if row.ready_for_mapping == "True":
            ready_total += 1
            ready_with_match += bool(present)
    return len(df), thresholds, per_ingredient, ready_total, ready_with_match


def pct(part: int, whole: int) -> float:
    return round(100 * part / whole, 2) if whole else 0.0


def build_report(root: Path, mapping: pd.DataFrame, unmatched: pd.DataFrame,
                 review: pd.DataFrame, conflicts: pd.DataFrame, class_coverage: pd.DataFrame,
                 vocab_count: int, total_recipes: int, thresholds: dict[int, int],
                 ready_total: int, ready_with_match: int, local_compare: str,
                 stage2_metrics: dict) -> str:
    counts = mapping["match_type"].value_counts().to_dict()
    exact, alias, fuzzy = (int(counts.get(x, 0)) for x in ("EXACT", "ALIAS", "FUZZY"))
    n_unmatched = int(counts.get("UNMATCHED", 0))
    mapped = exact + alias + fuzzy
    coverage = pct(mapped, len(mapping))
    recipe_coverage = pct(thresholds[1], total_recipes)
    if coverage >= 90 and recipe_coverage >= 60:
        compatibility = "GOOD"
    elif coverage >= 70 and recipe_coverage >= 30:
        compatibility = "MEDIUM"
    else:
        compatibility = "POOR"
    low = class_coverage[class_coverage["recipe_percentage"] < LOW_COVERAGE_PCT]
    ordered = class_coverage.sort_values(["recipe_count", "class_id"], ascending=[False, True])
    best = ordered.iloc[0]
    worst = ordered.iloc[-1]
    actual_conflicts = int((conflicts["conflict_type"] == "MANY_CLASSES_ONE_INGREDIENT").sum())
    review_classes = int(review["yolo_class"].nunique())
    stage2_review = int(stage2_metrics["review_recipe_count"])
    # Gate cho toàn bộ dataset: class chưa map và recipe Stage 2 cần rà soát đều phải xử lý.
    ready = (n_unmatched == 0 and review_classes == 0 and actual_conflicts == 0
             and stage2_review == 0 and recipe_coverage >= 50)
    issues = []
    if n_unmatched:
        issues.append(f"{n_unmatched} class chưa có đích: {', '.join(unmatched['yolo_class'])}.")
    if stage2_review:
        issues.append(f"{stage2_review:,} recipe bị gắn cờ cần rà soát ở Giai đoạn 2.")
    if recipe_coverage < 50:
        issues.append("Recipe coverage < 50% theo so khớp tên ingredient_clean chính xác.")
    issues.append("Đếm recipe theo tên chuẩn chính xác; các biến thể như unsalted butter, red onion,"
                  " beef cut không được suy diễn thành nguyên liệu cha.")
    lines = [
        "INGREDIENT MAPPING REPORT", "=========================", "",
        f"1. YOLO repository: {REPO} (main, commit {COMMIT})",
        f"2. YOLO class source file: {SOURCE_PATH} (Git blob {SOURCE_BLOB_SHA})",
        "   train.py + reports/train_args_ingredients.yaml trỏ tới data_checked.yaml;",
        f"   reports/classes.txt cùng 30 tên/thứ tự (Git blob {CLASSES_TXT_BLOB_SHA}).",
        f"   data.yaml Roboflow cục bộ: {local_compare}.",
        f"3. Tổng YOLO class: {len(mapping)}",
        f"4. Tổng ingredient vocabulary: {vocab_count:,}", "",
        f"5. Exact matches: {exact}", f"6. Alias matches: {alias}",
        f"7. Fuzzy matches accepted: {fuzzy}",
        f"8. Need review: {review_classes} class ({len(review)} dòng ứng viên)",
        f"9. Unmatched: {n_unmatched}",
        f"10. Mapping coverage: {mapped}/{len(mapping)} = {coverage:.2f}%", "",
        f"11. Tổng recipe: {total_recipes:,}",
        f"12. Recipe chứa >=1 YOLO ingredient: {thresholds[1]:,} ({pct(thresholds[1], total_recipes):.2f}%)",
        f"13. Recipe chứa >=2 YOLO ingredients: {thresholds[2]:,} ({pct(thresholds[2], total_recipes):.2f}%)",
        f"14. Recipe chứa >=3 YOLO ingredients: {thresholds[3]:,} ({pct(thresholds[3], total_recipes):.2f}%)",
        f"    Recipe Stage 2 ready_for_mapping=True: {ready_total:,}; trong đó >=1 match: {ready_with_match:,}",
        f"15. Class xuất hiện nhiều nhất: {best['yolo_class']} - {best['recipe_count']:,} recipe",
        f"16. Class xuất hiện ít nhất: {worst['yolo_class']} - {worst['recipe_count']:,} recipe", "",
        f"17. Mapping conflicts: {actual_conflicts} đụng đích thực tế; "
        f"{len(conflicts) - actual_conflicts} quan hệ có nguy cơ mất thông tin.",
        f"18. Mapping cần review: {', '.join(sorted(review['yolo_class'].unique())) or 'Không có'}",
        f"19. Class không map được: {', '.join(unmatched['yolo_class']) or 'Không có'}", "",
        f"20. Mức độ tương thích YOLO ↔ Recipe Dataset: {compatibility}",
        "    Quy ước: GOOD nếu mapping >=90% và recipe coverage >=60%;",
        "    MEDIUM nếu >=70% và >=30%; còn lại POOR.",
        f"21. Dataset đã sẵn sàng cho Recommendation Baseline trên toàn bộ recipe: {'YES' if ready else 'NO'}",
        f"    READY FOR STAGE 4: {'YES' if ready else 'NO'}",
        "    Gate: không còn class/review mapping chưa giải quyết, không còn recipe Stage 2 cần review,",
        "    recipe coverage >=50%, không có conflict đụng đích.",
        "22. Các vấn đề còn tồn tại:",
        *[f"    - {x}" for x in issues],
        f"    - {len(low)} class đã map có LOW RECIPE COVERAGE (<{LOW_COVERAGE_PCT:.0f}% recipe): "
        + ", ".join(f"{r.yolo_class}={r.recipe_count}" for r in low.itertuples(index=False)),
        "23. Đề xuất:",
        "    - Thành viên 1 xác nhận class beef tổng quát có cần ánh xạ sang các biến thể thịt bò.",
        "    - Rà soát recipe/item bị gắn cờ ở Giai đoạn 2 và đánh giá alias phân cấp riêng trước baseline.",
        "    - Nếu chạy baseline trên tập con, chỉ dùng mapping đã chấp nhận và nêu rõ phạm vi recipe.",
        "", "Phương pháp:",
        "- EXACT gồm trùng chữ hoàn toàn hoặc chỉ khác định dạng _/gạch nối/khoảng trắng/chữ hoa.",
        "- ALIAS chỉ dùng từ điển tường minh; FUZZY chỉ sinh ứng viên, không tự chấp nhận.",
        "- Need review là số class duy nhất; class UNMATCHED có thể đồng thời nằm trong nhóm review.",
        "- Recipe coverage đếm số tên standard_ingredient phân biệt của từng recipe, trên toàn bộ recipe.",
    ]
    return "\n".join(lines) + "\n"


def run(root: Path) -> dict:
    root = root.resolve()
    source = root / "mapping" / "yolo_class_source.yaml"
    aliases_path = root / "mapping" / "ingredient_aliases.json"
    recipes_path = root / "processed" / "recipes_cleaned.csv"
    vocab_path = root / "processed" / "ingredient_vocabulary.csv"
    stage2_metrics_path = root / "reports" / "stage2_metrics.json"
    for path in (source, aliases_path, recipes_path, vocab_path, stage2_metrics_path):
        if not path.is_file():
            raise FileNotFoundError(f"Thiếu file bắt buộc: {path}")
    input_hashes = {str(p): sha256(p) for p in (source, aliases_path, recipes_path,
                                                  vocab_path, stage2_metrics_path)}
    LOG.info("Đọc class YOLO tại commit %s", COMMIT)
    classes = load_classes(source)
    local_compare = check_local_data_yaml(root, classes)
    if local_compare.startswith("KHÁC"):
        raise ValueError("YOLO CLASS SOURCE NEEDS REVIEW: data.yaml cục bộ khác nguồn chính thức")
    vocab = load_vocabulary(vocab_path)
    aliases, alias_lookup = load_aliases(aliases_path, set(vocab["ingredient_clean"]))
    stage2_metrics = json.loads(stage2_metrics_path.read_text(encoding="utf-8"))
    mapping, unmatched, review = make_mapping(classes, vocab, aliases, alias_lookup)
    conflicts = make_conflicts(mapping)
    mapped = mapping[mapping["match_type"] != "UNMATCHED"]
    mapped_names = set(mapped["standard_ingredient"])
    total, thresholds, per_ingredient, ready_total, ready_with_match = count_recipes(recipes_path, mapped_names)
    if total != int(stage2_metrics["recipes_after"]):
        raise ValueError("Số recipe không khớp báo cáo Giai đoạn 2")
    coverage_rows = []
    for row in mapped.itertuples(index=False):
        n = per_ingredient[row.standard_ingredient]
        coverage_rows.append({"class_id": row.class_id, "yolo_class": row.yolo_class,
                              "standard_ingredient": row.standard_ingredient,
                              "recipe_count": n, "recipe_percentage": pct(n, total),
                              "coverage_flag": "LOW RECIPE COVERAGE" if pct(n, total) < LOW_COVERAGE_PCT else ""})
    class_coverage = pd.DataFrame(coverage_rows, columns=["class_id", "yolo_class",
                                                          "standard_ingredient", "recipe_count",
                                                          "recipe_percentage", "coverage_flag"])
    if not (0 <= thresholds[3] <= thresholds[2] <= thresholds[1] <= total):
        raise ValueError("Recipe coverage không đơn điệu")
    if len(mapping) != len(classes) or not mapped_names or mapped["standard_ingredient"].eq("").any():
        raise ValueError("Mapping bị thiếu hoặc rỗng bất thường")
    if len(unmatched) + len(mapped) != len(classes):
        raise ValueError("Tổng class mapping không khớp")
    output_dir = root / "mapping"
    report_path = root / "reports" / "stage3_ingredient_mapping_report.txt"
    report = build_report(root, mapping, unmatched, review, conflicts, class_coverage,
                          len(vocab), total, thresholds, ready_total, ready_with_match,
                          local_compare, stage2_metrics)
    # Từ đây chỉ ghi output Giai đoạn 3; file nguồn chỉ được kiểm tra lại bằng hash.
    pd.DataFrame(enumerate(classes), columns=["class_id", "yolo_class"]).to_csv(
        output_dir / "yolo_classes.csv", index=False, encoding="utf-8-sig")
    mapping.to_csv(output_dir / "ingredient_mapping.csv", index=False, encoding="utf-8-sig")
    accepted_json = dict(zip(mapped["yolo_class"], mapped["standard_ingredient"]))
    (output_dir / "ingredient_mapping.json").write_text(
        json.dumps(accepted_json, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    unmatched.to_csv(output_dir / "unmatched_yolo_classes.csv", index=False, encoding="utf-8-sig")
    review.to_csv(output_dir / "mapping_review_needed.csv", index=False, encoding="utf-8-sig")
    conflicts.to_csv(output_dir / "mapping_conflicts.csv", index=False, encoding="utf-8-sig")
    class_coverage.to_csv(output_dir / "yolo_recipe_coverage.csv", index=False, encoding="utf-8-sig")
    report_path.write_text(report, encoding="utf-8")
    for name, before in input_hashes.items():
        if sha256(Path(name)) != before:
            raise RuntimeError(f"File nguồn bị thay đổi: {name}")
    expected = [output_dir / x for x in ("yolo_classes.csv", "ingredient_aliases.json",
                "ingredient_mapping.csv", "ingredient_mapping.json", "unmatched_yolo_classes.csv",
                "mapping_review_needed.csv", "mapping_conflicts.csv", "yolo_recipe_coverage.csv")]
    if not all(x.is_file() for x in expected) or not report_path.is_file():
        raise RuntimeError("Thiếu output Giai đoạn 3")
    if len(json.loads((output_dir / "ingredient_mapping.json").read_text(encoding="utf-8"))) != len(mapped):
        raise RuntimeError("Mapping JSON không khớp CSV")
    LOG.info("Hoàn tất: %d/%d class map; >=1 ingredient %d/%d recipe",
             len(mapped), len(classes), thresholds[1], total)
    return {"classes": len(classes), "mapped": len(mapped), "exact": int((mapping.match_type == "EXACT").sum()),
            "alias": int((mapping.match_type == "ALIAS").sum()), "unmatched": len(unmatched),
            "review_classes": int(review["yolo_class"].nunique()),
            "mapping_coverage_pct": pct(len(mapped), len(classes)),
            "recipe_coverage_ge1_pct": pct(thresholds[1], total)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    try:
        summary = run(args.root)
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as exc:
        LOG.error("Giai đoạn 3 dừng: %s", exc)
        raise SystemExit(1) from exc
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
