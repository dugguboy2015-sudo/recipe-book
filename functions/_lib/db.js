export class DbError extends Error {
  constructor(status, body) {
    super(body?.message || `Database request failed (${status})`);
    this.status = status;
    this.code = body?.code; // Postgres error code, e.g. '23505'
    this.details = body?.details;
  }
}

export function createDb(env) {
  const base = `${env.SUPABASE_URL}/rest/v1/`;
  const key = env.SUPABASE_SECRET_KEY;
  // sb_secret_* keys: apikey header only. Legacy JWT service keys: apikey + Bearer.
  const auth = key.startsWith('eyJ') ? { apikey: key, Authorization: `Bearer ${key}` } : { apikey: key };

  async function request(path, { method = 'GET', body, prefer, headers = {} } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...auth,
        'Content-Type': 'application/json',
        ...(prefer ? { Prefer: prefer } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = { message: text.slice(0, 200) }; }
    }
    if (!res.ok) throw new DbError(res.status, data);
    return { data, headers: res.headers };
  }

  async function count(table, filters) {
    // filters: already-encoded PostgREST filter string, e.g. `ip_hash=eq.${encodeURIComponent(h)}`
    const { headers } = await request(`${table}?select=*&${filters}`, {
      method: 'HEAD',
      prefer: 'count=exact',
      headers: { Range: '0-0' },
    });
    const range = headers.get('content-range') || '*/0'; // "0-0/17" or "*/0"
    return Number(range.split('/')[1] || 0);
  }

  return { request, count };
}
