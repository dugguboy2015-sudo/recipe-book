// M5: "what's in the fridge" — which recipes can I mostly make with what I already have?
// Pure ranking over rows the caller fetched, so the maths is testable and the page just renders.

/**
 * Ranks recipes by how well they match a set of ingredients you have.
 *
 * Ordering is "closest to cookable first": most of your ingredients used, then fewest other things
 * to buy, then the shortest recipe (a 20-minute dish you can almost make beats an hour-long one).
 * `pantryIds` are staples every kitchen is assumed to have — counting salt as "missing" would make
 * every recipe look out of reach.
 *
 * @param {{
 *   have: number[],
 *   rows: Array<{ recipe_id: number, ingredient_id: number }>,
 *   recipesById?: Record<number, { total_time_minutes?: number }>,
 *   pantryIds?: number[],
 *   minMatches?: number,
 * }} input
 * @returns {Array<{ recipeId: number, matched: number[], missingCount: number, total: number }>}
 */
export function rankByIngredients({ have = [], rows = [], recipesById = {}, pantryIds = [], minMatches = 1 }) {
  const haveSet = new Set(have);
  const pantrySet = new Set(pantryIds);
  const byRecipe = new Map();

  for (const row of rows) {
    if (!byRecipe.has(row.recipe_id)) byRecipe.set(row.recipe_id, { matched: new Set(), missing: 0, total: 0 });
    const entry = byRecipe.get(row.recipe_id);
    entry.total += 1;
    if (haveSet.has(row.ingredient_id)) entry.matched.add(row.ingredient_id);
    else if (!pantrySet.has(row.ingredient_id)) entry.missing += 1;
  }

  return [...byRecipe.entries()]
    .map(([recipeId, entry]) => ({
      recipeId,
      matched: [...entry.matched],
      missingCount: entry.missing,
      total: entry.total,
    }))
    .filter((result) => result.matched.length >= minMatches)
    .sort((a, b) => b.matched.length - a.matched.length
      || a.missingCount - b.missingCount
      || (recipesById[a.recipeId]?.total_time_minutes ?? 999) - (recipesById[b.recipeId]?.total_time_minutes ?? 999)
      || a.recipeId - b.recipeId);
}

/** "Uses 3 of your 4 · 2 more to buy" — the one line a result needs. */
export function describeMatch(result, haveCount) {
  const uses = `Uses ${result.matched.length} of your ${haveCount}`;
  if (result.missingCount === 0) return `${uses} · nothing else to buy`;
  return `${uses} · ${result.missingCount} more to buy`;
}
