"""Pipeline Stage 6: detection JSON -> mapping -> recommender.

Không tự tải/chạy YOLO. Truyền Member1Detector làm callable; nó trả contract
thật ``{"ingredients": [{"name", "confidence", "count"}]}`` từ core.detector.
"""

from __future__ import annotations

import logging
import time
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable

from detection_to_ingredient import DEFAULT_ROOT, DetectionAdapter, load_integration_config
from recommender import Recommender


LOG = logging.getLogger(__name__)


def _failure(status: str, description: str, source: str, error_type: str,
             *, integration_mode: str) -> dict[str, Any]:
    problem = {"error_type": error_type, "source_module": source,
               "description": description, "severity": "ERROR"}
    LOG.error(description)
    return {"status": status, "integration_mode": integration_mode,
            "detected_ingredients": [], "mapped_ingredients": [],
            "unmapped_ingredients": [], "recommendations": [],
            "warnings": [description], "issues": [problem],
            "processing_time_ms": {"detection": 0.0, "adapter": 0.0,
                                   "recommendation": 0.0, "total": 0.0}}


class SmartKitchenPipeline:
    """Khởi tạo một lần, dùng lại cho nhiều request demo/local integration."""

    def __init__(self, root: Path = DEFAULT_ROOT):
        self.root = Path(root).resolve()
        self.config = load_integration_config(self.root)
        self.adapter = DetectionAdapter(self.root, self.config)
        self.recommender = Recommender(self.root)
        if not self.recommender.index.recipes:
            raise ValueError("Recipe Dataset không có recipe dùng được")
        invalid_targets = set(self.adapter.mapping.values()) - self.recommender.recipe_vocabulary
        if invalid_targets:
            raise ValueError(f"Mapping đích không có trong Recipe Dataset: {sorted(invalid_targets)}")

    def run_detections(self, detections: Any, *, top_n: int | None = None,
                       integration_mode: str = "MOCK",
                       detection_ms: float = 0.0) -> dict[str, Any]:
        if top_n is None:
            top_n = self.config.top_n
        if isinstance(top_n, bool) or not isinstance(top_n, int) or not 1 <= top_n <= 100:
            return _failure("INVALID_INPUT", "top_n phải là số nguyên trong [1,100].",
                            "pipeline", "Integration Error", integration_mode=integration_mode)
        start_total = time.perf_counter()
        start_adapter = time.perf_counter()
        adapted = self.adapter.process_detections(detections)
        adapter_ms = (time.perf_counter() - start_adapter) * 1000
        start_recommendation = time.perf_counter()
        if adapted["mapped_ingredients"]:
            result = self.recommender.recommend(adapted["mapped_ingredients"], top_n=top_n,
                                                return_diagnostics=True)
        else:
            result = {"recommendations": [], "warnings": [], "candidate_count": 0,
                      "qualified_count": 0, "normalized_ingredients": []}
        recommendation_ms = (time.perf_counter() - start_recommendation) * 1000
        warnings = adapted["warnings"] + result["warnings"]
        issues = list(adapted["issues"])
        if adapted["mapped_ingredients"] and not result["recommendations"]:
            issues.append({"error_type": "Empty Result", "source_module": "recommender",
                           "description": "Có ingredient hợp lệ nhưng không có recipe đạt ngưỡng.",
                           "severity": "WARNING"})
        if any(issue["error_type"] == "Integration Error" for issue in issues):
            status = "PARTIAL" if result["recommendations"] else "INVALID_DETECTIONS"
        elif result["recommendations"]:
            status = "PARTIAL" if adapted["unmapped_detections"] else "OK"
        else:
            status = "EMPTY"
        LOG.info("Generated %d recommendations, status=%s", len(result["recommendations"]), status)
        return {
            "status": status, "integration_mode": integration_mode,
            "detected_ingredients": adapted["detected_ingredients"],
            "mapped_ingredients": adapted["mapped_ingredients"],
            "unmapped_ingredients": adapted["unmapped_detections"],
            "recommendations": result["recommendations"],
            "warnings": warnings, "issues": issues,
            "candidate_count": result["candidate_count"],
            "qualified_count": result["qualified_count"],
            "processing_time_ms": {
                "detection": round(detection_ms, 3),
                "adapter": round(adapter_ms, 3),
                "recommendation": round(recommendation_ms, 3),
                "total": round(detection_ms + (time.perf_counter() - start_total) * 1000, 3),
            },
        }


@lru_cache(maxsize=4)
def _pipeline(root: str) -> SmartKitchenPipeline:
    return SmartKitchenPipeline(Path(root))


def run_smart_kitchen_pipeline(
    detections: Any = None, *, image_path: str | Path | None = None,
    detector: Callable[[str], Any] | None = None, top_n: int | None = None,
    root: Path = DEFAULT_ROOT,
) -> dict[str, Any]:
    """API-ready, trả dict JSON-compatible; không tạo backend hay gọi YOLO ngầm."""
    if detections is not None and image_path is not None:
        return _failure("INVALID_INPUT", "Chỉ truyền detections hoặc image_path, không truyền cả hai.",
                        "pipeline", "Integration Error", integration_mode="MOCK")
    mode = "REAL" if image_path is not None else "MOCK"
    inference_ms = 0.0
    if image_path is not None:
        path = Path(image_path)
        if not path.is_file():
            return _failure("IMAGE_NOT_FOUND", f"Không tìm thấy ảnh: {path}",
                            "detector", "Detection Error", integration_mode=mode)
        if detector is None:
            return _failure("DETECTOR_UNAVAILABLE", "Chưa có detector thật; không thể inference ảnh.",
                            "detector", "Detection Error", integration_mode=mode)
        start = time.perf_counter()
        try:
            detections = detector(str(path))
        except Exception as exc:  # detector bên ngoài có thể ném lỗi thư viện/model
            return _failure("DETECTION_FAILED", f"Detector thất bại: {type(exc).__name__}: {exc}",
                            "detector", "Detection Error", integration_mode=mode)
        inference_ms = (time.perf_counter() - start) * 1000
    try:
        pipeline = _pipeline(str(Path(root).resolve()))
    except (OSError, ValueError, KeyError) as exc:
        return _failure("SETUP_ERROR", f"Không nạp được mapping/config/recipes: {exc}",
                        "pipeline", "Integration Error", integration_mode=mode)
    try:
        return pipeline.run_detections(detections, top_n=top_n, integration_mode=mode,
                                       detection_ms=inference_ms)
    except (OSError, ValueError, TypeError) as exc:
        return _failure("PIPELINE_ERROR", f"Pipeline không xử lý được input: {exc}",
                        "pipeline", "Integration Error", integration_mode=mode)
