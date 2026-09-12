export function isJwtKey(key) {
  return key.startsWith('eyJ');
}

export async function rest(env, path, { method = 'GET', body, secret = false, prefer } = {}) {
  const key = secret ? env.SUPABASE_SECRET_KEY : env.SUPABASE_PUBLISHABLE_KEY;
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  if (secret && isJwtKey(key)) headers.Authorization = `Bearer ${key}`;
  if (!secret) headers.Authorization = `Bearer ${key}`;
  if (prefer) headers.Prefer = prefer;
  else if (method !== 'GET' && method !== 'DELETE') headers.Prefer = 'return=representation';

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, ok: res.ok, body: json };
}

export async function sql(env, query, { readOnly = true } = {}) {
  const ref = env.SUPABASE_PROJECT_REF || 'xtxufygmwqicrgzjwdxc';
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, read_only: readOnly }),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (res.status !== 201) {
    throw new Error(`Supabase SQL API returned ${res.status}: ${typeof json === 'string' ? json : JSON.stringify(json)}`);
  }
  return json;
}
