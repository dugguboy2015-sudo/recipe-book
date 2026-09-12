// Small pure/near-pure helpers shared between the planner's header, its day/week/month views, and
// the dashboard's "This week" card. Date math here is deliberately cross-week-boundary-safe (e.g.
// "tomorrow" can belong to a different week than "today") now that the store holds many weeks, not
// just one — see lib/planner-store.js for the multi-week schema these read from.

import { DAYS, PROTEIN_SMART_SLOTS } from './planner-constants.js';
import { getWeekDays, mondayOf } from '../lib/planner-store.js';

export function parseLocalDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function isoOfDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function todayIso(now = new Date()) {
  return isoOfDate(now);
}

export function addDaysIso(iso, n) {
  const date = parseLocalDate(iso);
  date.setDate(date.getDate() + n);
  return isoOfDate(date);
}

/** Monday-first weekday name (DAYS order) for an ISO date. */
export function dayNameForIso(iso) {
  return DAYS[(parseLocalDate(iso).getDay() + 6) % 7];
}

/** The planned entries for one exact calendar date, resolving whichever week it falls in. */
export function entriesOnDate(store, iso) {
  const days = getWeekDays(store, mondayOf(parseLocalDate(iso)));
  return days[dayNameForIso(iso)] || [];
}

/** @returns {number|null} the fraction (0-1) of a week's Packed Lunch/Lunch/Dinner entries that are protein-smart, or null if none are resolved yet. */
export function computeProteinSmartShare(planDays, resolvedById) {
  const flags = [];
  for (const day of DAYS) {
    for (const entry of planDays[day] || []) {
      if (!PROTEIN_SMART_SLOTS.includes(entry.slot)) continue;
      const recipe = resolvedById.get(entry.recipeId);
      if (!recipe) continue;
      flags.push(Boolean(recipe.is_protein_smart));
    }
  }
  if (flags.length === 0) return null;
  return flags.filter(Boolean).length / flags.length;
}
