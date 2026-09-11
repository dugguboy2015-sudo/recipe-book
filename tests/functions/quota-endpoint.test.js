import { describe, expect, it, beforeEach } from 'vitest';
import { onRequestGet } from '../../functions/api/recipes/generate/quota.js';
import { fakeEnv, stubFetch, jsonResponse } from './helpers.js';

function makeRequest({ origin = 'https://recipe-book-9eo.pages.dev' } = {}) {
  const headers = {};
  if (origin !== null) headers.Origin = origin;
  return new Request('https://recipe-book-9eo.pages.dev/api/recipes/generate/quota', { headers });
}

function generationCount(n) {
  return { test: (url, init) => url.includes('recipe_generations') && init.method === 'HEAD', respond: () => new Response(null, { status: 200, headers: { 'Content-Range': `0-0/${n}` } }) };
}

const noRecentGenerations = { test: (url, init) => url.includes('recipe_generations?select=protein_smart') && init.method === 'GET', respond: () => jsonResponse(200, []) };

describe('GET /api/recipes/generate/quota', () => {
  beforeEach(() => {
    globalThis.fetch = undefined;
  });

  it('rejects a mismatched Origin with 403', async () => {
    const res = await onRequestGet({ request: makeRequest({ origin: 'https://evil.example.com' }), env: fakeEnv() });
    expect(res.status).toBe(403);
  });

  it('returns remainingToday/remainingForYou/resetsAt/proteinSmartShare', async () => {
    stubFetch([generationCount(3), noRecentGenerations]);
    const res = await onRequestGet({ request: makeRequest(), env: fakeEnv({ GEN_GLOBAL_DAILY: '18', GEN_PER_IP_DAILY: '5' }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({ remainingToday: 15, remainingForYou: 2, proteinSmartShare: 0 });
    expect(typeof data.resetsAt).toBe('string');
  });

  it('never goes negative once the quota is already exceeded', async () => {
    stubFetch([generationCount(25), noRecentGenerations]);
    const res = await onRequestGet({ request: makeRequest(), env: fakeEnv({ GEN_GLOBAL_DAILY: '18', GEN_PER_IP_DAILY: '5' }) });
    const data = await res.json();
    expect(data.remainingToday).toBe(0);
    expect(data.remainingForYou).toBe(0);
  });

  it('computes proteinSmartShare from the recent-generations pool', async () => {
    stubFetch([
      generationCount(0),
      { test: (url) => url.includes('recipe_generations?select=protein_smart') && url.includes('outcome=eq.saved'), respond: () => jsonResponse(200, [{ protein_smart: true }, { protein_smart: true }, { protein_smart: false }, { protein_smart: false }, { protein_smart: false }]) },
    ]);
    const res = await onRequestGet({ request: makeRequest(), env: fakeEnv() });
    const data = await res.json();
    expect(data.proteinSmartShare).toBeCloseTo(0.4, 5);
  });
});
