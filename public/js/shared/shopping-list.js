// M2: turning a week's plan into a shopping list. Pure — no DOM, no network — so the aggregation
// and unit maths can be tested directly (pages/shopping.js does the fetching and rendering).
//
// Two owner decisions shape this (plan.md): quantities that are "to taste" are never given a
// number, and pantry staples (spices, oil, salt, sweeteners, condiments) are separated into a
// "Check you have these" section rather than padding the list you take to the shop.

import { VOLUME_ML, bestCupSpoon, formatQuantity } from './units.js';

const COUNT_UNITS = new Set(['piece', 'clove', 'inch', 'sprig', 'handful', 'bunch']);
const WEIGHT_G = { g: 1, kg: 1000 };

/** Aisles, in the order you walk a shop, built from the ingredient categories. */
export const AISLES = [
  { id: 'produce', label: 'Vegetables, herbs & fruit', categories: ['vegetable', 'herb', 'fruit'] },
  { id: 'pulses', label: 'Pulses & legumes', categories: ['pulse_legume'] },
  { id: 'grains', label: 'Grains & flours', categories: ['grain_whole', 'grain_refined'] },
  { id: 'protein', label: 'Paneer, tofu & plant protein', categories: ['plant_protein'] },
  { id: 'dairy', label: 'Dairy & eggs', categories: ['dairy', 'egg'] },
  { id: 'nuts', label: 'Nuts & seeds', categories: ['nut_seed'] },
  { id: 'meat', label: 'Meat & fish', categories: ['meat', 'fish', 'seafood', 'poultry'] },
  { id: 'other', label: 'Everything else', categories: ['other'] },
];

/** Staples most kitchens already have — checked, not bought, so they sit in their own section. */
export const PANTRY_CATEGORIES = ['spice', 'oil_fat', 'sweetener', 'condiment'];

function aisleFor(category) {
  return AISLES.find((aisle) => aisle.categories.includes(category)) || AISLES[AISLES.length - 1];
}

function unitKind(unit) {
  if (unit && unit in VOLUME_ML) return 'volume';
  if (COUNT_UNITS.has(unit)) return 'count';
  if (unit && unit in WEIGHT_G) return 'weight';
  return 'other';
}

/**
 * How much of one line to buy for one planned meal. A row marked `scales: false` (a pinch of
 * asafoetida, oil for frying) stays as written however many people are eating.
 */
function factorFor(entryServings, recipeServes, scales) {
  if (scales === false) return 1;
  const serves = Number(recipeServes) || 4;
  const wanted = Number(entryServings) || serves;
  return wanted / serves;
}

function formatLine(kind, unit, total) {
  if (kind === 'volume') return formatQuantity(bestCupSpoon(total));
  if (kind === 'weight') return total >= 1000 ? `${Number((total / 1000).toFixed(2))} kg` : `${Math.round(total)} g`;
  return formatQuantity({ quantity: Number(total.toFixed(2)), unit });
}

/**
 * Builds the list for one week.
 *
 * @param {{
 *   entries: Array<{ recipeId: number, servings: number }>,
 *   recipesById: Record<number, { name: string, serves: number }>,
 *   ingredientRows: Array<{ recipe_id: number, quantity: number|null, unit: string|null, scales: boolean,
 *     ingredient: { id: number, display_name: string, category: string } }>,
 * }} input
 * @returns {{ aisles: Array<{id: string, label: string, items: Array}>, pantry: Array, totalItems: number }}
 */
export function buildShoppingList({ entries = [], recipesById = {}, ingredientRows = [] }) {
  const rowsByRecipe = new Map();
  for (const row of ingredientRows) {
    if (!row?.ingredient) continue;
    if (!rowsByRecipe.has(row.recipe_id)) rowsByRecipe.set(row.recipe_id, []);
    rowsByRecipe.get(row.recipe_id).push(row);
  }

  const items = new Map(); // key -> item

  for (const entry of entries) {
    const recipe = recipesById[entry.recipeId];
    const rows = rowsByRecipe.get(entry.recipeId) || [];
    for (const row of rows) {
      const ingredient = row.ingredient;
      const isPantry = PANTRY_CATEGORIES.includes(ingredient.category);
      // "To taste" and anything without a number can't be summed — it becomes a reminder, not an amount.
      const unmeasured = row.unit === 'to_taste' || row.quantity === null || row.quantity === undefined;
      const kind = unmeasured ? 'none' : unitKind(row.unit);
      const key = `${ingredient.id}:${kind}:${kind === 'count' || kind === 'other' ? row.unit : ''}`;

      let item = items.get(key);
      if (!item) {
        item = {
          key,
          ingredientId: ingredient.id,
          name: ingredient.display_name,
          category: ingredient.category,
          pantry: isPantry,
          kind,
          unit: row.unit,
          total: 0,
          recipes: [],
        };
        items.set(key, item);
      }
      if (!unmeasured) {
        const scaled = row.quantity * factorFor(entry.servings, recipe?.serves, row.scales);
        if (kind === 'volume') item.total += scaled * VOLUME_ML[row.unit];
        else if (kind === 'weight') item.total += scaled * WEIGHT_G[row.unit];
        else item.total += scaled;
      }
      const recipeName = recipe?.name;
      if (recipeName && !item.recipes.includes(recipeName)) item.recipes.push(recipeName);
    }
  }

  const finished = [...items.values()].map((item) => ({
    ...item,
    amount: item.kind === 'none' ? '' : formatLine(item.kind, item.unit, item.total),
  }));

  const byName = (a, b) => a.name.localeCompare(b.name);
  const pantry = finished.filter((item) => item.pantry).sort(byName);
  const toBuy = finished.filter((item) => !item.pantry);

  const aisles = AISLES
    .map((aisle) => ({ id: aisle.id, label: aisle.label, items: toBuy.filter((item) => aisleFor(item.category).id === aisle.id).sort(byName) }))
    .filter((aisle) => aisle.items.length > 0);

  return { aisles, pantry, totalItems: toBuy.length };
}

/** The list as plain text, for Copy and Share. */
export function shoppingListText({ aisles, pantry }, { weekLabel, manualItems = [], checked = {} } = {}) {
  const lines = [`Shopping list — ${weekLabel}`];
  const line = (item) => `- ${item.name}${item.amount ? `: ${item.amount}` : ''}${checked[item.key] ? ' ✓' : ''}`;
  for (const aisle of aisles) {
    lines.push('', aisle.label);
    for (const item of aisle.items) lines.push(line(item));
  }
  if (manualItems.length > 0) {
    lines.push('', 'Also needed');
    for (const item of manualItems) lines.push(`- ${item.text}${checked[item.key] ? ' ✓' : ''}`);
  }
  if (pantry.length > 0) {
    lines.push('', 'Check you have these');
    for (const item of pantry) lines.push(line(item));
  }
  return lines.join('\n');
}
