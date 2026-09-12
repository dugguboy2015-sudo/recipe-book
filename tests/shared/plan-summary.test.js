import { describe, expect, it } from 'vitest';
import { todayName, tomorrowName, computeProteinSmartShare } from '../../public/js/shared/plan-summary.js';

describe('todayName / tomorrowName', () => {
  it('maps every day of the week correctly, including the Sunday -> Monday wrap', () => {
    expect(todayName(new Date('2026-09-14T12:00:00Z'))).toBe('Monday');
    expect(todayName(new Date('2026-09-20T12:00:00Z'))).toBe('Sunday');
    expect(tomorrowName(new Date('2026-09-14T12:00:00Z'))).toBe('Tuesday');
    expect(tomorrowName(new Date('2026-09-20T12:00:00Z'))).toBe('Monday'); // Sunday -> next week's Monday
  });
});

describe('computeProteinSmartShare', () => {
  const resolvedById = new Map([
    [1, { id: 1, is_protein_smart: true }],
    [2, { id: 2, is_protein_smart: false }],
  ]);

  it('returns null when nothing resolves yet', () => {
    expect(computeProteinSmartShare({ Monday: [] }, resolvedById)).toBeNull();
    expect(computeProteinSmartShare({ Monday: [{ recipeId: 999, slot: 'Dinner' }] }, resolvedById)).toBeNull();
  });

  it('only counts Packed Lunch/Lunch/Dinner slots', () => {
    const planDays = { Monday: [{ recipeId: 1, slot: 'Breakfast' }, { recipeId: 2, slot: 'Dinner' }] };
    expect(computeProteinSmartShare(planDays, resolvedById)).toBe(0); // only the Dinner entry (id 2, not smart) counts
  });

  it('computes the correct fraction across multiple days', () => {
    const planDays = {
      Monday: [{ recipeId: 1, slot: 'Dinner' }],
      Tuesday: [{ recipeId: 2, slot: 'Lunch' }],
    };
    expect(computeProteinSmartShare(planDays, resolvedById)).toBe(0.5);
  });
});
