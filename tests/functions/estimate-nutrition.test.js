import { describe, expect, it, vi, beforeEach } from 'vitest';
import { onRequestPost } from '../../functions/api/recipes/estimate-nutrition.js';
import { fakeEnv, stubFetch, turnstileOk, turnstileFail, jsonResponse } from './helpers.js';

function makeRequest({ origin = 'https://recipe-book-9eo.pages.dev', body = {} } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (origin !== null) headers.Origin = origin;
  return new Request('https://recipe-book-9eo.pages.dev/api/recipes/estimate-nutrition', {
    method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function generationCount(n) {
  return { test: (url, init) => url.includes('recipe_generations') && init.method === 'HEAD', respond: () => new Response(null, { status: 200, headers: { 'Content-Range': `0-0/${n}` } }) };
}

const generationInsertOk = { test: (url, init) => url.endsWith('/recipe_generations') && init.method === 'POST', respond: () => jsonResponse(201, [{ id: 'gen-1' }]) };

const validBody = {
  name: 'Dal Fry', serves: 4, turnstileToken: 'x'.repeat(20),
  ingredients: [{ group: 'Ingredients', items: [{ ingredient: { name: 'toor dal' }, quantity: 1, unit: 'cup', preparation: 'washed' }] }],
};

const goodNutrition = { calories_kcal: 250, protein_g: 12, carbs_g: 30, sugars_g: 3, fibre_g: 6, fat_g: 8, saturates_g: 2, salt_g: 0.8, nutrition_basis: 'Per serving (1 of 4). Estimate, not lab-tested.' };

function fakeGenEnv(overrides = {}) {
  return fakeEnv({ AI_MODEL: '@cf/test-model', AI: { run: vi.fn() }, ...overrides });
}

describe('POST /api/recipes/estimate-nutrition', () => {
  beforeEach(() => {
    globalThis.fetch = undefined;
  });

  it('rejects a mismatched Origin with 403', async () => {
    const res = await onRequestPost({ request: makeRequest({ origin: 'https://evil.example.com' }), env: fakeGenEnv() });
    expect(res.status).toBe(403);
  });

  it('rejects a request with no ingredients with 400 validation_failed', async () => {
    stubFetch([]);
    const res = await onRequestPost({ request: makeRequest({ body: { ...validBody, ingredients: [] } }), env: fakeGenEnv() });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('validation_failed');
  });

  it('rejects a failed Turnstile check with 403', async () => {
    stubFetch([turnstileFail]);
    const res = await onRequestPost({ request: makeRequest({ body: validBody }), env: fakeGenEnv() });
    expect(res.status).toBe(403);
  });

  it('rejects with 429 when the daily quota is met', async () => {
    stubFetch([turnstileOk, generationCount(18)]);
    const res = await onRequestPost({ request: makeRequest({ body: validBody }), env: fakeGenEnv({ GEN_GLOBAL_DAILY: '18' }) });
    expect(res.status).toBe(429);
  });

  it('returns 200 {nutrition, warnings} on a clean estimate, and never touches recipes', async () => {
    stubFetch([turnstileOk, generationCount(0), generationInsertOk]);
    const env = fakeGenEnv();
    env.AI.run.mockResolvedValue({ response: goodNutrition });

    const res = await onRequestPost({ request: makeRequest({ body: validBody }), env });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.nutrition).toMatchObject({ calories_kcal: 250, protein_g: 12 });
    expect(data.warnings).toEqual([]);
  });

  it('resolves an ingredient by id via the database when the client sent no name', async () => {
    stubFetch([
      turnstileOk, generationCount(0),
      { test: (url) => url.includes('ingredients?select=id,display_name,name'), respond: () => jsonResponse(200, [{ id: 5, display_name: 'Toor dal', name: 'toor dal' }]) },
      generationInsertOk,
    ]);
    const env = fakeGenEnv();
    env.AI.run.mockResolvedValue({ response: goodNutrition });

    const body = { ...validBody, ingredients: [{ group: 'Ingredients', items: [{ ingredient: { id: 5 }, quantity: 1, unit: 'cup', preparation: '' }] }] };
    const res = await onRequestPost({ request: makeRequest({ body }), env });

    expect(res.status).toBe(200);
    expect(env.AI.run).toHaveBeenCalled();
    const messages = env.AI.run.mock.calls[0][1].messages;
    expect(messages[1].content).toContain('Toor dal');
  });

  it('returns 502 invalid_output when a required nutrition field is missing', async () => {
    stubFetch([turnstileOk, generationCount(0), generationInsertOk]);
    const env = fakeGenEnv();
    env.AI.run.mockResolvedValue({ response: { ...goodNutrition, protein_g: undefined } });

    const res = await onRequestPost({ request: makeRequest({ body: validBody }), env });

    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe('invalid_output');
  });

  it('returns 503 generation_unavailable on a Workers AI error with no Gemini key configured', async () => {
    stubFetch([turnstileOk, generationCount(0), generationInsertOk]);
    const env = fakeGenEnv();
    env.AI.run.mockRejectedValue(new Error('capacity exceeded'));

    const res = await onRequestPost({ request: makeRequest({ body: validBody }), env });

    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('generation_unavailable');
  });
});
