import { describe, expect, it, beforeEach } from 'vitest';
import { onRequestPost } from '../../functions/api/recipes/index.js';
import { fakeEnv, stubFetch, signedInMember, signedInNoHousehold, AUTH_HEADER, rateLimitCount, cuisinesList, auditInsertOk, jsonResponse } from './helpers.js';

const validRecipe = {
  name: 'Test Dal', cuisine: 'North Indian', description: 'A simple dal.', serves: 4,
  total_time_minutes: 30, steps: [{ group: 'Method', steps: ['Cook the dal.'] }],
  is_vegetarian: true, is_egg_free: true, contains_dairy: false,
  // Phase 10: nutrition is required to save.
  calories_kcal: 250, protein_g: 12, carbs_g: 30, sugars_g: 3, fibre_g: 6, fat_g: 8, saturates_g: 2, salt_g: 0.8,
};

function makeRequest({ origin = 'https://recipe-book-9eo.pages.dev', body = {}, signedIn = true } = {}) {
  const headers = { 'Content-Type': 'application/json', ...(signedIn ? AUTH_HEADER : {}) };
  if (origin !== null) headers.Origin = origin;
  return new Request('https://recipe-book-9eo.pages.dev/api/recipes', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('POST /api/recipes', () => {
  beforeEach(() => {
    globalThis.fetch = undefined;
  });

  it('rejects a mismatched Origin with 403 origin_not_allowed', async () => {
    const res = await onRequestPost({ request: makeRequest({ origin: 'https://evil.example.com' }), env: fakeEnv() });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('origin_not_allowed');
  });

  it('rejects invalid JSON with 400 invalid_json', async () => {
    stubFetch([]);
    const res = await onRequestPost({ request: makeRequest({ body: '{not json' }), env: fakeEnv() });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('invalid_json');
  });

  it('rejects a signed-out request with 401 sign_in_required', async () => {
    stubFetch([]);
    const res = await onRequestPost({ request: makeRequest({ body: { recipe: validRecipe }, signedIn: false }), env: fakeEnv() });
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('sign_in_required');
  });

  it('rejects a signed-in user with no household with 403 no_household', async () => {
    stubFetch([...signedInNoHousehold]);
    const res = await onRequestPost({ request: makeRequest({ body: { recipe: validRecipe } }), env: fakeEnv() });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('no_household');
  });

  it('rate-limits at WRITES_PER_USER_HOURLY with 429 and a Retry-After header', async () => {
    stubFetch([...signedInMember(), rateLimitCount(30)]);
    const res = await onRequestPost({ request: makeRequest({ body: { recipe: validRecipe } }), env: fakeEnv({ WRITES_PER_USER_HOURLY: '30' }) });
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeTruthy();
    expect((await res.json()).code).toBe('rate_limited');
  });

  it('rejects an invalid recipe with 400 validation_failed and field errors', async () => {
    stubFetch([...signedInMember(), rateLimitCount(0), cuisinesList]);
    const res = await onRequestPost({ request: makeRequest({ body: { recipe: { ...validRecipe, name: '' } } }), env: fakeEnv() });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.code).toBe('validation_failed');
    expect(data.errors.name).toBeTruthy();
  });

  it('rejects a recipe missing nutrition with 400 validation_failed (Phase 10: nutrition is required)', async () => {
    stubFetch([...signedInMember(), rateLimitCount(0), cuisinesList]);
    const withoutCalories = { ...validRecipe };
    delete withoutCalories.calories_kcal;
    const res = await onRequestPost({ request: makeRequest({ body: { recipe: withoutCalories } }), env: fakeEnv() });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.code).toBe('validation_failed');
    expect(data.errors.calories_kcal).toBeTruthy();
  });

  it('creates a recipe and writes an audit row on success', async () => {
    const auditRows = [];
    stubFetch([
      ...signedInMember(),
      rateLimitCount(0),
      cuisinesList,
      {
        test: (url, init) => url.includes('rpc/save_household_recipe') && init.method === 'POST',
        respond: () => jsonResponse(200, { id: 42, name: validRecipe.name, updated_at: '2026-01-01T00:00:00Z' }),
      },
      auditInsertOk(auditRows),
    ]);
    const res = await onRequestPost({
      request: makeRequest({ body: { recipe: validRecipe, ingredients: [{ group: 'Ingredients', items: [{ ingredient: { name: 'toor dal' } }] }] } }),
      env: fakeEnv(),
    });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.recipe.id).toBe(42);
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].action).toBe('create');
  });

  it('maps a unique-slug violation to 409 duplicate_recipe and does not write an audit row', async () => {
    const auditRows = [];
    stubFetch([
      ...signedInMember(),
      rateLimitCount(0),
      cuisinesList,
      {
        test: (url, init) => url.includes('rpc/save_household_recipe') && init.method === 'POST',
        respond: () => jsonResponse(409, { code: '23505', message: 'duplicate key value violates unique constraint "recipes_slug_active_uidx"' }),
      },
      {
        test: (url) => url.includes('recipes?select=id,name'),
        respond: () => jsonResponse(200, [{ id: 7, name: validRecipe.name }]),
      },
      auditInsertOk(auditRows),
    ]);
    const res = await onRequestPost({
      request: makeRequest({ body: { recipe: validRecipe, ingredients: [{ group: 'Ingredients', items: [{ ingredient: { name: 'toor dal' } }] }] } }),
      env: fakeEnv(),
    });
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.code).toBe('duplicate_recipe');
    expect(data.existing.id).toBe(7);
    expect(auditRows).toHaveLength(0);
  });
});
