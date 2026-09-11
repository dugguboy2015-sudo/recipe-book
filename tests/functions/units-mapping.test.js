import { describe, expect, it } from 'vitest';
import { resolveDraftUnit } from '../../functions/_lib/ai/units-mapping.js';

describe('resolveDraftUnit', () => {
  it('maps common synonyms to canonical codes', () => {
    expect(resolveDraftUnit(1, 'tablespoon')).toEqual({ quantity: 1, unit: 'tbsp', warning: null });
    expect(resolveDraftUnit(1, 'teaspoons')).toEqual({ quantity: 1, unit: 'tsp', warning: null });
    expect(resolveDraftUnit(2, 'cups')).toEqual({ quantity: 2, unit: 'cup', warning: null });
    expect(resolveDraftUnit(3, 'cloves')).toEqual({ quantity: 3, unit: 'clove', warning: null });
  });

  it('passes through an already-canonical unit unchanged', () => {
    expect(resolveDraftUnit(0.5, 'cup')).toEqual({ quantity: 0.5, unit: 'cup', warning: null });
    expect(resolveDraftUnit(null, 'to_taste')).toEqual({ quantity: null, unit: 'to_taste', warning: null });
  });

  it('converts ml to the nearest cup/tbsp/tsp', () => {
    expect(resolveDraftUnit(240, 'ml')).toEqual({ quantity: 1, unit: 'cup', warning: null });
    expect(resolveDraftUnit(15, 'ml')).toEqual({ quantity: 1, unit: 'tbsp', warning: null });
  });

  it('converts litres to ml first, then to cup/tbsp/tsp', () => {
    expect(resolveDraftUnit(0.24, 'l')).toEqual({ quantity: 1, unit: 'cup', warning: null });
  });

  it('null quantity with an ml/l unit becomes to_taste, not a scaling error', () => {
    expect(resolveDraftUnit(null, 'ml')).toEqual({ quantity: null, unit: 'to_taste', warning: null });
  });

  it('keeps grams/kg as-is and warns non_cup_unit (no density to convert from)', () => {
    expect(resolveDraftUnit(200, 'g')).toEqual({ quantity: 200, unit: 'g', warning: 'non_cup_unit' });
    expect(resolveDraftUnit(1, 'kg')).toEqual({ quantity: 1, unit: 'kg', warning: 'non_cup_unit' });
  });

  it('falls back to to_taste and warns unknown_unit for anything unrecognised', () => {
    expect(resolveDraftUnit(1, 'smidgen')).toEqual({ quantity: null, unit: 'to_taste', warning: 'unknown_unit' });
  });
});
