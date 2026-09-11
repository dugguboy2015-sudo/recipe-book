// Every READ query against `recipes`. Each function takes the Supabase client explicitly so
// tests can inject a fake one that records calls instead of hitting the network.

const RECIPE_LIST_COLUMNS = 'id,slug,name,description,cuisine,tags,meal_types,serves,total_time_minutes,spice_level,protein_g,is_egg_free,is_vegetarian,contains_dairy,is_protein_smart,contains_nuts';
const DASHBOARD_COLUMNS = 'id,slug,name,cuisine,tags,meal_types,serves,spice_level,protein_g,is_vegetarian,is_egg_free,contains_dairy,is_protein_smart,contains_nuts,created_at';

function buildSearchFilter(value) {
  const escaped = String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const pattern = `*${escaped}*`;
  return `name.ilike."${pattern}",description.ilike."${pattern}"`;
}

function applyListFilters(query, filters) {
  let q = query.eq('is_deleted', false);
  if (filters.search) q = q.or(buildSearchFilter(filters.search.trim()));
  if (filters.cuisine) q = q.eq('cuisine', filters.cuisine);
  for (const tag of filters.tags || []) q = q.contains('tags', [tag]);
  if (filters.vegetarian) q = q.eq('is_vegetarian', true);
  if (filters.eggFree) q = q.eq('is_egg_free', true);
  if (filters.dairyFree) q = q.eq('contains_dairy', false);
  return q;
}

export async function fetchRecipesList(client, filters, { page, pageSize }) {
  const countQuery = applyListFilters(client.from('recipes').select('id', { count: 'exact', head: true }), filters);
  const { count: totalCount, error: countError } = await countQuery;
  if (countError) console.error(countError);

  const total = Number(totalCount || 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const clampedPage = Math.min(page, totalPages);
  const from = (clampedPage - 1) * pageSize;
  const to = from + pageSize - 1;

  let dataQuery = applyListFilters(client.from('recipes').select(RECIPE_LIST_COLUMNS), filters);
  dataQuery = dataQuery.range(from, to).order('name', { ascending: true });
  const { data, error } = await dataQuery;
  if (error) {
    console.error(error);
    return { recipes: [], totalCount: total, page: clampedPage };
  }
  return { recipes: data || [], totalCount: total, page: clampedPage };
}

export async function fetchCuisineOptions(client) {
  const { data, error } = await client.from('recipes').select('cuisine').eq('is_deleted', false).not('cuisine', 'is', null).order('cuisine');
  if (error) {
    console.error(error);
    return [];
  }
  return [...new Set((data || []).map((row) => row.cuisine).filter(Boolean))];
}

export async function fetchTagOptions(client) {
  const { data, error } = await client.from('recipes').select('tags').eq('is_deleted', false);
  if (error) {
    console.error(error);
    return [];
  }
  return [...new Set((data || []).flatMap((row) => (Array.isArray(row.tags) ? row.tags : [])).filter(Boolean))].sort();
}

export async function fetchSearchSuggestions(client) {
  const { data, error } = await client.from('recipes').select('name,description').eq('is_deleted', false).order('name');
  if (error) {
    console.error(error);
    return [];
  }
  const values = (data || []).flatMap((recipe) => [recipe.name, recipe.description].map((v) => String(v || '').trim()).filter(Boolean));
  return [...new Set(values)];
}

export async function fetchDashboardRecipes(client) {
  const { data, error } = await client.from('recipes').select(DASHBOARD_COLUMNS).eq('is_deleted', false);
  if (error) {
    console.error(error);
    return null;
  }
  return data || [];
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

export async function fetchPlannerRecipes(client, limit = 50) {
  const { data, error } = await client
    .from('recipes')
    .select(RECIPE_LIST_COLUMNS)
    .eq('is_deleted', false)
    .order('name', { ascending: true })
    .limit(limit);
  if (error) {
    console.error(error);
    return [];
  }
  return data || [];
}
