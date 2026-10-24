import { afterEach, describe, expect, it } from 'vitest';
import { dietaryBadges, spiceMeter, setBadgeDiet, displayName } from '../../public/js/components/recipe-card.js';

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

  // P10: one flame and the number, not five repeated glyphs. The icon is decorative; the level is
  // announced once, from the screen-reader-only text.
  it('hides the flame from assistive tech so the level is announced once', () => {
    const html = spiceMeter(5);
    expect(html.match(/<use href="#i-chili">/g)).toHaveLength(1);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('Spice 5 of 5, very hot');
    expect(html).not.toContain('🌶');
  });

  it('renders nothing on a card when the level is unknown', () => {
    expect(spiceMeter(null)).toBe('');
    expect(spiceMeter(0)).toBe('');
  });

  it('says so explicitly where there is room to, rather than looking like "not spicy"', () => {
    expect(spiceMeter(null, { showUnknown: true })).toContain('Spice not recorded');
  });
});

describe('displayName', () => {
  it('drops a cuisine suffix the card already shows in its chip', () => {
    expect(displayName({ name: 'Aloo Paratha with Curd (North Indian)', cuisine: 'North Indian' }))
      .toBe('Aloo Paratha with Curd');
  });

  it('keeps a parenthetical that says something else', () => {
    expect(displayName({ name: 'Kanda Poha (Maharashtrian Style)', cuisine: 'Maharashtrian' }))
      .toBe('Kanda Poha (Maharashtrian Style)');
    expect(displayName({ name: 'Lemon Rice (Chitranna)', cuisine: 'South Indian' }))
      .toBe('Lemon Rice (Chitranna)');
  });

  it('leaves a name alone when there is no cuisine to compare', () => {
    expect(displayName({ name: 'Basundi', cuisine: null })).toBe('Basundi');
    expect(displayName({ name: 'Basundi' })).toBe('Basundi');
  });
});
