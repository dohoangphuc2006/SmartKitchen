"""Conservative catalog eligibility for the second pass after a strict empty result."""
from src.recipe_requirements import _SEASONINGS


# An exact token must occur in a required source line and be marked core by
# CatalogRequirements. These names describe ingredient types, not substitutions.
ANCHOR_FOODS = frozenset({
    'chicken', 'chicken breast', 'boneless skinless chicken breast', 'chicken thigh',
    'skinless boneless chicken thigh', 'bone-in skin-on chicken thigh', 'skin-on, bone-in chicken thigh',
    'chicken wing', 'chicken drumstick', 'chicken legs', 'chicken tenders', 'whole chicken',
    'ground chicken', 'cooked chicken',
    'ground beef', 'ground beef chuck', 'beef chuck', 'boneless beef chuck', 'ground sirloin',
    'beef tenderloin', 'flank steak', 'skirt steak', 'sirloin steak', 'rib-eye steak', 'rib eye steak',
    'new york strip steak', 'beef brisket', 'beef short ribs', 'boneless beef short ribs', 'corned beef',
    'pork belly', 'pork ribs', 'ground pork', 'ground pork shoulder', 'pork shoulder', 'boneless pork shoulder',
    'pork tenderloin', 'boneless pork loin', 'bone-in pork chops', 'bone in pork chops',
    'duck', 'duck breast', 'duck legs', 'turkey', 'ground turkey', 'ground lamb', 'boneless leg of lamb',
    'salmon', 'salmon fillet', 'skinless salmon fillet', 'cod fillet', 'halibut fillet',
    'sea bass fillet with skin', 'tuna', 'tuna steak', 'snapper fillet', 'catfish fillet', 'tilapia fillet',
    'shrimp', 'shrimp peeled deveined', 'shrimp, peeled, deveined', 'shrimp in shell', 'jumbo shrimp',
    'squid', 'octopus', 'sea scallop', 'littleneck clam', 'mussel',
    'egg', 'quail egg', 'tofu', 'firm tofu', 'extra-firm tofu', 'extra firm tofu', 'silken tofu',
    'rice', 'cooked rice', 'pasta', 'potato', 'sweet potato', 'eggplant', 'zucchini',
    'cabbage', 'carrot', 'tomato', 'mushroom', 'cauliflower', 'broccoli',
})

# Permit only known accompaniments to be absent. An unclassified source token,
# another protein, a starch or an identified core ingredient blocks the recipe.
ALLOWED_MISSING_ACCOMPANIMENTS = _SEASONINGS | frozenset({
    'garlic', 'green_onion', 'shallot', 'onion', 'olive oil', 'extra virgin olive oil',
    'vegetable oil', 'canola oil', 'sesame oil', 'butter', 'unsalted butter', 'water',
    'sugar', 'honey', 'lemon', 'lemon juice', 'lemon zest', 'lime', 'lime juice',
    'lime zest', 'soy sauce', 'fish sauce', 'balsamic vinegar', 'vinegar',
    'thyme', 'thyme sprig', 'rosemary', 'rosemary sprig', 'parsley', 'italian parsley',
})
MAX_MISSING = 6
FALLBACK_WARNING = (
    'Gợi ý gần phù hợp: hãy xem danh sách nguyên liệu cần thêm và dạng nguyên liệu trong công thức. '
    '/ Near matches: review the missing ingredients and the required form in the recipe.'
)


def eligible_fallback_recipes(quality, normalized_pantry, scoring_index, *, decisions=None):
    """Map recipe IDs to the exact main ingredient matches justifying eligibility."""
    index = quality.index
    # Intersect by exact names in the selected ranker's pantry. Applying an
    # additional alias here could credit a match the selected score never saw.
    pantry_names = set(normalized_pantry)
    has_peeled_shrimp = bool(pantry_names & {'shrimp peeled deveined', 'shrimp, peeled, deveined'})
    if has_peeled_shrimp:
        pantry_names = pantry_names | {'shrimp peeled deveined'}
    pantry_ids = {index.name_to_id[name] for name in pantry_names if name in index.name_to_id}
    anchor_ids = {index.name_to_id[name] for name in pantry_names & ANCHOR_FOODS
                  if name in index.name_to_id}
    if not anchor_ids:
        return {}
    candidate_indices = {i for anchor in anchor_ids for i in quality.requirements.postings.get(anchor, ())}
    # The baseline index can have different token spellings from the ML index.
    # Keep both the requirements and the selected ranker's missing list honest.
    by_id = {recipe.row_id: recipe for recipe in scoring_index.recipes} if scoring_index is not index else None
    shrimp_id = index.name_to_id.get('shrimp')
    cleaned_shrimp_id = index.name_to_id.get('shrimp peeled deveined')
    eligible = {}
    for i in candidate_indices:
        recipe = index.recipes[i]
        requirements = quality.requirements.recipes[i]
        core = requirements.core | requirements.source_identity
        core_matches = anchor_ids & core & requirements.source_required
        reason = ('NO_SOURCE_INSTRUCTIONS' if not recipe.has_instructions else
                  'NO_EXACT_SOURCE_CORE_ANCHOR' if not core_matches else
                  'MISSING_CORE_INGREDIENT' if core - pantry_ids else None)
        if reason:
            if decisions is not None:
                decisions[recipe.row_id] = reason
            continue
        required_missing = {index.id_to_name[item] for item in requirements.required - pantry_ids}
        if not required_missing <= ALLOWED_MISSING_ACCOMPANIMENTS:
            if decisions is not None:
                decisions[recipe.row_id] = 'MISSING_REQUIRED_FOOD_OUTSIDE_ALLOWLIST'
            continue
        scored_recipe = recipe if by_id is None else by_id.get(recipe.row_id)
        if scored_recipe is None:
            if decisions is not None:
                decisions[recipe.row_id] = 'ABSENT_FROM_SELECTED_RANKER'
            continue
        scored_names = {scoring_index.id_to_name[item] for item in scored_recipe.ingredient_ids}
        shrimp_verified_cleaned = (
            has_peeled_shrimp
            and cleaned_shrimp_id is not None
            and shrimp_id is not None
            and cleaned_shrimp_id in requirements.required
            and shrimp_id not in requirements.required
            and 'shrimp' in scored_names
        )
        effective_pantry_names = set(normalized_pantry) | ({'shrimp'} if shrimp_verified_cleaned else set())
        missing = scored_names - effective_pantry_names
        matches = ({index.id_to_name[item] for item in core_matches} & scored_names) | (
            {'shrimp'} if shrimp_verified_cleaned else set()
        )
        reason = ('NO_ANCHOR_IN_SCORING_TOKENS' if not matches else
                  'TOO_MANY_SCORING_TOKENS_MISSING' if len(missing) > MAX_MISSING else
                  'MISSING_SCORING_TOKEN_OUTSIDE_ALLOWLIST' if any(
                      quality.normalize(name) not in ALLOWED_MISSING_ACCOMPANIMENTS for name in missing
                  ) else None)
        if decisions is not None:
            decisions[recipe.row_id] = reason or 'ELIGIBLE'
        if reason is None:
            eligible[recipe.row_id] = sorted(matches)
    return eligible
