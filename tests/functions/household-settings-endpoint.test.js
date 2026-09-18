import { describe, expect, it } from 'vitest';
import { onRequestPatch } from '../../functions/api/household/settings.js';
import { fakeEnv, stubFetch, signedInMember, AUTH_HEADER, jsonResponse, TEST_HOUSEHOLD_ID, TEST_USER_ID } from './helpers.js';

const ORIGIN = 'https://recipe-book-9eo.pages.dev';
const request = (body) => new Request(`${ORIGIN}/api/household/settings`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...AUTH_HEADER }, body: JSON.stringify(body),
});
const storedSettings = {
  test: (url, init) => url.includes('household_settings?select=settings') && (init.method || 'GET') === 'GET',
  respond: () => jsonResponse(200, [{ settings: { diet: { vegetarian: true, egg_free: true }, default_servings: 4, favourite_cuisines: ['Continental'] } }]),
};
const cuisines = { test: (url) => url.includes('cuisines?select=name'), respond: () => jsonResponse(200, [{ name: 'Gujarati' }, { name: 'South Indian' }]) };

describe('PATCH /api/household/settings', () => {
  it('is owner-only', async () => {
    stubFetch([...signedInMember({ role: 'member' })]);
    const res = await onRequestPatch({ request: request({ defaultServings: 2 }), env: fakeEnv() });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('owner_only');
  });

  it('rejects invalid fields with 400 and field errors', async () => {
    stubFetch([...signedInMember(), storedSettings, cuisines]);
    const res = await onRequestPatch({ request: request({ defaultServings: 40, favouriteCuisines: ['Martian'] }), env: fakeEnv() });
    expect(res.status).toBe(400);
    expect(Object.keys((await res.json()).errors).sort()).toEqual(['defaultServings', 'favouriteCuisines']);
  });

  it('saves the merged settings for this household, keeping an existing non-catalogue cuisine valid', async () => {
    const writes = [];
    stubFetch([
      ...signedInMember(),
      storedSettings,
      cuisines,
      {
        test: (url, init) => url.includes(`household_settings?household_id=eq.${TEST_HOUSEHOLD_ID}`) && init.method === 'PATCH',
        respond: (url, init) => { writes.push(JSON.parse(init.body)); return new Response(null, { status: 204 }); },
      },
    ]);
    const res = await onRequestPatch({ request: request({ diet: 'omnivore', favouriteCuisines: ['Continental', 'Gujarati'] }), env: fakeEnv() });
    expect(res.status).toBe(200);
    expect(writes).toHaveLength(1);
    expect(writes[0].updated_by).toBe(TEST_USER_ID);
    expect(writes[0].settings.diet.vegetarian).toBe(false);
    expect(writes[0].settings.favourite_cuisines).toEqual(['Continental', 'Gujarati']);
    expect(writes[0].settings.default_servings).toBe(4);
  });
});
