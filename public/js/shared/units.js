// Cups, spoons & scaling (Appendix C.2). Pure functions, no DOM.

export const VOLUME_ML = { cup: 240, tbsp: 15, tsp: 5, pinch: 0.3, ml: 1, l: 1000 };

const COUNT_UNITS = new Set(['piece', 'clove', 'inch', 'sprig', 'handful', 'bunch']);
const UNIT_NAMES = {
  cup: ['cup', 'cups'], tbsp: ['tbsp', 'tbsp'], tsp: ['tsp', 'tsp'],
  piece: ['', ''], clove: ['clove', 'cloves'], inch: ['inch', 'inches'],
  sprig: ['sprig', 'sprigs'], handful: ['handful', 'handfuls'], bunch: ['bunch', 'bunches'],
};

const FRACTION_GLYPHS = [
  [0, ''], [1 / 4, '¼'], [1 / 3, '⅓'], [1 / 2, '½'], [2 / 3, '⅔'], [3 / 4, '¾'],
];

export function scaleQuantity(quantity, fromServes, toServes, scales = true) {
  if (quantity === null || quantity === undefined) return null;
  if (!scales) return quantity;
  return (quantity * toServes) / fromServes;
}

function cupCandidates(trueCups) {
  const candidates = [];
  const baseWhole = Math.max(0, Math.floor(trueCups) - 1);
  for (let whole = baseWhole; whole <= baseWhole + 2; whole += 1) {
    for (const [frac] of FRACTION_GLYPHS) candidates.push(whole + frac);
  }
  return candidates;
}

function stepCandidates(trueValue, step) {
  const candidates = [];
  const baseSteps = Math.max(0, Math.floor(trueValue / step) - 1);
  for (let i = baseSteps; i <= baseSteps + 3; i += 1) candidates.push(i * step);
  return candidates;
}

function nearestWithinTolerance(trueValue, candidates, tolerance = 0.10) {
  let best = null;
  let bestDiff = Infinity;
  for (const candidate of candidates) {
    if (candidate <= 0) continue;
    const diff = Math.abs(candidate - trueValue);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = candidate;
    }
  }
  if (best === null) return null;
  return bestDiff <= tolerance * trueValue + 1e-9 ? best : null;
}

/** ml -> { quantity, unit }, the first representation (cup, then tbsp, then tsp) within 10%. */
export function bestCupSpoon(ml) {
  if (ml < 1.25) return { quantity: null, unit: 'pinch' };

  if (ml >= 60) {
    const trueCups = ml / VOLUME_ML.cup;
    const cups = nearestWithinTolerance(trueCups, cupCandidates(trueCups));
    if (cups !== null) return { quantity: cups, unit: 'cup' };
  }

  if (ml >= 15) {
    const trueTbsp = ml / VOLUME_ML.tbsp;
    const tbsp = nearestWithinTolerance(trueTbsp, stepCandidates(trueTbsp, 0.5));
    if (tbsp !== null) return { quantity: tbsp, unit: 'tbsp' };
  }

  const trueTsp = ml / VOLUME_ML.tsp;
  const tsp = nearestWithinTolerance(trueTsp, stepCandidates(trueTsp, 0.25));
  if (tsp !== null) return { quantity: tsp, unit: 'tsp' };

  // Fallback: something (very large or an odd fraction) matched nothing within tolerance —
  // round to the nearest quarter-teaspoon rather than fail outright.
  return { quantity: Math.round(trueTsp * 4) / 4, unit: 'tsp' };
}

/**
 * @param {number|null} quantity
 * @param {string} unit
 * @returns {{ quantity: number|null, unit: string }}
 */
export function displayQuantity(quantity, unit) {
  if (unit === 'pinch' || unit === 'to_taste') return { quantity: null, unit };
  if (quantity === null || quantity === undefined) return { quantity: null, unit };
  if (unit in VOLUME_ML) return bestCupSpoon(quantity * VOLUME_ML[unit]);
  if (COUNT_UNITS.has(unit)) return { quantity, unit };
  // legacy data (g/kg/ml/l as stored, or anything else): pass through unchanged
  return { quantity, unit };
}

function formatFraction(value) {
  const whole = Math.floor(value);
  const frac = value - whole;
  let glyph = '';
  let closestDiff = Infinity;
  for (const [f, g] of FRACTION_GLYPHS) {
    const diff = Math.abs(frac - f);
    if (diff < closestDiff) {
      closestDiff = diff;
      glyph = g;
    }
  }
  if (whole === 0 && glyph) return glyph;
  return whole + glyph;
}

export function formatQuantity({ quantity, unit }) {
  if (unit === 'to_taste') return 'to taste';
  if (unit === 'pinch') return 'a pinch';
  if (quantity === null || quantity === undefined) return '';

  const formattedNumber = formatFraction(quantity);

  if (unit === 'piece') return formattedNumber;

  const names = UNIT_NAMES[unit];
  if (!names) return `${formattedNumber} ${unit}`;
  const [singular, plural] = names;
  // "¾ cup" stays singular; only more-than-one takes the plural ("2¼ cups", "3 cloves").
  const name = quantity > 1 + 1e-9 ? plural : singular;
  return name ? `${formattedNumber} ${name}` : formattedNumber;
}
