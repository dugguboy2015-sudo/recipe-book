import { describe, expect, it } from 'vitest';
import { onRequestPost } from '../../functions/api/recipes/[id]/restore.js';
import { fakeEnv, stubFetch, turnstileOk, rateLimitCount, auditInsertOk, jsonResponse } from './helpers.js';

function makeRequest() {
  return new Request('https://recipe-book-9eo.pages.dev/api/recipes/5/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://recipe-book-9eo.pages.dev' },
    body: JSON.stringify({ turnstileToken: 'x'.repeat(20) }),
  });
}

describe('POST /api/recipes/:id/restore', () => {
  it('returns 404 when there is no soft-deleted recipe with that id', async () => {
    stubFetch([turnstileOk, rateLimitCount(0), { test: (url) => url.includes('is_deleted=eq.true'), respond: () => jsonResponse(200, []) }]);
    const res = await onRequestPost({ request: makeRequest(), env: fakeEnv(), params: { id: '5' } });
    expect(res.status).toBe(404);
  });

  it('maps a slug collision with an active recipe to 409 duplicate_recipe', async () => {
    stubFetch([
      turnstileOk,
      rateLimitCount(0),
      { test: (url, init) => url.includes('is_deleted=eq.true') && (!init.method || init.method === 'GET'), respond: () => jsonResponse(200, [{ id: 5, name: 'Old Name' }]) },
      { test: (url, init) => url.includes('recipes?id=eq.5') && init.method === 'PATCH', respond: () => jsonResponse(409, { code: '23505', message: 'duplicate key value violates unique constraint "recipes_slug_active_uidx"' }) },
    ]);
    const res = await onRequestPost({ request: makeRequest(), env: fakeEnv(), params: { id: '5' } });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('duplicate_recipe');
  });

  it('restores successfully and writes an audit row', async () => {
    const auditRows = [];
    stubFetch([
      turnstileOk,
      rateLimitCount(0),
      { test: (url, init) => url.includes('is_deleted=eq.true') && (!init.method || init.method === 'GET'), respond: () => jsonResponse(200, [{ id: 5, name: 'Old Name' }]) },
      { test: (url, init) => url.includes('recipes?id=eq.5') && init.method === 'PATCH', respond: () => jsonResponse(200, [{ id: 5, name: 'Old Name', is_deleted: false }]) },
      auditInsertOk(auditRows),
    ]);
    const res = await onRequestPost({ request: makeRequest(), env: fakeEnv(), params: { id: '5' } });
    expect(res.status).toBe(200);
    expect((await res.json()).recipe.is_deleted).toBe(false);
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].action).toBe('restore');
  });
});
