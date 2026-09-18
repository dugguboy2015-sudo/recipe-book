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

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Which preset a household's diet matches, or null if it has been customised beyond them. */
export function dietPresetKey(settings) {
  const diet = settings?.diet || {};
  return DIET_PRESET_KEYS.find((key) => {
    const preset = DIET_PRESETS[key].diet;
    return preset.vegetarian === Boolean(diet.vegetarian) && preset.egg_free === Boolean(diet.egg_free);
  }) || null;
}

/**
 * The adjective for this household's food ("vegetarian", or "" for a household that eats
 * everything), for copy such as "a flavourful vegetarian dinner". Egg-free isn't added: "an
 * egg-free vegetarian dinner" reads badly, and the catalogue filter already enforces it.
 */
export function dietAdjective(settings) {
  return settings?.diet?.vegetarian ? 'vegetarian' : '';
}

/** "vegetarian and egg-free" / "vegetarian" / "" — how the household's rules read in a sentence. */
export function dietPhrase(settings) {
  const diet = settings?.diet || {};
  if (diet.vegetarian && diet.egg_free) return 'vegetarian and egg-free';
  if (diet.vegetarian) return 'vegetarian';
  if (diet.egg_free) return 'egg-free';
  return '';
}

/** Which catalogue recipes this household should be shown: its diet as recipe-column filters. */
export function dietRecipeFilter(settings) {
  const diet = settings?.diet || {};
  return { vegetarian: Boolean(diet.vegetarian), eggFree: Boolean(diet.egg_free) };
}

/** True when a recipe fits this household's diet (used where rows are filtered in memory). */
export function recipeFitsDiet(settings, recipe) {
  const filter = dietRecipeFilter(settings);
  if (filter.vegetarian && recipe.is_vegetarian === false) return false;
  if (filter.eggFree && recipe.is_egg_free === false) return false;
  return true;
}

function cleanList(values, { max, maxLength, allowed } = {}) {
  if (!Array.isArray(values)) return null;
  const out = [];
  for (const value of values) {
    const text = String(value ?? '').trim().replace(/\s+/g, ' ');
    if (!text || text.length > maxLength || out.includes(text)) continue;
    if (allowed && !allowed.includes(text)) return null;
    out.push(text);
  }
  return out.length > max ? null : out;
}

/**
 * Validates the household settings editor's payload (M1d) and merges it over the current
 * settings. Only the family-specific fields are editable; health goals, measurements and country
 * stay as the template set them. `cuisines` is the list of known cuisine names.
 * @returns {{ ok: boolean, value?: object, errors: Record<string, string> }}
 */
export function applySettingsUpdate(current, body, { cuisines = [] } = {}) {
  const errors = {};
  const next = structuredClone(current || {});

  if (body?.diet !== undefined) {
    if (!DIET_PRESETS[body.diet]) errors.diet = 'Choose how your household eats.';
    else next.diet = structuredClone(DIET_PRESETS[body.diet].diet);
  }
  if (body?.defaultServings !== undefined) {
    const servings = Number(body.defaultServings);
    if (!Number.isInteger(servings) || servings < 1 || servings > 12) errors.defaultServings = 'Servings must be a whole number from 1 to 12.';
    else next.default_servings = servings;
  }
  if (body?.spiceLevel !== undefined) {
    const level = Number(body.spiceLevel);
    if (!Number.isInteger(level) || level < 1 || level > 5) errors.spiceLevel = 'Spice level must be from 1 to 5.';
    else next.spice = { ...(next.spice || {}), default_level: level, preference: level >= 4 ? 'hot' : level <= 2 ? 'mild' : 'medium' };
  }
  for (const [field, key] of [['favouriteCuisines', 'favourite_cuisines'], ['exploringCuisines', 'exploring_cuisines']]) {
    if (body?.[field] === undefined) continue;
    const list = cleanList(body[field], { max: 12, maxLength: 40, allowed: cuisines.length ? cuisines : undefined });
    if (!list) errors[field] = 'Pick from the listed cuisines (up to 12).';
    else next[key] = list;
  }
  if (body?.packedLunch !== undefined) {
    const lunch = body.packedLunch || {};
    const days = cleanList(lunch.days || [], { max: 7, maxLength: 10, allowed: WEEKDAYS });
    const who = String(lunch.for ?? '').trim().replace(/\s+/g, ' ');
    if (!days) errors.packedLunch = 'Choose packed-lunch days from Monday to Sunday.';
    else if (who.length > 60) errors.packedLunch = 'Keep "who it\'s for" under 60 characters.';
    else {
      const ordered = WEEKDAYS.filter((day) => days.includes(day));
      next.packed_lunch = { ...(next.packed_lunch || {}), for: ordered.length ? (who || 'someone at school') : null, days: ordered };
      if (!Array.isArray(next.packed_lunch.requirements)) next.packed_lunch.requirements = [];
    }
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value: next, errors };
}
