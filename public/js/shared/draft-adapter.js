// Pure mapping from a POST /api/recipes/generate response's `draft` (Appendix D.1 shape, with
// ingredients already resolved to the B.4 item shape by the server) into what the Phase 7 form
// components expect. DOM-free so it's directly testable.

/**
 * @param {Array<{group: string, items: Array<{ingredient: {id?: number, name: string, isNew?: boolean, category?: string}, quantity: number|null, unit: string, preparation: string|null, is_optional: boolean}>}>} draftIngredients
 * @returns {Array} the shape ingredient-editor.js#setValue expects (mirrors queries.js#fetchRecipeIngredients)
 */
export function draftIngredientsToEditorGroups(draftIngredients) {
  return (draftIngredients || []).map((group) => ({
    group: group.group,
    items: (group.items || []).map((item) => ({
      ingredientId: item.ingredient?.id ?? null,
      ingredientName: item.ingredient?.name || '',
      ingredientFlags: item.ingredient?.flags ?? null,
      ingredientReviewed: false, // AI-suggested matches are never pre-trusted as reviewed
      category: item.ingredient?.category ?? null,
      quantity: item.quantity ?? null,
      unit: item.unit,
      preparation: item.preparation || '',
      isOptional: Boolean(item.is_optional),
      scales: true,
    })),
  }));
}

/** The recipe-level (non-ingredient, non-step) fields a draft and the form share by name. */
export const DRAFT_RECIPE_FIELDS = [
  'name', 'description', 'cuisine', 'origin_note', 'serves', 'spice_level', 'time_note',
  'prep_time_minutes', 'cook_time_minutes', 'total_time_minutes',
  'egg_check_notes', 'calories_kcal', 'protein_g', 'carbs_g', 'sugars_g', 'fibre_g', 'fat_g', 'saturates_g', 'salt_g',
  'nutrition_basis', 'lunchbox_notes', 'common_mistakes', 'uk_sourcing_notes', 'storage_notes', 'kid_friendly_notes',
];

/** Maps each warning to the field it targets, for grouping under the form's AI-draft banner. */
export function groupWarningsByField(warnings) {
  const byField = new Map();
  for (const warning of warnings || []) {
    const field = warning.field || 'general';
    if (!byField.has(field)) byField.set(field, []);
    byField.get(field).push(warning);
  }
  return byField;
}
