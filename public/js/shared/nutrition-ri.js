// Appendix J.5: % of UK adult Reference Intake per serving, and front-of-pack traffic lights.
// Pure, DOM-free.

export const REFERENCE_INTAKES = {
  calories_kcal: 2000, fat_g: 70, saturates_g: 20, sugars_g: 90, salt_g: 6,
  protein_g: 50, carbs_g: 260, fibre_g: 30,
};

const TRAFFIC_LIGHT_FIELDS = new Set(['fat_g', 'saturates_g', 'sugars_g', 'salt_g']);

/** @returns {number|null} the field's value as a % of its adult RI, or null if either is unknown. */
export function percentRI(field, value) {
  const ri = REFERENCE_INTAKES[field];
  if (!ri || value === null || value === undefined) return null;
  return (value / ri) * 100;
}

/** green < 10% RI, amber 10-30%, red > 30% — only for fat, saturates, sugars and salt (J.5). */
export function trafficLightClass(field, percent) {
  if (!TRAFFIC_LIGHT_FIELDS.has(field) || percent === null || percent === undefined) return null;
  if (percent < 10) return 'green';
  if (percent <= 30) return 'amber';
  return 'red';
}

/** Rounds to the nearest 5, clamped to [0, 100] — for the CSP-safe `.w-pct-N` width classes. */
export function nearestWidthClass(percent) {
  const clamped = Math.max(0, Math.min(100, percent ?? 0));
  return `w-pct-${Math.round(clamped / 5) * 5}`;
}
