import { describe, expect, it } from 'vitest';
import {
  DAYS, migratePlanV1, hasWeekRolledOver, archiveWeek, applyPrefEvent, defaultPlan, defaultPrefs,
  addEntry, removeEntry, keepEntry, replaceEntry, updateServings, parseImportedPlanData, mondayOf,
} from '../../public/js/lib/planner-store.js';

describe('mondayOf', () => {
  it('returns the same date for a Monday and steps back to it from later in the week', () => {
    expect(mondayOf(new Date('2026-09-14T12:00:00Z'))).toBe('2026-09-14');
    expect(mondayOf(new Date('2026-09-18T12:00:00Z'))).toBe('2026-09-14'); // Friday
    expect(mondayOf(new Date('2026-09-20T12:00:00Z'))).toBe('2026-09-14'); // Sunday
  });
});

describe('migratePlanV1', () => {
  it('converts v1 entries to v2 shape, renaming Other to Snacks and defaulting a missing slot to Dinner', () => {
    const v1 = {
      Monday: [{ id: 12, name: 'Dal', slot: 'Dinner', servings: 3 }],
      Tuesday: [{ id: 7, name: 'Snack Mix', slot: 'Other' }],
      Wednesday: [{ id: 9, name: 'Mystery Meal' }], // no slot at all
      Thursday: [], Friday: [], Saturday: [], Sunday: [],
    };
    const plan = migratePlanV1(v1, { defaultServings: 4, weekOf: '2026-09-14' });
    expect(plan).toEqual({
      version: 2,
      weekOf: '2026-09-14',
      days: {
        Monday: [{ recipeId: 12, slot: 'Dinner', servings: 3, source: 'manual' }],
        Tuesday: [{ recipeId: 7, slot: 'Snacks', servings: 4, source: 'manual' }],
        Wednesday: [{ recipeId: 9, slot: 'Dinner', servings: 4, source: 'manual' }],
        Thursday: [], Friday: [], Saturday: [], Sunday: [],
      },
    });
  });

  it('drops malformed entries and tolerates a missing/undefined day', () => {
    const plan = migratePlanV1({ Monday: [{ id: null }, { notAnId: 1 }] }, { weekOf: '2026-09-14' });
    expect(plan.days.Monday).toEqual([]);
    expect(plan.days.Sunday).toEqual([]);
  });
});

describe('hasWeekRolledOver', () => {
  it('is true with no stored week, false within the same week, true 7+ days later', () => {
    expect(hasWeekRolledOver(undefined, '2026-09-14')).toBe(true);
    expect(hasWeekRolledOver('2026-09-14', '2026-09-14')).toBe(false);
    expect(hasWeekRolledOver('2026-09-14', '2026-09-20')).toBe(false); // still within the same week, Sunday
    expect(hasWeekRolledOver('2026-09-14', '2026-09-21')).toBe(true); // next Monday
  });
});

describe('archiveWeek', () => {
  it('appends the ended week to history and caps it at 12 weeks', () => {
    const plan = defaultPlan('2026-09-14');
    plan.days.Monday = [{ recipeId: 1, slot: 'Dinner', servings: 4, source: 'auto' }];
    const prefs = { ...defaultPrefs(), history: Array.from({ length: 12 }, (_, i) => ({ weekOf: `week-${i}`, entries: [] })) };
    const next = archiveWeek(prefs, plan);
    expect(next.history).toHaveLength(12);
    expect(next.history.at(-1)).toEqual({ weekOf: '2026-09-14', entries: [{ recipeId: 1, day: 'Monday', slot: 'Dinner', source: 'auto' }] });
    expect(next.history[0].weekOf).toBe('week-1'); // oldest entry dropped
  });

  it('is a no-op for an empty week', () => {
    const prefs = defaultPrefs();
    expect(archiveWeek(prefs, defaultPlan('2026-09-14'))).toBe(prefs);
  });
});

describe('applyPrefEvent', () => {
  it('increments the right stat per event and sets lastPlanned on manual/kept', () => {
    let prefs = defaultPrefs();
    prefs = applyPrefEvent(prefs, 12, 'manual', '2026-09-14');
    expect(prefs.recipes['12']).toMatchObject({ manual: 1, lastPlanned: '2026-09-14' });
    prefs = applyPrefEvent(prefs, 12, 'loved', '2026-09-21');
    expect(prefs.recipes['12']).toMatchObject({ manual: 1, loved: 1, lastPlanned: '2026-09-14' });
    prefs = applyPrefEvent(prefs, 12, 'notAgain', '2026-09-28');
    expect(prefs.recipes['12']).toMatchObject({ notAgain: 1, lastNotAgain: '2026-09-28' });
  });

  it('never mutates the input prefs object', () => {
    const prefs = defaultPrefs();
    const frozen = JSON.parse(JSON.stringify(prefs));
    applyPrefEvent(prefs, 1, 'manual', '2026-09-14');
    expect(prefs).toEqual(frozen);
  });
});

describe('plan reducers', () => {
  it('addEntry is a no-op when the recipe is already in that day/slot', () => {
    let plan = defaultPlan('2026-09-14');
    plan = addEntry(plan, 'Monday', 'Dinner', 5, 4, 'manual');
    const again = addEntry(plan, 'Monday', 'Dinner', 5, 4, 'manual');
    expect(again.days.Monday).toHaveLength(1);
  });

  it('removeEntry removes only the matching slot/recipe', () => {
    let plan = defaultPlan('2026-09-14');
    plan = addEntry(plan, 'Monday', 'Dinner', 5, 4);
    plan = addEntry(plan, 'Monday', 'Lunch', 5, 4);
    plan = removeEntry(plan, 'Monday', 'Dinner', 5);
    expect(plan.days.Monday).toEqual([{ recipeId: 5, slot: 'Lunch', servings: 4, source: 'manual' }]);
  });

  it('keepEntry converts an auto entry to manual and drops its reasons', () => {
    let plan = defaultPlan('2026-09-14');
    plan.days.Monday = [{ recipeId: 5, slot: 'Dinner', servings: 4, source: 'auto', reasons: ['High protein'] }];
    plan = keepEntry(plan, 'Monday', 'Dinner', 5);
    expect(plan.days.Monday).toEqual([{ recipeId: 5, slot: 'Dinner', servings: 4, source: 'manual' }]);
  });

  it('replaceEntry swaps one entry in place (shuffle)', () => {
    let plan = defaultPlan('2026-09-14');
    plan.days.Monday = [{ recipeId: 5, slot: 'Dinner', servings: 4, source: 'auto' }];
    plan = replaceEntry(plan, 'Monday', 'Dinner', 5, { recipeId: 9, slot: 'Dinner', servings: 4, source: 'auto' });
    expect(plan.days.Monday).toEqual([{ recipeId: 9, slot: 'Dinner', servings: 4, source: 'auto' }]);
  });

  it('updateServings changes only the targeted entry', () => {
    let plan = defaultPlan('2026-09-14');
    plan = addEntry(plan, 'Monday', 'Dinner', 5, 4);
    plan = updateServings(plan, 'Monday', 'Dinner', 5, 6);
    expect(plan.days.Monday[0].servings).toBe(6);
  });
});

describe('parseImportedPlanData', () => {
  it('accepts a well-formed export', () => {
    const plan = defaultPlan('2026-09-14');
    const prefs = defaultPrefs();
    const parsed = parseImportedPlanData(JSON.stringify({ plan, prefs }));
    expect(parsed).toEqual({ plan, prefs });
  });

  it('rejects malformed or missing data', () => {
    expect(() => parseImportedPlanData(JSON.stringify({}))).toThrow();
    expect(() => parseImportedPlanData(JSON.stringify({ plan: { version: 1 }, prefs: defaultPrefs() }))).toThrow();
    expect(() => parseImportedPlanData(JSON.stringify({ plan: defaultPlan(), prefs: { version: 2 } }))).toThrow();
    expect(() => parseImportedPlanData('not json')).toThrow();
  });

  it('rejects a plan missing one of the seven days', () => {
    const plan = defaultPlan('2026-09-14');
    delete plan.days.Sunday;
    expect(() => parseImportedPlanData(JSON.stringify({ plan, prefs: defaultPrefs() }))).toThrow();
  });
});

describe('DAYS', () => {
  it('re-exports the seven days from the planner engine', () => {
    expect(DAYS).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
  });
});
