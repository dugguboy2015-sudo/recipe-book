import { describe, expect, it } from 'vitest';
import { computeRefinedCarbHeavy, isProteinSmart, computeEffectiveGoal } from '../../functions/_lib/ai/protein-goal.js';

describe('computeRefinedCarbHeavy', () => {
  it('is false with no grain or sweetener ingredients', () => {
    expect(computeRefinedCarbHeavy({ resolvedIngredients: [{ category: 'vegetable', quantity: 1, unit: 'cup' }], serves: 4 })).toBe(false);
  });

  it('is true when refined grain is at least 40% of total grain volume', () => {
    const resolvedIngredients = [
      { category: 'grain_whole', quantity: 0.6, unit: 'cup' },
      { category: 'grain_refined', quantity: 0.4, unit: 'cup' },
    ];
    expect(computeRefinedCarbHeavy({ resolvedIngredients, serves: 4 })).toBe(true);
  });

  it('is false when refined grain is under 40% of total grain volume', () => {
    const resolvedIngredients = [
      { category: 'grain_whole', quantity: 0.7, unit: 'cup' },
      { category: 'grain_refined', quantity: 0.29, unit: 'cup' },
    ];
    expect(computeRefinedCarbHeavy({ resolvedIngredients, serves: 4 })).toBe(false);
  });

  it('is true when added sugar exceeds 1½ tsp (7.5ml) per serving', () => {
    // 2 tbsp = 30ml, / 4 serves = 7.5ml/serving exactly -> not over; bump to 3 tbsp to exceed it
    const resolvedIngredients = [{ category: 'sweetener', quantity: 3, unit: 'tbsp' }];
    expect(computeRefinedCarbHeavy({ resolvedIngredients, serves: 4 })).toBe(true);
  });

  it('ignores ingredients with no volume unit (count/weight) or null quantity', () => {
    const resolvedIngredients = [
      { category: 'grain_refined', quantity: null, unit: 'cup' },
      { category: 'grain_refined', quantity: 5, unit: 'piece' },
    ];
    expect(computeRefinedCarbHeavy({ resolvedIngredients, serves: 4 })).toBe(false);
  });
});

describe('isProteinSmart (J.2)', () => {
  const base = { protein_g: 20, calories_kcal: 350, sugars_g: 5, refinedCarbHeavy: false };

  it('is true when every condition holds', () => {
    expect(isProteinSmart(base)).toBe(true);
  });

  it('is false under 15g protein', () => {
    expect(isProteinSmart({ ...base, protein_g: 14 })).toBe(false);
  });

  it('is false when protein is under 20% of calories', () => {
    expect(isProteinSmart({ ...base, calories_kcal: 2000 })).toBe(false);
  });

  it('is false over 8g sugar', () => {
    expect(isProteinSmart({ ...base, sugars_g: 9 })).toBe(false);
  });

  it('is false when refined-carb-heavy', () => {
    expect(isProteinSmart({ ...base, refinedCarbHeavy: true })).toBe(false);
  });

  it('is false with sugars_g missing (null input treated as unknown, never protein-smart)', () => {
    expect(isProteinSmart({ ...base, sugars_g: null })).toBe(false);
  });
});

describe('computeEffectiveGoal (J.3)', () => {
  it('honours an explicit protein_smart request unconditionally', () => {
    expect(computeEffectiveGoal('protein_smart', []).effectiveGoal).toBe('protein_smart');
  });

  it('auto upgrades to protein_smart when the recent share is under 60%', () => {
    const recentRecords = Array.from({ length: 10 }, (_, i) => ({ protein_smart: i < 5 })); // 50%
    const result = computeEffectiveGoal('auto', recentRecords);
    expect(result.effectiveGoal).toBe('protein_smart');
    expect(result.goalAdjusted).toBe(false);
  });

  it('auto stays balanced when the recent share is already >= 60%', () => {
    const recentRecords = Array.from({ length: 10 }, (_, i) => ({ protein_smart: i < 6 })); // 60%
    const result = computeEffectiveGoal('auto', recentRecords);
    expect(result.effectiveGoal).toBe('balanced');
  });

  it('with no history at all, auto defaults to protein_smart (share treated as 0)', () => {
    expect(computeEffectiveGoal('auto', []).effectiveGoal).toBe('protein_smart');
  });

  it('honours an explicit balanced request when the share would stay >= 60% after counting it', () => {
    // 6 of 9 protein-smart so far (67%); adding one more balanced recipe -> 6/10 = 60%, still ok
    const recentRecords = Array.from({ length: 9 }, (_, i) => ({ protein_smart: i < 6 }));
    const result = computeEffectiveGoal('balanced', recentRecords);
    expect(result.effectiveGoal).toBe('balanced');
    expect(result.goalAdjusted).toBe(false);
  });

  it('upgrades an explicit balanced request to protein_smart when it would drop the share below 60%', () => {
    // 5 of 9 protein-smart (55%); adding one more balanced -> 5/10 = 50%, below 60%
    const recentRecords = Array.from({ length: 9 }, (_, i) => ({ protein_smart: i < 5 }));
    const result = computeEffectiveGoal('balanced', recentRecords);
    expect(result.effectiveGoal).toBe('protein_smart');
    expect(result.goalAdjusted).toBe(true);
  });
});
