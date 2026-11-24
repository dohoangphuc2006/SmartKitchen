"""Chuyển output core.detector.detect_ingredients sang nguyên liệu Stage 3.

Hỗ trợ dict {"ingredients": [{"name", "confidence", "count"}]} thật của
Thành viên 1 và list[dict] mock/legacy. Không chạy YOLO ở đây.
"""

from __future__ import annotations

import csv
import json
import logging
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any


LOG = logging.getLogger(__name__)
DEFAULT_ROOT = Path(__file__).resolve().parent.parent


@dataclass(frozen=True)
class IntegrationConfig:
    detection_confidence_threshold: float = 0.5
    top_n: int = 5

    def __post_init__(self) -> None:
        if (isinstance(self.detection_confidence_threshold, bool) or
                not isinstance(self.detection_confidence_threshold, (int, float)) or
                not math.isfinite(self.detection_confidence_threshold) or
                not 0 <= self.detection_confidence_threshold <= 1):
            raise ValueError("detection_confidence_threshold phải nằm trong [0,1]")
        if isinstance(self.top_n, bool) or not isinstance(self.top_n, int) or not 1 <= self.top_n <= 100:
            raise ValueError("top_n phải là số nguyên trong [1,100]")


def load_integration_config(root: Path = DEFAULT_ROOT) -> IntegrationConfig:
    path = Path(root) / "config" / "integration_config.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError("config phải là JSON object")
        return IntegrationConfig(**data)
    except (OSError, ValueError, TypeError, json.JSONDecodeError) as exc:
        raise ValueError(f"Không thể nạp {path}: {exc}") from exc


class DetectionAdapter:
    """Class ID/tên luôn kiểm tra với yolo_classes.csv đã xác minh ở Stage 3."""

    def __init__(self, root: Path = DEFAULT_ROOT, config: IntegrationConfig | None = None):
        self.root = Path(root).resolve()
        self.config = config or load_integration_config(self.root)
        mapping_path = self.root / "mapping" / "ingredient_mapping.json"
        classes_path = self.root / "mapping" / "yolo_classes.csv"
        try:
            self.mapping = json.loads(mapping_path.read_text(encoding="utf-8"))
            with classes_path.open(encoding="utf-8-sig", newline="") as file:
                rows = list(csv.DictReader(file))
            self.id_to_class = {int(row["class_id"]): row["yolo_class"] for row in rows}
        except (OSError, ValueError, KeyError, json.JSONDecodeError) as exc:
            raise ValueError(f"Không thể nạp mapping/class nguồn: {exc}") from exc
        if (not isinstance(self.mapping, dict) or len(self.id_to_class) != len(rows) or
                len(set(self.id_to_class.values())) != len(rows) or
                not all(isinstance(k, str) and isinstance(v, str) and v
                        for k, v in self.mapping.items()) or
                not set(self.mapping).issubset(self.id_to_class.values())):
            raise ValueError("Mapping hoặc class list bị trùng/sai cấu trúc")
        self.class_to_id = {name: class_id for class_id, name in self.id_to_class.items()}

    def process_detections(self, detections: Any) -> dict[str, Any]:
        """Không ném lỗi vì từng detection hỏng; ghi issue rồi tiếp tục."""
        issues: list[dict[str, str]] = []
        accepted: dict[str, dict[str, Any]] = {}
        mapped: dict[str, float] = {}
        unmapped: dict[str, float] = {}
        filtered_count = 0

        def issue(kind: str, description: str, severity: str = "WARNING") -> None:
            issues.append({"error_type": kind, "source_module": "detection_adapter",
                           "description": description, "severity": severity})
            if severity == "WARNING":
                LOG.warning(description)

        if isinstance(detections, dict) and isinstance(detections.get("ingredients"), list):
            detections = detections["ingredients"]
        elif not isinstance(detections, list):
            issue("Integration Error", "Detector output phải là {'ingredients': list[dict]} hoặc list[dict].", "ERROR")
            detections = []
        LOG.info("Received %d detection objects", len(detections))
        for idx, item in enumerate(detections):
            if not isinstance(item, dict):
                issue("Integration Error", f"Detection #{idx} không phải object; đã bỏ qua.")
                continue
            given_names = [item[key] for key in ("class", "class_name", "name") if key in item]
            if len(given_names) > 1 and any(name != given_names[0] for name in given_names[1:]):
                issue("Integration Error", f"Detection #{idx}: class/class_name/name không khớp.")
                continue
            raw_name = item.get("class_name", item.get("class", item.get("name")))
            class_id = item.get("class_id")
            if class_id is not None:
                if isinstance(class_id, bool) or not (isinstance(class_id, int) or
                                                      isinstance(class_id, str) and class_id.isdecimal()):
                    issue("Integration Error", f"Detection #{idx} có class_id không hợp lệ.")
                    continue
                class_id = int(class_id)
                expected = self.id_to_class.get(class_id)
                if expected is None:
                    issue("Integration Error", f"Detection #{idx} có class_id={class_id} ngoài class list.")
                    continue
                if raw_name is not None and (not isinstance(raw_name, str) or raw_name != expected):
                    issue("Integration Error", f"Detection #{idx}: class_id={class_id} không khớp tên class.")
                    continue
                class_name = expected
            elif isinstance(raw_name, str) and raw_name:
                class_name = raw_name
                class_id = self.class_to_id.get(class_name)
            else:
                issue("Integration Error", f"Detection #{idx} thiếu class/class_name/class_id.")
                continue
            if class_name not in self.class_to_id:
                issue("Integration Error", f"Detection #{idx}: '{class_name}' không thuộc 30 class YOLO chính thức.")
                continue
            raw_confidence = item.get("confidence")
            if (isinstance(raw_confidence, bool) or
                    not isinstance(raw_confidence, (int, float)) or
                    not math.isfinite(raw_confidence) or not 0 <= raw_confidence <= 1):
                issue("Integration Error", f"Detection #{idx} ({class_name}) thiếu/confidence không hợp lệ.")
                continue
            confidence = float(raw_confidence)
            if confidence < self.config.detection_confidence_threshold:
                filtered_count += 1
                issue("Low Confidence", f"Bỏ {class_name} ({confidence:.3f}) dưới threshold "
                      f"{self.config.detection_confidence_threshold:.3f}.", "INFO")
                continue
            raw_count = item.get("count", 1)
            if isinstance(raw_count, bool) or not isinstance(raw_count, int) or raw_count < 1:
                issue("Integration Error", f"Detection #{idx} ({class_name}) có count không hợp lệ.")
                continue
            if class_name not in accepted:
                accepted[class_name] = {"name": class_name, "class_id": class_id,
                                        "confidence": confidence, "count": 0}
            accepted[class_name]["count"] += raw_count
            accepted[class_name]["confidence"] = max(accepted[class_name]["confidence"], confidence)
            standard = self.mapping.get(class_name)
            if standard:
                mapped[standard] = max(mapped.get(standard, 0.0), confidence)
            else:
                unmapped[class_name] = max(unmapped.get(class_name, 0.0), confidence)

        detected = sorted(accepted.values(), key=lambda x: (-x["confidence"], x["name"]))
        ingredients = sorted(mapped, key=lambda name: (-mapped[name], name))
        unmapped_names = sorted(unmapped, key=lambda name: (-unmapped[name], name))
        for name in unmapped_names:
            description = ("Nhận diện 'beef' chưa xác định phần thịt. Hãy chọn phần thịt cụ thể thủ công nếu biết."
                           if name == 'beef' else f"Class YOLO '{name}' chưa có mapping sang recipe ingredient.")
            issue("Mapping Error", description)
        if not ingredients:
            issue("Empty Result", "Không có ingredient chuẩn để gửi sang recommender.", "INFO")
        LOG.info("Mapped %d unique ingredients; %d unmapped classes; %d below threshold",
                 len(ingredients), len(unmapped_names), filtered_count)
        return {"detected_ingredients": detected, "mapped_ingredients": ingredients,
                "unmapped_detections": unmapped_names, "filtered_count": filtered_count,
                "issues": issues, "warnings": [x["description"] for x in issues]}


def process_detections(detections: Any, *, root: Path = DEFAULT_ROOT,
                       config: IntegrationConfig | None = None) -> dict[str, Any]:
    """Hàm tiện dụng cho notebook/script; pipeline tái sử dụng instance để nhanh hơn."""
    return DetectionAdapter(root, config).process_detections(detections)
