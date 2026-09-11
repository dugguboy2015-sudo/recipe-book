const CACHE_MS = 5 * 60 * 1000;
let cache = null; // { names, expiresAt }

export async function getCuisines(db) {
  if (cache && cache.expiresAt > Date.now()) return cache.names;
  const { data } = await db.request('cuisines?select=name');
  const names = (data || []).map((row) => row.name);
  cache = { names, expiresAt: Date.now() + CACHE_MS };
  return names;
}
