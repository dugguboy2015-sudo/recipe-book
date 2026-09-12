// Small pure helpers shared between the planner's week header and the dashboard's "This week"
// card (Appendix L.4), so both compute "today", "tomorrow" and the protein-smart share the same
// way instead of drifting apart.

import { DAYS, PROTEIN_SMART_SLOTS } from './planner-constants.js';

/** Monday-first weekday index (0=Monday..6=Sunday) for a JS Date. */
function weekdayIndex(date) {
  return (date.getDay() + 6) % 7;
}

export function todayName(now = new Date()) {
  return DAYS[weekdayIndex(now)];
}

export function tomorrowName(now = new Date()) {
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return DAYS[weekdayIndex(tomorrow)];
}

/** @returns {number|null} the fraction (0-1) of this week's Packed Lunch/Lunch/Dinner entries that are protein-smart, or null if none are resolved yet. */
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

export function entriesForDay(planDays, day) {
  return planDays[day] || [];
}
