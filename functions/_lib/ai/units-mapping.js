import { bestCupSpoon } from '../../../public/js/shared/units.js';

const UNIT_SYNONYMS = {
  tablespoon: 'tbsp', tablespoons: 'tbsp', tbs: 'tbsp',
  teaspoon: 'tsp', teaspoons: 'tsp',
  cups: 'cup',
  pieces: 'piece', pcs: 'piece', pc: 'piece',
  cloves: 'clove',
  inches: 'inch',
  sprigs: 'sprig',
  handfuls: 'handful',
  bunches: 'bunch',
};

const RUNTIME_VALID_UNITS = new Set(['cup', 'tbsp', 'tsp', 'pinch', 'piece', 'clove', 'to_taste', 'inch', 'sprig', 'handful', 'bunch']);

/**
 * The model is instructed to output only cup/tbsp/tsp/etc (D.2), but v2's normalisation step
 * still maps synonyms and converts any stray ml/g the model produces anyway.
 * @returns {{ quantity: number|null, unit: string, warning: string|null }}
 */
export function resolveDraftUnit(quantity, rawUnit) {
  const synonym = String(rawUnit || '').trim().toLowerCase();
  const unit = UNIT_SYNONYMS[synonym] || synonym;

  if (unit === 'ml' || unit === 'l') {
    if (quantity === null || quantity === undefined) return { quantity: null, unit: 'to_taste', warning: null };
    const ml = unit === 'l' ? quantity * 1000 : quantity;
    const converted = bestCupSpoon(ml);
    return { quantity: converted.quantity, unit: converted.unit, warning: null };
  }

  if (unit === 'g' || unit === 'kg') {
    // Grams can't become cups without ingredient-specific densities — keep as-is and warn.
    return { quantity, unit, warning: 'non_cup_unit' };
  }

  if (!RUNTIME_VALID_UNITS.has(unit)) {
    return { quantity: null, unit: 'to_taste', warning: 'unknown_unit' };
  }

  return { quantity, unit, warning: null };
}
