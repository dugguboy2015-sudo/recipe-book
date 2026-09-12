// Every READ query against `recipes` and its read models. Each function takes the Supabase client
// explicitly so tests can inject a fake one that records calls instead of hitting the network.
// List-returning functions return {ok, data, error} (BUG-4/8.4) so a failed request can render a
// distinct error state instead of silently looking like "no results".

const RECIPE_LIST_COLUMNS = 'id,slug,name,description,cuisine,tags,meal_types,serves,total_time_minutes,spice_level,protein_g,is_egg_free,is_vegetarian,contains_dairy,is_protein_smart,contains_nuts';
const DASHBOARD_COLUMNS = 'id,slug,name,cuisine,tags,meal_types,serves,spice_level,protein_g,is_vegetarian,is_egg_free,contains_dairy,is_protein_smart,contains_nuts,created_at';

function buildSearchFilter(value) {
  const escaped = String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const pattern = `*${escaped}*`;
  return `name.ilike."${pattern}",description.ilike."${pattern}"`;
}

function applySearchFilters(query, filters = {}) {
  let q = query.eq('is_deleted', false);
  if (filters.term) q = q.or(buildSearchFilter(filters.term.trim()));
  if (filters.cuisine) q = q.eq('cuisine', filters.cuisine);
  for (const tag of filters.tags || []) q = q.contains('tags', [tag]);
  for (const mealType of filters.mealTypes || []) q = q.contains('meal_types', [mealType]);
  const dietary = filters.dietary || {};
  if (dietary.vegetarian) q = q.eq('is_vegetarian', true);
  if (dietary.eggFree) q = q.eq('is_egg_free', true);
  if (dietary.dairyFree) q = q.eq('contains_dairy', false);
  if (dietary.proteinSmart) q = q.eq('is_protein_smart', true);
  if (dietary.nutFree) q = q.eq('contains_nuts', false);
  if (dietary.spiceMax) q = q.lte('spice_level', dietary.spiceMax);
  return q;
}

/**
 * The one search implementation (BUG-6), used by both the recipes page and the planner.
 * @param {{ term?: string, cuisine?: string, tags?: string[], mealTypes?: string[],
 *   dietary?: { vegetarian?: boolean, eggFree?: boolean, dairyFree?: boolean, proteinSmart?: boolean, nutFree?: boolean, spiceMax?: number } }} filters
 * @param {{ page: number, pageSize: number }} pagination
 * @returns {Promise<{ok: boolean, data: object[], totalCount: number, page: number, error: object|null}>}
 */
export async function searchRecipes(client, filters = {}, { page = 1, pageSize = 12 } = {}) {
  const countQuery = applySearchFilters(client.from('recipes').select('id', { count: 'exact', head: true }), filters);
  const { count: totalCount, error: countError } = await countQuery;
  if (countError) {
    console.error(countError);
    return { ok: false, data: [], totalCount: 0, page, error: countError };
  }

  const total = Number(totalCount || 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const clampedPage = Math.min(Math.max(1, page), totalPages);
  const from = (clampedPage - 1) * pageSize;
  const to = from + pageSize - 1;

  let dataQuery = applySearchFilters(client.from('recipes').select(RECIPE_LIST_COLUMNS), filters);
  dataQuery = dataQuery.range(from, to).order('name', { ascending: true });
  const { data, error } = await dataQuery;
  if (error) {
    console.error(error);
    return { ok: false, data: [], totalCount: total, page: clampedPage, error };
  }
  return { ok: true, data: data || [], totalCount: total, page: clampedPage, error: null };
}

/** recipe_stats (007_read_views.sql): totals for the dashboard tiles, one bounded row — no full-table read. */
export async function fetchRecipeStats(client) {
  const { data, error } = await client.from('recipe_stats').select('*').maybeSingle();
  if (error) {
    console.error(error);
    return { ok: false, data: null, error };
  }
  return { ok: true, data, error: null };
}

/** The N most recently added recipes for the dashboard, bounded by `limit` — not a full-table read. */
export async function fetchRecentRecipes(client, limit = 3) {
  const { data, error } = await client
    .from('recipes')
    .select(DASHBOARD_COLUMNS)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error(error);
    return { ok: false, data: [], error };
  }
  return { ok: true, data: data || [], error: null };
}

const PLANNER_CANDIDATE_COLUMNS = 'id,name,slug,cuisine,meal_types,total_time_minutes,is_protein_smart,spice_level';

/**
 * planner_candidates (012_derived_flags.sql): the bounded (limit 500 in the view itself) recipe
 * pool the planner's scoring engine (shared/planner-engine.js, Appendix K) chooses from — one
 * query per auto-fill/shuffle, not a full-table read.
 */
export async function fetchPlannerCandidates(client) {
  const { data, error } = await client.from('planner_candidates').select(PLANNER_CANDIDATE_COLUMNS);
  if (error) {
    console.error(error);
    return { ok: false, data: [], error };
  }
  return { ok: true, data: data || [], error: null };
}

/**
 * Resolves planned recipe ids to display data at render time (task 11.2) — an id missing from the
 * result (deleted since it was planned) renders as "Recipe no longer available" in the UI.
 */
export async function fetchPlannerRecipesByIds(client, ids) {
  const unique = [...new Set((ids || []).filter((id) => id != null))];
  if (unique.length === 0) return { ok: true, data: [], error: null };
  const { data, error } = await client.from('planner_candidates').select(PLANNER_CANDIDATE_COLUMNS).in('id', unique);
  if (error) {
    console.error(error);
    return { ok: false, data: [], error };
  }
  return { ok: true, data: data || [], error: null };
}

/** cuisine_counts (007_read_views.sql): every cuisine with its live recipe count, for the filter facet (BUG-2). */
export async function fetchCuisineCounts(client) {
  const { data, error } = await client.from('cuisine_counts').select('cuisine,sort_order,recipes').order('sort_order', { ascending: true });
  if (error) {
    console.error(error);
    return { ok: false, data: [], error };
  }
  return { ok: true, data: data || [], error: null };
}

/** tag_counts (007_read_views.sql): every tag with its live recipe count, for the tag-filter facet (BUG-2). */
export async function fetchTagCounts(client) {
  const { data, error } = await client.from('tag_counts').select('tag,recipes').order('recipes', { ascending: false });
  if (error) {
    console.error(error);
    return { ok: false, data: [], error };
  }
  return { ok: true, data: data || [], error: null };
}

/** Live, debounced (250ms, caller's responsibility) search-box suggestions — 2+ characters, limit 8 (8.3). */
export async function fetchSearchSuggestions(client, term, limit = 8) {
  const trimmed = String(term || '').trim();
  if (trimmed.length < 2) return { ok: true, data: [], error: null };
  const { data, error } = await client
    .from('recipes')
    .select('name')
    .eq('is_deleted', false)
    .ilike('name', `*${trimmed}*`)
    .order('name', { ascending: true })
    .limit(limit);
  if (error) {
    console.error(error);
    return { ok: false, data: [], error };
  }
  return { ok: true, data: (data || []).map((row) => row.name), error: null };
}

export async function fetchRecipeById(client, id) {
  // maybeSingle(), not single(): a recipe that's been deleted since the caller last saw its id is
  // an expected, unremarkable case here (BUG-9) — not a query error worth logging.
  const { data, error } = await client.from('recipes').select('*').eq('id', id).eq('is_deleted', false).maybeSingle();
  if (error) {
    console.error(error);
    return null;
  }
  return data;
}

/** For the recipes.html?recipe=<slug> deep link (task 7.4). */
export async function fetchRecipeBySlug(client, slug) {
  const { data, error } = await client.from('recipes').select('*').eq('slug', slug).eq('is_deleted', false).maybeSingle();
  if (error) {
    console.error(error);
    return null;
  }
  return data;
}

/** The full controlled cuisine vocabulary (migration 002), for the recipe form's cuisine <select>
 * — distinct from fetchCuisineCounts, which only lists cuisines currently in use (the filter). */
export async function fetchAllCuisines(client) {
  const { data, error } = await client.from('cuisines').select('name').order('sort_order', { ascending: true });
  if (error) {
    console.error(error);
    return [];
  }
  return (data || []).map((row) => row.name);
}

const INGREDIENT_COLUMNS = 'id,name,display_name,category,contains_meat,contains_egg,contains_dairy,contains_nuts,contains_gluten,status';

/**
 * Ingredient search for the IngredientCombobox (task 7.1). match_ingredient() (Appendix A.13) is
 * service_role-only, so the browser searches ingredients/ingredient_aliases directly with ilike —
 * both are anon-readable (migration 009). Flags + status travel with each match so the dietary
 * auto-suggestion (7.3) can tell a fully-known, reviewed ingredient list from one with gaps.
 */
export async function searchIngredients(client, term, limit = 8) {
  const trimmed = String(term || '').trim();
  if (trimmed.length < 2) return [];
  const pattern = `*${trimmed.replace(/[%,()]/g, '')}*`;

  const [byName, byAlias] = await Promise.all([
    client.from('ingredients').select(INGREDIENT_COLUMNS).or(`name.ilike.${pattern},display_name.ilike.${pattern}`).limit(limit),
    client.from('ingredient_aliases').select(`ingredient:ingredients(${INGREDIENT_COLUMNS})`).ilike('alias', pattern).limit(limit),
  ]);
  if (byName.error) console.error(byName.error);
  if (byAlias.error) console.error(byAlias.error);

  const results = new Map();
  for (const row of byName.data || []) results.set(row.id, row);
  for (const row of byAlias.data || []) {
    if (row.ingredient) results.set(row.ingredient.id, row.ingredient);
  }
  return [...results.values()].slice(0, limit);
}

/** Loads one ingredient by id (used to re-hydrate flags for a saved recipe's rows when editing). */
export async function fetchIngredientsByIds(client, ids) {
  const unique = [...new Set((ids || []).filter((id) => id != null))];
  if (unique.length === 0) return [];
  const { data, error } = await client.from('ingredients').select(INGREDIENT_COLUMNS).in('id', unique);
  if (error) {
    console.error(error);
    return [];
  }
  return data || [];
}

/**
 * The B.4-shaped ingredient groups for an existing recipe, ordered by group_position/position, for
 * the ingredient editor's setValue() when opening Edit (task 7.1).
 */
export async function fetchRecipeIngredients(client, recipeId) {
  const { data, error } = await client
    .from('recipe_ingredients')
    .select(`group_name,group_position,position,quantity,unit,preparation,is_optional,scales,ingredient:ingredients(${INGREDIENT_COLUMNS})`)
    .eq('recipe_id', recipeId)
    .order('group_position', { ascending: true })
    .order('position', { ascending: true });
  if (error) {
    console.error(error);
    return [];
  }

  const groups = [];
  const byName = new Map();
  for (const row of data || []) {
    let group = byName.get(row.group_name);
    if (!group) {
      group = { group: row.group_name, items: [] };
      byName.set(row.group_name, group);
      groups.push(group);
    }
    group.items.push({
      ingredientId: row.ingredient?.id ?? null,
      ingredientName: row.ingredient?.display_name || row.ingredient?.name || '',
      ingredientFlags: row.ingredient
        ? {
            contains_meat: row.ingredient.contains_meat,
            contains_egg: row.ingredient.contains_egg,
            contains_dairy: row.ingredient.contains_dairy,
            contains_nuts: row.ingredient.contains_nuts,
            contains_gluten: row.ingredient.contains_gluten,
          }
        : null,
      ingredientReviewed: row.ingredient?.status === 'reviewed',
      quantity: row.quantity,
      unit: row.unit,
      preparation: row.preparation || '',
      isOptional: Boolean(row.is_optional),
      scales: row.scales !== false,
    });
  }
  return groups;
}
