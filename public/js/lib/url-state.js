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
  if (filters.vegetarian) params.set('veg', '1');
  if (filters.eggFree) params.set('eggfree', '1');
  if (filters.dairyFree) params.set('dairyfree', '1');
  if (filters.proteinSmart) params.set('proteinsmart', '1');
  if (filters.nutFree) params.set('nutfree', '1');
  if (filters.spiceMax) params.set('spice', String(filters.spiceMax));
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
    vegetarian: params.get('veg') === '1',
    eggFree: params.get('eggfree') === '1',
    dairyFree: params.get('dairyfree') === '1',
    proteinSmart: params.get('proteinsmart') === '1',
    nutFree: params.get('nutfree') === '1',
    spiceMax: params.get('spice') ? Number(params.get('spice')) : null,
  };
}

/** @param {URLSearchParams} params */
export function searchParamsToPage(params) {
  const page = Number(params.get('page'));
  return Number.isFinite(page) && page > 0 ? page : 1;
}
