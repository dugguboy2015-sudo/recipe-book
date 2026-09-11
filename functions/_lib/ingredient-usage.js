const CACHE_MS = 10 * 60 * 1000;
let cache = null; // { names, expiresAt }

/** The 150 most-used ingredient names (ingredient_usage view, Appendix A.13), for D.2's prompt. */
export async function getKnownIngredients(db, limit = 150) {
  if (cache && cache.expiresAt > Date.now()) return cache.names;
  const { data } = await db.request(`ingredient_usage?select=name&order=uses.desc&limit=${limit}`);
  const names = (data || []).map((row) => row.name);
  cache = { names, expiresAt: Date.now() + CACHE_MS };
  return names;
}
