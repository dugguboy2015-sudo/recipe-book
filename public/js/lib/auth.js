import { supabase } from './supabase-client.js';

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/** Calls back with (session, event) on every auth change. Returns an unsubscribe function. */
export function onAuthChange(callback) {
  const { data } = supabase.auth.onAuthStateChange((event, session) => callback(session, event));
  return () => data.subscription.unsubscribe();
}

/**
 * Emails a sign-in link; creates the account on first use. `captchaToken` is a Turnstile token:
 * Supabase checks it when its sign-in captcha is switched on, which protects the project's tiny
 * email allowance from being spent by bots.
 */
export function sendSignInEmail(email, redirectTo, captchaToken) {
  return supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo, shouldCreateUser: true, captchaToken } });
}

export function signOut() {
  return supabase.auth.signOut();
}

/** The signed-in user's household (null if they belong to none), read through RLS. */
export async function fetchMyHousehold(session) {
  if (!session) return null;
  const { data, error } = await supabase
    .from('household_members')
    .select('household_id, role, display_name, households(name, is_curator)')
    .eq('user_id', session.user.id)
    .maybeSingle();
  if (error) {
    console.error(error);
    return null;
  }
  if (!data) return null;
  return {
    id: data.household_id,
    role: data.role,
    displayName: data.display_name,
    name: data.households?.name || 'Your household',
    isCurator: Boolean(data.households?.is_curator),
  };
}

/** The household's stored settings (RLS: members only), or null. */
export async function fetchHouseholdSettings(householdId) {
  const { data, error } = await supabase.from('household_settings').select('settings').eq('household_id', householdId).maybeSingle();
  if (error) {
    console.error(error);
    return null;
  }
  return data?.settings || null;
}

export async function fetchCuisineNames() {
  const { data, error } = await supabase.from('cuisines').select('name').order('sort_order', { ascending: true });
  if (error) {
    console.error(error);
    return [];
  }
  return (data || []).map((row) => row.name);
}

export async function fetchHouseholdMembers(householdId) {
  const { data, error } = await supabase
    .from('household_members')
    .select('user_id, role, display_name, joined_at')
    .eq('household_id', householdId)
    .order('joined_at', { ascending: true });
  if (error) {
    console.error(error);
    return [];
  }
  return data || [];
}

/** POSTs to one of this site's Functions as the signed-in user. */
export function postAsUser(path, body) {
  return sendAsUser('POST', path, body);
}

/** PATCHes one of this site's Functions as the signed-in user. */
export function patchAsUser(path, body) {
  return sendAsUser('PATCH', path, body);
}

async function sendAsUser(method, path, body) {
  const session = await getSession();
  const response = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}
