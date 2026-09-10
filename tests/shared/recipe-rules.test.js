import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  slugify, parseAmount, formatAmount, ingredientsToText, textToIngredients,
  stepsToText, textToSteps, reconcileTimes, normalizeRecipeInput, dietaryWarnings,
} from '../../public/js/shared/recipe-rules.js';

describe('slugify', () => {
  it.each([
    ['Aloo Paratha with Curd (North Indian)', 'aloo-paratha-with-curd-north-indian'],
    ['Masala Cheese & Sweetcorn Sandwich', 'masala-cheese-sweetcorn-sandwich'],
    ['  Puran Poli (Sweet, Dessert-Style) ', 'puran-poli-sweet-dessert-style'],
    ['Lemon Rice (Chitranna)', 'lemon-rice-chitranna'],
  ])('%s -> %s', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it('matches the DB-generated slug for every fixture recipe', () => {
    const snapshot = JSON.parse(readFileSync('scripts/fixtures/recipes.snapshot.json', 'utf8'));
    const dbSlugs = JSON.parse(readFileSync('scripts/fixtures/slugs.json', 'utf8'));
    const dbSlugById = new Map(dbSlugs.map((row) => [row.id, row.slug]));
    for (const recipe of snapshot) {
      expect(slugify(recipe.name)).toBe(dbSlugById.get(recipe.id));
    }
  });
});

describe('parseAmount', () => {
  it.each([
    ['2', 2], ['2.5', 2.5], ['1/2', 0.5], ['1 1/2', 1.5], ['½', 0.5], ['¾', 0.75], ['', null], ['pinch', null],
  ])('%s -> %s', (input, expected) => {
    expect(parseAmount(input)).toBe(expected);
  });
});

describe('formatAmount', () => {
  it.each([[0.5, '0.5'], [1.5, '1.5'], [null, '']])('%s -> %s', (input, expected) => {
    expect(formatAmount(input)).toBe(expected);
  });
});

describe('ingredients round-trip', () => {
  const fixtures = JSON.parse(readFileSync('scripts/fixtures/recipes.snapshot.json', 'utf8')).filter((r) => !r.is_deleted && r.id !== 2);

  it('round-trips every fixture recipe (amount null / unit "" normalised)', () => {
    for (const recipe of fixtures) {
      const normalized = recipe.ingredients
        .filter((g) => g.items.length > 0)
        .map((g) => ({ group: g.group, items: g.items.map((item) => ({ name: item.name, unit: item.unit || '', amount: item.amount ?? null })) }));
      const text = ingredientsToText(recipe.ingredients);
      const roundTripped = textToIngredients(text);
      expect(roundTripped).toEqual(normalized);
    }
  });

  it('survives a name containing " | "', () => {
    const groups = [{ group: 'Ingredients', items: [{ name: 'chicken | garlic', unit: 'piece', amount: 2 }] }];
    const roundTripped = textToIngredients(ingredientsToText(groups));
    expect(roundTripped).toEqual(groups);
  });

  it('puts items before any header into group "Ingredients"', () => {
    const parsed = textToIngredients('1 tsp | salt\n2 cup | sugar');
    expect(parsed).toEqual([{ group: 'Ingredients', items: [{ name: 'salt', unit: 'tsp', amount: 1 }, { name: 'sugar', unit: 'cup', amount: 2 }] }]);
  });

  it('drops an empty group (a header with no items)', () => {
    const parsed = textToIngredients('# Empty group\n# For the dough\n1 tsp | salt');
    expect(parsed).toEqual([{ group: 'For the dough', items: [{ name: 'salt', unit: 'tsp', amount: 1 }] }]);
  });
});

describe('steps round-trip', () => {
  const fixtures = JSON.parse(readFileSync('scripts/fixtures/recipes.snapshot.json', 'utf8')).filter((r) => !r.is_deleted && r.id !== 2);

  it('round-trips every fixture recipe', () => {
    for (const recipe of fixtures) {
      const normalized = recipe.steps.filter((g) => g.steps.length > 0);
      const roundTripped = textToSteps(stepsToText(recipe.steps));
      expect(roundTripped).toEqual(normalized);
    }
  });
});

describe('reconcileTimes', () => {
  it.each([
    [{ prep: 20, cook: 30, total: 30 }, { prep: 20, cook: 30, total: 50, adjusted: true }],
    [{ prep: 20, cook: 30, total: null }, { prep: 20, cook: 30, total: 50, adjusted: false }],
    [{ prep: 10, cook: 10, total: 60 }, { prep: 10, cook: 10, total: 60, adjusted: false }],
    [{ prep: null, cook: null, total: 40 }, { prep: null, cook: null, total: 40, adjusted: false }],
  ])('%j -> %j', (input, expected) => {
    expect(reconcileTimes(input)).toEqual(expected);
  });
});

describe('normalizeRecipeInput', () => {
  const cuisines = ['North Indian', 'South Indian', 'Other'];
  const validBase = {
    name: 'Test Recipe', cuisine: 'North Indian', description: 'A test', serves: 4,
    is_vegetarian: true, is_egg_free: true, contains_dairy: false,
    steps: [{ group: 'Method', steps: ['Do a thing'] }],
    ingredients: [{ group: 'Ingredients', items: [{ name: 'salt' }] }],
  };

  it('strips id, slug, is_deleted, created_at', () => {
    const { value } = normalizeRecipeInput({ ...validBase, id: 1, slug: 'x', is_deleted: false, created_at: 'now' }, { cuisines });
    expect(value.id).toBeUndefined();
    expect(value.slug).toBeUndefined();
    expect(value.is_deleted).toBeUndefined();
    expect(value.created_at).toBeUndefined();
  });

  it('errors when is_vegetarian is missing (strict)', () => {
    const { name, ...rest } = validBase; // eslint-disable-line no-unused-vars
    const input = { ...rest, name: 'x' };
    delete input.is_vegetarian;
    const { ok, errors } = normalizeRecipeInput(input, { cuisines, mode: 'strict' });
    expect(ok).toBe(false);
    expect(errors.is_vegetarian).toBeTruthy();
  });

  it('errors when is_vegetarian is missing (draft)', () => {
    const input = { ...validBase };
    delete input.is_vegetarian;
    const { ok, errors } = normalizeRecipeInput(input, { cuisines, mode: 'draft' });
    expect(ok).toBe(false);
    expect(errors.is_vegetarian).toBeTruthy();
  });

  it('errors when is_vegetarian is the string "true"', () => {
    const { ok, errors } = normalizeRecipeInput({ ...validBase, is_vegetarian: 'true' }, { cuisines });
    expect(ok).toBe(false);
    expect(errors.is_vegetarian).toBeTruthy();
  });

  it('errors on an unknown cuisine in strict mode', () => {
    const { ok, errors } = normalizeRecipeInput({ ...validBase, cuisine: 'Klingon' }, { cuisines, mode: 'strict' });
    expect(ok).toBe(false);
    expect(errors.cuisine).toBeTruthy();
  });

  it('falls back an unknown cuisine to Other with a warning in draft mode', () => {
    const { ok, value, warnings } = normalizeRecipeInput({ ...validBase, cuisine: 'Klingon' }, { cuisines, mode: 'draft' });
    expect(ok).toBe(true);
    expect(value.cuisine).toBe('Other');
    expect(warnings.some((w) => w.field === 'cuisine')).toBe(true);
  });

  it('rejects 61 ingredient lines in strict mode', () => {
    const items = Array.from({ length: 61 }, (_, i) => ({ name: `item ${i}` }));
    const { ok, errors } = normalizeRecipeInput({ ...validBase, ingredients: [{ group: 'Ingredients', items }] }, { cuisines, mode: 'strict' });
    expect(ok).toBe(false);
    expect(errors.ingredients).toBeTruthy();
  });

  it('truncates 61 ingredient lines with a warning in draft mode', () => {
    const items = Array.from({ length: 61 }, (_, i) => ({ name: `item ${i}` }));
    const { ok, warnings } = normalizeRecipeInput({ ...validBase, ingredients: [{ group: 'Ingredients', items }] }, { cuisines, mode: 'draft' });
    expect(ok).toBe(true);
    expect(warnings.some((w) => w.field === 'ingredients')).toBe(true);
  });
});

describe('dietaryWarnings (Appendix G.2)', () => {
  function recipeWith(ingredientName, claims) {
    return { ...claims, ingredients: [{ group: 'Ingredients', items: [{ name: ingredientName }] }] };
  }

  it.each([
    ['eggplant', { is_egg_free: true }, false],
    ['egg noodles', { is_egg_free: true }, true],
    ['eggless mayonnaise', { is_egg_free: true }, false],
    ['2 eggs', { is_egg_free: true }, true],
    ['coconut milk', { contains_dairy: false }, false],
    ['ghee', { contains_dairy: false }, true],
    ['peanut butter', { contains_dairy: false }, false],
    ['paneer', { contains_dairy: false }, true],
    ['oyster sauce', { is_vegetarian: true }, true],
    ['vegetarian oyster sauce', { is_vegetarian: true }, false],
    ['chicken stock', { is_vegetarian: true }, true],
    ['vegetable stock', { is_vegetarian: true }, false],
    ['ghee', { contains_dairy: true }, false],
  ])('%s with %j warns=%s', (ingredient, claims, shouldWarn) => {
    const warnings = dietaryWarnings(recipeWith(ingredient, claims));
    expect(warnings.length > 0).toBe(shouldWarn);
  });
});
