import { describe, expect, it } from 'vitest';
import {
  DAYS, migratePlanV1ToWeek, migratePlanV2ToV3, applyPrefEvent, defaultStore, defaultPrefs,
  emptyDays, getWeekDays, setWeekDays, resetWeekDays, pruneOldWeeks,
  addEntry, removeEntry, keepEntry, replaceEntry, updateServings, parseImportedPlanData, mondayOf,
} from '../../public/js/lib/planner-store.js';

describe('mondayOf', () => {
  it('returns the same date for a Monday and steps back to it from later in the week', () => {
    expect(mondayOf(new Date('2026-09-14T12:00:00Z'))).toBe('2026-09-14');
    expect(mondayOf(new Date('2026-09-18T12:00:00Z'))).toBe('2026-09-14'); // Friday
    expect(mondayOf(new Date('2026-09-20T12:00:00Z'))).toBe('2026-09-14'); // Sunday
  });
});

describe('migratePlanV1ToWeek', () => {
  it('converts v1 entries to v3 day-map shape, renaming Other to Snacks and defaulting a missing slot to Dinner', () => {
    const v1 = {
      Monday: [{ id: 12, name: 'Dal', slot: 'Dinner', servings: 3 }],
      Tuesday: [{ id: 7, name: 'Snack Mix', slot: 'Other' }],
      Wednesday: [{ id: 9, name: 'Mystery Meal' }], // no slot at all
      Thursday: [], Friday: [], Saturday: [], Sunday: [],
    };
    const days = migratePlanV1ToWeek(v1, { defaultServings: 4 });
    expect(days).toEqual({
      Monday: [{ recipeId: 12, slot: 'Dinner', servings: 3, source: 'manual' }],
      Tuesday: [{ recipeId: 7, slot: 'Snacks', servings: 4, source: 'manual' }],
      Wednesday: [{ recipeId: 9, slot: 'Dinner', servings: 4, source: 'manual' }],
      Thursday: [], Friday: [], Saturday: [], Sunday: [],
    });
  });

  it('drops malformed entries and tolerates a missing/undefined day', () => {
    const days = migratePlanV1ToWeek({ Monday: [{ id: null }, { notAnId: 1 }] });
    expect(days.Monday).toEqual([]);
    expect(days.Sunday).toEqual([]);
  });
});

describe('migratePlanV2ToV3', () => {
  it('wraps a single v2 week under its own weekOf key', () => {
    const v2 = { version: 2, weekOf: '2026-09-14', days: { ...emptyDays(), Monday: [{ recipeId: 5, slot: 'Dinner', servings: 4, source: 'manual' }] } };
    const store = migratePlanV2ToV3(v2);
    expect(store).toEqual({ version: 3, weeks: { '2026-09-14': { days: v2.days } } });
  });
});

describe('week accessors', () => {
  it('getWeekDays returns fresh empty days for a week never touched, without mutating the store', () => {
    const store = defaultStore();
    expect(getWeekDays(store, '2026-09-14')).toEqual(emptyDays());
    expect(store.weeks).toEqual({});
  });

  it('setWeekDays stores a week independently of others', () => {
    let store = defaultStore();
    store = setWeekDays(store, '2026-09-14', { ...emptyDays(), Monday: [{ recipeId: 1, slot: 'Dinner', servings: 4, source: 'manual' }] });
    store = setWeekDays(store, '2026-09-21', { ...emptyDays(), Tuesday: [{ recipeId: 2, slot: 'Lunch', servings: 4, source: 'manual' }] });
    expect(getWeekDays(store, '2026-09-14').Monday).toHaveLength(1);
    expect(getWeekDays(store, '2026-09-21').Tuesday).toHaveLength(1);
    expect(getWeekDays(store, '2026-09-28')).toEqual(emptyDays()); // untouched third week is unaffected
  });

  it('resetWeekDays clears only the targeted week', () => {
    let store = defaultStore();
    store = setWeekDays(store, '2026-09-14', { ...emptyDays(), Monday: [{ recipeId: 1, slot: 'Dinner', servings: 4, source: 'manual' }] });
    store = setWeekDays(store, '2026-09-21', { ...emptyDays(), Tuesday: [{ recipeId: 2, slot: 'Lunch', servings: 4, source: 'manual' }] });
    store = resetWeekDays(store, '2026-09-14');
    expect(getWeekDays(store, '2026-09-14')).toEqual(emptyDays());
    expect(getWeekDays(store, '2026-09-21').Tuesday).toHaveLength(1);
  });
});

describe('pruneOldWeeks', () => {
  it('drops weeks older than the retention window and keeps everything else', () => {
    let store = defaultStore();
    store = setWeekDays(store, '2015-01-05', { ...emptyDays(), Monday: [{ recipeId: 1, slot: 'Dinner', servings: 4, source: 'manual' }] }); // far in the past
    store = setWeekDays(store, '2026-09-07', { ...emptyDays(), Monday: [{ recipeId: 2, slot: 'Dinner', servings: 4, source: 'manual' }] }); // recent
    store = setWeekDays(store, '2027-01-04', { ...emptyDays(), Monday: [{ recipeId: 3, slot: 'Dinner', servings: 4, source: 'manual' }] }); // future
    const pruned = pruneOldWeeks(store, '2026-09-14');
    expect(Object.keys(pruned.weeks).sort()).toEqual(['2026-09-07', '2027-01-04']);
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

describe('plan reducers (operate on one week\'s days map)', () => {
  it('addEntry is a no-op when the recipe is already in that day/slot', () => {
    let days = emptyDays();
    days = addEntry(days, 'Monday', 'Dinner', 5, 4, 'manual');
    const again = addEntry(days, 'Monday', 'Dinner', 5, 4, 'manual');
    expect(again.Monday).toHaveLength(1);
  });

  it('removeEntry removes only the matching slot/recipe', () => {
    let days = emptyDays();
    days = addEntry(days, 'Monday', 'Dinner', 5, 4);
    days = addEntry(days, 'Monday', 'Lunch', 5, 4);
    days = removeEntry(days, 'Monday', 'Dinner', 5);
    expect(days.Monday).toEqual([{ recipeId: 5, slot: 'Lunch', servings: 4, source: 'manual' }]);
  });

  it('keepEntry converts an auto entry to manual and drops its reasons', () => {
    let days = emptyDays();
    days.Monday = [{ recipeId: 5, slot: 'Dinner', servings: 4, source: 'auto', reasons: ['High protein'] }];
    days = keepEntry(days, 'Monday', 'Dinner', 5);
    expect(days.Monday).toEqual([{ recipeId: 5, slot: 'Dinner', servings: 4, source: 'manual' }]);
  });

  it('replaceEntry swaps one entry in place (shuffle)', () => {
    let days = emptyDays();
    days.Monday = [{ recipeId: 5, slot: 'Dinner', servings: 4, source: 'auto' }];
    days = replaceEntry(days, 'Monday', 'Dinner', 5, { recipeId: 9, slot: 'Dinner', servings: 4, source: 'auto' });
    expect(days.Monday).toEqual([{ recipeId: 9, slot: 'Dinner', servings: 4, source: 'auto' }]);
  });

  it('updateServings changes only the targeted entry', () => {
    let days = emptyDays();
    days = addEntry(days, 'Monday', 'Dinner', 5, 4);
    days = updateServings(days, 'Monday', 'Dinner', 5, 6);
    expect(days.Monday[0].servings).toBe(6);
  });
});

describe('parseImportedPlanData', () => {
  it('accepts a well-formed export', () => {
    const store = setWeekDays(defaultStore(), '2026-09-14', emptyDays());
    const prefs = defaultPrefs();
    const parsed = parseImportedPlanData(JSON.stringify({ store, prefs }));
    expect(parsed).toEqual({ store, prefs });
  });

  it('rejects malformed or missing data', () => {
    expect(() => parseImportedPlanData(JSON.stringify({}))).toThrow();
    expect(() => parseImportedPlanData(JSON.stringify({ store: { version: 2 }, prefs: defaultPrefs() }))).toThrow();
    expect(() => parseImportedPlanData(JSON.stringify({ store: defaultStore(), prefs: { version: 2 } }))).toThrow();
    expect(() => parseImportedPlanData('not json')).toThrow();
  });

  it('rejects a week missing one of the seven days', () => {
    const store = defaultStore();
    const badDays = emptyDays();
    delete badDays.Sunday;
    store.weeks['2026-09-14'] = { days: badDays };
    expect(() => parseImportedPlanData(JSON.stringify({ store, prefs: defaultPrefs() }))).toThrow();
  });
});

describe('DAYS', () => {
  it('re-exports the seven days from the planner engine', () => {
    expect(DAYS).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
  });
});
