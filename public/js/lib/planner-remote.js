import { defaultStore, defaultPrefs, DEFAULT_AUTO_SLOTS, setWeekDays } from './planner-store.js';

// M1e: the household's plan in the database (migration 019), so it follows them between devices and
// members. Members read and write their own household's rows directly under RLS — see the
// migration for why this one write path doesn't go through a Pages Function.
//
// Writes are debounced per week and coalesced: dragging a servings stepper or shuffling a slot a
// few times sends one row, not one per keystroke. The browser copy is still written on every
// change (planner.js), so a failed save never loses what the person just did.

const SAVE_DEBOUNCE_MS = 600;
// How far back to load. A year of history is plenty for "what did we eat in March"; older weeks
// stay in the database (the 5-year retention cap applies to the browser copy) and are simply not
// fetched on every page load.
const HISTORY_DAYS = 400;

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

/** The household's stored plan as the same `{ store, prefs }` shape the browser store uses. */
export async function fetchRemotePlan(client, householdId) {
  const [weeks, prefsRow] = await Promise.all([
    client.from('plan_weeks').select('week_of, days').eq('household_id', householdId).gte('week_of', isoDaysAgo(HISTORY_DAYS)),
    client.from('plan_prefs').select('prefs').eq('household_id', householdId).maybeSingle(),
  ]);
  if (weeks.error || prefsRow.error) {
    console.error(weeks.error || prefsRow.error);
    return { ok: false, store: defaultStore(), prefs: defaultPrefs(), isEmpty: true };
  }
  let store = defaultStore();
  for (const row of weeks.data || []) store = setWeekDays(store, row.week_of, row.days);
  const stored = prefsRow.data?.prefs;
  const prefs = stored
    ? { ...defaultPrefs(), ...stored, settings: { autoSlots: { ...DEFAULT_AUTO_SLOTS, ...(stored.settings?.autoSlots || {}) } } }
    : defaultPrefs();
  return { ok: true, store, prefs, isEmpty: (weeks.data || []).length === 0 && !stored };
}

function upsertWeek(client, householdId, userId, weekOf, days) {
  return client.from('plan_weeks')
    .upsert({ household_id: householdId, week_of: weekOf, days, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: 'household_id,week_of' });
}

function upsertPrefs(client, householdId, userId, prefs) {
  return client.from('plan_prefs')
    .upsert({ household_id: householdId, prefs, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: 'household_id' });
}

/** Uploads a whole plan at once — the one-time import of a browser plan into a new household. */
export async function uploadPlan(client, householdId, userId, store, prefs) {
  const rows = Object.entries(store.weeks || {}).map(([weekOf, week]) => ({
    household_id: householdId, week_of: weekOf, days: week.days, updated_by: userId, updated_at: new Date().toISOString(),
  }));
  if (rows.length > 0) {
    const { error } = await client.from('plan_weeks').upsert(rows, { onConflict: 'household_id,week_of' });
    if (error) {
      console.error(error);
      return false;
    }
  }
  const { error } = await upsertPrefs(client, householdId, userId, prefs);
  if (error) {
    console.error(error);
    return false;
  }
  return true;
}

/**
 * A debounced writer for one household's plan.
 * @param {{ client: object, householdId: string, userId: string, onError?: () => void }} options
 */
export function createPlanSync({ client, householdId, userId, onError }) {
  const pendingWeeks = new Map(); // weekOf -> days
  let pendingPrefs = null;
  let timer = null;

  async function flush() {
    clearTimeout(timer);
    timer = null;
    const weeks = [...pendingWeeks.entries()];
    const prefs = pendingPrefs;
    pendingWeeks.clear();
    pendingPrefs = null;
    try {
      const writes = weeks.map(([weekOf, days]) => upsertWeek(client, householdId, userId, weekOf, days));
      if (prefs) writes.push(upsertPrefs(client, householdId, userId, prefs));
      const results = await Promise.all(writes);
      const failed = results.find((result) => result.error);
      if (failed) throw failed.error;
    } catch (err) {
      console.error('Saving the plan failed:', err);
      onError?.();
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(flush, SAVE_DEBOUNCE_MS);
  }

  // Leaving the page (closing the tab, following a link) must not drop a save that is still waiting
  // out its debounce.
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => {
      if (pendingWeeks.size > 0 || pendingPrefs) flush();
    });
  }

  return {
    queueWeek(weekOf, days) {
      pendingWeeks.set(weekOf, days);
      schedule();
    },
    queuePrefs(prefs) {
      pendingPrefs = prefs;
      schedule();
    },
    flush,
  };
}
