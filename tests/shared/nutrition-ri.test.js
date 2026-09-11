import { describe, expect, it } from 'vitest';
import { percentRI, trafficLightClass, nearestWidthClass } from '../../public/js/shared/nutrition-ri.js';

describe('percentRI', () => {
  it('computes % of the adult RI for a known field', () => {
    expect(percentRI('protein_g', 18)).toBe(36);
    expect(percentRI('salt_g', 2.1)).toBeCloseTo(35, 5);
  });

  it('returns null for a missing value or unknown field', () => {
    expect(percentRI('protein_g', null)).toBeNull();
    expect(percentRI('not_a_field', 10)).toBeNull();
  });
});

describe('trafficLightClass (J.5)', () => {
  it('is green under 10% RI', () => {
    expect(trafficLightClass('sugars_g', 9.9)).toBe('green');
  });

  it('is amber between 10% and 30% inclusive', () => {
    expect(trafficLightClass('saturates_g', 10)).toBe('amber');
    expect(trafficLightClass('saturates_g', 30)).toBe('amber');
  });

  it('is red over 30%', () => {
    expect(trafficLightClass('salt_g', 35)).toBe('red');
  });

  it('is null for protein and fibre — progress only, no traffic light', () => {
    expect(trafficLightClass('protein_g', 90)).toBeNull();
    expect(trafficLightClass('fibre_g', 50)).toBeNull();
  });
});

describe('nearestWidthClass', () => {
  it('rounds to the nearest 5% step', () => {
    expect(nearestWidthClass(22)).toBe('w-pct-20');
    expect(nearestWidthClass(23)).toBe('w-pct-25');
  });

  it('clamps to [0, 100]', () => {
    expect(nearestWidthClass(-10)).toBe('w-pct-0');
    expect(nearestWidthClass(240)).toBe('w-pct-100');
  });
});
