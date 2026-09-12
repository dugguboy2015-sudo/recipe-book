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

  it('migrates a v1 plan on first load and removes the v1 key once v2 is written', async () => {
    const { loadPlanState, mondayOf } = await import('../../public/js/lib/planner-store.js');
    store.set('recipeBookPlanner', JSON.stringify({ Monday: [{ id: 5, name: 'Dal', slot: 'Dinner', servings: 4 }] }));

    const { plan, storageAvailable } = loadPlanState({ defaultServings: 4 });
    expect(storageAvailable).toBe(true);
    expect(plan.weekOf).toBe(mondayOf());
    expect(plan.days.Monday).toEqual([{ recipeId: 5, slot: 'Dinner', servings: 4, source: 'manual' }]);
    expect(store.has('recipeBookPlanner')).toBe(false);
    expect(store.has('recipeBookPlanner.v2')).toBe(true);
  });

  it('rolls over an elapsed week: archives it, fires a kept signal for surviving auto entries, and surfaces a week review', async () => {
    const { loadPlanState, persistPrefs, defaultPrefs } = await import('../../public/js/lib/planner-store.js');
    const staleWeek = { version: 2, weekOf: '2020-01-06', days: { Monday: [{ recipeId: 9, slot: 'Dinner', servings: 4, source: 'auto' }], Tuesday: [], Wednesday: [], Thursday: [], Friday: [], Saturday: [], Sunday: [] } };
    store.set('recipeBookPlanner.v2', JSON.stringify(staleWeek));
    persistPrefs(defaultPrefs());

    const { plan, prefs, weekReview } = loadPlanState({ defaultServings: 4 });
    expect(plan.days.Monday).toEqual([]); // fresh, empty plan for the new week
    expect(prefs.recipes['9']).toMatchObject({ kept: 1, lastPlanned: '2020-01-06' });
    expect(prefs.history).toEqual([{ weekOf: '2020-01-06', entries: [{ recipeId: 9, day: 'Monday', slot: 'Dinner', source: 'auto' }] }]);
    expect(weekReview).toEqual({ weekOf: '2020-01-06', entries: [{ recipeId: 9, slot: 'Dinner', servings: 4, source: 'auto', day: 'Monday' }] });
  });

  it('does not re-surface a week review once it has been dismissed', async () => {
    const { loadPlanState, dismissWeekReview, persistPrefs, defaultPrefs } = await import('../../public/js/lib/planner-store.js');
    const staleWeek = { version: 2, weekOf: '2020-01-06', days: { Monday: [{ recipeId: 9, slot: 'Dinner', servings: 4, source: 'manual' }], Tuesday: [], Wednesday: [], Thursday: [], Friday: [], Saturday: [], Sunday: [] } };
    store.set('recipeBookPlanner.v2', JSON.stringify(staleWeek));
    persistPrefs(dismissWeekReview(defaultPrefs(), '2020-01-06'));

    const { weekReview } = loadPlanState({ defaultServings: 4 });
    expect(weekReview).toBeNull();
  });

  it('falls back to an in-memory plan and reports storageAvailable:false when localStorage throws', async () => {
    globalThis.localStorage = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
      removeItem: () => {},
    };
    const { loadPlanState } = await import('../../public/js/lib/planner-store.js');
    const { plan, storageAvailable } = loadPlanState({ defaultServings: 4 });
    expect(storageAvailable).toBe(false);
    expect(plan.days.Monday).toEqual([]);
  });

  it('persistPlan/persistPrefs round-trip through loadPlanState/loadPrefs', async () => {
    const { persistPlan, persistPrefs, loadPrefs, loadPlanState, defaultPlan, applyPrefEvent, defaultPrefs } = await import('../../public/js/lib/planner-store.js');
    const plan = defaultPlan('2026-09-14');
    plan.days.Monday = [{ recipeId: 1, slot: 'Breakfast', servings: 4, source: 'manual' }];
    expect(persistPlan(plan)).toBe(true);
    expect(persistPrefs(applyPrefEvent(defaultPrefs(), 1, 'manual', '2026-09-14'))).toBe(true);

    const loaded = loadPlanState({ defaultServings: 4 });
    expect(loaded.plan).toEqual(plan);
    expect(loadPrefs().recipes['1']).toMatchObject({ manual: 1 });
  });
});
