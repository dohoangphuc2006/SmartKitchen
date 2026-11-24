"""FastAPI app demo: chỉ ghép UI/API với pipeline đã kiểm chứng."""

from __future__ import annotations

import logging
from collections.abc import Callable
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from backend.errors import ApiError
from backend.routes.recommendation import router as recommendation_router
from backend.routes.recipes import router as recipe_router
from backend.schemas.response_models import HealthResponse
from backend.services.smart_kitchen_service import ROOT, SmartKitchenService
from src.localization import get_localization
from src.pantry_catalog import get_pantry_catalog


LOG = logging.getLogger(__name__)
FRONTEND = ROOT / "frontend"


def create_app(service_factory: Callable[[], SmartKitchenService] = SmartKitchenService) -> FastAPI:
    @asynccontextmanager
    async def lifespan(application: FastAPI):
        service = service_factory()
        application.state.service = service
        LOG.info("Smart Kitchen service đã khởi tạo")
        yield
        application.state.service = None

    application = FastAPI(title="Smart Kitchen", lifespan=lifespan)
    application.include_router(recommendation_router)
    application.include_router(recipe_router)
    application.mount("/static", StaticFiles(directory=FRONTEND), name="static")

    @application.exception_handler(ApiError)
    async def api_error_handler(_request: Request, exc: ApiError):
        content = {"success": False, "error": exc.code, "message": exc.message}
        if exc.detection is not None:
            content['detection'] = exc.detection
        return JSONResponse(status_code=exc.status_code, content=content,
                            headers={'Retry-After': '1'} if exc.status_code == 429 else None)

    @application.get("/", include_in_schema=False)
    def homepage():
        return FileResponse(FRONTEND / "index.html")

    @application.get("/api/health", response_model=HealthResponse)
    def health(request: Request):
        service = request.app.state.service
        return {"status": "ok", "model_loaded": service.model_loaded,
                "recommender_loaded": service.recommender_loaded}

    @application.get("/api/config")
    def public_config(request: Request):
        service = request.app.state.service
        config = service.config
        result = {"top_n": config.top_n, "max_upload_mb": config.max_upload_mb,
                "allowed_extensions": config.allowed_extensions,
                "live_detection": {"interval_ms": 1100, "max_width": 640, "max_upload_bytes": 1_048_576},
                "localization": get_localization(str(getattr(service, "root", ROOT))).public_dictionary()}
        if getattr(service, 'recipe_first', False):
            result.update(recipe_first=True, image_detection_available=service.model_loaded,
                          ranking_method=service.ranking_method)
        scope = getattr(service, 'scope', None)
        if scope:
            result['scope'] = scope.public()
            if scope.profile == 'fridge30_precision_guard':
                result['empty_detection_contract'] = {'status':'NO_CONFIRMED_DETECTIONS','http_status':200}
                return result
            result['empty_detection_contract'] = {'status':'NO_DETECTIONS','http_status':200} if scope.profile=='fridge30_experimental' else {
                'header': 'X-Smart-Kitchen-Empty-Result', 'value': 'success-v1',
                'status': 'NO_SUPPORTED_DETECTIONS', 'legacy_http_status': 422}
        return result

    @application.get('/api/display-catalog')
    def display_catalog(request: Request):
        service = request.app.state.service
        repository = getattr(service, 'recipe_repository', None) or getattr(service, 'repository', None)
        return repository.display_catalog() if repository else {'recipes': {}, 'coverage': {}}

    @application.get('/api/ingredients/catalog')
    def ingredient_catalog(request: Request, q: str = "", category: str = "", limit: int = 50, offset: int = 0):
        service = request.app.state.service
        catalog = get_pantry_catalog(str(getattr(service, "root", ROOT)))
        return catalog.search(query=q, category=category, limit=limit, offset=offset)

    return application


app = create_app()
