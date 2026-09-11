const ALLOWED_EXACT = new Set([
  'https://recipe-book-9eo.pages.dev',
  'http://localhost:8788',
  'http://127.0.0.1:8788',
]);

const ALLOWED_SUFFIX = '.recipe-book-9eo.pages.dev';

export function isAllowedOrigin(origin) {
  if (ALLOWED_EXACT.has(origin)) return true;
  try {
    const { protocol, host } = new URL(origin);
    return protocol === 'https:' && host.endsWith(ALLOWED_SUFFIX);
  } catch {
    return false;
  }
}

/** Returns true if the request should proceed, false if it was rejected (caller should 403). */
export function assertAllowedOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return true; // no Origin header (e.g. curl) — Turnstile still gates the write
  return isAllowedOrigin(origin);
}
