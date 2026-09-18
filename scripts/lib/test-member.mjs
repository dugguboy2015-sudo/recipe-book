// A throwaway signed-in household member for scripts that exercise write paths (smoke --write,
// end-to-end checks). Created through the Supabase admin API, so no email is ever sent: the user is
// created pre-confirmed and signed in by following an admin-generated magic link server-side.
// Every deployment shares the production database, so always call cleanup(), which deletes the
// household and the auth user. Recipes the household saved are not deleted with it (their owner
// becomes null) — hard-delete any test recipes first; only `__smoke__*` rows may be.

function adminHeaders(env) {
  const headers = { apikey: env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' };
  if (env.SUPABASE_SECRET_KEY.startsWith('eyJ')) headers.Authorization = `Bearer ${env.SUPABASE_SECRET_KEY}`;
  return headers;
}

/** Signs in a new pre-confirmed user and returns their access token. */
export async function createTestUser(env, { email, redirectTo }) {
  const headers = adminHeaders(env);
  const created = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, { method: 'POST', headers, body: JSON.stringify({ email, email_confirm: true }) });
  const user = await created.json();
  if (!created.ok) throw new Error(`creating test user failed: ${created.status} ${JSON.stringify(user)}`);
  const linkRes = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/generate_link`, { method: 'POST', headers, body: JSON.stringify({ type: 'magiclink', email, redirect_to: redirectTo }) });
  const link = (await linkRes.json()).action_link;
  const verify = await fetch(link, { redirect: 'manual' });
  const fragment = (verify.headers.get('location') || '').split('#')[1] || '';
  const token = new URLSearchParams(fragment).get('access_token');
  if (!token) throw new Error('test user sign-in did not return an access token (is the redirect URL allow-listed?)');
  return { userId: user.id, token };
}

export async function deleteTestUser(env, userId) {
  await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${userId}`, { method: 'DELETE', headers: adminHeaders(env) });
}

/**
 * A test user who owns a (non-curator) household on `base`.
 * @returns {Promise<{ token: string, userId: string, householdId: string, authHeader: object, cleanup: () => Promise<void> }>}
 */
export async function createTestMember(env, base, { label = 'test' } = {}) {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const { userId, token } = await createTestUser(env, { email, redirectTo: `${base}/` });
  const authHeader = { Authorization: `Bearer ${token}` };
  const res = await fetch(`${base}/api/household`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader },
    body: JSON.stringify({ name: `__${label}__ household`, displayName: 'Test', diet: 'vegetarian_egg_free' }),
  });
  const data = await res.json();
  if (res.status !== 201) {
    await deleteTestUser(env, userId);
    throw new Error(`creating test household failed: ${res.status} ${JSON.stringify(data)}`);
  }
  const householdId = data.household.id;
  return {
    token, userId, householdId, authHeader,
    async cleanup() {
      await fetch(`${env.SUPABASE_URL}/rest/v1/households?id=eq.${householdId}`, { method: 'DELETE', headers: adminHeaders(env) });
      await deleteTestUser(env, userId);
    },
  };
}
