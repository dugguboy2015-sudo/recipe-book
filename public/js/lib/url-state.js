// Pure mapping between the recipes-page filter state and the URL query string (task 8.7), so
// refresh and Back keep your place. DOM-free (URLSearchParams works the same in Node and the
// browser) — only history.replaceState itself needs a real document.

/** @returns {URLSearchParams} */
export function filtersToSearchParams(filters, page) {
  const params = new URLSearchParams();
  if (filters.search) params.set('q', filters.search);
  if (filters.cuisine) params.set('cuisine', filters.cuisine);
  if (filters.tags?.length) params.set('tags', filters.tags.join(','));
  if (filters.mealTypes?.length) params.set('meal', filters.mealTypes.join(','));
  if (filters.dairyFree) params.set('dairyfree', '1');
  if (filters.proteinSmart) params.set('proteinsmart', '1');
  if (filters.nutFree) params.set('nutfree', '1');
  if (filters.spiceMax) params.set('spice', String(filters.spiceMax));
  if (filters.pendingOnly) params.set('status', 'pending');
  if (page && page > 1) params.set('page', String(page));
  return params;
}

/** @param {URLSearchParams} params */
export function searchParamsToFilters(params) {
  return {
    search: params.get('q') || '',
    cuisine: params.get('cuisine') || '',
    tags: params.get('tags') ? params.get('tags').split(',').filter(Boolean) : [],
    mealTypes: params.get('meal') ? params.get('meal').split(',').filter(Boolean) : [],
    dairyFree: params.get('dairyfree') === '1',
    proteinSmart: params.get('proteinsmart') === '1',
    nutFree: params.get('nutfree') === '1',
    spiceMax: params.get('spice') ? Number(params.get('spice')) : null,
    pendingOnly: params.get('status') === 'pending',
  };
}

/** @param {URLSearchParams} params */
export function searchParamsToPage(params) {
  const page = Number(params.get('page'));
  return Number.isFinite(page) && page > 0 ? page : 1;
}

/* ---------- P2: the open recipe is part of the URL too ----------
   The filters above belong to the recipes page; these belong to the recipe detail, which can be
   opened from any page. syncUrl() rebuilds the query from filters alone, so without this it wiped
   ?recipe= off the address bar the moment the page loaded — a shared link worked exactly once and
   could not be bookmarked, refreshed or re-shared from where you landed. */
export const RECIPE_PARAMS = ['recipe', 'serves'];

/** Copies the recipe-detail params off `current` onto `params`, so one owner can't erase the other's. */
export function preserveRecipeParams(params, current) {
  for (const key of RECIPE_PARAMS) {
    const value = current?.get?.(key);
    if (value) params.set(key, value);
  }
  return params;
}

/** The query string for a recipe detail: its slug, and the servings being viewed if they were scaled. */
export function recipeSearchParams(slug, serves) {
  const params = new URLSearchParams();
  params.set('recipe', slug);
  if (serves) params.set('serves', String(serves));
  return params;
}

/** @returns {{slug: string|null, serves: number|null}} */
export function parseRecipeParams(params) {
  const slug = params?.get?.('recipe') || null;
  const raw = Number(params?.get?.('serves'));
  return { slug, serves: Number.isFinite(raw) && raw > 0 ? raw : null };
}

/* ---------- P2: the planner's view and date ----------
   Both were real state already — one in localStorage, one in memory — just not addressable, so a
   planner link always landed on today in whatever view that browser last used. Written with
   replaceState: stepping through a month of days should not bury the page you arrived from under
   thirty history entries. */
export function plannerSearchParams(viewMode, selectedDate) {
  const params = new URLSearchParams();
  if (viewMode && viewMode !== 'week') params.set('view', viewMode);
  if (selectedDate) params.set('date', selectedDate);
  return params;
}

/** The shape alone is not enough: 2026-13-45 would reach parseLocalDate and become an Invalid Date. */
function isRealDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** @returns {{viewMode: string|null, selectedDate: string|null}} */
export function parsePlannerParams(params) {
  const view = params?.get?.('view');
  const date = params?.get?.('date');
  return {
    viewMode: ['day', 'week', 'month'].includes(view) ? view : null,
    selectedDate: isRealDate(date) ? date : null,
  };
}
