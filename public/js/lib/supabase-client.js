import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '../config.js';

export const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false },
});
