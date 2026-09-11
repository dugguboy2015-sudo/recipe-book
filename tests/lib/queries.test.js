import { describe, expect, it } from 'vitest';
import { searchRecipes, fetchRecipeStats, fetchRecentRecipes, fetchCuisineCounts, fetchTagCounts, fetchSearchSuggestions, fetchRecipeById } from '../../public/js/lib/queries.js';

function createFakeClient(response) {
  const queries = [];

  function makeBuilder(table) {
    const record = { table, calls: [] };
    queries.push(record);
    const builder = {};
    for (const method of ['select', 'eq', 'or', 'contains', 'not', 'order', 'range', 'limit', 'lte', 'in', 'ilike']) {
      builder[method] = (...args) => {
        record.calls.push({ method, args });
        return builder;
      };
    }
    builder.single = (...args) => {
      record.calls.push({ method: 'single', args });
      return Promise.resolve(response);
    };
    builder.maybeSingle = (...args) => {
      record.calls.push({ method: 'maybeSingle', args });
      return Promise.resolve(response);
    };
    builder.then = (resolve) => resolve(response);
    return builder;
  }

  return { from: (table) => makeBuilder(table), queries };
}

function callsFor(client, method) {
  return client.queries.flatMap((q) => q.calls).filter((c) => c.method === method);
}

describe('searchRecipes', () => {
  it('always filters is_deleted=false, with no other filters by default', async () => {
    const client = createFakeClient({ data: [], error: null, count: 0 });
    await searchRecipes(client, {}, { page: 1, pageSize: 12 });
    const isDeletedCalls = callsFor(client, 'eq').filter((c) => c.args[0] === 'is_deleted');
    expect(isDeletedCalls.length).toBe(2); // count query + data query
    expect(isDeletedCalls.every((c) => c.args[1] === false)).toBe(true);
  });

  it('applies term, cuisine, tags, mealTypes and every dietary filter as PostgREST calls', async () => {
    const client = createFakeClient({ data: [], error: null, count: 0 });
    await searchRecipes(
      client,
      {
        term: 'poha', cuisine: 'Maharashtrian', tags: ['Snack'], mealTypes: ['Breakfast'],
        dietary: { vegetarian: true, eggFree: true, dairyFree: true, proteinSmart: true, nutFree: true, spiceMax: 3 },
      },
      { page: 1, pageSize: 12 },
    );

    const orCalls = callsFor(client, 'or');
    expect(orCalls.length).toBe(2);
    expect(orCalls[0].args[0]).toContain('name.ilike."*poha*"');
    expect(orCalls[0].args[0]).toContain('description.ilike."*poha*"');

    expect(callsFor(client, 'eq').some((c) => c.args[0] === 'cuisine' && c.args[1] === 'Maharashtrian')).toBe(true);
    expect(callsFor(client, 'contains').some((c) => c.args[0] === 'tags' && c.args[1][0] === 'Snack')).toBe(true);
    expect(callsFor(client, 'contains').some((c) => c.args[0] === 'meal_types' && c.args[1][0] === 'Breakfast')).toBe(true);
    expect(callsFor(client, 'eq').some((c) => c.args[0] === 'is_vegetarian' && c.args[1] === true)).toBe(true);
    expect(callsFor(client, 'eq').some((c) => c.args[0] === 'is_egg_free' && c.args[1] === true)).toBe(true);
    expect(callsFor(client, 'eq').some((c) => c.args[0] === 'contains_dairy' && c.args[1] === false)).toBe(true);
    expect(callsFor(client, 'eq').some((c) => c.args[0] === 'is_protein_smart' && c.args[1] === true)).toBe(true);
    expect(callsFor(client, 'eq').some((c) => c.args[0] === 'contains_nuts' && c.args[1] === false)).toBe(true);
    expect(callsFor(client, 'lte').some((c) => c.args[0] === 'spice_level' && c.args[1] === 3)).toBe(true);
  });

  it('paginates using range() derived from page/pageSize', async () => {
    const client = createFakeClient({ data: [], error: null, count: 30 });
    await searchRecipes(client, {}, { page: 2, pageSize: 12 });
    const rangeCalls = callsFor(client, 'range');
    expect(rangeCalls).toEqual([{ method: 'range', args: [12, 23] }]);
  });

  it('clamps the requested page down to the last available page', async () => {
    const client = createFakeClient({ data: [], error: null, count: 5 });
    const result = await searchRecipes(client, {}, { page: 9, pageSize: 12 });
    expect(result.page).toBe(1);
  });

  it('returns ok:false with an empty list on a query error, never a false "no results"', async () => {
    const client = createFakeClient({ data: null, error: { message: 'network down' }, count: 0 });
    const result = await searchRecipes(client, {}, { page: 1, pageSize: 12 });
    expect(result.ok).toBe(false);
    expect(result.data).toEqual([]);
  });
});

describe('fetchRecipeStats', () => {
  it('reads the recipe_stats view as a single row', async () => {
    const client = createFakeClient({ data: { total: 32, protein_smart: 0 }, error: null });
    const result = await fetchRecipeStats(client);
    expect(result).toEqual({ ok: true, data: { total: 32, protein_smart: 0 }, error: null });
  });

  it('returns ok:false on error', async () => {
    const client = createFakeClient({ data: null, error: { message: 'down' } });
    const result = await fetchRecipeStats(client);
    expect(result.ok).toBe(false);
  });
});

describe('fetchRecentRecipes', () => {
  it('orders by created_at desc and applies the limit, filtering is_deleted', async () => {
    const client = createFakeClient({ data: [{ id: 1 }], error: null });
    const result = await fetchRecentRecipes(client, 3);
    expect(result).toEqual({ ok: true, data: [{ id: 1 }], error: null });
    expect(callsFor(client, 'order')).toEqual([{ method: 'order', args: ['created_at', { ascending: false }] }]);
    expect(callsFor(client, 'limit')).toEqual([{ method: 'limit', args: [3] }]);
    expect(callsFor(client, 'eq').some((c) => c.args[0] === 'is_deleted' && c.args[1] === false)).toBe(true);
  });
});

describe('fetchCuisineCounts / fetchTagCounts', () => {
  it('reads cuisine_counts ordered by sort_order', async () => {
    const client = createFakeClient({ data: [{ cuisine: 'South Indian', sort_order: 10, recipes: 5 }], error: null });
    const result = await fetchCuisineCounts(client);
    expect(result.ok).toBe(true);
    expect(result.data[0].cuisine).toBe('South Indian');
  });

  it('reads tag_counts ordered by recipe count', async () => {
    const client = createFakeClient({ data: [{ tag: 'Quick', recipes: 4 }], error: null });
    const result = await fetchTagCounts(client);
    expect(result.ok).toBe(true);
    expect(result.data[0].tag).toBe('Quick');
  });
});

describe('fetchSearchSuggestions', () => {
  it('returns no results and makes no request under 2 characters', async () => {
    const client = createFakeClient({ data: [{ name: 'Poha' }], error: null });
    const result = await fetchSearchSuggestions(client, 'p');
    expect(result).toEqual({ ok: true, data: [], error: null });
    expect(client.queries.length).toBe(0);
  });

  it('queries name.ilike at 2+ characters, limited to 8', async () => {
    const client = createFakeClient({ data: [{ name: 'Poha' }, { name: 'Pohe' }], error: null });
    const result = await fetchSearchSuggestions(client, 'po');
    expect(result).toEqual({ ok: true, data: ['Poha', 'Pohe'], error: null });
    expect(callsFor(client, 'ilike')).toEqual([{ method: 'ilike', args: ['name', '*po*'] }]);
    expect(callsFor(client, 'limit')).toEqual([{ method: 'limit', args: [8] }]);
  });
});

describe('fetchRecipeById', () => {
  it('filters by id and is_deleted=false', async () => {
    const client = createFakeClient({ data: { id: 11, name: 'Kanda Poha' }, error: null });
    const result = await fetchRecipeById(client, 11);
    expect(result).toEqual({ id: 11, name: 'Kanda Poha' });
    expect(callsFor(client, 'eq').some((c) => c.args[0] === 'id' && c.args[1] === 11)).toBe(true);
    expect(callsFor(client, 'eq').some((c) => c.args[0] === 'is_deleted' && c.args[1] === false)).toBe(true);
  });

  it('returns null on error', async () => {
    const client = createFakeClient({ data: null, error: { message: 'not found' } });
    const result = await fetchRecipeById(client, 999);
    expect(result).toBeNull();
  });
});
