import { describe, expect, it } from 'vitest';
import { dishArtSvg } from '../../public/js/components/dish-art.js';
import { DISH_TYPES } from '../../public/js/shared/dish-type.js';

describe('dishArtSvg', () => {
  it('draws every dish type the matcher can return', () => {
    for (const type of DISH_TYPES) {
      const svg = dishArtSvg({ name: type.keywords[0], cuisine: 'North Indian', slug: 't' });
      expect(svg).toContain(`data-dish-type="${type.id}"`);
      expect(svg).toContain('<svg');
    }
  });

  it('tints by cuisine and uses tokens only — no colour literals', () => {
    const svg = dishArtSvg({ name: 'Dal Fry', cuisine: 'Maharashtrian', slug: 'dal-fry' });
    expect(svg).toContain('var(--cuisine-maharashtrian-bg)');
    expect(svg).toContain('var(--cuisine-maharashtrian-ink)');
    expect(svg).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(svg).not.toMatch(/\brgb\(|\bhsl\(/i);
  });

  it('falls back to an unknown cuisine tint rather than breaking', () => {
    expect(dishArtSvg({ name: 'Dal', cuisine: 'Martian', slug: 'x' })).toContain('var(--cuisine-other-bg)');
  });

  it('keeps the monogram for a dish it cannot name', () => {
    const svg = dishArtSvg({ name: 'Something Entirely New', cuisine: 'Fusion', slug: 'sen' });
    expect(svg).toContain('class="monogram"');
    expect(svg).toContain('>S<');
  });
});
