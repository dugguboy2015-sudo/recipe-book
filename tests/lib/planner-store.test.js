import { describe, expect, it } from 'vitest';
import {
  DAYS, migratePlanV1ToWeek, migratePlanV2ToV3, applyPrefEvent, defaultStore, defaultPrefs,
  emptyDays, getWeekDays, setWeekDays, resetWeekDays, pruneOldWeeks,
  addEntry, removeEntry, keepEntry, replaceEntry, updateServings, parseImportedPlanData, mondayOf,
  applyWeekCompletion, stampAddedBy, setFavourite, isFavourite, favouriteIds, addLeftoverEntry, markCooked,
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

describe('applyWeekCompletion (M1e: runs over a plan from anywhere)', () => {
  const lastWeek = '2026-09-14';
  const today = '2026-09-21';
  const storeWith = (entries) => setWeekDays(defaultStore(), lastWeek, { ...emptyDays(), Monday: entries });

  it('credits surviving auto entries once and offers the review card', () => {
    const store = storeWith([
      { recipeId: 1, slot: 'Dinner', servings: 4, source: 'auto' },
      { recipeId: 2, slot: 'Lunch', servings: 4, source: 'manual' },
    ]);
    const first = applyWeekCompletion(store, defaultPrefs(), today);
    expect(first.prefsChanged).toBe(true);
    expect(first.prefs.recipes['1'].kept).toBe(1);
    expect(first.prefs.recipes['2']).toBeUndefined(); // manual entries were never auto-filled
    expect(first.weekReview.weekOf).toBe(lastWeek);
    expect(first.weekReview.entries).toHaveLength(2);

    const second = applyWeekCompletion(store, first.prefs, today);
    expect(second.prefsChanged).toBe(false);
    expect(second.prefs.recipes['1'].kept).toBe(1);
  });

  it('does nothing for a week nobody planned', () => {
    const result = applyWeekCompletion(defaultStore(), defaultPrefs(), today);
    expect(result.prefsChanged).toBe(false);
    expect(result.weekReview).toBeNull();
  });

  it('stops offering the review once it has been dismissed', () => {
    const prefs = { ...defaultPrefs(), lastReviewedWeekOf: lastWeek };
    const result = applyWeekCompletion(storeWith([{ recipeId: 1, slot: 'Dinner', servings: 4, source: 'auto' }]), prefs, today);
    expect(result.weekReview).toBeNull();
  });
});

describe('stampAddedBy (M1e attribution)', () => {
  it('names whoever is signed in on entries that name nobody, and leaves the rest alone', () => {
    const days = { ...emptyDays(), Monday: [{ recipeId: 1, slot: 'Dinner' }, { recipeId: 2, slot: 'Lunch', addedBy: 'someone-else' }] };
    const stamped = stampAddedBy(days, 'me');
    expect(stamped.Monday[0].addedBy).toBe('me');
    expect(stamped.Monday[1].addedBy).toBe('someone-else');
  });

  it('is a no-op when signed out', () => {
    const days = { ...emptyDays(), Monday: [{ recipeId: 1, slot: 'Dinner' }] };
    expect(stampAddedBy(days, null)).toBe(days);
  });
});

describe('favourites (M5)', () => {
  it('stars and unstars a recipe without disturbing its other history', () => {
    let prefs = applyPrefEvent(defaultPrefs(), 7, 'loved', '2026-09-21');
    prefs = setFavourite(prefs, 7, true);
    expect(isFavourite(prefs, 7)).toBe(true);
    expect(prefs.recipes['7'].loved).toBe(1);
    prefs = setFavourite(prefs, 7, false);
    expect(isFavourite(prefs, 7)).toBe(false);
    expect(prefs.recipes['7'].loved).toBe(1);
  });

  it('stars a recipe with no history yet', () => {
    const prefs = setFavourite(defaultPrefs(), 3, true);
    expect(isFavourite(prefs, 3)).toBe(true);
    expect(prefs.recipes['3'].manual).toBe(0);
  });

  it('lists the starred ids', () => {
    let prefs = setFavourite(defaultPrefs(), 3, true);
    prefs = setFavourite(prefs, 9, true);
    prefs = setFavourite(prefs, 9, false);
    prefs = setFavourite(prefs, 11, true);
    expect(favouriteIds(prefs).sort((a, b) => a - b)).toEqual([3, 11]);
  });

  it('never mutates the prefs it was given', () => {
    const before = defaultPrefs();
    setFavourite(before, 1, true);
    expect(isFavourite(before, 1)).toBe(false);
  });
});

describe('leftovers and cooked history (M5)', () => {
  const base = { ...emptyDays(), Monday: [{ recipeId: 1, slot: 'Dinner', servings: 4, source: 'manual' }] };

  it('plans leftovers as a real entry that is flagged not to be cooked again', () => {
    const days = addLeftoverEntry(base, 'Tuesday', 'Lunch', 1, 2, 'user-1');
    expect(days.Tuesday[0]).toMatchObject({ recipeId: 1, slot: 'Lunch', servings: 2, leftover: true, addedBy: 'user-1' });
    expect(days.Monday[0].leftover).toBeUndefined();
  });

  it('will not double up leftovers in the same slot', () => {
    const once = addLeftoverEntry(base, 'Tuesday', 'Lunch', 1, 2);
    expect(addLeftoverEntry(once, 'Tuesday', 'Lunch', 1, 2)).toBe(once);
  });

  it('ticks a meal as cooked and back again', () => {
    const cooked = markCooked(base, 'Monday', 'Dinner', 1, true);
    expect(cooked.Monday[0].cooked).toBe(true);
    expect(markCooked(cooked, 'Monday', 'Dinner', 1, false).Monday[0].cooked).toBe(false);
    expect(base.Monday[0].cooked).toBeUndefined();
  });
});
