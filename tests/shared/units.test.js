import { describe, expect, it } from 'vitest';
import { scaleQuantity, bestCupSpoon, displayQuantity, formatQuantity } from '../../public/js/shared/units.js';

function displayAndFormat(quantity, unit, fromServes, toServes, scales = true) {
  const scaled = scaleQuantity(quantity, fromServes, toServes, scales);
  return formatQuantity(displayQuantity(scaled, unit));
}

describe('Appendix C.2 scaling + display table', () => {
  it.each([
    [1.5, 'cup', 4, 6, true, '2¼ cups'],
    [0.5, 'tsp', 4, 6, true, '¾ tsp'],
    [3, 'tbsp', 4, 6, true, '4½ tbsp'],
    [6, 'tbsp', 4, 8, true, '¾ cup'],
    [1, 'tsp', 4, 2, true, '½ tsp'],
    [1, 'pinch', 4, 8, false, 'a pinch'],
    [2, 'clove', 4, 6, true, '3 cloves'],
    [1, 'piece', 4, 6, true, '1½'],
  ])('%s %s scaled %s -> %s (scales=%s) => %s', (quantity, unit, fromServes, toServes, scales, expected) => {
    expect(displayAndFormat(quantity, unit, fromServes, toServes, scales)).toBe(expected);
  });

  it('0.2 tsp displays as a pinch (no scaling change)', () => {
    expect(formatQuantity(displayQuantity(0.2, 'tsp'))).toBe('a pinch');
  });

  it('to_taste always displays as "to taste" regardless of scaling', () => {
    const scaled = scaleQuantity(null, 4, 8, true);
    expect(formatQuantity(displayQuantity(scaled, 'to_taste'))).toBe('to taste');
  });
});

describe('bestCupSpoon boundaries (Appendix G.3)', () => {
  it('59ml stays in tbsp/tsp range (just under the 60ml cup threshold)', () => {
    const result = bestCupSpoon(59);
    expect(result.unit).not.toBe('cup');
  });

  it('60ml is eligible for cup (right at the threshold)', () => {
    // 60ml = 0.25 cup exactly, a valid cup step, so it should be expressed as ¼ cup.
    const result = bestCupSpoon(60);
    expect(result).toEqual({ quantity: 0.25, unit: 'cup' });
  });

  it('14ml stays below the 15ml tbsp threshold (tsp only)', () => {
    const result = bestCupSpoon(14);
    expect(result.unit).toBe('tsp');
  });

  it('15ml is eligible for tbsp (right at the threshold): exactly 1 tbsp', () => {
    const result = bestCupSpoon(15);
    expect(result).toEqual({ quantity: 1, unit: 'tbsp' });
  });

  it('1.2ml is below the pinch cutoff', () => {
    expect(bestCupSpoon(1.2)).toEqual({ quantity: null, unit: 'pinch' });
  });

  it('1.25ml is at the pinch cutoff and resolves to a tiny tsp amount, not a pinch', () => {
    const result = bestCupSpoon(1.25);
    expect(result.unit).toBe('tsp');
  });
});

describe('scaleQuantity', () => {
  it('returns null for a null quantity regardless of scales', () => {
    expect(scaleQuantity(null, 4, 8, true)).toBeNull();
    expect(scaleQuantity(null, 4, 8, false)).toBeNull();
  });

  it('leaves the quantity unchanged when scales is false', () => {
    expect(scaleQuantity(2, 4, 8, false)).toBe(2);
  });

  it('scales proportionally to the target servings', () => {
    expect(scaleQuantity(2, 4, 8, true)).toBe(4);
    expect(scaleQuantity(2, 4, 2, true)).toBe(1);
  });
});
