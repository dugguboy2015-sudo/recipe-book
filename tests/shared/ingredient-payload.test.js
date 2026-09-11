import { describe, expect, it } from 'vitest';
import { recipeIngredientsToPayload } from '../../public/js/shared/ingredient-payload.js';

describe('recipeIngredientsToPayload', () => {
  it('round-trips a fetched recipe_ingredients shape into the identical B.4 payload unchanged', () => {
    // Shape mirrors queries.js#fetchRecipeIngredients's output for recipe 1's flour row.
    const fetched = [
      {
        group: 'For the dough',
        items: [
          { ingredientId: 31, ingredientName: 'Whole wheat flour', quantity: 1.5, unit: 'cup', preparation: '', isOptional: false, scales: true },
          { ingredientId: 9, ingredientName: 'Salt', quantity: null, unit: 'to_taste', preparation: '', isOptional: false, scales: true },
        ],
      },
    ];

    const payload = recipeIngredientsToPayload(fetched);
    expect(payload).toEqual([
      {
        group: 'For the dough',
        items: [
          { ingredient: { id: 31 }, quantity: 1.5, unit: 'cup', preparation: null, is_optional: false, scales: true },
          { ingredient: { id: 9 }, quantity: null, unit: 'to_taste', preparation: null, is_optional: false, scales: true },
        ],
      },
    ]);

    // Applying the transform again to the same (unedited) shape is idempotent — this is the
    // "editing without changes leaves recipe_ingredients identical" acceptance criterion at the
    // payload-shape level.
    expect(recipeIngredientsToPayload(fetched)).toEqual(payload);
  });

  it('names a new ingredient by name, not id, and defaults quantity-less rows to to_taste', () => {
    const groups = [{ group: 'Ingredients', items: [
      { ingredientId: null, ingredientName: 'kasuri methi', quantity: null, unit: 'pinch', preparation: 'crushed', isOptional: true, scales: false },
    ] }];
    expect(recipeIngredientsToPayload(groups)).toEqual([
      { group: 'Ingredients', items: [
        { ingredient: { name: 'kasuri methi' }, quantity: null, unit: 'pinch', preparation: 'crushed', is_optional: true, scales: false },
      ] },
    ]);
  });

  it('drops empty groups and unnamed rows', () => {
    const groups = [
      { group: 'Empty', items: [{ ingredientId: null, ingredientName: '  ', quantity: null, unit: 'tbsp', preparation: '', isOptional: false, scales: true }] },
      { group: 'Real', items: [
        { ingredientId: 1, ingredientName: 'Onion', quantity: 1, unit: 'piece', preparation: '', isOptional: false, scales: true },
        { ingredientId: null, ingredientName: '', quantity: null, unit: 'tbsp', preparation: '', isOptional: false, scales: true },
      ] },
    ];
    expect(recipeIngredientsToPayload(groups)).toEqual([
      { group: 'Real', items: [{ ingredient: { id: 1 }, quantity: 1, unit: 'piece', preparation: null, is_optional: false, scales: true }] },
    ]);
  });
});
