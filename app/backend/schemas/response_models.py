"""Contract JSON công khai của backend."""

from __future__ import annotations

from typing import Annotated, Literal
from pydantic import BaseModel, Field, StringConstraints


RankingMethod = Literal['final', 'ml_tfidf', 'ml_lsa', 'quality_overlap', 'quality_hybrid', 'tfidf_cosine', 'overlap']


class DetectedIngredient(BaseModel):
    canonical_ingredient: str | None = None
    class_id: int | None = Field(default=None, ge=0, le=29)
    name: str
    confidence: float = Field(ge=0, le=1)
    count: int = Field(ge=1)


class ConditionalIngredient(BaseModel):
    pantry: str
    recipe: str


class VerifiedCompatibleIngredient(ConditionalIngredient):
    evidence: str


class FoodAvailability(BaseModel):
    matched_ingredients: list[str]
    missing_ingredients: list[str]


class RecipeRecommendation(BaseModel):
    recipe_id: int
    recipe_name: str
    score: float
    ml_tfidf_cosine: float | None = None
    ml_lsa_cosine: float | None = None
    ready_for_mapping: bool | None = None
    match_ratio: float = Field(ge=0, le=1)
    matched_ingredients: list[str]
    missing_ingredients: list[str]
    matched_count: int
    missing_count: int
    key_matches: list[str] | None = None
    suggestion_status: Literal['pantry_match', 'needs_ingredients'] | None = None
    readiness_status: Literal['CAN_COOK_NOW', 'NEEDS_ADDITIONAL_INGREDIENTS'] | None = None
    conditional_ingredients: list[ConditionalIngredient] | None = None
    readiness_group: Literal['A', 'B', 'C'] | None = None
    quantity_status: Literal['not_checked'] | None = None
    pantry_food_used_count: int | None = None
    pantry_food_count: int | None = None
    verified_compatible_ingredients: list[VerifiedCompatibleIngredient] | None = None
    unavailable_ingredients: list[str] | None = None
    missing_core_ingredients: list[str] | None = None
    matched_core_ingredients: list[str] | None = None
    missing_seasonings: list[str] | None = None
    optional_ingredients: list[str] | None = None
    required_equipment: list[str] | None = None
    food_availability: FoodAvailability | None = None
    missing_required_count: int | None = None
    matched_core_count: int | None = None
    method_similarity: float | None = None
    match_confidence: float | None = None
    passes_baseline_25pct: bool | None = None
    reliable_for_can_cook_now: bool | None = None
    ranking_factors: dict[str, float] | None = None


class AnalyzeResponse(BaseModel):
    success: bool = True
    status: str
    detected_ingredients: list[DetectedIngredient]
    mapped_ingredients: list[str]
    unmapped_ingredients: list[str]
    recommendations: list[RecipeRecommendation]
    warnings: list[str]
    timing_ms: dict[str, float]
    detection: dict | None = None
    raw_detections: list[dict] | None = None
    accepted_detections: list[dict] | None = None
    review_candidates: list[dict] | None = None
    rejected_detections: list[dict] | None = None
    confirmed_pantry: list[str] | None = None


class HealthResponse(BaseModel):
    status: str
    model_loaded: bool
    recommender_loaded: bool


class ErrorResponse(BaseModel):
    success: bool = False
    error: str
    message: str


class RecommendRequest(BaseModel):
    confirmed: bool = Field(default=False, strict=True)
    ingredients: list[Annotated[str, StringConstraints(strict=True, strip_whitespace=True,
                                                      min_length=1, max_length=100)]] = Field(min_length=1, max_length=100)
    top_n: int = Field(default=5, strict=True, ge=1, le=20)
    ranking_method: RankingMethod | None = None
    two_tier: bool = Field(default=False, strict=True)
    confirmed_staples: list[Annotated[str, StringConstraints(strict=True, strip_whitespace=True,
                                                            min_length=1, max_length=60)]] | None = Field(default=None, max_length=20)


class RecommendResponse(BaseModel):
    success: bool = True
    ingredients: list[str]
    recommendations: list[RecipeRecommendation]
    warnings: list[str]
    timing_ms: dict[str, float]
    confirmed_pantry: list[str] | None = None
    ranking_method: RankingMethod
    model_version: str | None = None
    artifact_sha256: Annotated[str, StringConstraints(pattern=r'^[0-9a-f]{64}$')] | None = None
    empty_reason: str | None = None
    empty_detail: dict | None = None
    unresolved_ingredients: list[dict] | None = None
    fallback_used: bool | None = None
    staple_policy: dict | None = None
    two_tier: bool | None = None
    main_ingredients: list[str] | None = None
    confirmed_staples: list[str] | None = None
    tier_a_recommendations: list[RecipeRecommendation] | None = None
    tier_b_recommendations: list[RecipeRecommendation] | None = None
    tier_summary: dict | None = None


class VietnameseRecipeTranslation(BaseModel):
    recipe_name: str | None = None
    recipe_name_source: str
    recipe_name_review_status: Literal["reviewed", "auto_unreviewed", "untranslated"]
    recipe_name_display_eligible: bool = False
    ingredients: list[str] | None = None
    ingredients_source: str = 'none'
    ingredients_review_status: Literal["reviewed", "auto_unreviewed", "untranslated"] = 'untranslated'
    translation_version: str | None = None
    instructions: str | None = None
    instruction_steps: list[str]
    instructions_source: str
    instructions_review_status: Literal["reviewed", "auto_unreviewed", "untranslated"]


class RecipeTranslations(BaseModel):
    vi: VietnameseRecipeTranslation


class RecipeSource(BaseModel):
    dataset_name: str
    publisher: str
    original_content_source: str
    dataset_url: str
    license: str
    license_url: str
    revision: str
    source_level: Literal["dataset"]


class RecipeDetailResponse(BaseModel):
    success: bool = True
    recipe_id: int
    recipe_name: str
    ingredients: list[str]
    instructions: str
    instruction_steps: list[str]
    language: Literal["en"]
    translations: RecipeTranslations
    source: RecipeSource
