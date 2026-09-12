// The weekly planner's storage (localStorage; no accounts, so it's per-browser — Appendix K.1).
// Pure schema/migration/reducer functions are exported separately from the localStorage-touching
// wrappers so the former can be unit tested directly (this project verifies DOM/browser-API code
// live in the browser instead, per established convention — see docs/progress.md).
//
// v3 stores every week the user has ever touched, keyed by its Monday, instead of only ever "the
// current" week — multi-week planning (looking ahead, looking back) needs each week to be
// independently addressable rather than discarded the moment it ends.

import { DAYS, SLOTS } from '../shared/planner-constants.js';

export { DAYS, SLOTS };

const PLAN_KEY_V1 = 'recipeBookPlanner';
const PLAN_KEY_V2 = 'recipeBookPlanner.v2';
const PLAN_KEY_V3 = 'recipeBookPlanner.v3';
const PREFS_KEY = 'recipeBook.prefs.v1';
const RETENTION_WEEKS = 260; // ~5 years — a defensive cap on storage growth, not a user-facing feature

export const DEFAULT_AUTO_SLOTS = { Breakfast: true, 'Packed Lunch': true, Lunch: 'weekends', Dinner: true, Snacks: false, Dessert: false };

/** The Monday ('YYYY-MM-DD') of the week containing `date`. */
export function mondayOf(date = new Date()) {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utc.getUTCDay(); // 0 = Sunday .. 6 = Saturday
  utc.setUTCDate(utc.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return utc.toISOString().slice(0, 10);
}

function daysBetween(isoA, isoB) {
  return Math.round((Date.parse(`${isoB}T00:00:00Z`) - Date.parse(`${isoA}T00:00:00Z`)) / 86400000);
}

function addDaysIso(iso, n) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}

export function emptyDays() {
  return Object.fromEntries(DAYS.map((day) => [day, []]));
}

export function defaultStore() {
  return { version: 3, weeks: {} };
}

export function defaultPrefs() {
  return {
    version: 1, recipes: {}, lastKeptCreditedWeekOf: null, lastReviewedWeekOf: null,
    settings: { autoSlots: { ...DEFAULT_AUTO_SLOTS } },
  };
}

/** Read-only: a week that's never been touched returns fresh empty days, not stored. */
export function getWeekDays(store, weekOf) {
  return store.weeks[weekOf]?.days ?? emptyDays();
}

export function setWeekDays(store, weekOf, days) {
  return { ...store, weeks: { ...store.weeks, [weekOf]: { days } } };
}

export function resetWeekDays(store, weekOf) {
  return setWeekDays(store, weekOf, emptyDays());
}

/** Drops weeks older than the retention window, so the store doesn't grow forever (task: multi-week planning). */
export function pruneOldWeeks(store, today = mondayOf()) {
  const weeks = {};
  for (const [weekOf, week] of Object.entries(store.weeks)) {
    if (daysBetween(weekOf, today) <= RETENTION_WEEKS * 7) weeks[weekOf] = week;
  }
  return { ...store, weeks };
}

/** v1 ({day: [{id, name, slot, servings}]}) -> a single week's v3 `days` map. */
export function migratePlanV1ToWeek(v1, { defaultServings = 4 } = {}) {
  const days = emptyDays();
  for (const day of DAYS) {
    const entries = Array.isArray(v1?.[day]) ? v1[day] : [];
    days[day] = entries
      .filter((e) => e && e.id != null)
      .map((e) => ({
        recipeId: e.id,
        slot: e.slot === 'Other' ? 'Snacks' : (e.slot || 'Dinner'),
        servings: e.servings ?? defaultServings,
        source: 'manual',
      }));
  }
  return days;
}

/** v2 ({version, weekOf, days}) -> a v3 store holding just that one week. */
export function migratePlanV2ToV3(v2) {
  return setWeekDays(defaultStore(), v2.weekOf, v2.days);
}

/** K.1's event -> signal table. Returns a new prefs object; never mutates the input. */
export function applyPrefEvent(prefs, recipeId, event, weekOf) {
  const key = String(recipeId);
  const current = prefs.recipes?.[key] || { manual: 0, kept: 0, removed: 0, loved: 0, notAgain: 0, lastPlanned: null, lastNotAgain: null };
  const next = { ...current };
  if (event === 'manual') { next.manual += 1; next.lastPlanned = weekOf; }
  else if (event === 'kept') { next.kept += 1; next.lastPlanned = weekOf; }
  else if (event === 'removed') next.removed += 1;
  else if (event === 'loved') next.loved += 1;
  else if (event === 'notAgain') { next.notAgain += 1; next.lastNotAgain = weekOf; }
  else return prefs;
  return { ...prefs, recipes: { ...prefs.recipes, [key]: next } };
}

export function dismissWeekReview(prefs, weekOf) {
  return { ...prefs, lastReviewedWeekOf: weekOf };
}

function entryMatches(entry, slot, recipeId) {
  return entry.slot === slot && entry.recipeId === recipeId;
}

/** Adds a manual entry; a no-op if that recipe is already in that day/slot (task 11.3). Operates on one week's `days` map. */
export function addEntry(days, day, slot, recipeId, servings, source = 'manual') {
  const existing = days[day] || [];
  if (existing.some((e) => entryMatches(e, slot, recipeId))) return days;
  return { ...days, [day]: [...existing, { recipeId, slot, servings, source }] };
}

/** Convenience for the common "add one entry to one week" call site — read, reduce, and re-wrap in one step. */
export function addEntryToWeek(store, weekOf, day, slot, recipeId, servings, source = 'manual') {
  return setWeekDays(store, weekOf, addEntry(getWeekDays(store, weekOf), day, slot, recipeId, servings, source));
}

export function removeEntry(days, day, slot, recipeId) {
  const existing = days[day] || [];
  return { ...days, [day]: existing.filter((e) => !entryMatches(e, slot, recipeId)) };
}

/** Pins an auto-filled entry as manual (the Keep button) so auto-fill never touches it again. */
export function keepEntry(days, day, slot, recipeId) {
  const existing = days[day] || [];
  return { ...days, [day]: existing.map((e) => (entryMatches(e, slot, recipeId) ? { recipeId, slot, servings: e.servings, source: 'manual' } : e)) };
}

export function replaceEntry(days, day, slot, recipeId, replacement) {
  const existing = days[day] || [];
  return { ...days, [day]: existing.map((e) => (entryMatches(e, slot, recipeId) ? replacement : e)) };
}

export function updateServings(days, day, slot, recipeId, servings) {
  const existing = days[day] || [];
  return { ...days, [day]: existing.map((e) => (entryMatches(e, slot, recipeId) ? { ...e, servings } : e)) };
}

function safeGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key, value) {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}
function safeRemove(key) {
  try { localStorage.removeItem(key); } catch { /* best-effort */ }
}

export function loadPrefs() {
  try {
    const raw = safeGet(PREFS_KEY);
    if (!raw) return defaultPrefs();
    const parsed = JSON.parse(raw);
    return {
      ...defaultPrefs(),
      ...parsed,
      settings: { autoSlots: { ...DEFAULT_AUTO_SLOTS, ...(parsed?.settings?.autoSlots || {}) } },
    };
  } catch {
    return defaultPrefs();
  }
}

export function persistPrefs(prefs) {
  return safeSet(PREFS_KEY, JSON.stringify(prefs));
}

export function persistStore(store) {
  return safeSet(PLAN_KEY_V3, JSON.stringify(store));
}

/**
 * Loads the multi-week store, migrating from v1/v2 as needed, and applies the one-time
 * week-completion signals (the "kept" credit for surviving auto entries, and the "How was last
 * week?" review card) for the single most-recently-completed week, if not already done.
 * @returns {{ store: object, prefs: object, weekReview: {weekOf: string, entries: Array} | null, storageAvailable: boolean }}
 */
export function loadPlanState({ defaultServings = 4 } = {}) {
  const today = mondayOf();
  let prefs = loadPrefs();

  try {
    let store;
    let storageAvailable = true;

    const rawV3 = safeGet(PLAN_KEY_V3);
    if (rawV3) {
      store = JSON.parse(rawV3);
    } else {
      const rawV2 = safeGet(PLAN_KEY_V2);
      const rawV1 = safeGet(PLAN_KEY_V1);
      if (rawV2) {
        store = migratePlanV2ToV3(JSON.parse(rawV2));
        const wrote = safeSet(PLAN_KEY_V3, JSON.stringify(store));
        if (wrote) safeRemove(PLAN_KEY_V2); // keep v2 around if the v3 write failed, so nothing is lost
        storageAvailable = wrote;
      } else if (rawV1) {
        const days = migratePlanV1ToWeek(JSON.parse(rawV1), { defaultServings });
        store = setWeekDays(defaultStore(), today, days);
        const wrote = safeSet(PLAN_KEY_V3, JSON.stringify(store));
        if (wrote) safeRemove(PLAN_KEY_V1);
        storageAvailable = wrote;
      } else {
        store = defaultStore();
        storageAvailable = safeSet(PLAN_KEY_V3, JSON.stringify(store)); // proves storage actually works, not just that nothing was found
      }
    }

    store = pruneOldWeeks(store, today);

    // K.1's week-completion signals fire once, for only the single most-recently-completed week
    // (not a backlog of every missed week) — older weeks stay fully intact and browsable, they
    // just don't retroactively re-trigger these one-time signals.
    const latestCompletedWeekOf = addDaysIso(today, -7);
    const completedEntries = DAYS.flatMap((day) => (getWeekDays(store, latestCompletedWeekOf)[day] || []).map((e) => ({ ...e, day })));

    let weekReview = null;
    if (completedEntries.length > 0) {
      if (prefs.lastKeptCreditedWeekOf !== latestCompletedWeekOf) {
        for (const entry of completedEntries) {
          if (entry.source === 'auto') prefs = applyPrefEvent(prefs, entry.recipeId, 'kept', latestCompletedWeekOf);
        }
        prefs = { ...prefs, lastKeptCreditedWeekOf: latestCompletedWeekOf };
        persistPrefs(prefs);
      }
      if (prefs.lastReviewedWeekOf !== latestCompletedWeekOf) {
        weekReview = { weekOf: latestCompletedWeekOf, entries: completedEntries };
      }
    }

    persistStore(store);
    return { store, prefs, weekReview, storageAvailable };
  } catch {
    return { store: defaultStore(), prefs, weekReview: null, storageAvailable: false };
  }
}

export function exportPlanData(store, prefs) {
  return { exportedAt: new Date().toISOString(), store, prefs };
}

/** Validates an imported export before it replaces the live store/prefs (task 11.8). */
export function parseImportedPlanData(json) {
  const data = JSON.parse(json);
  const store = data?.store;
  const prefs = data?.prefs;
  if (!store || store.version !== 3 || typeof store.weeks !== 'object') {
    throw new Error('This file is not a recognized recipe planner export.');
  }
  for (const week of Object.values(store.weeks)) {
    if (!week || typeof week.days !== 'object') throw new Error('This file is not a recognized recipe planner export.');
    for (const day of DAYS) {
      if (!Array.isArray(week.days[day])) throw new Error('This file is not a recognized recipe planner export.');
    }
  }
  if (!prefs || prefs.version !== 1 || typeof prefs.recipes !== 'object') {
    throw new Error('This file is not a recognized recipe planner export.');
  }
  return { store, prefs };
}
