// Per-household settings: the same shape as config/household.json. Migration 015 stores one row per
// household; M1d moves every consumer onto them. Shared by the Functions and the browser, the same
// way recipe-rules.js is, so both sides agree on what a valid household looks like.

const NON_VEGETARIAN = ['meat', 'poultry', 'fish', 'seafood', 'gelatine', 'fish sauce', 'oyster sauce', 'animal rennet'];

/** The starting diets offered when a household is created. M1d's settings editor refines these. */
export const DIET_PRESETS = {
  vegetarian_egg_free: {
    label: 'Vegetarian, no egg',
    diet: { vegetarian: true, egg_free: true, dairy_ok: true, never: [...NON_VEGETARIAN, 'egg'] },
  },
  vegetarian: {
    label: 'Vegetarian (eats egg)',
    diet: { vegetarian: true, egg_free: false, dairy_ok: true, never: [...NON_VEGETARIAN] },
  },
  omnivore: {
    label: 'Eats meat and fish',
    diet: { vegetarian: false, egg_free: false, dairy_ok: true, never: [] },
  },
};

export const DIET_PRESET_KEYS = Object.keys(DIET_PRESETS);

/**
 * Starting settings for a new, non-founding household. App-wide rules — health goals, measurement
 * style, country — come from the template. Everything specific to one family is reset, because a
 * stranger's household must not inherit this family's cuisines, spice level or school lunches.
 */
export function buildNewHouseholdSettings(template, dietKey) {
  const preset = DIET_PRESETS[dietKey];
  if (!preset) throw new Error(`Unknown diet: ${dietKey}`);
  const base = structuredClone(template);
  return {
    ...base,
    diet: structuredClone(preset.diet),
    default_servings: 4,
    favourite_cuisines: [],
    exploring_cuisines: [],
    spice: { ...base.spice, preference: 'medium', default_level: 3 },
    packed_lunch: { for: null, days: [], requirements: [] },
  };
}
