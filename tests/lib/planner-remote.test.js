import { describe, expect, it, vi } from 'vitest';
import { createPlanSync, fetchRemotePlan, uploadPlan } from '../../public/js/lib/planner-remote.js';
import { DEFAULT_AUTO_SLOTS } from '../../public/js/lib/planner-store.js';

const HOUSEHOLD = 'household-1';
const USER = 'user-1';

/** A Supabase-shaped stub: records queries, answers plan_weeks/plan_prefs reads and upserts. */
function fakeClient({ weeks = [], prefs = null, error = null } = {}) {
  const upserts = [];
  const client = {
    upserts,
    from(table) {
      const builder = {
        table,
        select() { return builder; },
        eq() { return builder; },
        gte() { return builder; },
        maybeSingle() { return Promise.resolve({ data: prefs ? { prefs } : null, error }); },
        upsert(rows, options) {
          upserts.push({ table, rows, options });
          return Promise.resolve({ error });
        },
        then(resolve) { return Promise.resolve({ data: weeks, error }).then(resolve); },
      };
      return builder;
    },
  };
  return client;
}

describe('fetchRemotePlan', () => {
  it('turns the household rows into the same store shape the browser uses', async () => {
    const days = { Monday: [{ recipeId: 7, slot: 'Dinner', servings: 4, source: 'manual' }] };
    const result = await fetchRemotePlan(fakeClient({ weeks: [{ week_of: '2026-09-21', days }], prefs: { version: 1, recipes: { 7: { loved: 1 } } } }), HOUSEHOLD);
    expect(result.ok).toBe(true);
    expect(result.isEmpty).toBe(false);
    expect(result.store.weeks['2026-09-21'].days).toEqual(days);
    expect(result.prefs.recipes[7].loved).toBe(1);
    expect(result.prefs.settings.autoSlots).toEqual(DEFAULT_AUTO_SLOTS);
  });

  it('reports an empty household so a first sign-in can adopt this browser\'s plan', async () => {
    const result = await fetchRemotePlan(fakeClient(), HOUSEHOLD);
    expect(result.ok).toBe(true);
    expect(result.isEmpty).toBe(true);
    expect(result.store.weeks).toEqual({});
  });

  it('reports failure rather than a false empty plan, so nothing overwrites a real one', async () => {
    const result = await fetchRemotePlan(fakeClient({ error: { message: 'nope' } }), HOUSEHOLD);
    expect(result.ok).toBe(false);
  });
});

describe('uploadPlan', () => {
  it('writes one row per week plus the prefs row, all for this household', async () => {
    const client = fakeClient();
    const store = { version: 3, weeks: { '2026-09-14': { days: { Monday: [] } }, '2026-09-21': { days: { Tuesday: [] } } } };
    const ok = await uploadPlan(client, HOUSEHOLD, USER, store, { version: 1, recipes: {} });
    expect(ok).toBe(true);
    const weekWrite = client.upserts.find((write) => write.table === 'plan_weeks');
    expect(weekWrite.rows).toHaveLength(2);
    expect(weekWrite.rows.every((row) => row.household_id === HOUSEHOLD && row.updated_by === USER)).toBe(true);
    expect(client.upserts.some((write) => write.table === 'plan_prefs')).toBe(true);
  });

  it('still writes the prefs row for a plan with no weeks yet', async () => {
    const client = fakeClient();
    await uploadPlan(client, HOUSEHOLD, USER, { version: 3, weeks: {} }, { version: 1 });
    expect(client.upserts.map((write) => write.table)).toEqual(['plan_prefs']);
  });
});

describe('createPlanSync', () => {
  it('coalesces repeated edits to one write per week and one for prefs', async () => {
    vi.useFakeTimers();
    const client = fakeClient();
    const sync = createPlanSync({ client, householdId: HOUSEHOLD, userId: USER });
    sync.queueWeek('2026-09-21', { Monday: [] });
    sync.queueWeek('2026-09-21', { Monday: [{ recipeId: 1 }] });
    sync.queueWeek('2026-09-28', { Tuesday: [] });
    sync.queuePrefs({ version: 1 });
    expect(client.upserts).toHaveLength(0); // nothing sent while edits are still arriving
    await vi.runAllTimersAsync();
    expect(client.upserts).toHaveLength(3);
    const week = client.upserts.find((write) => write.rows.week_of === '2026-09-21');
    expect(week.rows.days).toEqual({ Monday: [{ recipeId: 1 }] }); // the last value wins
    vi.useRealTimers();
  });

  it('reports a failed save instead of failing silently', async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const sync = createPlanSync({ client: fakeClient({ error: { message: 'denied' } }), householdId: HOUSEHOLD, userId: USER, onError });
    sync.queueWeek('2026-09-21', {});
    await vi.runAllTimersAsync();
    expect(onError).toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe('prefs writes are serialised (M5)', () => {
  it('does not lose the first star when two are made in quick succession', async () => {
    const { setRemoteFavourite } = await import('../../public/js/lib/planner-remote.js');
    let stored = { version: 1, recipes: {} };
    const client = {
      from() {
        const builder = {
          select() { return builder; },
          eq() { return builder; },
          async maybeSingle() {
            // A real read sends what the row held when it was read, not when it arrives — which is
            // exactly how the second star used to overwrite the first.
            const snapshot = stored;
            await new Promise((resolve) => setTimeout(resolve, 10));
            return { data: { prefs: snapshot }, error: null };
          },
          upsert(row) {
            stored = row.prefs;
            return Promise.resolve({ error: null });
          },
        };
        return builder;
      },
    };
    await Promise.all([
      setRemoteFavourite(client, { householdId: 'h', userId: 'u', recipeId: 1, favourite: true }),
      setRemoteFavourite(client, { householdId: 'h', userId: 'u', recipeId: 2, favourite: true }),
    ]);
    expect(Object.keys(stored.recipes).sort()).toEqual(['1', '2']);
  });
});
