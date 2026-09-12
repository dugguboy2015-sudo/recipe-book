// The weekly planner's storage (localStorage; no accounts, so it's per-browser — Appendix K.1).
// Pure schema/migration/reducer functions are exported separately from the localStorage-touching
// wrappers so the former can be unit tested directly (this project verifies DOM/browser-API code
// live in the browser instead, per established convention — see docs/progress.md).

import { DAYS, SLOTS, HISTORY_WEEKS_KEPT } from '../shared/planner-engine.js';

export { DAYS, SLOTS };

const PLAN_KEY_V1 = 'recipeBookPlanner';
const PLAN_KEY_V2 = 'recipeBookPlanner.v2';
const PREFS_KEY = 'recipeBook.prefs.v1';

export const DEFAULT_AUTO_SLOTS = { Breakfast: true, 'Packed Lunch': true, Lunch: 'weekends', Dinner: true, Snacks: false, Dessert: false };

/** The Monday ('YYYY-MM-DD') of the week containing `date`. */
export function mondayOf(date = new Date()) {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utc.getUTCDay(); // 0 = Sunday .. 6 = Saturday
  utc.setUTCDate(utc.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return utc.toISOString().slice(0, 10);
}

export function defaultPlan(weekOf = mondayOf()) {
  return { version: 2, weekOf, days: Object.fromEntries(DAYS.map((day) => [day, []])) };
}

export function defaultPrefs() {
  return {
    version: 1, recipes: {}, history: [], lastReviewedWeekOf: null,
    settings: { autoSlots: { ...DEFAULT_AUTO_SLOTS } },
  };
}

/** Task 11.1: v1 ({day: [{id, name, slot, servings}]}) -> v2 ({version, weekOf, days: {day: [{recipeId, slot, servings, source}]}}). */
export function migratePlanV1(v1, { defaultServings = 4, weekOf = mondayOf() } = {}) {
  const plan = defaultPlan(weekOf);
  for (const day of DAYS) {
    const entries = Array.isArray(v1?.[day]) ? v1[day] : [];
    plan.days[day] = entries
      .filter((e) => e && e.id != null)
      .map((e) => ({
        recipeId: e.id,
        slot: e.slot === 'Other' ? 'Snacks' : (e.slot || 'Dinner'),
        servings: e.servings ?? defaultServings,
        source: 'manual',
      }));
  }
  return plan;
}

/** True once a stored plan's week has fully elapsed and a new one should start (task 11.1). */
export function hasWeekRolledOver(weekOf, today = mondayOf()) {
  if (!weekOf) return true;
  const diffDays = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${weekOf}T00:00:00Z`)) / 86400000);
  return diffDays >= 7;
}

/** Archives a finished week's entries into prefs.history, capped at the last 12 weeks (K.1). */
export function archiveWeek(prefs, plan) {
  const entries = DAYS.flatMap((day) => (plan.days[day] || []).map((e) => ({ recipeId: e.recipeId, day, slot: e.slot, source: e.source })));
  if (entries.length === 0) return prefs;
  const history = [...(prefs.history || []), { weekOf: plan.weekOf, entries }].slice(-HISTORY_WEEKS_KEPT);
  return { ...prefs, history };
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

/** Adds a manual entry; a no-op if that recipe is already in that day/slot (task 11.3). */
export function addEntry(plan, day, slot, recipeId, servings, source = 'manual') {
  const existing = plan.days[day] || [];
  if (existing.some((e) => entryMatches(e, slot, recipeId))) return plan;
  return { ...plan, days: { ...plan.days, [day]: [...existing, { recipeId, slot, servings, source }] } };
}

export function removeEntry(plan, day, slot, recipeId) {
  const existing = plan.days[day] || [];
  return { ...plan, days: { ...plan.days, [day]: existing.filter((e) => !entryMatches(e, slot, recipeId)) } };
}

/** Pins an auto-filled entry as manual (task 11.4's Keep button) so auto-fill never touches it again. */
export function keepEntry(plan, day, slot, recipeId) {
  const existing = plan.days[day] || [];
  return {
    ...plan,
    days: { ...plan.days, [day]: existing.map((e) => (entryMatches(e, slot, recipeId) ? { recipeId, slot, servings: e.servings, source: 'manual' } : e)) },
  };
}

export function replaceEntry(plan, day, slot, recipeId, replacement) {
  const existing = plan.days[day] || [];
  return { ...plan, days: { ...plan.days, [day]: existing.map((e) => (entryMatches(e, slot, recipeId) ? replacement : e)) } };
}

export function updateServings(plan, day, slot, recipeId, servings) {
  const existing = plan.days[day] || [];
  return { ...plan, days: { ...plan.days, [day]: existing.map((e) => (entryMatches(e, slot, recipeId) ? { ...e, servings } : e)) } };
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

/**
 * Loads the current plan, migrating a v1 plan or rolling over an elapsed week as needed.
 * @returns {{ plan: object, prefs: object, weekReview: {weekOf: string, entries: Array} | null, storageAvailable: boolean }}
 */
export function loadPlanState({ defaultServings = 4 } = {}) {
  const today = mondayOf();
  let prefs = loadPrefs();

  try {
    const rawV2 = safeGet(PLAN_KEY_V2);
    let plan = rawV2 ? JSON.parse(rawV2) : null;
    let storageAvailable = true;

    if (!plan) {
      const rawV1 = safeGet(PLAN_KEY_V1);
      if (rawV1) {
        plan = migratePlanV1(JSON.parse(rawV1), { defaultServings, weekOf: today });
        const wrote = safeSet(PLAN_KEY_V2, JSON.stringify(plan));
        if (wrote) safeRemove(PLAN_KEY_V1); // keep v1 around if the v2 write failed, so nothing is lost
        storageAvailable = wrote;
      } else {
        plan = defaultPlan(today);
        storageAvailable = safeSet(PLAN_KEY_V2, JSON.stringify(plan)); // proves storage actually works, not just that nothing was found
      }
    }

    let weekReview = null;
    if (hasWeekRolledOver(plan.weekOf, today)) {
      const endedWeekOf = plan.weekOf;
      const endedEntries = DAYS.flatMap((day) => (plan.days[day] || []).map((e) => ({ ...e, day })));
      // K.1: an auto-filled entry that survived to week's end counts as "kept" — one still there
      // hasn't already been removed/replaced (those fire their own 'removed' event immediately).
      for (const entry of endedEntries) {
        if (entry.source === 'auto') prefs = applyPrefEvent(prefs, entry.recipeId, 'kept', endedWeekOf);
      }
      prefs = archiveWeek(prefs, plan);
      persistPrefs(prefs);
      plan = defaultPlan(today);
      safeSet(PLAN_KEY_V2, JSON.stringify(plan));
      if (endedEntries.length && prefs.lastReviewedWeekOf !== endedWeekOf) {
        weekReview = { weekOf: endedWeekOf, entries: endedEntries };
      }
    }

    return { plan, prefs, weekReview, storageAvailable };
  } catch {
    return { plan: defaultPlan(today), prefs, weekReview: null, storageAvailable: false };
  }
}

export function persistPlan(plan) {
  return safeSet(PLAN_KEY_V2, JSON.stringify(plan));
}

export function exportPlanData(plan, prefs) {
  return { exportedAt: new Date().toISOString(), plan, prefs };
}

/** Validates an imported export before it replaces the live plan/prefs (task 11.8). */
export function parseImportedPlanData(json) {
  const data = JSON.parse(json);
  const plan = data?.plan;
  const prefs = data?.prefs;
  if (!plan || plan.version !== 2 || typeof plan.weekOf !== 'string' || typeof plan.days !== 'object') {
    throw new Error('This file is not a recognized recipe planner export.');
  }
  for (const day of DAYS) {
    if (!Array.isArray(plan.days[day])) throw new Error('This file is not a recognized recipe planner export.');
  }
  if (!prefs || prefs.version !== 1 || typeof prefs.recipes !== 'object') {
    throw new Error('This file is not a recognized recipe planner export.');
  }
  return { plan, prefs };
}

export function resetPlan() {
  return defaultPlan(mondayOf());
}
