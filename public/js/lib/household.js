import { supabase } from './supabase-client.js';
import { getReadyAccount } from '../components/account.js';

// The household profile every page plans and filters by (M1d). A signed-in member gets their own
// household's settings (read through RLS), laid over config/household.json for any key the stored
// row lacks; a signed-out visitor gets the file itself, the app's default household. A change of
// household reloads the page (components/account.js), so one cached answer per load is enough.

let pending = null;

async function fetchTemplate() {
  const res = await fetch('/config/household.json');
  if (!res.ok) throw new Error(`household.json: HTTP ${res.status}`);
  return res.json();
}

async function load() {
  const [template, account] = await Promise.all([fetchTemplate(), getReadyAccount().catch(() => null)]);
  const householdId = account?.household?.id;
  if (!householdId) return template;
  const { data, error } = await supabase.from('household_settings').select('settings').eq('household_id', householdId).maybeSingle();
  if (error) {
    console.error('Failed to load household settings; using the default household.', error);
    return template;
  }
  return { ...template, ...(data?.settings || {}) };
}

export async function getHousehold() {
  if (!pending) {
    pending = load().catch((err) => {
      console.error('Failed to load household.json', err);
      pending = null;
      throw err;
    });
  }
  return pending;
}
