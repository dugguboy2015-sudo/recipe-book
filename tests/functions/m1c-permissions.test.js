import { describe, expect, it } from 'vitest';
import { onRequestPost as createRecipe } from '../../functions/api/recipes/index.js';
import { onRequestPatch, onRequestDelete } from '../../functions/api/recipes/[id].js';
import { onRequestPost as approveRecipe } from '../../functions/api/recipes/[id]/approve.js';
import { onRequestPost as restoreRecipe } from '../../functions/api/recipes/[id]/restore.js';
import { canEditRecipe, initialCatalogueStatus } from '../../functions/_lib/write-guard.js';
import {
  fakeEnv, stubFetch, signedInMember, AUTH_HEADER, rateLimitCount, cuisinesList, auditInsertOk, jsonResponse,
  TEST_HOUSEHOLD_ID, TEST_USER_ID,
} from './helpers.js';

const OTHER_HOUSEHOLD = '33333333-3333-4333-8333-333333333333';
const ORIGIN = 'https://recipe-book-9eo.pages.dev';

function request(path, method, body = {}) {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...AUTH_HEADER },
    body: JSON.stringify(body),
  });
}

const validRecipe = {
  name: 'Test Dal', cuisine: 'North Indian', description: 'A simple dal.', serves: 4,
  total_time_minutes: 30, steps: [{ group: 'Method', steps: ['Cook the dal.'] }],
  is_vegetarian: true, is_egg_free: true, contains_dairy: false,
  calories_kcal: 250, protein_g: 12, carbs_g: 30, sugars_g: 3, fibre_g: 6, fat_g: 8, saturates_g: 2, salt_g: 0.8,
};

function existingRecipe(overrides) {
  return {
    test: (url) => url.includes('recipes?select=*') && url.includes('id=eq.5'),
    respond: () => jsonResponse(200, [{ id: 5, name: 'Old Dal', updated_at: '2025-01-01T00:00:00Z', catalogue_status: 'public', created_by_household: OTHER_HOUSEHOLD, ...overrides }]),
  };
}

describe('write-guard rules', () => {
  const member = { householdId: TEST_HOUSEHOLD_ID, isCurator: false };
  const curator = { householdId: OTHER_HOUSEHOLD, isCurator: true };

  it('lets a household edit only what it contributed', () => {
    expect(canEditRecipe(member, { created_by_household: TEST_HOUSEHOLD_ID })).toBe(true);
    expect(canEditRecipe(member, { created_by_household: OTHER_HOUSEHOLD })).toBe(false);
  });

  it('keeps unowned recipes (before the founding owner claims them) curator-only', () => {
    expect(canEditRecipe(member, { created_by_household: null })).toBe(false);
    expect(canEditRecipe(curator, { created_by_household: null })).toBe(true);
  });

  it('lets the curator edit anything', () => {
    expect(canEditRecipe(curator, { created_by_household: TEST_HOUSEHOLD_ID })).toBe(true);
  });

  it('publishes curator recipes immediately and holds everyone else for approval', () => {
    expect(initialCatalogueStatus(curator)).toBe('public');
    expect(initialCatalogueStatus(member)).toBe('pending');
  });
});

describe('POST /api/recipes stamps the household', () => {
  async function createAs(isCurator) {
    const rpcBodies = [];
    const auditRows = [];
    stubFetch([
      ...signedInMember({ isCurator }),
      rateLimitCount(0),
      cuisinesList,
      {
        test: (url, init) => url.includes('rpc/save_household_recipe') && init.method === 'POST',
        respond: (url, init) => {
          rpcBodies.push(JSON.parse(init.body));
          return jsonResponse(200, { id: 42, name: validRecipe.name });
        },
      },
      auditInsertOk(auditRows),
    ]);
    const res = await createRecipe({
      request: request('/api/recipes', 'POST', { recipe: validRecipe, ingredients: [{ group: 'Ingredients', items: [{ ingredient: { name: 'toor dal' } }] }] }),
      env: fakeEnv(),
    });
    return { res, rpcBodies, auditRows };
  }

  it('creates a member household recipe as pending, owned by that household, audited to the member', async () => {
    const { res, rpcBodies, auditRows } = await createAs(false);
    expect(res.status).toBe(201);
    expect(rpcBodies[0]).toMatchObject({ p_household_id: TEST_HOUSEHOLD_ID, p_catalogue_status: 'pending' });
    expect(auditRows[0].actor_user_id).toBe(TEST_USER_ID);
  });

  it('creates a curator recipe as public', async () => {
    const { rpcBodies } = await createAs(true);
    expect(rpcBodies[0].p_catalogue_status).toBe('public');
  });
});

describe('PATCH/DELETE /api/recipes/:id ownership', () => {
  it("refuses to edit another household's public recipe with 403 not_your_recipe", async () => {
    stubFetch([...signedInMember({ isCurator: false }), rateLimitCount(0), existingRecipe({})]);
    const res = await onRequestPatch({ request: request('/api/recipes/5', 'PATCH', { recipe: { name: 'X' }, expectedUpdatedAt: '2025-01-01T00:00:00Z' }), env: fakeEnv(), params: { id: '5' } });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('not_your_recipe');
  });

  it("hides another household's pending recipe as 404", async () => {
    stubFetch([...signedInMember({ isCurator: false }), rateLimitCount(0), existingRecipe({ catalogue_status: 'pending' })]);
    const res = await onRequestDelete({ request: request('/api/recipes/5', 'DELETE'), env: fakeEnv(), params: { id: '5' } });
    expect(res.status).toBe(404);
  });

  it('lets a household delete its own recipe', async () => {
    stubFetch([
      ...signedInMember({ isCurator: false }),
      rateLimitCount(0),
      existingRecipe({ created_by_household: TEST_HOUSEHOLD_ID }),
      { test: (url, init) => url.includes('recipes?id=eq.5') && init.method === 'PATCH', respond: () => jsonResponse(204) },
      auditInsertOk(),
    ]);
    const res = await onRequestDelete({ request: request('/api/recipes/5', 'DELETE'), env: fakeEnv(), params: { id: '5' } });
    expect(res.status).toBe(200);
  });

  it("refuses to restore another household's recipe", async () => {
    stubFetch([
      ...signedInMember({ isCurator: false }),
      rateLimitCount(0),
      { test: (url) => url.includes('is_deleted=eq.true'), respond: () => jsonResponse(200, [{ id: 5, catalogue_status: 'public', created_by_household: OTHER_HOUSEHOLD }]) },
    ]);
    const res = await restoreRecipe({ request: request('/api/recipes/5/restore', 'POST'), env: fakeEnv(), params: { id: '5' } });
    expect(res.status).toBe(403);
  });
});

describe('POST /api/recipes/:id/approve', () => {
  it('is curator-only', async () => {
    stubFetch([...signedInMember({ isCurator: false })]);
    const res = await approveRecipe({ request: request('/api/recipes/5/approve', 'POST'), env: fakeEnv(), params: { id: '5' } });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('curator_only');
  });

  it('publishes a pending recipe and audits it', async () => {
    const patches = [];
    const auditRows = [];
    stubFetch([
      ...signedInMember({ isCurator: true }),
      rateLimitCount(0),
      existingRecipe({ catalogue_status: 'pending' }),
      {
        test: (url, init) => url.includes('catalogue_status=eq.pending') && init.method === 'PATCH',
        respond: (url, init) => {
          patches.push(JSON.parse(init.body));
          return jsonResponse(200, [{ id: 5, catalogue_status: 'public' }]);
        },
      },
      auditInsertOk(auditRows),
    ]);
    const res = await approveRecipe({ request: request('/api/recipes/5/approve', 'POST'), env: fakeEnv(), params: { id: '5' } });
    expect(res.status).toBe(200);
    expect(patches).toEqual([{ catalogue_status: 'public' }]);
    expect(auditRows[0]).toMatchObject({ action: 'update', actor_user_id: TEST_USER_ID });
  });

  it('is a no-op for an already-public recipe', async () => {
    const calls = stubFetch([...signedInMember({ isCurator: true }), rateLimitCount(0), existingRecipe({})]);
    const res = await approveRecipe({ request: request('/api/recipes/5/approve', 'POST'), env: fakeEnv(), params: { id: '5' } });
    expect(res.status).toBe(200);
    expect(calls.some((c) => c.init.method === 'PATCH')).toBe(false);
  });
});
