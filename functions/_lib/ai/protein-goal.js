import { VOLUME_ML } from '../../../public/js/shared/units.js';

/**
 * Mirrors `refresh_recipe_derived`'s refined_carb_heavy rule (Appendix A.13/J.2) for a draft that
 * has no recipe_id yet: true if refined-grain volume >= 40% of total grain volume, or
 * added-sugar volume exceeds 1½ tsp (7.5ml) per serving.
 * @param {{ resolvedIngredients: Array<{category: string, quantity: number|null, unit: string}>, serves: number }} input
 */
export function computeRefinedCarbHeavy({ resolvedIngredients, serves }) {
  let grainTotalMl = 0;
  let grainRefinedMl = 0;
  let sweetenerMl = 0;

  for (const item of resolvedIngredients || []) {
    const mlPerUnit = VOLUME_ML[item.unit];
    if (mlPerUnit === undefined || item.quantity === null || item.quantity === undefined) continue;
    const volumeMl = item.quantity * mlPerUnit;
    if (item.category === 'grain_whole' || item.category === 'grain_refined') grainTotalMl += volumeMl;
    if (item.category === 'grain_refined') grainRefinedMl += volumeMl;
    if (item.category === 'sweetener') sweetenerMl += volumeMl;
  }

  const refinedGrainHeavy = grainTotalMl > 0 && grainRefinedMl >= 0.4 * grainTotalMl;
  const sugarHeavy = serves > 0 && sweetenerMl / serves > 7.5;
  return refinedGrainHeavy || sugarHeavy;
}

/** J.2: is_protein_smart, computed the same way the generated column is. */
export function isProteinSmart({ protein_g, calories_kcal, sugars_g, refinedCarbHeavy }) {
  return Boolean(
    protein_g >= 15
    && calories_kcal > 0 && protein_g * 4 >= 0.20 * calories_kcal
    && sugars_g !== null && sugars_g !== undefined && sugars_g <= 8
    && refinedCarbHeavy === false,
  );
}

/**
 * J.3: the effective goal for this generation request, from the caller-supplied recent-recipe
 * pool (the last 20 saved AI recipes' protein_smart flags — or, per spec, every generated draft's
 * flag instead when fewer than 5 have been saved; deciding which pool to pass in is the caller's
 * job, since it needs a DB query this module stays free of).
 * @param {'auto'|'protein_smart'|'balanced'} requestedGoal
 * @param {Array<{protein_smart: boolean}>} recentRecords
 */
export function computeEffectiveGoal(requestedGoal, recentRecords) {
  const total = recentRecords.length;
  const proteinSmartCount = recentRecords.filter((r) => r.protein_smart).length;
  const share = total > 0 ? proteinSmartCount / total : 0;

  if (requestedGoal === 'protein_smart') return { effectiveGoal: 'protein_smart', goalAdjusted: false, share };

  if (requestedGoal === 'balanced') {
    const projectedShare = proteinSmartCount / (total + 1);
    if (projectedShare >= 0.6) return { effectiveGoal: 'balanced', goalAdjusted: false, share };
    return { effectiveGoal: 'protein_smart', goalAdjusted: true, share };
  }

  // auto
  if (share < 0.6) return { effectiveGoal: 'protein_smart', goalAdjusted: false, share };
  return { effectiveGoal: 'balanced', goalAdjusted: false, share };
}
