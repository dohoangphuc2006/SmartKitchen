"""Gọi detector TV1 đã merge vào core/detector.py, model tại models/best.pt.

Wrapper chỉ kiểm tra class contract và gọi inference, không thay logic YOLO.
"""

from __future__ import annotations

import csv
import importlib.util
import sys
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml


DEFAULT_ROOT = Path(__file__).resolve().parent.parent


@lru_cache(maxsize=4)
def _load_detector(repo_root: str):
    path = Path(repo_root) / "core" / "detector.py"
    if not path.is_file():
        raise FileNotFoundError(f"Chưa có detector thật tại {path}")
    spec = importlib.util.spec_from_file_location("member1_core_detector", path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Không nạp được {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    if not hasattr(module, "detect_ingredients") or not hasattr(module, "load_model"):
        raise ValueError("core/detector.py không có detect_ingredients/load_model như contract đã đọc")
    model_path = Path(module.MODEL_PATH)
    if not model_path.is_file():
        raise FileNotFoundError(f"Thiếu checkpoint detector đang dùng: {model_path}")
    return module


class Member1Detector:
    """Callable truyền vào run_smart_kitchen_pipeline(..., detector=...)."""

    def __init__(self, repo_root: Path = DEFAULT_ROOT, *, project_root: Path = DEFAULT_ROOT):
        self.repo_root = Path(repo_root).resolve()
        self.project_root = Path(project_root).resolve()
        self.module = _load_detector(str(self.repo_root))
        classes_path = self.project_root / "mapping" / "yolo_classes.csv"
        with classes_path.open(encoding="utf-8-sig", newline="") as file:
            self.official_names = {int(row["class_id"]): row["yolo_class"]
                                   for row in csv.DictReader(file)}
        # Xác nhận config đã bàn giao và mapping cùng tên/thứ tự trước khi load model.
        class_config = yaml.safe_load(
            (self.project_root / "config" / "yolo_classes.yaml").read_text(encoding="utf-8"))
        names = class_config["names"]
        config_names = (dict(enumerate(names)) if isinstance(names, list)
                        else {int(key): value for key, value in names.items()})
        if (class_config["nc"] != len(config_names) or
                config_names != self.official_names):
            raise ValueError("CLASS CONTRACT CONFLICT: yolo_classes.yaml không khớp yolo_classes.csv")

    def __call__(self, image_path: str) -> dict[str, Any]:
        image = Path(image_path)
        if not image.is_file():
            raise FileNotFoundError(f"Không thấy ảnh: {image}")
        model = self.module.load_model()
        model_names = model.names
        actual = (dict(enumerate(model_names)) if isinstance(model_names, list)
                  else {int(k): v for k, v in model_names.items()})
        if actual != self.official_names:
            raise ValueError("Class list trong checkpoint không khớp data_checked.yaml/yolo_classes.csv")
        # Hàm này là code của Thành viên 1: mở ảnh, predict, gom count/max confidence.
        return self.module.detect_ingredients(str(image))
