import { describe, expect, it } from 'vitest';
import { describeMatch, rankByIngredients } from '../../public/js/shared/fridge-search.js';

// 1 onion, 2 tomato, 3 paneer, 90 salt (a pantry staple)
const rows = [
  { recipe_id: 10, ingredient_id: 1 }, { recipe_id: 10, ingredient_id: 2 }, { recipe_id: 10, ingredient_id: 90 },
  { recipe_id: 20, ingredient_id: 1 }, { recipe_id: 20, ingredient_id: 3 }, { recipe_id: 20, ingredient_id: 4 }, { recipe_id: 20, ingredient_id: 5 },
  { recipe_id: 30, ingredient_id: 7 },
];

describe('rankByIngredients', () => {
  it('puts the recipe using most of what you have first', () => {
    const ranked = rankByIngredients({ have: [1, 2], rows });
    expect(ranked.map((r) => r.recipeId)).toEqual([10, 20]);
    expect(ranked[0].matched.sort()).toEqual([1, 2]);
  });

  it('breaks a tie on how much else you would have to buy', () => {
    const ranked = rankByIngredients({ have: [1], rows });
    expect(ranked.map((r) => r.recipeId)).toEqual([10, 20]); // 10 is missing 2 (tomato, salt), 20 is missing 3
    expect(ranked[0].missingCount).toBe(2);
    expect(ranked[1].missingCount).toBe(3);
  });

  it('then prefers the quicker recipe', () => {
    const tieRows = [{ recipe_id: 1, ingredient_id: 1 }, { recipe_id: 2, ingredient_id: 1 }];
    const ranked = rankByIngredients({ have: [1], rows: tieRows, recipesById: { 1: { total_time_minutes: 60 }, 2: { total_time_minutes: 20 } } });
    expect(ranked.map((r) => r.recipeId)).toEqual([2, 1]);
  });

  it('does not count store-cupboard staples as something to buy', () => {
    const withPantry = rankByIngredients({ have: [1, 2], rows, pantryIds: [90] });
    expect(withPantry[0].missingCount).toBe(0);
    const withoutPantry = rankByIngredients({ have: [1, 2], rows });
    expect(withoutPantry[0].missingCount).toBe(1);
  });

  it('leaves out recipes that use nothing you have', () => {
    expect(rankByIngredients({ have: [1], rows }).map((r) => r.recipeId)).not.toContain(30);
  });

  it('can insist on more than one match', () => {
    expect(rankByIngredients({ have: [1, 2], rows, minMatches: 2 }).map((r) => r.recipeId)).toEqual([10]);
  });

  it('is empty when you have nothing', () => {
    expect(rankByIngredients({ have: [], rows })).toEqual([]);
  });
});

describe('describeMatch', () => {
  it('says what it uses and what is still needed', () => {
    expect(describeMatch({ matched: [1, 2], missingCount: 2 }, 4)).toBe('Uses 2 of your 4 · 2 more to buy');
    expect(describeMatch({ matched: [1], missingCount: 0 }, 1)).toBe('Uses 1 of your 1 · nothing else to buy');
  });
});
