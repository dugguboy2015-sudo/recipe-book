import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '../config.js';

// M1b: sessions persist (sign-in survives reloads) and are picked up from sign-in links. The
// implicit flow is deliberate: PKCE ties a sign-in link to the browser that requested it, which
// breaks the everyday case of asking on a laptop and opening the email on a phone.
export const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
});
