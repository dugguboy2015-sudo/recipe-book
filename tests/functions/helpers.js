import { vi } from 'vitest';

export function fakeEnv(overrides = {}) {
  return {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SECRET_KEY: 'sb_secret_fake',
    TURNSTILE_SECRET_KEY: 'fake-turnstile-secret',
    IP_HASH_SALT: 'fake-salt',
    WRITES_PER_IP_HOURLY: '30',
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

export const turnstileOk = {
  test: (url) => url.includes('challenges.cloudflare.com/turnstile'),
  respond: () => jsonResponse(200, { success: true, 'error-codes': [] }),
};

export const turnstileFail = {
  test: (url) => url.includes('challenges.cloudflare.com/turnstile'),
  respond: () => jsonResponse(200, { success: false, 'error-codes': ['invalid-input-response'] }),
};

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
