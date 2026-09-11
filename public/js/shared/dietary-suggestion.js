// Pure logic for task 7.3's "Based on the ingredients: …" auto-suggestion and the household
// confirm dialog. DOM-free so both can be unit tested directly.

/**
 * Aggregates dietary flags across an ingredient editor's active rows, for pre-selecting the
 * dietary answers on a manual recipe. Returns null (no suggestion) unless every named row
 * resolves to a known ingredient whose flags are settled: an existing ingredient must be
 * `reviewed`, and a brand-new one carries flags derived at entry time (never "unreviewed" in the
 * ingredient-editor sense, since it doesn't exist yet).
 * @param {Array<{ingredientName: string, ingredientId: number|null, ingredientReviewed: boolean,
 *   ingredientFlags: {contains_meat: boolean, contains_egg: boolean, contains_dairy: boolean}|null}>} rows
 */
export function aggregateIngredientDietarySignal(rows) {
  const active = (rows || []).filter((r) => r.ingredientName?.trim());
  if (active.length === 0) return null;
  if (active.some((r) => !r.ingredientFlags || (r.ingredientId && !r.ingredientReviewed))) return null;

  return {
    is_vegetarian: !active.some((r) => r.ingredientFlags.contains_meat),
    is_egg_free: !active.some((r) => r.ingredientFlags.contains_egg),
    contains_dairy: active.some((r) => r.ingredientFlags.contains_dairy),
  };
}

/**
 * Whether saving this recipe's dietary answers should be confirmed against the household profile
 * (config/household.json): "This household is vegetarian and egg-free. Save anyway?"
 * @param {{diet?: {vegetarian?: boolean, egg_free?: boolean}}} household
 * @param {{is_vegetarian: boolean, is_egg_free: boolean}} recipe
 */
export function needsHouseholdConfirm(household, recipe) {
  if (!household) return false;
  const violatesVeg = Boolean(household.diet?.vegetarian) && recipe.is_vegetarian === false;
  const violatesEgg = Boolean(household.diet?.egg_free) && recipe.is_egg_free === false;
  return violatesVeg || violatesEgg;
}
