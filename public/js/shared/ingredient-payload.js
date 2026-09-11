// Pure transform between the ingredient editor's row shape (also used by
// queries.js#fetchRecipeIngredients) and the B.4 wire payload. Kept DOM-free and separate from
// ingredient-editor.js so the form <-> payload round trip (task 7.1/7.3 tests) doesn't need a
// browser environment.

/**
 * @param {Array<{group: string, items: Array<{ingredientId: number|null, ingredientName: string,
 *   quantity: number|null, unit: string, preparation: string, isOptional: boolean, scales: boolean}>}>} groups
 * @returns {Array} the B.4 `ingredients` array
 */
export function recipeIngredientsToPayload(groups) {
  return (groups || [])
    .filter((g) => g.items.some((item) => item.ingredientName?.trim()))
    .map((g) => ({
      group: (g.group || '').trim() || 'Ingredients',
      items: g.items
        .filter((item) => item.ingredientName?.trim())
        .map((item) => ({
          ingredient: item.ingredientId
            ? { id: item.ingredientId }
            : { name: item.ingredientName.trim(), ...(item.category ? { category: item.category } : {}) },
          quantity: item.quantity ?? null,
          unit: item.quantity !== null && item.quantity !== undefined
            ? item.unit
            : (item.unit === 'to_taste' || item.unit === 'pinch' ? item.unit : 'to_taste'),
          preparation: item.preparation?.trim() || null,
          is_optional: Boolean(item.isOptional),
          scales: item.scales !== false,
        })),
    }));
}
