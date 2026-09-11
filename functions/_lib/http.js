export function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export function problem(status, code, message, extra = {}) {
  return json(status, { code, message, ...extra });
}

export async function readJson(request, maxBytes = 64_000) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > maxBytes) {
    const err = new Error('payload_too_large');
    err.code = 'payload_too_large';
    throw err;
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) {
    const err = new Error('payload_too_large');
    err.code = 'payload_too_large';
    throw err;
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    const err = new Error('invalid_json');
    err.code = 'invalid_json';
    throw err;
  }
}
