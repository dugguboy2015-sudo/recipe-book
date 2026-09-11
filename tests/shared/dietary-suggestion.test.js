import { describe, expect, it } from 'vitest';
import { aggregateIngredientDietarySignal, needsHouseholdConfirm } from '../../public/js/shared/dietary-suggestion.js';

function row(overrides) {
  return { ingredientName: 'ingredient', ingredientId: 1, ingredientReviewed: true, ingredientFlags: { contains_meat: false, contains_egg: false, contains_dairy: false }, ...overrides };
}

describe('aggregateIngredientDietarySignal', () => {
  it('returns null with no named rows', () => {
    expect(aggregateIngredientDietarySignal([])).toBeNull();
    expect(aggregateIngredientDietarySignal([row({ ingredientName: '  ' })])).toBeNull();
  });

  it('returns null when any resolved ingredient is unreviewed', () => {
    expect(aggregateIngredientDietarySignal([row({ ingredientReviewed: false })])).toBeNull();
  });

  it('returns null when a row has no flags at all', () => {
    expect(aggregateIngredientDietarySignal([row({ ingredientFlags: null })])).toBeNull();
  });

  it('does not require review for a brand-new ingredient (no id yet, flags derived at entry)', () => {
    const signal = aggregateIngredientDietarySignal([row({ ingredientId: null, ingredientReviewed: false })]);
    expect(signal).toEqual({ is_vegetarian: true, is_egg_free: true, contains_dairy: false });
  });

  it('flags not-vegetarian when any row contains meat', () => {
    const signal = aggregateIngredientDietarySignal([
      row({}),
      row({ ingredientFlags: { contains_meat: true, contains_egg: false, contains_dairy: false } }),
    ]);
    expect(signal).toEqual({ is_vegetarian: false, is_egg_free: true, contains_dairy: false });
  });

  it('flags contains_dairy true when any row contains dairy', () => {
    const signal = aggregateIngredientDietarySignal([row({ ingredientFlags: { contains_meat: false, contains_egg: false, contains_dairy: true } })]);
    expect(signal).toEqual({ is_vegetarian: true, is_egg_free: true, contains_dairy: true });
  });
});

describe('needsHouseholdConfirm', () => {
  const household = { diet: { vegetarian: true, egg_free: true } };

  it('confirms when a vegetarian, egg-free household gets a non-vegetarian recipe', () => {
    expect(needsHouseholdConfirm(household, { is_vegetarian: false, is_egg_free: true })).toBe(true);
  });

  it('confirms when the recipe contains egg', () => {
    expect(needsHouseholdConfirm(household, { is_vegetarian: true, is_egg_free: false })).toBe(true);
  });

  it('does not confirm when the recipe matches the household diet', () => {
    expect(needsHouseholdConfirm(household, { is_vegetarian: true, is_egg_free: true })).toBe(false);
  });

  it('never confirms without a household profile', () => {
    expect(needsHouseholdConfirm(null, { is_vegetarian: false, is_egg_free: false })).toBe(false);
  });

  it('does not confirm for a household without those restrictions', () => {
    expect(needsHouseholdConfirm({ diet: { vegetarian: false, egg_free: false } }, { is_vegetarian: false, is_egg_free: false })).toBe(false);
  });
});
