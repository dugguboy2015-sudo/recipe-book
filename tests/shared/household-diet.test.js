import { describe, expect, it } from 'vitest';
import template from '../../config/household.json';
import {
  applySettingsUpdate, buildNewHouseholdSettings, dietAdjective, dietPhrase, dietPresetKey, dietRecipeFilter, recipeFitsDiet,
} from '../../public/js/shared/household-settings.js';

const omnivore = buildNewHouseholdSettings(template, 'omnivore');
const eggEater = buildNewHouseholdSettings(template, 'vegetarian');

describe('diet helpers (M1d)', () => {
  it('recognises which preset a household matches', () => {
    expect(dietPresetKey(template)).toBe('vegetarian_egg_free');
    expect(dietPresetKey(eggEater)).toBe('vegetarian');
    expect(dietPresetKey(omnivore)).toBe('omnivore');
  });

  it('words the diet for copy and sentences', () => {
    expect(dietAdjective(template)).toBe('vegetarian');
    expect(dietAdjective(omnivore)).toBe('');
    expect(dietPhrase(template)).toBe('vegetarian and egg-free');
    expect(dietPhrase(eggEater)).toBe('vegetarian');
  });

  it('turns the diet into catalogue filters', () => {
    expect(dietRecipeFilter(template)).toEqual({ vegetarian: true, eggFree: true });
    expect(dietRecipeFilter(eggEater)).toEqual({ vegetarian: true, eggFree: false });
    expect(dietRecipeFilter(omnivore)).toEqual({ vegetarian: false, eggFree: false });
    expect(dietRecipeFilter(null)).toEqual({ vegetarian: false, eggFree: false });
  });

  it('checks a single recipe against the diet', () => {
    const omelette = { is_vegetarian: true, is_egg_free: false };
    expect(recipeFitsDiet(template, omelette)).toBe(false);
    expect(recipeFitsDiet(eggEater, omelette)).toBe(true);
    expect(recipeFitsDiet(eggEater, { is_vegetarian: false, is_egg_free: true })).toBe(false);
    expect(recipeFitsDiet(omnivore, { is_vegetarian: false, is_egg_free: false })).toBe(true);
  });
});

describe('applySettingsUpdate', () => {
  const cuisines = ['South Indian', 'North Indian', 'Gujarati'];

  it('merges a valid update over the current settings, leaving the rest alone', () => {
    const { ok, value } = applySettingsUpdate(template, {
      diet: 'vegetarian', defaultServings: 3, spiceLevel: 2, favouriteCuisines: ['Gujarati', 'Gujarati', ' South Indian '],
    }, { cuisines });
    expect(ok).toBe(true);
    expect(value.diet.egg_free).toBe(false);
    expect(value.default_servings).toBe(3);
    expect(value.spice).toMatchObject({ default_level: 2, preference: 'mild' });
    expect(value.favourite_cuisines).toEqual(['Gujarati', 'South Indian']);
    expect(value.health_goals).toEqual(template.health_goals);
    expect(value.exploring_cuisines).toEqual(template.exploring_cuisines);
  });

  it('orders packed-lunch days and needs someone to pack them for', () => {
    const { value } = applySettingsUpdate(template, { packedLunch: { days: ['Friday', 'Monday'], for: '' } });
    expect(value.packed_lunch.days).toEqual(['Monday', 'Friday']);
    expect(value.packed_lunch.for).toBe('someone at school');
    const none = applySettingsUpdate(template, { packedLunch: { days: [], for: 'our son' } }).value;
    expect(none.packed_lunch.for).toBeNull();
  });

  it('rejects bad values per field without touching the settings', () => {
    const before = JSON.stringify(template);
    const { ok, errors } = applySettingsUpdate(template, {
      diet: 'carnivore', defaultServings: 0, spiceLevel: 9, favouriteCuisines: ['Martian'], packedLunch: { days: ['Funday'] },
    }, { cuisines });
    expect(ok).toBe(false);
    expect(Object.keys(errors).sort()).toEqual(['defaultServings', 'diet', 'favouriteCuisines', 'packedLunch', 'spiceLevel']);
    expect(JSON.stringify(template)).toBe(before);
  });
});
