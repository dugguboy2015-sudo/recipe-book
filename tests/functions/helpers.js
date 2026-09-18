import { vi } from 'vitest';

export function fakeEnv(overrides = {}) {
  return {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SECRET_KEY: 'sb_secret_fake',
    IP_HASH_SALT: 'fake-salt',
    WRITES_PER_USER_HOURLY: '30',
    AI: {},
    ...overrides,
  };
}

function jsonResponse(status, body, headers = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/**
 * handlers: array of { test: (url, init) => boolean, respond: (url, init) => Response }, checked
 * in order, first match wins. Falls through to a 500 "unhandled" response so a missing stub fails
 * loudly instead of hanging.
 */
export function stubFetch(handlers) {
  const calls = [];
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    calls.push({ url: String(url), init });
    for (const handler of handlers) {
      if (handler.test(String(url), init)) return handler.respond(String(url), init);
    }
    return jsonResponse(500, { message: `unhandled fetch: ${init.method || 'GET'} ${url}` });
  });
  return calls;
}

export const TEST_HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';
export const TEST_USER_ID = '22222222-2222-4222-8222-222222222222';
export const AUTH_HEADER = { Authorization: 'Bearer test-access-token' };

/**
 * Stubs for a signed-in member: Supabase's /auth/v1/user and the membership lookup. Defaults to
 * the curator household, which may edit any recipe; pass isCurator: false to test ownership.
 */
export function signedInMember({ userId = TEST_USER_ID, householdId = TEST_HOUSEHOLD_ID, role = 'owner', isCurator = true } = {}) {
  return [
    {
      test: (url) => url.includes('/auth/v1/user'),
      respond: () => jsonResponse(200, { id: userId, email: 'member@example.com', email_confirmed_at: '2026-09-18T00:00:00Z' }),
    },
    {
      test: (url) => url.includes('household_members?select='),
      respond: () => jsonResponse(200, [{ household_id: householdId, role, display_name: 'Member', households: { is_curator: isCurator } }]),
    },
  ];
}

export const signedInNoHousehold = [
  { test: (url) => url.includes('/auth/v1/user'), respond: () => jsonResponse(200, { id: TEST_USER_ID, email: 'x@example.com', email_confirmed_at: '2026-09-18T00:00:00Z' }) },
  { test: (url) => url.includes('household_members?select='), respond: () => jsonResponse(200, []) },
];

export function rateLimitCount(n) {
  return {
    test: (url, init) => url.includes('recipe_audit_log') && init.method === 'HEAD',
    respond: () => new Response(null, { status: 200, headers: { 'Content-Range': `0-0/${n}` } }),
  };
}

export const cuisinesList = {
  test: (url) => url.includes('cuisines?select=name'),
  respond: () => jsonResponse(200, [{ name: 'North Indian' }, { name: 'South Indian' }, { name: 'Other' }]),
};

export function auditInsertOk(recorder) {
  return {
    test: (url, init) => url.includes('recipe_audit_log') && init.method === 'POST',
    respond: (url, init) => {
      recorder?.push(JSON.parse(init.body));
      return jsonResponse(201, {});
    },
  };
}

export { jsonResponse };
