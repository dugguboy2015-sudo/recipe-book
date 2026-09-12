import { describe, expect, it } from 'vitest';
import { DAYS, computeScore, planWeek } from '../../public/js/shared/planner-engine.js';

const household = {
  default_servings: 4,
  favourite_cuisines: ['South Indian', 'North Indian', 'Maharashtrian', 'Rajasthani', 'Chaat', 'Indo-Chinese'],
};

const WEEK_OF = '2026-09-14'; // a Monday

function emptyPlan() {
  return Object.fromEntries(DAYS.map((day) => [day, []]));
}

function emptyPrefs(autoSlots) {
  return {
    version: 1,
    recipes: {},
    history: [],
    settings: {
      autoSlots: { Breakfast: false, 'Packed Lunch': false, Lunch: false, Dinner: false, Snacks: false, Dessert: false, ...autoSlots },
    },
  };
}

const MAIN_RECIPES = [
  { id: 1, name: 'Idli', cuisine: 'South Indian', meal_types: ['Breakfast'], total_time_minutes: 20, is_protein_smart: false, spice_level: 'mild' },
  { id: 2, name: 'Poha', cuisine: 'Maharashtrian', meal_types: ['Breakfast'], total_time_minutes: 15, is_protein_smart: false, spice_level: 'mild' },
  { id: 3, name: 'Moong Dal Chilla', cuisine: 'North Indian', meal_types: ['Breakfast', 'Packed Lunch'], total_time_minutes: 20, is_protein_smart: true, spice_level: 'mild' },
  { id: 4, name: 'Dal Tadka', cuisine: 'North Indian', meal_types: ['Lunch', 'Dinner'], total_time_minutes: 30, is_protein_smart: true, spice_level: 'medium' },
  { id: 5, name: 'Paneer Butter Masala', cuisine: 'North Indian', meal_types: ['Lunch', 'Dinner'], total_time_minutes: 35, is_protein_smart: true, spice_level: 'medium' },
  { id: 6, name: 'Chole', cuisine: 'North Indian', meal_types: ['Lunch', 'Dinner'], total_time_minutes: 45, is_protein_smart: true, spice_level: 'medium' },
  { id: 7, name: 'Aloo Gobi', cuisine: 'North Indian', meal_types: ['Lunch', 'Dinner'], total_time_minutes: 30, is_protein_smart: false, spice_level: 'mild' },
  { id: 8, name: 'Veg Biryani', cuisine: 'Hyderabadi', meal_types: ['Dinner'], total_time_minutes: 70, is_protein_smart: false, spice_level: 'hot' },
  { id: 9, name: 'Rajma', cuisine: 'North Indian', meal_types: ['Lunch', 'Dinner'], total_time_minutes: 40, is_protein_smart: true, spice_level: 'medium' },
  { id: 10, name: 'Sprouts Chaat', cuisine: 'Chaat', meal_types: ['Packed Lunch', 'Snacks'], total_time_minutes: 15, is_protein_smart: true, spice_level: 'mild' },
  { id: 11, name: 'Vegetable Sandwich', cuisine: 'North Indian', meal_types: ['Packed Lunch'], total_time_minutes: 10, is_protein_smart: false, spice_level: 'mild' },
  { id: 12, name: 'Paneer Roll', cuisine: 'North Indian', meal_types: ['Packed Lunch'], total_time_minutes: 20, is_protein_smart: true, spice_level: 'medium' },
];

function allEntries(plan) {
  return DAYS.flatMap((day) => (plan[day] || []).map((entry) => ({ ...entry, day })));
}

describe('planWeek', () => {
  it('is deterministic — identical inputs produce an identical plan', () => {
    const input = { recipes: MAIN_RECIPES, plan: emptyPlan(), prefs: emptyPrefs({ Breakfast: true, 'Packed Lunch': true, Dinner: true, Lunch: 'weekends' }), household, weekOf: WEEK_OF };
    const first = planWeek(input);
    const second = planWeek({ ...input, plan: emptyPlan() });
    expect(second.plan).toEqual(first.plan);
    expect(second.proteinSmartShare).toBe(first.proteinSmartShare);
    expect(second.needs).toEqual(first.needs);
  });

  it('never overwrites a slot the user filled by hand, even when auto-fill is enabled for it', () => {
    const plan = emptyPlan();
    plan.Monday = [{ recipeId: 999, slot: 'Dinner', servings: 4, source: 'manual' }];
    const result = planWeek({ recipes: MAIN_RECIPES, plan, prefs: emptyPrefs({ Dinner: true }), household, weekOf: WEEK_OF });
    const mondayDinners = result.plan.Monday.filter((e) => e.slot === 'Dinner');
    expect(mondayDinners).toEqual([{ recipeId: 999, slot: 'Dinner', servings: 4, source: 'manual' }]);
  });

  it('repairs toward a 60% protein-smart share across Packed Lunch/Lunch/Dinner when candidates allow it', () => {
    const nonProteinSmart = [1, 2, 3, 4, 5].map((n) => ({
      id: 100 + n, name: `Quick Favourite ${n}`, cuisine: 'North Indian', meal_types: ['Dinner'],
      total_time_minutes: 20, is_protein_smart: false, spice_level: 'mild',
    }));
    const proteinSmart = [1, 2, 3, 4, 5].map((n) => ({
      id: 200 + n, name: `Protein Smart ${n}`, cuisine: `Cuisine${n}`, meal_types: ['Dinner'],
      total_time_minutes: 65, is_protein_smart: true, spice_level: 'medium',
    }));
    const recipes = [...nonProteinSmart, ...proteinSmart];
    const result = planWeek({ recipes, plan: emptyPlan(), prefs: emptyPrefs({ Dinner: true }), household, weekOf: WEEK_OF });

    expect(result.proteinSmartShare).toBeGreaterThanOrEqual(0.6);
    expect(result.needs).toEqual([]);

    // The cuisine cap (max 3 dinners/week from one cuisine) must still hold after repair swaps.
    const cuisineCounts = {};
    for (const entry of allEntries(result.plan)) {
      const recipe = recipes.find((r) => r.id === entry.recipeId);
      cuisineCounts[recipe.cuisine] = (cuisineCounts[recipe.cuisine] || 0) + 1;
    }
    for (const count of Object.values(cuisineCounts)) expect(count).toBeLessThanOrEqual(3);
  });

  it('reports a shortfall instead of exceeding the hard rules when there are not enough eligible candidates', () => {
    const recipes = [
      { id: 1, name: 'Only Dinner Option', cuisine: 'North Indian', meal_types: ['Dinner'], total_time_minutes: 30, is_protein_smart: true, spice_level: 'mild' },
    ];
    const result = planWeek({ recipes, plan: emptyPlan(), prefs: emptyPrefs({ Dinner: true }), household, weekOf: WEEK_OF });
    const dinnerEntries = allEntries(result.plan).filter((e) => e.slot === 'Dinner');
    expect(dinnerEntries).toHaveLength(1); // only one non-Breakfast use of any recipe per week
    expect(result.needs).toContainEqual({ slot: 'Dinner', count: 6 });
  });

  it('excludes a "not again" recipe from auto-fill entirely', () => {
    const prefs = emptyPrefs({ Breakfast: true, 'Packed Lunch': true, Dinner: true, Lunch: 'weekends' });
    prefs.recipes['5'] = { manual: 0, kept: 0, removed: 0, loved: 0, notAgain: 1, lastPlanned: null };
    const result = planWeek({ recipes: MAIN_RECIPES, plan: emptyPlan(), prefs, household, weekOf: WEEK_OF });
    expect(allEntries(result.plan).some((e) => e.recipeId === 5)).toBe(false);
  });

  it('fills Packed Lunch only on weekdays and only from Packed-Lunch-tagged recipes', () => {
    const result = planWeek({ recipes: MAIN_RECIPES, plan: emptyPlan(), prefs: emptyPrefs({ 'Packed Lunch': true }), household, weekOf: WEEK_OF });
    const packedLunchEntries = allEntries(result.plan).filter((e) => e.slot === 'Packed Lunch');
    expect(packedLunchEntries.some((e) => e.day === 'Saturday' || e.day === 'Sunday')).toBe(false);
    for (const entry of packedLunchEntries) {
      const recipe = MAIN_RECIPES.find((r) => r.id === entry.recipeId);
      expect(recipe.meal_types).toContain('Packed Lunch');
    }
  });
});

describe('computeScore', () => {
  const baseArgs = { slot: 'Dinner', day: 'Tuesday', plannedRecipesById: {}, prefs: emptyPrefs({}), household, weekOf: WEEK_OF };

  it('cold start (no history): a favourite-cuisine, protein-smart recipe outscores a plain one by more than the jitter spread', () => {
    const favourite = { id: 501, name: 'Favourite & Smart', cuisine: 'North Indian', meal_types: ['Dinner'], total_time_minutes: 90, is_protein_smart: true };
    const plain = { id: 502, name: 'Plain', cuisine: 'Continental', meal_types: ['Dinner'], total_time_minutes: 90, is_protein_smart: false };
    const favouriteScore = computeScore({ ...baseArgs, recipe: favourite });
    const plainScore = computeScore({ ...baseArgs, recipe: plain });
    expect(favouriteScore - plainScore).toBeGreaterThan(0.15); // max jitter spread is 0.15
  });

  it('applies a recency penalty for a recipe planned within the last 7 days', () => {
    const recipe = { id: 601, name: 'Recent', cuisine: 'North Indian', meal_types: ['Dinner'], total_time_minutes: 30, is_protein_smart: true };
    const recentPrefs = emptyPrefs({});
    recentPrefs.recipes['601'] = { manual: 1, kept: 0, removed: 0, loved: 0, notAgain: 0, lastPlanned: '2026-09-10' }; // 4 days before weekOf
    const staleScore = computeScore({ ...baseArgs, recipe, prefs: emptyPrefs({}) });
    const recentScore = computeScore({ ...baseArgs, recipe, prefs: recentPrefs });
    expect(recentScore).toBeLessThan(staleScore);
  });
});
