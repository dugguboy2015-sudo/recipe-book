import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// These exercise the localStorage-touching wrappers with an in-memory fake — the rest of
// planner-store.js's pure logic (migration, reducers, etc.) is covered without localStorage in
// tests/lib/planner-store.test.js, per this project's DOM/browser-API testing convention.
function installFakeLocalStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); },
    clear: () => store.clear(),
  };
  return store;
}

describe('planner-store localStorage wrappers', () => {
  let store;

  beforeEach(async () => {
    vi.resetModules();
    store = installFakeLocalStorage();
  });

  afterEach(() => {
    delete globalThis.localStorage;
  });

  it('migrates a v1 plan on first load and removes the v1 key once v3 is written', async () => {
    const { loadPlanState, mondayOf } = await import('../../public/js/lib/planner-store.js');
    store.set('recipeBookPlanner', JSON.stringify({ Monday: [{ id: 5, name: 'Dal', slot: 'Dinner', servings: 4 }] }));

    const { store: planStore, storageAvailable } = loadPlanState({ defaultServings: 4 });
    expect(storageAvailable).toBe(true);
    const today = mondayOf();
    expect(planStore.weeks[today].days.Monday).toEqual([{ recipeId: 5, slot: 'Dinner', servings: 4, source: 'manual' }]);
    expect(store.has('recipeBookPlanner')).toBe(false);
    expect(store.has('recipeBookPlanner.v3')).toBe(true);
  });

  it('migrates a v2 plan on first load and removes the v2 key once v3 is written', async () => {
    const { loadPlanState, mondayOf } = await import('../../public/js/lib/planner-store.js');
    const recentWeekOf = mondayOf(new Date(Date.parse(`${mondayOf()}T00:00:00Z`) - 21 * 86400000)); // 3 weeks ago — well within retention
    const v2 = { version: 2, weekOf: recentWeekOf, days: { Monday: [{ recipeId: 9, slot: 'Dinner', servings: 4, source: 'manual' }], Tuesday: [], Wednesday: [], Thursday: [], Friday: [], Saturday: [], Sunday: [] } };
    store.set('recipeBookPlanner.v2', JSON.stringify(v2));

    const { store: planStore, storageAvailable } = loadPlanState({ defaultServings: 4 });
    expect(storageAvailable).toBe(true);
    expect(planStore.weeks[recentWeekOf].days.Monday).toEqual(v2.days.Monday);
    expect(store.has('recipeBookPlanner.v2')).toBe(false);
    expect(store.has('recipeBookPlanner.v3')).toBe(true);
  });

  it('a week completing fires a kept signal for surviving auto entries but leaves its data intact for later browsing (multi-week planning)', async () => {
    const { loadPlanState, persistPrefs, defaultPrefs, getWeekDays, mondayOf } = await import('../../public/js/lib/planner-store.js');
    // 3 weeks ago: completed, well within the retention window, but not "the single most recently
    // completed week" (that's exactly 1 week ago) — so it should survive untouched without firing
    // the one-time completion signals a second time.
    const olderWeekOf = mondayOf(new Date(Date.parse(`${mondayOf()}T00:00:00Z`) - 21 * 86400000));
    const v3 = { version: 3, weeks: { [olderWeekOf]: { days: { Monday: [{ recipeId: 9, slot: 'Dinner', servings: 4, source: 'auto' }], Tuesday: [], Wednesday: [], Thursday: [], Friday: [], Saturday: [], Sunday: [] } } } };
    store.set('recipeBookPlanner.v3', JSON.stringify(v3));
    persistPrefs(defaultPrefs());

    const { store: planStore, prefs, weekReview } = loadPlanState({ defaultServings: 4 });
    // The completion signal only fires for the single most-recently-completed week — this fixture's
    // older week isn't that, so no signal fires for it, but its data must survive regardless,
    // unlike the old destructive-reset model.
    expect(getWeekDays(planStore, olderWeekOf).Monday).toEqual(v3.weeks[olderWeekOf].days.Monday);
    expect(weekReview).toBeNull();
    expect(prefs.recipes['9']).toBeUndefined();
  });

  it('fires the kept signal and a week review for the actual most-recently-completed week', async () => {
    const { loadPlanState, persistPrefs, defaultPrefs, mondayOf } = await import('../../public/js/lib/planner-store.js');
    const today = mondayOf();
    const lastWeekOf = mondayOf(new Date(Date.parse(`${today}T00:00:00Z`) - 7 * 86400000));
    const v3 = { version: 3, weeks: { [lastWeekOf]: { days: { Monday: [{ recipeId: 1, slot: 'Dinner', servings: 4, source: 'auto' }], Tuesday: [], Wednesday: [], Thursday: [], Friday: [], Saturday: [], Sunday: [] } } } };
    store.set('recipeBookPlanner.v3', JSON.stringify(v3));
    persistPrefs(defaultPrefs());

    const { prefs, weekReview } = loadPlanState({ defaultServings: 4 });
    expect(prefs.recipes['1']).toMatchObject({ kept: 1, lastPlanned: lastWeekOf });
    expect(weekReview).toEqual({ weekOf: lastWeekOf, entries: [{ recipeId: 1, slot: 'Dinner', servings: 4, source: 'auto', day: 'Monday' }] });
  });

  it('does not re-surface a week review once it has been dismissed', async () => {
    const { loadPlanState, dismissWeekReview, persistPrefs, defaultPrefs, mondayOf } = await import('../../public/js/lib/planner-store.js');
    const today = mondayOf();
    const lastWeekOf = mondayOf(new Date(Date.parse(`${today}T00:00:00Z`) - 7 * 86400000));
    const v3 = { version: 3, weeks: { [lastWeekOf]: { days: { Monday: [{ recipeId: 9, slot: 'Dinner', servings: 4, source: 'manual' }], Tuesday: [], Wednesday: [], Thursday: [], Friday: [], Saturday: [], Sunday: [] } } } };
    store.set('recipeBookPlanner.v3', JSON.stringify(v3));
    persistPrefs(dismissWeekReview(defaultPrefs(), lastWeekOf));

    const { weekReview } = loadPlanState({ defaultServings: 4 });
    expect(weekReview).toBeNull();
  });

  it('planning a future week stores it independently of the current week', async () => {
    const { loadPlanState, persistStore, setWeekDays, getWeekDays, mondayOf } = await import('../../public/js/lib/planner-store.js');
    const { store: initialStore } = loadPlanState({ defaultServings: 4 });
    const today = mondayOf();
    const futureWeekOf = mondayOf(new Date(Date.parse(`${today}T00:00:00Z`) + 21 * 86400000));

    const updated = setWeekDays(initialStore, futureWeekOf, { Monday: [{ recipeId: 3, slot: 'Lunch', servings: 4, source: 'manual' }], Tuesday: [], Wednesday: [], Thursday: [], Friday: [], Saturday: [], Sunday: [] });
    persistStore(updated);

    const { store: reloaded } = loadPlanState({ defaultServings: 4 });
    expect(getWeekDays(reloaded, futureWeekOf).Monday).toEqual([{ recipeId: 3, slot: 'Lunch', servings: 4, source: 'manual' }]);
    expect(getWeekDays(reloaded, today).Monday).toEqual([]); // untouched, independent of the future week
  });

  it('falls back to an in-memory store and reports storageAvailable:false when localStorage throws', async () => {
    globalThis.localStorage = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
      removeItem: () => {},
    };
    const { loadPlanState, getWeekDays, mondayOf } = await import('../../public/js/lib/planner-store.js');
    const { store: planStore, storageAvailable } = loadPlanState({ defaultServings: 4 });
    expect(storageAvailable).toBe(false);
    expect(getWeekDays(planStore, mondayOf())).toEqual({ Monday: [], Tuesday: [], Wednesday: [], Thursday: [], Friday: [], Saturday: [], Sunday: [] });
  });

  it('persistStore/persistPrefs round-trip through loadPlanState/loadPrefs', async () => {
    const { persistStore, persistPrefs, loadPrefs, loadPlanState, defaultStore, setWeekDays, applyPrefEvent, defaultPrefs, getWeekDays, mondayOf } = await import('../../public/js/lib/planner-store.js');
    const today = mondayOf();
    const store2 = setWeekDays(defaultStore(), today, { Monday: [{ recipeId: 1, slot: 'Breakfast', servings: 4, source: 'manual' }], Tuesday: [], Wednesday: [], Thursday: [], Friday: [], Saturday: [], Sunday: [] });
    expect(persistStore(store2)).toBe(true);
    expect(persistPrefs(applyPrefEvent(defaultPrefs(), 1, 'manual', today))).toBe(true);

    const loaded = loadPlanState({ defaultServings: 4 });
    expect(getWeekDays(loaded.store, today)).toEqual(store2.weeks[today].days);
    expect(loadPrefs().recipes['1']).toMatchObject({ manual: 1 });
  });
});
