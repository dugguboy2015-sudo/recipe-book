import { writeFileSync, readFileSync } from 'node:fs';
import { ING, flags } from './data/ingredient-dictionary.mjs';
import { OVERRIDES, SKIP_RECIPES, RECONSTRUCTED_GROUPS } from './data/ingredient-overrides.mjs';

const snapshot = JSON.parse(readFileSync('scripts/fixtures/recipes.snapshot.json', 'utf8'))
  .filter((r) => !r.is_deleted);

// A few recipes lost part or all of their stored ingredients to the known edit-flattening bug
// (BUG-5/BUG-10) before this project started. Where the method text still describes them in full,
// the groups are reconstructed here (flagged in docs/progress.md) instead of leaving them empty.
for (const recipe of snapshot) {
  if (RECONSTRUCTED_GROUPS[recipe.id]) {
    const { mode, groups } = RECONSTRUCTED_GROUPS[recipe.id];
    recipe.ingredients = mode === 'replace' ? groups : [...groups, ...recipe.ingredients];
  }
}

// name -> canonical key, longest alias/name first so e.g. "kashmiri red chilli powder"
// matches before the shorter "red chilli powder".
const LOOKUP = [];
for (const [key, def] of Object.entries(ING)) {
  for (const term of [key, ...def.aliases]) LOOKUP.push({ term, key });
}
LOOKUP.sort((a, b) => b.term.length - a.term.length);

function termRegex(term) {
  return new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(es|s)?\\b`, 'i');
}

function autoMatch(name) {
  const matches = LOOKUP.filter(({ term }) => termRegex(term).test(name));
  if (matches.length === 0) return { key: null, ambiguous: false };
  const top = matches[0]; // longest term wins by construction of LOOKUP
  const topTermLower = top.term.toLowerCase();
  // A shorter match nested inside the chosen term/alias (e.g. "peas" inside the alias
  // "split pigeon peas", or "pepper" inside "black pepper powder") isn't a real conflict.
  const realConflict = matches.some((m) => m.key !== top.key && !topTermLower.includes(m.term.toLowerCase()));
  return { key: top.key, ambiguous: realConflict };
}

function deriveScales(unit) {
  return unit !== 'pinch' && unit !== 'to_taste';
}

function convertVolume(unit, amount) {
  if (unit === 'tbsp' && amount % 4 === 0 && amount >= 4) {
    return { quantity: (amount / 4) * 0.25, unit: 'cup' };
  }
  return { quantity: amount, unit };
}

const AUTO_UNITS = new Set(['tbsp', 'tsp', 'cup']);

// group_name has a 60-char check constraint (Appendix A.12). Source group names are almost always
// well under that, but a couple carry a long parenthetical aside — strip it before hard-truncating.
function fitGroupName(name) {
  if (name.length <= 60) return name;
  const withoutParen = name.replace(/\s*\([^)]*\)\s*$/, '').trim();
  if (withoutParen.length > 0 && withoutParen.length <= 60) return withoutParen;
  return withoutParen.slice(0, 60) || name.slice(0, 60);
}

function stripMatchedText(name, key) {
  const def = ING[key];
  let text = name;
  // Strip every alias/name occurrence, not just the first — source text sometimes repeats the
  // ingredient as both its canonical name and a parenthetical alias, e.g. "whole wheat flour (atta)".
  for (const term of [key, ...def.aliases].sort((a, b) => b.length - a.length)) {
    text = text.replace(termRegex(term), '');
  }
  text = text
    .replace(/\(\s*\)/g, '')           // now-empty parens left behind
    .replace(/\(\s*,/g, '(')            // "(, foo" -> "(foo"
    .replace(/,\s*\)/g, ')')            // "foo, )" -> "foo)"
    .replace(/\s+,/g, ',')              // "fresh , chopped" -> "fresh, chopped"
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/^[,\s]+|[,\s]+$/g, '');
  // Balance a leftover unmatched paren from a wrapper that had no closing/opening partner.
  if ((text.match(/\(/g) || []).length !== (text.match(/\)/g) || []).length) {
    text = text.replace(/[()]/g, '');
  }
  text = text.replace(/^[,\s]+|[,\s]+$/g, '').trim();
  return text || null;
}

const backfill = [];
const nutritionNeeded = [];
const problems = [];

for (const recipe of snapshot) {
  if (SKIP_RECIPES.includes(recipe.id)) continue;
  const overridesForRecipe = OVERRIDES[recipe.id] || {};
  let groupPosition = 0;
  let flatIndex = 0;

  for (const group of recipe.ingredients) {
    groupPosition += 1;
    let effectiveGroupName = fitGroupName(group.group);
    let position = 0;

    for (const item of group.items) {
      const override = overridesForRecipe[flatIndex];
      flatIndex += 1;

      if (override && override.header) {
        effectiveGroupName = fitGroupName(override.header);
        continue;
      }

      let key = override?.ing;
      if (!key) {
        const m = autoMatch(item.name);
        key = m.key;
        if (key && m.ambiguous && !override) {
          problems.push(`AMBIGUOUS recipe ${recipe.id} item ${flatIndex - 1}: multiple ingredients match "${item.name}" (picked "${key}") — add an explicit override`);
          continue;
        }
      }
      if (!key) {
        problems.push(`recipe ${recipe.id} item ${flatIndex - 1}: no ingredient match for "${item.name}"`);
        continue;
      }
      if (!ING[key]) {
        problems.push(`recipe ${recipe.id} item ${flatIndex - 1}: unknown override key "${key}"`);
        continue;
      }

      let quantity;
      let unit;
      if (override && 'qty' in override) {
        quantity = override.qty;
        unit = override.unit;
      } else if (item.amount != null && AUTO_UNITS.has(item.unit)) {
        const conv = convertVolume(item.unit, item.amount);
        quantity = conv.quantity;
        unit = conv.unit;
      } else if (item.amount == null) {
        quantity = null;
        unit = 'to_taste';
      } else {
        problems.push(`recipe ${recipe.id} item ${flatIndex - 1}: no override for non-volume unit "${item.unit}" (name "${item.name}")`);
        continue;
      }

      const preparation = override?.prep !== undefined ? override.prep : stripMatchedText(item.name, key);
      const isOptional = override?.optional ?? /optional/i.test(item.name);
      const scales = override?.scales ?? deriveScales(unit);

      position += 1;
      backfill.push({
        recipe_id: recipe.id,
        group_name: effectiveGroupName,
        group_position: groupPosition,
        position,
        original_text: `${item.name} | ${item.amount ?? ''} ${item.unit ?? ''}`.trim(),
        ingredient: key,
        aliases: ING[key].aliases,
        category: ING[key].category,
        flags: flags(key),
        quantity,
        unit,
        preparation: preparation && preparation.length <= 120 ? preparation : (preparation ? preparation.slice(0, 120) : null),
        is_optional: isOptional,
        scales,
      });
    }
  }
  nutritionNeeded.push(recipe.id);
}

if (problems.length > 0) {
  console.error(`${problems.length} unresolved line(s):`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}

writeFileSync('migrations/data/ingredients_backfill.json', JSON.stringify(backfill, null, 2));
console.log(`Wrote ${backfill.length} recipe_ingredients rows for ${nutritionNeeded.length} recipes to migrations/data/ingredients_backfill.json`);
