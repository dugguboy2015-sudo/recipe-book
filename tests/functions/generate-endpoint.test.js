import { describe, expect, it, beforeEach, vi } from 'vitest';
import { onRequestPost } from '../../functions/api/recipes/generate.js';
import { fakeEnv, stubFetch, turnstileOk, turnstileFail, cuisinesList, jsonResponse } from './helpers.js';

function makeRequest({ origin = 'https://recipe-book-9eo.pages.dev', body = {} } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (origin !== null) headers.Origin = origin;
  return new Request('https://recipe-book-9eo.pages.dev/api/recipes/generate', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function generationCount(globalN, ipN = globalN) {
  return {
    test: (url, init) => url.includes('recipe_generations') && init.method === 'HEAD',
    respond: (url) => new Response(null, { status: 200, headers: { 'Content-Range': `0-0/${url.includes('ip_hash') ? ipN : globalN}` } }),
  };
}

const noSimilarRecipes = { test: (url, init) => url.includes('rpc/similar_recipes') && init.method === 'POST', respond: () => jsonResponse(200, []) };
const noRecentGenerations = { test: (url, init) => url.includes('recipe_generations?select=protein_smart') && init.method === 'GET', respond: () => jsonResponse(200, []) };
const similarRecipeMatch = { test: (url, init) => url.includes('rpc/similar_recipes') && init.method === 'POST', respond: () => jsonResponse(200, [{ id: 11, name: 'Kanda Poha', score: 0.8 }]) };
const noIngredientUsage = { test: (url) => url.includes('ingredient_usage'), respond: () => jsonResponse(200, []) };
const noIngredientMatches = { test: (url, init) => url.includes('ingredients?') || url.includes('ingredient_aliases?') || (url.includes('rpc/match_ingredient') && init.method === 'POST'), respond: () => jsonResponse(200, []) };
const noNameCollision = { test: (url) => url.includes('recipes?select=id,name&slug='), respond: () => jsonResponse(200, []) };
const generationInsertOk = (rows = []) => ({
  test: (url, init) => url.endsWith('/recipe_generations') && init.method === 'POST',
  respond: (url, init) => {
    const row = JSON.parse(init.body);
    rows.push(row);
    return jsonResponse(201, [{ ...row, id: `gen-${rows.length}` }]);
  },
});

const validBody = { prompt: 'paneer butter masala, lighter than usual', turnstileToken: 'x'.repeat(20) };

const goodDraft = {
  request_ok: true, refusal_reason: null, name: 'Paneer Butter Masala', description: 'A lighter version.', cuisine: 'North Indian',
  origin_note: null, meal_types: ['Dinner'], tags: [], serves: 4, spice_level: 3,
  prep_time_minutes: 10, cook_time_minutes: 20, total_time_minutes: 30, time_note: null,
  ingredients: [{ group: 'Ingredients', items: [{ name: 'paneer', category: 'dairy', quantity: 1, unit: 'cup', preparation: '', optional: false }] }],
  steps: [{ group: 'Method', steps: ['Cook it.'] }],
  is_vegetarian: true, is_egg_free: true, contains_dairy: true, egg_check_notes: 'No eggs used.',
  calories_kcal: 350, protein_g: 20, carbs_g: 20, sugars_g: 5, fibre_g: 4, fat_g: 18, saturates_g: 8, salt_g: 1,
  nutrition_basis: 'Per serving. Estimate.', lunchbox_notes: null, common_mistakes: null, uk_sourcing_notes: null, storage_notes: null, kid_friendly_notes: null,
};

function fakeGenEnv(overrides = {}) {
  return fakeEnv({ AI_MODEL: '@cf/test-model', GEMINI_MODEL: 'gemini-test', AI: { run: vi.fn() }, ...overrides });
}

const happyPathHandlers = () => [turnstileOk, generationCount(0), noSimilarRecipes, noRecentGenerations, cuisinesList, noIngredientUsage, noIngredientMatches, noNameCollision, generationInsertOk()];

describe('POST /api/recipes/generate — short-circuits (no model call)', () => {
  beforeEach(() => {
    globalThis.fetch = undefined;
  });

  it('rejects a mismatched Origin with 403, before touching Turnstile or the database', async () => {
    const env = fakeGenEnv();
    const res = await onRequestPost({ request: makeRequest({ origin: 'https://evil.example.com' }), env });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('origin_not_allowed');
    expect(env.AI.run).not.toHaveBeenCalled();
  });

  it('rejects a too-short prompt with 400 validation_failed', async () => {
    stubFetch([]);
    const env = fakeGenEnv();
    const res = await onRequestPost({ request: makeRequest({ body: { prompt: 'hi', turnstileToken: 'x'.repeat(20) } }), env });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('validation_failed');
    expect(env.AI.run).not.toHaveBeenCalled();
  });

  it('rejects an out-of-range constraint with 400 validation_failed', async () => {
    stubFetch([]);
    const res = await onRequestPost({ request: makeRequest({ body: { ...validBody, constraints: { serves: 99 } } }), env: fakeGenEnv() });
    expect(res.status).toBe(400);
  });

  it('rejects a failed Turnstile check with 403, before any quota check', async () => {
    stubFetch([turnstileFail]);
    const env = fakeGenEnv();
    const res = await onRequestPost({ request: makeRequest({ body: validBody }), env });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('verification_failed');
    expect(env.AI.run).not.toHaveBeenCalled();
  });

  it('rejects with 429 generation_limit scope:site when the global daily count is met, before the duplicate precheck', async () => {
    stubFetch([turnstileOk, generationCount(18)]);
    const env = fakeGenEnv({ GEN_GLOBAL_DAILY: '18' });
    const res = await onRequestPost({ request: makeRequest({ body: validBody }), env });
    expect(res.status).toBe(429);
    const data = await res.json();
    expect(data).toMatchObject({ code: 'generation_limit', scope: 'site' });
    expect(env.AI.run).not.toHaveBeenCalled();
  });

  it('rejects with 429 generation_limit scope:you when the per-IP daily count is met', async () => {
    stubFetch([turnstileOk, generationCount(0, 5)]);
    const env = fakeGenEnv({ GEN_PER_IP_DAILY: '5' });
    const res = await onRequestPost({ request: makeRequest({ body: validBody }), env });
    expect(res.status).toBe(429);
    expect((await res.json())).toMatchObject({ code: 'generation_limit', scope: 'you' });
  });

  it('rejects with 409 similar_exists on a >=0.6 match, without ever calling the model or logging a generation row', async () => {
    const genRows = [];
    stubFetch([turnstileOk, generationCount(0), similarRecipeMatch, generationInsertOk(genRows)]);
    const env = fakeGenEnv();
    const res = await onRequestPost({ request: makeRequest({ body: { prompt: 'kanda poha', turnstileToken: 'x'.repeat(20) } }), env });
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.code).toBe('similar_exists');
    expect(data.matches[0].name).toBe('Kanda Poha');
    expect(env.AI.run).not.toHaveBeenCalled();
    expect(genRows).toHaveLength(0);
  });

  it('force:true skips the duplicate precheck entirely', async () => {
    stubFetch([...happyPathHandlers()]);
    const env = fakeGenEnv();
    env.AI.run.mockResolvedValue({ response: goodDraft });
    const res = await onRequestPost({ request: makeRequest({ body: { ...validBody, force: true } }), env });
    expect(res.status).toBe(200);
  });
});

describe('POST /api/recipes/generate — success path', () => {
  beforeEach(() => {
    globalThis.fetch = undefined;
  });

  it('returns 200 with the expected response shape on a clean draft', async () => {
    const genRows = [];
    stubFetch([turnstileOk, generationCount(0), noSimilarRecipes, noRecentGenerations, cuisinesList, noIngredientUsage, noIngredientMatches, noNameCollision, generationInsertOk(genRows)]);
    const env = fakeGenEnv();
    env.AI.run.mockResolvedValue({ response: goodDraft, usage: { prompt_tokens: 2000, completion_tokens: 800 } });

    const res = await onRequestPost({ request: makeRequest({ body: validBody }), env });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.draft.name).toBe('Paneer Butter Masala');
    expect(data.draft.ingredients[0].items[0].ingredient).toMatchObject({ name: 'paneer', isNew: true });
    expect(data.usage).toMatchObject({ provider: 'workers-ai', model: '@cf/test-model' });
    expect(typeof data.generationId).toBe('string');
    expect(genRows).toHaveLength(1);
    expect(genRows[0].outcome).toBe('generated');
  });

  it("the draft never contains id, slug, is_deleted or timestamps", async () => {
    stubFetch([...happyPathHandlers()]);
    const env = fakeGenEnv();
    env.AI.run.mockResolvedValue({ response: goodDraft });
    const res = await onRequestPost({ request: makeRequest({ body: validBody }), env });
    const data = await res.json();
    for (const key of ['id', 'slug', 'is_deleted', 'created_at', 'updated_at', 'deleted_at']) {
      expect(data.draft).not.toHaveProperty(key);
    }
  });

  it('handles a response already parsed as an object', async () => {
    stubFetch([...happyPathHandlers()]);
    const env = fakeGenEnv();
    env.AI.run.mockResolvedValue({ response: goodDraft });
    const res = await onRequestPost({ request: makeRequest({ body: validBody }), env });
    expect(res.status).toBe(200);
  });

  it('handles a response as a JSON string', async () => {
    stubFetch([...happyPathHandlers()]);
    const env = fakeGenEnv();
    env.AI.run.mockResolvedValue({ response: JSON.stringify(goodDraft) });
    const res = await onRequestPost({ request: makeRequest({ body: validBody }), env });
    expect(res.status).toBe(200);
  });

  it('handles a response wrapped in markdown fences', async () => {
    stubFetch([...happyPathHandlers()]);
    const env = fakeGenEnv();
    env.AI.run.mockResolvedValue({ response: `Here:\n\`\`\`json\n${JSON.stringify(goodDraft)}\n\`\`\`` });
    const res = await onRequestPost({ request: makeRequest({ body: validBody }), env });
    expect(res.status).toBe(200);
  });
});

describe('POST /api/recipes/generate — refusal, retry, fallback, and failure paths', () => {
  beforeEach(() => {
    globalThis.fetch = undefined;
  });

  it('returns 422 not_a_recipe and logs outcome:refused when the model declines', async () => {
    const genRows = [];
    stubFetch([turnstileOk, generationCount(0), noSimilarRecipes, noRecentGenerations, cuisinesList, noIngredientUsage, generationInsertOk(genRows)]);
    const env = fakeGenEnv();
    env.AI.run.mockResolvedValue({ response: { ...goodDraft, request_ok: false, refusal_reason: 'That is not a food request.' } });

    const res = await onRequestPost({ request: makeRequest({ body: { prompt: 'write me a poem about cars', turnstileToken: 'x'.repeat(20) } }), env });

    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('not_a_recipe');
    expect(genRows).toHaveLength(1);
    expect(genRows[0].outcome).toBe('refused');
  });

  it('retries once with feedback on a household-rule violation and succeeds on the corrected draft', async () => {
    const genRows = [];
    stubFetch([turnstileOk, generationCount(0), noSimilarRecipes, noRecentGenerations, cuisinesList, noIngredientUsage, noIngredientMatches, noNameCollision, generationInsertOk(genRows)]);
    const env = fakeGenEnv();
    const badDraft = { ...goodDraft, ingredients: [{ group: 'Ingredients', items: [{ name: 'chicken', category: 'plant_protein', quantity: 1, unit: 'cup', preparation: '', optional: false }] }] };
    env.AI.run
      .mockResolvedValueOnce({ response: badDraft })
      .mockResolvedValueOnce({ response: goodDraft });

    const res = await onRequestPost({ request: makeRequest({ body: validBody }), env });

    expect(res.status).toBe(200);
    expect(env.AI.run).toHaveBeenCalledTimes(2);
    const secondCallMessages = env.AI.run.mock.calls[1][1].messages;
    expect(secondCallMessages.some((m) => m.content.includes('chicken'))).toBe(true);
    expect(genRows).toHaveLength(2);
    expect(genRows.map((r) => r.outcome)).toEqual(['invalid', 'generated']);
  });

  it('returns 502 invalid_output when the household violation persists after the one retry', async () => {
    const genRows = [];
    stubFetch([turnstileOk, generationCount(0), noSimilarRecipes, noRecentGenerations, cuisinesList, noIngredientUsage, noIngredientMatches, noNameCollision, generationInsertOk(genRows)]);
    const env = fakeGenEnv();
    const badDraft = { ...goodDraft, is_vegetarian: false };
    env.AI.run.mockResolvedValue({ response: badDraft });

    const res = await onRequestPost({ request: makeRequest({ body: validBody }), env });

    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe('invalid_output');
    expect(env.AI.run).toHaveBeenCalledTimes(2);
  });

  it('returns 502 invalid_output after two unparseable responses with no Gemini key configured', async () => {
    const genRows = [];
    stubFetch([turnstileOk, generationCount(0), noSimilarRecipes, noRecentGenerations, cuisinesList, noIngredientUsage, generationInsertOk(genRows)]);
    const env = fakeGenEnv();
    env.AI.run.mockResolvedValue({ response: 'not json at all' });

    const res = await onRequestPost({ request: makeRequest({ body: validBody }), env });

    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe('invalid_output');
    expect(genRows.every((r) => r.outcome === 'error')).toBe(true);
  });

  it('falls back to Gemini when Workers AI is unavailable and a Gemini key is set', async () => {
    const genRows = [];
    stubFetch([
      turnstileOk, generationCount(0), noSimilarRecipes, noRecentGenerations, cuisinesList, noIngredientUsage, noIngredientMatches, noNameCollision,
      { test: (url) => url.includes('generativelanguage.googleapis.com'), respond: () => jsonResponse(200, { candidates: [{ content: { parts: [{ text: JSON.stringify(goodDraft) }] } }] }) },
      generationInsertOk(genRows),
    ]);
    const env = fakeGenEnv({ GEMINI_API_KEY: 'test-key' });
    env.AI.run.mockRejectedValue(new Error('capacity exceeded'));

    const res = await onRequestPost({ request: makeRequest({ body: validBody }), env });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.usage.provider).toBe('gemini');
  });

  it('returns 503 generation_unavailable on a Workers AI error with no Gemini key configured', async () => {
    const genRows = [];
    stubFetch([turnstileOk, generationCount(0), noSimilarRecipes, noRecentGenerations, cuisinesList, noIngredientUsage, generationInsertOk(genRows)]);
    const env = fakeGenEnv();
    env.AI.run.mockRejectedValue(new Error('capacity exceeded'));

    const res = await onRequestPost({ request: makeRequest({ body: validBody }), env });

    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('generation_unavailable');
    expect(env.AI.run).toHaveBeenCalledTimes(1);
  });
});
