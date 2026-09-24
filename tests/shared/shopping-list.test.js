import { describe, expect, it } from 'vitest';
import { buildShoppingList, shoppingListText } from '../../public/js/shared/shopping-list.js';

const recipesById = {
  1: { name: 'Dal Tadka', serves: 4 },
  2: { name: 'Kanda Poha', serves: 2 },
};

function row(recipeId, id, name, category, quantity, unit, scales = true) {
  return { recipe_id: recipeId, quantity, unit, scales, ingredient: { id, display_name: name, category } };
}

const ingredientRows = [
  row(1, 10, 'Toor dal', 'pulse_legume', 1, 'cup'),
  row(1, 11, 'Red onion', 'vegetable', 1, 'piece'),
  row(1, 12, 'Garlic', 'vegetable', 3, 'clove'),
  row(1, 20, 'Turmeric', 'spice', 0.5, 'tsp'),
  row(1, 21, 'Salt', 'spice', null, 'to_taste'),
  row(1, 22, 'Ghee', 'oil_fat', 1, 'tbsp', false),
  row(2, 11, 'Red onion', 'vegetable', 1, 'piece'),
  row(2, 13, 'Flattened rice', 'grain_refined', 2, 'cup'),
  row(2, 20, 'Turmeric', 'spice', 0.25, 'tsp'),
];

const find = (list, name) => [...list.aisles.flatMap((aisle) => aisle.items), ...list.pantry].find((item) => item.name === name);

describe('buildShoppingList', () => {
  it('adds up one ingredient used by two meals', () => {
    const list = buildShoppingList({
      entries: [{ recipeId: 1, servings: 4 }, { recipeId: 2, servings: 2 }],
      recipesById,
      ingredientRows,
    });
    const onion = find(list, 'Red onion');
    expect(onion.amount).toBe('2');
    expect(onion.recipes).toEqual(['Dal Tadka', 'Kanda Poha']);
  });

  it('scales each meal by its own planned servings', () => {
    const list = buildShoppingList({ entries: [{ recipeId: 1, servings: 8 }], recipesById, ingredientRows });
    expect(find(list, 'Toor dal').amount).toBe('2 cups'); // 1 cup for 4, doubled for 8
    expect(find(list, 'Garlic').amount).toBe('6 cloves');
  });

  it('leaves rows marked "does not scale" exactly as written', () => {
    const list = buildShoppingList({ entries: [{ recipeId: 1, servings: 12 }], recipesById, ingredientRows });
    expect(find(list, 'Ghee').amount).toBe('1 tbsp');
  });

  it('gives "to taste" no quantity at all', () => {
    const list = buildShoppingList({ entries: [{ recipeId: 1, servings: 4 }], recipesById, ingredientRows });
    const salt = find(list, 'Salt');
    expect(salt.amount).toBe('');
    expect(salt.pantry).toBe(true);
  });

  it('keeps pantry staples out of the aisles you shop', () => {
    const list = buildShoppingList({ entries: [{ recipeId: 1, servings: 4 }], recipesById, ingredientRows });
    const aisleNames = list.aisles.flatMap((aisle) => aisle.items.map((item) => item.name));
    expect(aisleNames).not.toContain('Turmeric');
    expect(list.pantry.map((item) => item.name)).toEqual(['Ghee', 'Salt', 'Turmeric']);
    expect(list.totalItems).toBe(3); // dal, onion, garlic
  });

  it('sums volumes across meals and shows them in cups and spoons', () => {
    const list = buildShoppingList({
      entries: [{ recipeId: 1, servings: 4 }, { recipeId: 2, servings: 2 }],
      recipesById,
      ingredientRows,
    });
    expect(find(list, 'Turmeric').amount).toBe('¾ tsp'); // 0.5 tsp + 0.25 tsp
  });

  it('keeps different unit kinds for one ingredient on separate lines', () => {
    const list = buildShoppingList({
      entries: [{ recipeId: 1, servings: 4 }, { recipeId: 2, servings: 2 }],
      recipesById,
      ingredientRows: [row(1, 30, 'Coriander', 'herb', 1, 'bunch'), row(2, 30, 'Coriander', 'herb', 2, 'tbsp')],
    });
    const coriander = list.aisles.flatMap((aisle) => aisle.items).filter((item) => item.name === 'Coriander');
    expect(coriander.map((item) => item.amount).sort()).toEqual(['1 bunch', '2 tbsp']);
  });

  it('groups items into the aisles you walk, skipping empty ones', () => {
    const list = buildShoppingList({ entries: [{ recipeId: 1, servings: 4 }, { recipeId: 2, servings: 2 }], recipesById, ingredientRows });
    expect(list.aisles.map((aisle) => aisle.label)).toEqual(['Vegetables, herbs & fruit', 'Pulses & legumes', 'Grains & flours']);
  });

  it('is empty for a week with nothing planned', () => {
    const list = buildShoppingList({ entries: [], recipesById, ingredientRows });
    expect(list).toEqual({ aisles: [], pantry: [], totalItems: 0 });
  });

  it('survives a planned recipe whose ingredients are missing', () => {
    const list = buildShoppingList({ entries: [{ recipeId: 99, servings: 4 }], recipesById, ingredientRows });
    expect(list.totalItems).toBe(0);
  });
});

describe('shoppingListText', () => {
  it('writes the list out under its headings, ticks included', () => {
    const list = buildShoppingList({ entries: [{ recipeId: 1, servings: 4 }], recipesById, ingredientRows });
    const onionKey = find(list, 'Red onion').key;
    const text = shoppingListText(list, {
      weekLabel: 'week of 21 Sept',
      manualItems: [{ key: 'manual:1', text: 'Kitchen roll' }],
      checked: { [onionKey]: true },
    });
    expect(text.split('\n')[0]).toBe('Shopping list — week of 21 Sept');
    expect(text).toContain('- Red onion: 1 ✓');
    expect(text).toContain('Also needed\n- Kitchen roll');
    expect(text).toContain('Check you have these');
    expect(text).toContain('- Salt');
  });
});

describe('leftovers (M5)', () => {
  it('never buys twice for a meal that is eaten again', () => {
    const once = buildShoppingList({ entries: [{ recipeId: 1, servings: 4 }], recipesById, ingredientRows });
    const twice = buildShoppingList({
      entries: [{ recipeId: 1, servings: 4 }, { recipeId: 1, servings: 4, leftover: true }],
      recipesById,
      ingredientRows,
    });
    expect(find(twice, 'Toor dal').amount).toBe(find(once, 'Toor dal').amount);
    expect(twice.totalItems).toBe(once.totalItems);
  });

  it('still buys for a meal genuinely cooked twice', () => {
    const list = buildShoppingList({
      entries: [{ recipeId: 1, servings: 4 }, { recipeId: 1, servings: 4 }],
      recipesById,
      ingredientRows,
    });
    expect(find(list, 'Toor dal').amount).toBe('2 cups');
  });
});
