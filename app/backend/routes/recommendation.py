"""Upload ảnh, xác thực và chuyển vào service Stage 6."""

from __future__ import annotations

import inspect
import io
import logging
import tempfile
import time
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, File, Request, UploadFile
from PIL import Image, UnidentifiedImageError
from starlette.concurrency import run_in_threadpool

from backend.errors import ApiError
from backend.schemas.response_models import AnalyzeResponse, ErrorResponse, RecommendRequest, RecommendResponse
from core.detection_scope import DECISION_FIELDS, FULL30_PROFILES, PRECISION_GUARD


LOG = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["recommendation"])
MIME_BY_EXTENSION = {"jpg": "image/jpeg", "jpeg": "image/jpeg",
                     "png": "image/png", "webp": "image/webp"}
MAX_IMAGE_PIXELS = 25_000_000
QUANTITY_NOT_CHECKED = 'Chưa xác nhận đủ định lượng để nấu / Ingredient quantities have not been verified.'


@router.post('/detect-frame')
async def detect_frame(request: Request, image: UploadFile | None = File(default=None)):
    """Memory-only detection. No temp file or recommender for live frames."""
    service = request.app.state.service
    if image is None:
        raise ApiError(400, 'MISSING_IMAGE', 'Vui lòng chọn ảnh để phân tích.')
    try:
        if getattr(service, 'recipe_first', False) and not service.model_loaded:
            raise ApiError(503, 'DETECTOR_UNAVAILABLE', 'Nhận diện ảnh không khả dụng. Hãy nhập nguyên liệu thủ công.')
        data = await image.read(1_048_577)
        if len(data) > 1_048_576:
            raise ApiError(413, 'FILE_TOO_LARGE', 'Frame vượt giới hạn 1 MB.')
        validate_image(data, image.filename, image.content_type, ('jpg', 'jpeg', 'png', 'webp'))
        with Image.open(io.BytesIO(data)) as source:
            if source.width > 1280 or source.height > 1280:
                raise ApiError(413, 'IMAGE_TOO_LARGE', 'Frame phải có cạnh không quá 1280 pixel.')
            picture = source.copy()
        result = await run_in_threadpool(service.detect_frame, picture)
    except ApiError:
        raise
    except Exception as exc:
        LOG.exception('Frame detection failed')
        raise ApiError(503, 'DETECTOR_ERROR', 'Không thể phân tích ảnh lúc này.') from exc
    finally:
        await image.close()
    return {'success': True, **result}


@router.post("/recommend", response_model=RecommendResponse, response_model_exclude_unset=True)
async def recommend(request: Request, payload: RecommendRequest):
    started = time.perf_counter()
    service = request.app.state.service
    scope=getattr(service,'scope',None)
    if scope and scope.profile in FULL30_PROFILES and not payload.confirmed:
        raise ApiError(409,'INGREDIENT_CONFIRMATION_REQUIRED','Hãy kiểm tra/sửa và xác nhận danh sách nguyên liệu trước khi gợi ý món.')
    try:
        sig = inspect.signature(service.recommend_ingredients)
        accepts_ranking = (
            'ranking_method' in sig.parameters
            or any(
                p.kind in (inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD)
                for p in sig.parameters.values()
            )
            or len([p for p in sig.parameters.values() if p.kind in (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD)]) >= 3
        )
        accepts_two_tier = (
            'two_tier' in sig.parameters
            or any(p.kind == inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values())
        )
        if accepts_two_tier and (payload.two_tier or payload.confirmed_staples is not None):
            def _call_two_tier():
                return service.recommend_ingredients(
                    payload.ingredients,
                    payload.top_n,
                    payload.ranking_method,
                    two_tier=payload.two_tier,
                    confirmed_staples=payload.confirmed_staples,
                )
            result = await run_in_threadpool(_call_two_tier)
        elif payload.ranking_method is None and not accepts_ranking:
            result = await run_in_threadpool(service.recommend_ingredients, payload.ingredients, payload.top_n)
        else:
            result = await run_in_threadpool(service.recommend_ingredients,
                                             payload.ingredients, payload.top_n, payload.ranking_method)
        method = result.get('method', getattr(service, 'ranking_method', 'final'))
        expected_method = payload.ranking_method or getattr(service, 'ranking_method', 'final')
        if method != expected_method:
            raise ValueError('Recommendation returned a different ranking method')
        if method in {'ml_tfidf', 'ml_lsa'} and not (result.get('model_version') and result.get('artifact_sha256')):
            raise ValueError('ML recommendation is missing artifact identity')
    except Exception as exc:
        LOG.exception("Recommendation failed: %s", type(exc).__name__)
        raise ApiError(500, "RECOMMENDATION_ERROR", "Không thể gợi ý món lúc này. Vui lòng thử lại.") from exc
    # Unknown terms remain explicit warnings; never invent a mapping or confidence.
    response = {"success": True, "ranking_method": method, "ingredients": result["normalized_ingredients"],
            "recommendations": result["recommendations"], "warnings": result["warnings"],
            "timing_ms": {"request": round((time.perf_counter() - started) * 1000, 3)}}
    if scope and scope.profile == PRECISION_GUARD:
        response['confirmed_pantry'] = result['normalized_ingredients']
    for key in ('model_version', 'artifact_sha256', 'empty_reason', 'empty_detail', 'unresolved_ingredients', 'fallback_used', 'staple_policy'):
        if key in result:
            response[key] = result[key]
    for key in ('two_tier', 'main_ingredients', 'confirmed_staples',
                'tier_a_recommendations', 'tier_b_recommendations', 'tier_summary'):
        if key in result and result[key] is not None:
            response[key] = result[key]
    if result['recommendations']:
        response['warnings'] = [*response['warnings'], QUANTITY_NOT_CHECKED]
        response['recommendations'] = [dict(row, quantity_status='not_checked')
                                       for row in result['recommendations']]
    for tier_key in ('tier_a_recommendations', 'tier_b_recommendations'):
        if tier_key in response and response[tier_key]:
            response[tier_key] = [dict(row, quantity_status='not_checked') for row in response[tier_key]]
    return response


def validate_image(data: bytes, filename: str | None, mime: str | None,
                   allowed_extensions: tuple[str, ...]) -> str:
    """Kiểm tra extension, MIME, nội dung ảnh và số pixel; trả suffix an toàn."""
    suffix = Path(filename or "").suffix.lower().lstrip(".")
    if suffix not in allowed_extensions:
        raise ApiError(415, "INVALID_FILE_TYPE", "Chỉ chấp nhận ảnh JPG, JPEG, PNG hoặc WEBP.")
    expected_mime = MIME_BY_EXTENSION[suffix]
    if (mime or "").split(";", 1)[0].lower() != expected_mime:
        raise ApiError(415, "INVALID_MIME_TYPE", "Loại nội dung ảnh không khớp phần mở rộng tệp.")
    try:
        with Image.open(io.BytesIO(data)) as picture:
            actual_format = picture.format
            if picture.width * picture.height > MAX_IMAGE_PIXELS:
                raise ApiError(413, "IMAGE_TOO_LARGE", "Ảnh có quá nhiều pixel để xử lý.")
            picture.verify()
    except ApiError:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
        raise ApiError(415, "INVALID_IMAGE", "File không phải ảnh hợp lệ hoặc đã bị hỏng.") from exc
    expected_format = "JPEG" if suffix in {"jpg", "jpeg"} else suffix.upper()
    if actual_format != expected_format:
        raise ApiError(415, "INVALID_IMAGE", "Nội dung ảnh không khớp định dạng tệp.")
    return suffix


@router.post("/analyze", response_model=AnalyzeResponse, response_model_exclude_unset=True,
             responses={400: {"model": ErrorResponse}, 413: {"model": ErrorResponse},
                        415: {"model": ErrorResponse}, 422: {"model": ErrorResponse},
                        500: {"model": ErrorResponse}, 503: {"model": ErrorResponse}})
async def analyze(request: Request, image: UploadFile | None = File(default=None)):
    started = time.perf_counter()
    if image is None:
        raise ApiError(400, "MISSING_IMAGE", "Vui lòng chọn ảnh để phân tích.")
    service = request.app.state.service
    try:
        if getattr(service, 'recipe_first', False) and not service.model_loaded:
            raise ApiError(503, 'DETECTOR_UNAVAILABLE', 'Nhận diện ảnh không khả dụng. Hãy nhập nguyên liệu thủ công.')
        data = await image.read(service.config.max_upload_bytes + 1)
        if len(data) > service.config.max_upload_bytes:
            raise ApiError(413, "FILE_TOO_LARGE",
                           f"Ảnh vượt giới hạn {service.config.max_upload_mb} MB.")
        if not data:
            raise ApiError(415, "INVALID_IMAGE", "File ảnh trống.")
        suffix = validate_image(data, image.filename, image.content_type,
                                service.config.allowed_extensions)
    finally:
        await image.close()
    LOG.info("Nhận ảnh hợp lệ, %d bytes", len(data))
    # Không dùng tên file do người dùng cung cấp; thư mục/tệp sẽ tự xóa sau request.
    with tempfile.TemporaryDirectory(prefix="smart_kitchen_") as folder:
        path = Path(folder) / f"{uuid4().hex}.{suffix}"
        path.write_bytes(data)
        try:
            result = await run_in_threadpool(service.analyze_image, path)
        except Exception as exc:
            LOG.exception("Lỗi chạy pipeline: %s", type(exc).__name__)
            raise ApiError(500, "INTERNAL_ERROR", "Có lỗi xảy ra, vui lòng thử lại.") from exc
    status = result["status"]
    if status == "DETECTION_FAILED":
        LOG.error("Detector lỗi trong request")
        raise ApiError(503, "DETECTOR_ERROR", "Không thể phân tích ảnh lúc này.")
    if status in {"SETUP_ERROR", "PIPELINE_ERROR", "INVALID_DETECTIONS", "INVALID_INPUT"}:
        LOG.error("Lỗi tích hợp pipeline: %s", status)
        raise ApiError(500, "INTEGRATION_ERROR", "Hệ thống chưa xử lý được ảnh này.")
    profile = (result.get('detection') or {}).get('scope',{}).get('profile')
    if profile in FULL30_PROFILES:
        timing=dict(result['processing_time_ms']);timing['request']=round((time.perf_counter()-started)*1000,3)
        decision_fields = {k:result['detection'][k] for k in DECISION_FIELDS} if profile == PRECISION_GUARD else {}
        return dict(success=True,status=status,detected_ingredients=result['detected_ingredients'],
                    mapped_ingredients=result['mapped_ingredients'],unmapped_ingredients=result['unmapped_ingredients'],
                    recommendations=[],warnings=result['warnings'],timing_ms=timing,detection=result['detection'], **decision_fields)
    if not result["detected_ingredients"]:
        LOG.warning("Không có nguyên liệu được phát hiện trên ngưỡng")
        geometry = result.get('detection') or {}
        if geometry.get('scope', {}).get('profile') == 'fridge11':
            raw = geometry.get('raw_boxes', [])
            allowed = {c['class_id'] for c in geometry['scope']['supported_classes']}
            only_outside = bool(raw) and all(b.get('class_id') not in allowed for b in raw)
            code = 'OUT_OF_SCOPE_DETECTIONS' if only_outside else 'NO_SUPPORTED_INGREDIENT'
            message = ('Các dự đoán hiện tại nằm ngoài danh sách 11 lớp hỗ trợ. Bạn có thể thêm nguyên liệu thủ công.'
                       if only_outside else 'Chưa phát hiện nguyên liệu thuộc danh sách hỗ trợ ở ngưỡng hiện tại. Bạn có thể thêm thủ công.')
            # Explicit negotiation preserves the historical 422 contract for old
            # clients. Empty inference is a successful result for the new UI;
            # malformed uploads and detector failures keep their error status.
            if request.headers.get('X-Smart-Kitchen-Empty-Result') == 'success-v1':
                timing = dict(result['processing_time_ms'])
                timing['request'] = round((time.perf_counter() - started) * 1000, 3)
                return {'success': True, 'status': 'NO_SUPPORTED_DETECTIONS',
                        'detected_ingredients': [], 'mapped_ingredients': [],
                        'unmapped_ingredients': [], 'recommendations': [],
                        'warnings': [message], 'timing_ms': timing, 'detection': geometry}
            raise ApiError(422, code, message, detection=geometry)
        raise ApiError(422, "NO_INGREDIENT_DETECTED", "Không phát hiện được nguyên liệu phù hợp trong ảnh.", detection=result.get('detection'))
    if not result["mapped_ingredients"]:
        LOG.warning("Các class được phát hiện đều chưa map")
        raise ApiError(422, "NO_MAPPED_INGREDIENT", "Nguyên liệu được phát hiện chưa có trong bộ gợi ý.", detection=result.get('detection'))
    if not result["recommendations"]:
        LOG.warning("Không có recipe đạt ngưỡng")
        # Valid detections remain useful even when recipe matching is empty.
        # Return the pantry so the user can correct it without losing YOLO output.
    if result["unmapped_ingredients"]:
        LOG.warning("Có %d class chưa map", len(result["unmapped_ingredients"]))
    timing = dict(result["processing_time_ms"])
    timing["request"] = round((time.perf_counter() - started) * 1000, 3)
    LOG.info("Xử lý xong: %d class, %d món, %.1f ms",
             len(result["detected_ingredients"]), len(result["recommendations"]), timing["request"])
    return {"success": True, "status": status,
            "detected_ingredients": result["detected_ingredients"],
            "mapped_ingredients": result["mapped_ingredients"],
            "unmapped_ingredients": result["unmapped_ingredients"],
            "recommendations": result["recommendations"],
            "warnings": result["warnings"], "timing_ms": timing, "detection": result.get('detection')}
