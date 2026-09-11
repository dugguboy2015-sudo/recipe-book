import { describe, expect, it } from 'vitest';
import { fetchRecipesList, fetchCuisineOptions, fetchTagOptions, fetchRecipeById } from '../../public/js/lib/queries.js';

function createFakeClient(response) {
  const queries = [];

  function makeBuilder(table) {
    const record = { table, calls: [] };
    queries.push(record);
    const builder = {};
    for (const method of ['select', 'eq', 'or', 'contains', 'not', 'order', 'range', 'limit']) {
      builder[method] = (...args) => {
        record.calls.push({ method, args });
        return builder;
      };
    }
    builder.single = (...args) => {
      record.calls.push({ method: 'single', args });
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

describe('fetchRecipesList', () => {
  it('always filters is_deleted=false, with no other filters by default', async () => {
    const client = createFakeClient({ data: [], error: null, count: 0 });
    await fetchRecipesList(client, { search: '', cuisine: '', tags: [], vegetarian: false, eggFree: false, dairyFree: false }, { page: 1, pageSize: 12 });
    const isDeletedCalls = callsFor(client, 'eq').filter((c) => c.args[0] === 'is_deleted');
    expect(isDeletedCalls.length).toBe(2); // count query + data query
    expect(isDeletedCalls.every((c) => c.args[1] === false)).toBe(true);
  });

  it('applies search, cuisine, tags and dietary filters as PostgREST calls', async () => {
    const client = createFakeClient({ data: [], error: null, count: 0 });
    await fetchRecipesList(
      client,
      { search: 'poha', cuisine: 'Maharashtrian', tags: ['Snack'], vegetarian: true, eggFree: true, dairyFree: true },
      { page: 1, pageSize: 12 },
    );

    const orCalls = callsFor(client, 'or');
    expect(orCalls.length).toBe(2);
    expect(orCalls[0].args[0]).toContain('name.ilike."*poha*"');
    expect(orCalls[0].args[0]).toContain('description.ilike."*poha*"');

    const cuisineCalls = callsFor(client, 'eq').filter((c) => c.args[0] === 'cuisine');
    expect(cuisineCalls.every((c) => c.args[1] === 'Maharashtrian')).toBe(true);

    const containsCalls = callsFor(client, 'contains');
    expect(containsCalls.every((c) => c.args[0] === 'tags' && c.args[1][0] === 'Snack')).toBe(true);

    expect(callsFor(client, 'eq').some((c) => c.args[0] === 'is_vegetarian' && c.args[1] === true)).toBe(true);
    expect(callsFor(client, 'eq').some((c) => c.args[0] === 'is_egg_free' && c.args[1] === true)).toBe(true);
    expect(callsFor(client, 'eq').some((c) => c.args[0] === 'contains_dairy' && c.args[1] === false)).toBe(true);
  });

  it('paginates using range() derived from page/pageSize', async () => {
    const client = createFakeClient({ data: [], error: null, count: 30 });
    await fetchRecipesList(client, { search: '', cuisine: '', tags: [] }, { page: 2, pageSize: 12 });
    const rangeCalls = callsFor(client, 'range');
    expect(rangeCalls).toEqual([{ method: 'range', args: [12, 23] }]);
  });

  it('clamps the requested page down to the last available page', async () => {
    const client = createFakeClient({ data: [], error: null, count: 5 });
    const { page } = await fetchRecipesList(client, { search: '', cuisine: '', tags: [] }, { page: 9, pageSize: 12 });
    expect(page).toBe(1);
  });
});

describe('fetchCuisineOptions', () => {
  it('filters is_deleted=false and excludes null cuisines', async () => {
    const client = createFakeClient({ data: [{ cuisine: 'Maharashtrian' }, { cuisine: 'Maharashtrian' }], error: null });
    const result = await fetchCuisineOptions(client);
    expect(result).toEqual(['Maharashtrian']);
    expect(callsFor(client, 'eq').some((c) => c.args[0] === 'is_deleted' && c.args[1] === false)).toBe(true);
    expect(callsFor(client, 'not').some((c) => c.args[0] === 'cuisine')).toBe(true);
  });
});

describe('fetchTagOptions', () => {
  it('flattens and dedupes tags across recipes', async () => {
    const client = createFakeClient({ data: [{ tags: ['Snack', 'Lunch'] }, { tags: ['Snack'] }], error: null });
    const result = await fetchTagOptions(client);
    expect(result).toEqual(['Lunch', 'Snack']);
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
