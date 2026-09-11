import { dietaryWarnings, reconcileTimes, slugify } from '../../../public/js/shared/recipe-rules.js';
import { resolveIngredients } from './ingredient-resolution.js';
import { computeRefinedCarbHeavy, isProteinSmart } from './protein-goal.js';

const NUTRITION_FIELDS = ['calories_kcal', 'protein_g', 'carbs_g', 'sugars_g', 'fibre_g', 'fat_g', 'saturates_g', 'salt_g'];

function structuralHardFailure(draft) {
  if (!draft || typeof draft !== 'object') return 'empty response';
  if (!draft.name || !String(draft.name).trim()) return 'missing name';
  const hasIngredients = Array.isArray(draft.ingredients) && draft.ingredients.some((g) => Array.isArray(g?.items) && g.items.length > 0);
  if (!hasIngredients) return 'zero ingredients';
  const hasSteps = Array.isArray(draft.steps) && draft.steps.some((g) => Array.isArray(g?.steps) && g.steps.length > 0);
  if (!hasSteps) return 'zero steps';
  const hasDietary = typeof draft.is_vegetarian === 'boolean' && typeof draft.is_egg_free === 'boolean' && typeof draft.contains_dairy === 'boolean';
  if (!hasDietary) return 'missing a dietary boolean';
  return null;
}

/**
 * Steps 7-10 of the generate pipeline: hard structural checks, the v2 household hard rule
 * (Appendix I — meat/egg evidence is invalid, not a warning), nutrition completeness, time
 * reconciliation, name collision, ingredient resolution, and the J.2/J.3 protein-goal check.
 *
 * @param {{ request: Function }} db
 * @param {object} draft - the raw, still-unresolved model output
 * @param {{ cuisines: string[], constraints: object, effectiveGoal: 'protein_smart'|'balanced',
 *   findExistingBySlug: (slug: string) => Promise<{id: number, name: string}|null> }} context
 * @returns {Promise<{ hardFailure: string|null, retryIssues: string[], warnings: Array, resolvedIngredients: Array, proteinSmart: boolean }>}
 */
export async function evaluateDraft(db, draft, { constraints = {}, effectiveGoal, findExistingBySlug } = {}) {
  const hardFailure = structuralHardFailure(draft);
  if (hardFailure) {
    return { hardFailure, householdIssues: [], nutritionIssues: [], goalIssue: null, retryFeedback: null, warnings: [], resolvedIngredients: [], proteinSmart: false };
  }

  const householdIssues = [];
  const nutritionIssues = [];
  const warnings = [];

  // v2 Appendix I hard rule: this household is strictly vegetarian and egg-free. A draft claiming
  // otherwise, or whose ingredients contradict the claim, is invalid — not merely a warning.
  if (draft.is_vegetarian !== true) householdIssues.push('the draft is not marked vegetarian; make it vegetarian');
  if (draft.is_egg_free !== true) householdIssues.push('the draft is not marked egg-free; make it egg-free');
  const crossCheck = dietaryWarnings(draft);
  for (const w of crossCheck) {
    if (w.field === 'is_vegetarian') householdIssues.push(`the draft used ${w.evidence[0]}; use a vegetarian substitute instead`);
    else if (w.field === 'is_egg_free') householdIssues.push(`the draft used ${w.evidence[0]}; use an eggless alternative instead`);
    else warnings.push({ field: w.field, code: w.code, message: w.message, evidence: w.evidence });
  }

  if (constraints.vegetarian && draft.is_vegetarian !== true) warnings.push({ field: 'is_vegetarian', code: 'constraint_violation', message: 'You asked for a vegetarian recipe.' });
  if (constraints.eggFree && draft.is_egg_free !== true) warnings.push({ field: 'is_egg_free', code: 'constraint_violation', message: 'You asked for an egg-free recipe.' });
  if (constraints.dairyFree && draft.contains_dairy !== false) warnings.push({ field: 'contains_dairy', code: 'constraint_violation', message: 'You asked for a dairy-free recipe.' });
  if (constraints.maxTotalMinutes && Number(draft.total_time_minutes) > constraints.maxTotalMinutes) {
    warnings.push({ field: 'total_time_minutes', code: 'constraint_violation', message: `You asked for at most ${constraints.maxTotalMinutes} minutes.` });
  }

  for (const field of NUTRITION_FIELDS) {
    if (draft[field] === null || draft[field] === undefined) nutritionIssues.push(`the nutrition field ${field} is missing; include a per-serving estimate`);
  }
  const kcalCalc = 4 * (draft.protein_g || 0) + 4 * (draft.carbs_g || 0) + 9 * (draft.fat_g || 0) + 2 * (draft.fibre_g || 0);
  if (draft.calories_kcal && Math.abs(draft.calories_kcal - kcalCalc) / draft.calories_kcal > 0.2) {
    warnings.push({ field: 'calories_kcal', code: 'nutrition_inconsistent', message: 'calories don’t match 4×protein + 4×carbs + 9×fat + 2×fibre within 20%.' });
  }
  if (draft.sugars_g > draft.carbs_g) warnings.push({ field: 'sugars_g', code: 'nutrition_inconsistent', message: 'sugars_g is greater than carbs_g.' });
  if (draft.saturates_g > draft.fat_g) warnings.push({ field: 'saturates_g', code: 'nutrition_inconsistent', message: 'saturates_g is greater than fat_g.' });

  const reconciled = reconcileTimes({ prep: draft.prep_time_minutes, cook: draft.cook_time_minutes, total: draft.total_time_minutes });
  if (reconciled.adjusted) warnings.push({ field: 'total_time_minutes', code: 'times_adjusted', message: 'total_time_minutes was adjusted to be at least prep + cook.' });

  if (findExistingBySlug) {
    const existing = await findExistingBySlug(slugify(draft.name));
    if (existing) warnings.push({ field: 'name', code: 'name_exists', message: `A recipe named "${existing.name}" already exists.`, existing });
  }

  const { groups: resolvedIngredients, warnings: unitWarnings } = await resolveIngredients(db, draft.ingredients);
  for (const w of unitWarnings) {
    warnings.push({
      field: w.field,
      code: w.code,
      message: w.code === 'non_cup_unit' ? `${w.field}'s quantity couldn't be converted to cups or spoons.` : `${w.field}'s unit wasn't recognised.`,
    });
  }

  const refinedCarbHeavy = computeRefinedCarbHeavy({
    resolvedIngredients: resolvedIngredients.flatMap((g) => g.items),
    serves: Number(draft.serves) || 0,
  });
  const proteinSmart = isProteinSmart({ protein_g: draft.protein_g, calories_kcal: draft.calories_kcal, sugars_g: draft.sugars_g, refinedCarbHeavy });

  const goalIssue = effectiveGoal === 'protein_smart' && !proteinSmart
    ? `protein ${draft.protein_g ?? '?'} g, needs ≥ 15 g and ≥ 20% of calories from protein, sugars ≤ 8 g, and mainly whole grains; add paneer, tofu, soya, dal or hung curd and cut refined grains/added sugar`
    : null;

  const allIssues = [...householdIssues, ...nutritionIssues, ...(goalIssue ? [goalIssue] : [])];
  const retryFeedback = allIssues.length ? allIssues.join(' ') : null;

  return { hardFailure: null, householdIssues, nutritionIssues, goalIssue, retryFeedback, warnings, resolvedIngredients, proteinSmart, refinedCarbHeavy };
}
