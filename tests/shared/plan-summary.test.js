import { describe, expect, it } from 'vitest';
import { todayIso, addDaysIso, dayNameForIso, entriesOnDate, computeProteinSmartShare } from '../../public/js/shared/plan-summary.js';
import { defaultStore, setWeekDays, emptyDays } from '../../public/js/lib/planner-store.js';

describe('todayIso / addDaysIso', () => {
  it('formats a Date as a local-calendar ISO string', () => {
    expect(todayIso(new Date(2026, 8, 14))).toBe('2026-09-14'); // month is 0-indexed
  });

  it('shifts by n days, including across a month boundary', () => {
    expect(addDaysIso('2026-09-14', 1)).toBe('2026-09-15');
    expect(addDaysIso('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDaysIso('2026-09-14', -1)).toBe('2026-09-13');
  });
});

describe('dayNameForIso', () => {
  it('maps every day of the week correctly', () => {
    expect(dayNameForIso('2026-09-14')).toBe('Monday');
    expect(dayNameForIso('2026-09-20')).toBe('Sunday');
  });
});

describe('entriesOnDate', () => {
  it('resolves an exact date to its entries, correctly crossing a week boundary', () => {
    // Sunday 2026-09-20 belongs to the week of 2026-09-14; Monday 2026-09-21 belongs to the next
    // week (2026-09-21) — a single-week model would get this wrong at exactly this boundary.
    let store = defaultStore();
    store = setWeekDays(store, '2026-09-14', { ...emptyDays(), Sunday: [{ recipeId: 1, slot: 'Dinner', servings: 4, source: 'manual' }] });
    store = setWeekDays(store, '2026-09-21', { ...emptyDays(), Monday: [{ recipeId: 2, slot: 'Breakfast', servings: 4, source: 'manual' }] });

    expect(entriesOnDate(store, '2026-09-20')).toEqual([{ recipeId: 1, slot: 'Dinner', servings: 4, source: 'manual' }]);
    expect(entriesOnDate(store, '2026-09-21')).toEqual([{ recipeId: 2, slot: 'Breakfast', servings: 4, source: 'manual' }]);
  });

  it('returns an empty array for an untouched date', () => {
    expect(entriesOnDate(defaultStore(), '2026-09-14')).toEqual([]);
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
