import { describe, expect, it } from 'vitest';
import { onRequestPatch, onRequestDelete } from '../../functions/api/recipes/[id].js';
import { fakeEnv, stubFetch, turnstileOk, rateLimitCount, cuisinesList, auditInsertOk, jsonResponse } from './helpers.js';

function makeRequest(method, body = {}) {
  return new Request('https://recipe-book-9eo.pages.dev/api/recipes/5', {
    method,
    headers: { 'Content-Type': 'application/json', Origin: 'https://recipe-book-9eo.pages.dev' },
    body: JSON.stringify(body),
  });
}

const patchBody = { recipe: { name: 'Updated Dal' }, expectedUpdatedAt: '2026-01-01T00:00:00Z', turnstileToken: 'x'.repeat(20) };

describe('PATCH /api/recipes/:id', () => {
  it('rejects an id that fails the id pattern with 404', async () => {
    const res = await onRequestPatch({ request: makeRequest('PATCH', patchBody), env: fakeEnv(), params: { id: 'abc' } });
    expect(res.status).toBe(404);
  });

  it('returns 404 not_found when the recipe does not exist (before-read)', async () => {
    stubFetch([
      turnstileOk,
      rateLimitCount(0),
      { test: (url) => url.includes('recipes?select=*') && url.includes('is_deleted=eq.false'), respond: () => jsonResponse(200, []) },
    ]);
    const res = await onRequestPatch({ request: makeRequest('PATCH', patchBody), env: fakeEnv(), params: { id: '5' } });
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('not_found');
  });

  it('maps PT409 from save_recipe to 409 edit_conflict with the current row', async () => {
    stubFetch([
      turnstileOk,
      rateLimitCount(0),
      { test: (url) => url.includes('recipes?select=*') && url.includes('is_deleted=eq.false'), respond: () => jsonResponse(200, [{ id: 5, name: 'Old Dal', updated_at: '2025-01-01T00:00:00Z' }]) },
      cuisinesList,
      { test: (url, init) => url.includes('rpc/save_recipe') && init.method === 'POST', respond: () => jsonResponse(409, { code: 'PT409', message: 'edit_conflict' }) },
      { test: (url) => url.includes('recipes?select=*') && !url.includes('is_deleted'), respond: () => jsonResponse(200, [{ id: 5, name: 'Someone Else Changed This', updated_at: '2026-02-02T00:00:00Z' }]) },
    ]);
    const res = await onRequestPatch({ request: makeRequest('PATCH', patchBody), env: fakeEnv(), params: { id: '5' } });
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.code).toBe('edit_conflict');
    expect(data.current.name).toBe('Someone Else Changed This');
  });

  it('maps PT400 dietary_mismatch to 400 validation_failed with evidence-based messages', async () => {
    stubFetch([
      turnstileOk,
      rateLimitCount(0),
      { test: (url) => url.includes('recipes?select=*') && url.includes('is_deleted=eq.false'), respond: () => jsonResponse(200, [{ id: 5, name: 'Old Dal', updated_at: '2025-01-01T00:00:00Z' }]) },
      cuisinesList,
      {
        test: (url, init) => url.includes('rpc/save_recipe') && init.method === 'POST',
        respond: () => jsonResponse(400, { code: 'PT400', message: 'dietary_mismatch', details: JSON.stringify({ contains_dairy: ['Paneer'] }) }),
      },
    ]);
    const res = await onRequestPatch({ request: makeRequest('PATCH', { ...patchBody, recipe: { contains_dairy: false } }), env: fakeEnv(), params: { id: '5' } });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.code).toBe('validation_failed');
    expect(data.errors.contains_dairy).toMatch(/Paneer/);
  });

  it('updates successfully and writes an audit row with before/after', async () => {
    const auditRows = [];
    stubFetch([
      turnstileOk,
      rateLimitCount(0),
      { test: (url) => url.includes('recipes?select=*') && url.includes('is_deleted=eq.false'), respond: () => jsonResponse(200, [{ id: 5, name: 'Old Dal', updated_at: '2025-01-01T00:00:00Z' }]) },
      cuisinesList,
      { test: (url, init) => url.includes('rpc/save_recipe') && init.method === 'POST', respond: () => jsonResponse(200, { id: 5, name: 'Updated Dal', updated_at: '2026-03-03T00:00:00Z' }) },
      auditInsertOk(auditRows),
    ]);
    const res = await onRequestPatch({ request: makeRequest('PATCH', patchBody), env: fakeEnv(), params: { id: '5' } });
    expect(res.status).toBe(200);
    expect((await res.json()).recipe.name).toBe('Updated Dal');
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].action).toBe('update');
    expect(auditRows[0].before.name).toBe('Old Dal');
  });
});

describe('DELETE /api/recipes/:id', () => {
  it('returns 404 when the recipe is already gone', async () => {
    stubFetch([
      turnstileOk,
      rateLimitCount(0),
      { test: (url) => url.includes('recipes?select=*'), respond: () => jsonResponse(200, []) },
    ]);
    const res = await onRequestDelete({ request: makeRequest('DELETE', { turnstileToken: 'x'.repeat(20) }), env: fakeEnv(), params: { id: '5' } });
    expect(res.status).toBe(404);
  });

  it('soft-deletes successfully and writes an audit row (never on failure)', async () => {
    const auditRows = [];
    stubFetch([
      turnstileOk,
      rateLimitCount(0),
      { test: (url) => url.includes('recipes?select=*') && url.includes('is_deleted=eq.false'), respond: () => jsonResponse(200, [{ id: 5, name: 'Old Dal' }]) },
      { test: (url, init) => url.includes('recipes?id=eq.5') && init.method === 'PATCH', respond: () => jsonResponse(200, {}) },
      auditInsertOk(auditRows),
    ]);
    const res = await onRequestDelete({ request: makeRequest('DELETE', { turnstileToken: 'x'.repeat(20) }), env: fakeEnv(), params: { id: '5' } });
    expect(res.status).toBe(200);
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].action).toBe('delete');
  });
});
