"""API chỉ đọc để truy xuất chi tiết công thức theo row_id."""

from typing import Annotated

from fastapi import APIRouter, Path, Request

from backend.errors import ApiError
from backend.schemas.response_models import ErrorResponse, RecipeDetailResponse
from src.recipe_repository import RecipeDetailUnavailableError, RecipeNotFoundError


router = APIRouter(prefix="/api/recipes", tags=["recipes"])


@router.get("/{recipe_id}", response_model=RecipeDetailResponse,
            responses={404: {"model": ErrorResponse}, 422: {"model": ErrorResponse}})
async def recipe_detail(request: Request, recipe_id: Annotated[int, Path(ge=0)]):
    try:
        return request.app.state.service.get_recipe_detail(recipe_id)
    except RecipeNotFoundError as exc:
        raise ApiError(404, "RECIPE_NOT_FOUND", "Không tìm thấy công thức này.") from exc
    except RecipeDetailUnavailableError as exc:
        raise ApiError(422, "RECIPE_DETAIL_UNAVAILABLE", str(exc)) from exc

