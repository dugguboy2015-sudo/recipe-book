import { readFileSync } from 'node:fs';
import { ING } from './data/ingredient-dictionary.mjs';
import { SKIP_RECIPES, RECONSTRUCTED_GROUPS } from './data/ingredient-overrides.mjs';

const UNIT_CODES = new Set(['cup', 'tbsp', 'tsp', 'pinch', 'piece', 'clove', 'inch', 'sprig', 'handful', 'bunch', 'to_taste', 'ml', 'l', 'g', 'kg']);
const CATEGORIES = new Set(['grain_whole', 'grain_refined', 'pulse_legume', 'dairy', 'plant_protein', 'vegetable', 'fruit', 'nut_seed', 'spice', 'herb', 'oil_fat', 'sweetener', 'condiment', 'other']);

const backfill = JSON.parse(readFileSync('migrations/data/ingredients_backfill.json', 'utf8'));
const snapshot = JSON.parse(readFileSync('scripts/fixtures/recipes.snapshot.json', 'utf8')).filter((r) => !r.is_deleted);

let errors = 0;
function fail(msg) {
  console.error('FAIL: ' + msg);
  errors += 1;
}

// 1. Coverage: every snapshot line for a non-skipped recipe is covered exactly once.
// (headers consume a raw line but produce no backfill row, so we count expected rows
//  as raw lines minus header overrides, per recipe.)
import { OVERRIDES } from './data/ingredient-overrides.mjs';
for (const recipe of snapshot) {
  if (SKIP_RECIPES.includes(recipe.id)) continue;
  let ingredients = recipe.ingredients;
  if (RECONSTRUCTED_GROUPS[recipe.id]) {
    const { mode, groups } = RECONSTRUCTED_GROUPS[recipe.id];
    ingredients = mode === 'replace' ? groups : [...groups, ...recipe.ingredients];
  }
  const rawCount = ingredients.reduce((n, g) => n + g.items.length, 0);
  const headerCount = Object.values(OVERRIDES[recipe.id] || {}).filter((o) => o.header).length;
  const expected = rawCount - headerCount;
  const actual = backfill.filter((r) => r.recipe_id === recipe.id).length;
  if (actual !== expected) {
    fail(`recipe ${recipe.id}: expected ${expected} recipe_ingredients rows (${rawCount} raw lines - ${headerCount} headers), got ${actual}`);
  }
}
if (backfill.some((r) => SKIP_RECIPES.includes(r.recipe_id))) fail('a skipped recipe produced backfill rows');

// 2 & 3. unit and category validity
for (const row of backfill) {
  if (row.unit != null && !UNIT_CODES.has(row.unit)) fail(`recipe ${row.recipe_id} pos ${row.group_position}/${row.position}: invalid unit "${row.unit}"`);
  if (!CATEGORIES.has(row.category)) fail(`recipe ${row.recipe_id} pos ${row.group_position}/${row.position}: invalid category "${row.category}"`);
  if (row.quantity == null && row.unit === null) fail(`recipe ${row.recipe_id} pos ${row.group_position}/${row.position}: quantity null but unit also null`);
}

// 4. no canonical name also appears as an alias of a different ingredient
const names = new Set(Object.keys(ING));
for (const [key, def] of Object.entries(ING)) {
  for (const alias of def.aliases) {
    if (names.has(alias) && alias !== key) fail(`alias "${alias}" of "${key}" is also a canonical ingredient name`);
    for (const [otherKey, otherDef] of Object.entries(ING)) {
      if (otherKey !== key && otherDef.aliases.includes(alias)) fail(`alias "${alias}" is claimed by both "${key}" and "${otherKey}"`);
    }
  }
}

// 5. derived dietary flags vs stored booleans, per recipe
const mismatches = [];
for (const recipe of snapshot) {
  if (SKIP_RECIPES.includes(recipe.id)) continue;
  const rows = backfill.filter((r) => r.recipe_id === recipe.id);
  const derivedVegetarian = !rows.some((r) => r.flags.contains_meat);
  const derivedEggFree = !rows.some((r) => r.flags.contains_egg);
  const derivedDairy = rows.some((r) => r.flags.contains_dairy);
  if (derivedVegetarian !== recipe.is_vegetarian) mismatches.push(`recipe ${recipe.id} (${recipe.name}): is_vegetarian stored=${recipe.is_vegetarian} derived=${derivedVegetarian}`);
  if (derivedEggFree !== recipe.is_egg_free) mismatches.push(`recipe ${recipe.id} (${recipe.name}): is_egg_free stored=${recipe.is_egg_free} derived=${derivedEggFree}`);
  if (derivedDairy !== recipe.contains_dairy) mismatches.push(`recipe ${recipe.id} (${recipe.name}): contains_dairy stored=${recipe.contains_dairy} derived=${derivedDairy}`);
}

console.log(`Checked ${backfill.length} rows across ${snapshot.length - SKIP_RECIPES.length} recipes.`);
if (mismatches.length > 0) {
  console.log(`\n${mismatches.length} dietary derivation mismatch(es) (see docs/progress.md for the decision on each):`);
  for (const m of mismatches) console.log('  ' + m);
}

if (errors > 0) {
  console.error(`\n${errors} structural error(s).`);
  process.exit(1);
}
console.log('\nvalidate-backfill: structural checks passed.');
