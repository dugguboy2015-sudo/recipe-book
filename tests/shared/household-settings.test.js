import { describe, expect, it } from 'vitest';
import template from '../../config/household.json';
import { DIET_PRESETS, DIET_PRESET_KEYS, buildNewHouseholdSettings } from '../../public/js/shared/household-settings.js';

describe('DIET_PRESETS', () => {
  it('offers three starting diets with a label each', () => {
    expect(DIET_PRESET_KEYS).toEqual(['vegetarian_egg_free', 'vegetarian', 'omnivore']);
    for (const key of DIET_PRESET_KEYS) expect(DIET_PRESETS[key].label).toBeTruthy();
  });

  it('matches the founding household\'s own "never" list exactly for vegetarian, no egg', () => {
    expect([...DIET_PRESETS.vegetarian_egg_free.diet.never].sort()).toEqual([...template.diet.never].sort());
  });

  it('keeps egg allowed only where the diet says so', () => {
    expect(DIET_PRESETS.vegetarian.diet.never).not.toContain('egg');
    expect(DIET_PRESETS.vegetarian_egg_free.diet.never).toContain('egg');
    expect(DIET_PRESETS.omnivore.diet.never).toEqual([]);
  });
});

describe('buildNewHouseholdSettings', () => {
  it('applies the chosen diet', () => {
    const settings = buildNewHouseholdSettings(template, 'omnivore');
    expect(settings.diet.vegetarian).toBe(false);
    expect(settings.diet.egg_free).toBe(false);
  });

  it('keeps app-wide rules from the template', () => {
    const settings = buildNewHouseholdSettings(template, 'vegetarian');
    expect(settings.health_goals).toEqual(template.health_goals);
    expect(settings.measurements).toEqual(template.measurements);
    expect(settings.country).toBe(template.country);
  });

  it("does not hand a stranger this family's cuisines, spice level or school lunches", () => {
    const settings = buildNewHouseholdSettings(template, 'vegetarian_egg_free');
    expect(settings.favourite_cuisines).toEqual([]);
    expect(settings.exploring_cuisines).toEqual([]);
    expect(settings.spice.default_level).toBe(3);
    expect(settings.packed_lunch.days).toEqual([]);
    expect(settings.packed_lunch.for).toBeNull();
  });

  it('never mutates the template it was given', () => {
    const before = JSON.stringify(template);
    const settings = buildNewHouseholdSettings(template, 'omnivore');
    settings.health_goals.protein_smart_share = 0;
    expect(JSON.stringify(template)).toBe(before);
  });

  it('rejects an unknown diet', () => {
    expect(() => buildNewHouseholdSettings(template, 'carnivore')).toThrow(/Unknown diet/);
  });
});

describe('buildNewHouseholdSettings — meal slots chosen at setup (P8)', () => {
  const template = { version: 1, spice: { preference: 'medium' } };

  it('stores only the meals the household said it plans', () => {
    const s = buildNewHouseholdSettings(template, 'vegetarian_egg_free', ['Breakfast', 'Dinner']);
    expect(s.meal_slots).toEqual(['Breakfast', 'Dinner']);
  });

  it('stores them in the canonical order, not the order they were ticked', () => {
    const s = buildNewHouseholdSettings(template, 'vegetarian_egg_free', ['Dinner', 'Breakfast', 'Lunch']);
    expect(s.meal_slots).toEqual(['Breakfast', 'Lunch', 'Dinner']);
  });

  it('ignores anything that is not a real slot', () => {
    const s = buildNewHouseholdSettings(template, 'vegetarian_egg_free', ['Dinner', 'Elevenses']);
    expect(s.meal_slots).toEqual(['Dinner']);
  });

  // A household with no meals has no planner, so an empty or missing choice means all of them.
  it('falls back to every meal when none is chosen or the field is absent', () => {
    expect(buildNewHouseholdSettings(template, 'vegetarian_egg_free', []).meal_slots).toHaveLength(6);
    expect(buildNewHouseholdSettings(template, 'vegetarian_egg_free').meal_slots).toHaveLength(6);
  });
});
