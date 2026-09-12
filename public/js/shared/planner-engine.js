// Appendix K: the planner engine. Deterministic, explainable, no AI/network calls — pure
// functions over recipes/plan/prefs/household data the caller already has. Storage itself
// (localStorage read/write) lives in lib/planner-store.js; this module never touches it.

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
export const WEEKEND_DAYS = ['Saturday', 'Sunday'];
export const SLOTS = ['Breakfast', 'Packed Lunch', 'Lunch', 'Dinner', 'Snacks', 'Dessert'];
export const PROTEIN_SMART_SLOTS = ['Packed Lunch', 'Lunch', 'Dinner'];
export const NOT_AGAIN_EXCLUSION_WEEKS = 8;
export const HISTORY_WEEKS_KEPT = 12;

const REASON_TEXT = {
  highProtein: 'High protein',
  loved: 'You loved this',
  quick: 'Quick weeknight',
  favouriteCuisine: 'Favourite cuisine',
  somethingNew: 'Something new',
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/** A small deterministic hash-based PRNG in [0, 1) — no Math.random(), so planWeek is seeded/reproducible. */
export function seededRandom(seed) {
  let hash = 2166136261;
  const text = String(seed);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 1_000_000) / 1_000_000;
}

function daysBetween(isoA, isoB) {
  const a = new Date(`${isoA}T00:00:00Z`);
  const b = new Date(`${isoB}T00:00:00Z`);
  return Math.round((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000));
}

function statsFor(prefs, recipeId) {
  return prefs?.recipes?.[String(recipeId)] || { manual: 0, kept: 0, removed: 0, loved: 0, notAgain: 0, lastPlanned: null, lastNotAgain: null };
}

function interactionsFor(stats) {
  return stats.manual + stats.kept + stats.removed + stats.loved + stats.notAgain;
}

/** K.2: affinity(r), clamped to [-3, 3]. */
export function computeAffinity(stats) {
  const raw = 2 * stats.manual + stats.kept + 3 * stats.loved - 2 * stats.removed - 4 * stats.notAgain;
  return clamp(raw / Math.sqrt(1 + interactionsFor(stats)), -3, 3);
}

function cuisineAffinity(recipe, plannedRecipesById, prefs, household) {
  const plannedWithSameCuisine = Object.values(plannedRecipesById).filter((r) => r.cuisine === recipe.cuisine);
  const mean = plannedWithSameCuisine.length
    ? plannedWithSameCuisine.reduce((sum, r) => sum + computeAffinity(statsFor(prefs, r.id)), 0) / plannedWithSameCuisine.length
    : 0;
  const favouriteBonus = (household?.favourite_cuisines || []).includes(recipe.cuisine) ? 0.5 : 0;
  return mean + favouriteBonus;
}

function dayFit(slot, day, recipe) {
  if (slot !== 'Dinner' || !WEEKDAYS.includes(day)) return 0;
  const minutes = recipe.total_time_minutes ?? 0;
  if (minutes <= 40) return 0.5;
  if (minutes > 60) return -0.5;
  return 0;
}

function novelty(stats) {
  const timesPlanned = stats.manual + stats.kept;
  return Math.max(0, 0.4 - 0.1 * timesPlanned);
}

function recency(stats, weekOf) {
  if (!stats.lastPlanned) return 0;
  const diff = daysBetween(stats.lastPlanned, weekOf);
  if (diff >= 0 && diff <= 7) return -1.5;
  if (diff > 7 && diff <= 14) return -0.7;
  return 0;
}

/**
 * K.2's full score for one (recipe, slot, day) candidate. `plannedRecipesById` is a lookup of
 * recipes already placed in the plan being built, for cuisineAff's "mean affinity of planned
 * recipes with r.cuisine" term.
 */
export function computeScore({ recipe, slot, day, plannedRecipesById, prefs, household, weekOf }) {
  const stats = statsFor(prefs, recipe.id);
  const affinity = computeAffinity(stats);
  const cuisineAff = cuisineAffinity(recipe, plannedRecipesById, prefs, household);
  const slotFit = (recipe.meal_types || []).includes(slot) ? 1 : 0.2;
  const health = recipe.is_protein_smart ? 1 : 0;
  const jitter = seededRandom(`${weekOf}:${recipe.id}:${slot}:${day}`) * 0.15;

  return 1.0 * affinity + 0.6 * cuisineAff + 1.0 * slotFit + 0.8 * health
    + 0.5 * dayFit(slot, day, recipe) + novelty(stats) + recency(stats, weekOf) + jitter;
}

/** The chips shown on an auto-filled entry — the top 2 reasons it was picked. */
export function topReasons(recipe, { prefs, household } = {}) {
  const stats = statsFor(prefs, recipe.id);
  const candidates = [];
  if (recipe.is_protein_smart) candidates.push(['highProtein', 1]);
  if (stats.loved > 0) candidates.push(['loved', 2]);
  if ((recipe.total_time_minutes ?? 999) <= 40) candidates.push(['quick', 0.8]);
  if ((household?.favourite_cuisines || []).includes(recipe.cuisine)) candidates.push(['favouriteCuisine', 0.7]);
  if (novelty(stats) >= 0.3) candidates.push(['somethingNew', 0.3]);
  candidates.sort((a, b) => b[1] - a[1]);
  return candidates.slice(0, 2).map(([key]) => REASON_TEXT[key]);
}

function isSlotEnabled(autoSlots, slot, day) {
  const setting = autoSlots?.[slot];
  if (setting === true) return true;
  if (setting === 'weekends') return WEEKEND_DAYS.includes(day);
  return false;
}

/** K.1: a "Not again" mark excludes a recipe for 8 weeks, not forever. */
function isNotAgainExcluded(prefs, recipeId, weekOf) {
  const stats = statsFor(prefs, recipeId);
  if (stats.notAgain <= 0) return false;
  if (!stats.lastNotAgain) return true; // no timestamp recorded — be conservative and keep excluding
  return daysBetween(stats.lastNotAgain, weekOf) < NOT_AGAIN_EXCLUSION_WEEKS * 7;
}

function usesThisWeek(plan, recipeId) {
  return DAYS.reduce((count, day) => count + (plan[day] || []).filter((e) => e.recipeId === recipeId).length, 0);
}

function dinnerCuisineCount(plan, recipesById, cuisine) {
  return DAYS.reduce((count, day) => count + (plan[day] || []).filter((e) => e.slot === 'Dinner' && recipesById[e.recipeId]?.cuisine === cuisine).length, 0);
}

function eligibleCandidates(recipes, { slot, plan, prefs, recipesById, weekOf }) {
  return recipes.filter((r) => {
    if (slot === 'Packed Lunch' && !(r.meal_types || []).includes('Packed Lunch')) return false;
    if (isNotAgainExcluded(prefs, r.id, weekOf)) return false;
    const uses = usesThisWeek(plan, r.id);
    if (slot === 'Breakfast') {
      if (uses >= 2) return false; // Breakfast may repeat once, never more
    } else if (uses >= 1) {
      return false; // no recipe twice in the same week outside Breakfast
    }
    if (slot === 'Dinner' && dinnerCuisineCount(plan, recipesById, r.cuisine) >= 3) return false;
    return true;
  });
}

function buildFillOrder() {
  const order = [];
  for (const day of WEEKDAYS) order.push({ day, slot: 'Packed Lunch' });
  for (const day of DAYS) order.push({ day, slot: 'Dinner' });
  for (const day of WEEKEND_DAYS) order.push({ day, slot: 'Lunch' });
  for (const day of DAYS) order.push({ day, slot: 'Breakfast' });
  return order;
}

function cloneDays(plan) {
  const next = {};
  for (const day of DAYS) next[day] = [...(plan?.[day] || [])];
  return next;
}

function isProteinSmart(recipesById, recipeId) {
  return Boolean(recipesById[recipeId]?.is_protein_smart);
}

function computeProteinSmartShare(plan, recipesById) {
  const entries = DAYS.flatMap((day) => (plan[day] || []).filter((e) => PROTEIN_SMART_SLOTS.includes(e.slot)));
  if (entries.length === 0) return 1; // nothing to fall short of yet
  const smartCount = entries.filter((e) => isProteinSmart(recipesById, e.recipeId)).length;
  return smartCount / entries.length;
}

/**
 * K.3: fills empty, auto-enabled slots for the week. Never touches a slot that already has an
 * entry (manual or otherwise carried over) — the hard "user entries are never overwritten" rule.
 * @param {{ recipes: Array, plan: object, prefs: object, household: object, weekOf: string }} input
 * @returns {{ plan: object, added: Array, proteinSmartShare: number, needs: Array<{slot: string, count: number}> }}
 */
export function planWeek({ recipes, plan, prefs, household, weekOf }) {
  const recipesById = Object.fromEntries(recipes.map((r) => [r.id, r]));
  const workingPlan = cloneDays(plan);
  const added = [];
  const shortfallCounts = {};

  for (const { day, slot } of buildFillOrder()) {
    if (!isSlotEnabled(prefs?.settings?.autoSlots, slot, day)) continue;
    if ((workingPlan[day] || []).some((e) => e.slot === slot)) continue; // not empty — never touch

    const candidates = eligibleCandidates(recipes, { slot, plan: workingPlan, prefs, recipesById, weekOf });
    if (candidates.length === 0) {
      shortfallCounts[slot] = (shortfallCounts[slot] || 0) + 1;
      continue;
    }

    const plannedRecipesById = Object.fromEntries(
      DAYS.flatMap((d) => workingPlan[d] || []).map((e) => [e.recipeId, recipesById[e.recipeId]]).filter(([, r]) => r),
    );
    const best = candidates
      .map((r) => ({ recipe: r, score: computeScore({ recipe: r, slot, day, plannedRecipesById, prefs, household, weekOf }) }))
      .sort((a, b) => b.score - a.score)[0].recipe;

    const entry = {
      recipeId: best.id, slot, servings: household?.default_servings || 4, source: 'auto',
      reasons: topReasons(best, { prefs, household }),
    };
    workingPlan[day] = [...(workingPlan[day] || []), entry];
    added.push({ day, slot, recipeId: best.id });
  }

  repairForProteinSmartTarget(workingPlan, recipes, recipesById, { prefs, household, weekOf, shortfallCounts });

  return {
    plan: workingPlan,
    added,
    proteinSmartShare: computeProteinSmartShare(workingPlan, recipesById),
    needs: Object.entries(shortfallCounts).map(([slot, count]) => ({ slot, count })),
  };
}

/** K.3 step 4: swap the lowest-scoring non-protein-smart *auto* entry for a protein-smart candidate, until >= 60% or no swaps are left. */
function repairForProteinSmartTarget(workingPlan, recipes, recipesById, { prefs, household, weekOf, shortfallCounts }) {
  const TARGET = 0.6;
  while (true) {
    if (computeProteinSmartShare(workingPlan, recipesById) >= TARGET) return;

    const swappable = DAYS.flatMap((day) => (workingPlan[day] || []).map((entry, index) => ({ day, index, entry })))
      .filter(({ entry }) => entry.source === 'auto' && PROTEIN_SMART_SLOTS.includes(entry.slot) && !isProteinSmart(recipesById, entry.recipeId));
    if (swappable.length === 0) return; // nothing left to swap — report the shortfall as-is

    const withScores = swappable.map((candidate) => ({
      ...candidate,
      score: computeScore({
        recipe: recipesById[candidate.entry.recipeId], slot: candidate.entry.slot, day: candidate.day,
        plannedRecipesById: {}, prefs, household, weekOf,
      }),
    })).sort((a, b) => a.score - b.score);
    const worst = withScores[0];

    const otherPlanWithoutWorst = cloneDays(workingPlan);
    otherPlanWithoutWorst[worst.day] = otherPlanWithoutWorst[worst.day].filter((_, i) => i !== worst.index);
    const replacementCandidates = eligibleCandidates(recipes, { slot: worst.entry.slot, plan: otherPlanWithoutWorst, prefs, recipesById, weekOf })
      .filter((r) => r.is_protein_smart);

    if (replacementCandidates.length === 0) {
      shortfallCounts[worst.entry.slot] = (shortfallCounts[worst.entry.slot] || 0) + 1;
      return;
    }

    const plannedRecipesById = Object.fromEntries(
      DAYS.flatMap((d) => otherPlanWithoutWorst[d] || []).map((e) => [e.recipeId, recipesById[e.recipeId]]).filter(([, r]) => r),
    );
    const replacement = replacementCandidates
      .map((r) => ({ recipe: r, score: computeScore({ recipe: r, slot: worst.entry.slot, day: worst.day, plannedRecipesById, prefs, household, weekOf }) }))
      .sort((a, b) => b.score - a.score)[0].recipe;

    workingPlan[worst.day] = otherPlanWithoutWorst[worst.day].slice();
    workingPlan[worst.day].splice(worst.index, 0, {
      recipeId: replacement.id, slot: worst.entry.slot, servings: household?.default_servings || 4,
      source: 'auto', reasons: topReasons(replacement, { prefs, household }),
    });
  }
}

/**
 * K.3's Shuffle button: picks the next-best candidate for one existing entry's (day, slot),
 * excluding the recipe already there. Returns a replacement entry, or null if nothing else fits.
 */
export function shuffleEntry({ plan, day, slot, recipeId, servings, recipes, prefs, household, weekOf }) {
  const recipesById = Object.fromEntries(recipes.map((r) => [r.id, r]));
  const planWithoutEntry = cloneDays(plan);
  planWithoutEntry[day] = (planWithoutEntry[day] || []).filter((e) => !(e.slot === slot && e.recipeId === recipeId));

  const candidates = eligibleCandidates(recipes, { slot, plan: planWithoutEntry, prefs, recipesById, weekOf })
    .filter((r) => r.id !== recipeId);
  if (candidates.length === 0) return null;

  const plannedRecipesById = Object.fromEntries(
    DAYS.flatMap((d) => planWithoutEntry[d] || []).map((e) => [e.recipeId, recipesById[e.recipeId]]).filter(([, r]) => r),
  );
  const best = candidates
    .map((r) => ({ recipe: r, score: computeScore({ recipe: r, slot, day, plannedRecipesById, prefs, household, weekOf }) }))
    .sort((a, b) => b.score - a.score)[0].recipe;

  return { recipeId: best.id, slot, servings, source: 'auto', reasons: topReasons(best, { prefs, household }) };
}
