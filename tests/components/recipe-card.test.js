import { afterEach, describe, expect, it } from 'vitest';
import { dietaryBadges, spiceMeter, setBadgeDiet } from '../../public/js/components/recipe-card.js';

const VEG_EGG_FREE = { is_vegetarian: true, is_egg_free: true, contains_dairy: true, mealTypes: [] };

afterEach(() => setBadgeDiet(null));

describe('dietaryBadges', () => {
  it('shows Vegetarian and Egg-free when nothing says the viewer only eats that way', () => {
    const html = dietaryBadges(VEG_EGG_FREE);
    expect(html).toContain('Vegetarian');
    expect(html).toContain('Egg-free');
  });

  it('drops the badges a household\'s own diet already guarantees', () => {
    setBadgeDiet({ vegetarian: true, eggFree: true });
    const html = dietaryBadges(VEG_EGG_FREE);
    expect(html).not.toContain('Vegetarian');
    expect(html).not.toContain('Egg-free');
  });

  it('keeps Egg-free for a vegetarian household that does eat egg', () => {
    setBadgeDiet({ vegetarian: true, eggFree: false });
    const html = dietaryBadges(VEG_EGG_FREE);
    expect(html).not.toContain('Vegetarian');
    expect(html).toContain('Egg-free');
  });

  it('still shows the badges that carry information either way', () => {
    setBadgeDiet({ vegetarian: true, eggFree: true });
    const html = dietaryBadges({ ...VEG_EGG_FREE, contains_dairy: false, contains_nuts: false, is_protein_smart: true });
    expect(html).toContain('Dairy-free');
    expect(html).toContain('Nut-free');
    expect(html).toContain('Protein-smart');
  });
});

describe('spiceMeter', () => {
  it('says the level in text, not only in colour', () => {
    const html = spiceMeter(3);
    expect(html).toContain('3/5');
    expect(html).toContain('Spice 3 of 5, medium');
  });

  it('hides the chilli glyphs from assistive tech so the level is announced once', () => {
    const html = spiceMeter(5);
    expect(html.match(/🌶/g)).toHaveLength(5);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('Spice 5 of 5, very hot');
  });

  it('renders nothing on a card when the level is unknown', () => {
    expect(spiceMeter(null)).toBe('');
    expect(spiceMeter(0)).toBe('');
  });

  it('says so explicitly where there is room to, rather than looking like "not spicy"', () => {
    expect(spiceMeter(null, { showUnknown: true })).toContain('Spice not recorded');
  });
});
