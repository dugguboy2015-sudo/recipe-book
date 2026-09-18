/**
 * The signed-in user behind a request, or null. The browser sends its Supabase access token as a
 * bearer header; Supabase's own /auth/v1/user endpoint validates it. That round trip is the
 * authority — it rejects expired, revoked and forged tokens without this code holding any JWT
 * signing material.
 */
export async function getUser(request, config) {
  const header = request.headers.get('Authorization') || '';
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match) return null;
  let res;
  try {
    res = await fetch(`${config.SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: config.SUPABASE_SECRET_KEY, Authorization: `Bearer ${match[1]}` },
    });
  } catch (err) {
    console.error('Auth lookup failed:', err);
    return null;
  }
  if (!res.ok) return null;
  const user = await res.json().catch(() => null);
  if (!user?.id) return null;
  return {
    id: user.id,
    email: String(user.email || '').toLowerCase(),
    emailConfirmed: Boolean(user.email_confirmed_at || user.confirmed_at),
  };
}
