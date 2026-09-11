import { describe, expect, it, vi } from 'vitest';
import { resolveIngredients } from '../../functions/_lib/ai/ingredient-resolution.js';

function fakeDb({ byName = [], byAlias = [], matchIngredient = () => [] } = {}) {
  const calls = [];
  return {
    calls,
    request: vi.fn(async (path, opts) => {
      calls.push({ path, opts });
      if (path.startsWith('ingredients?')) return { data: byName };
      if (path.startsWith('ingredient_aliases?')) return { data: byAlias };
      if (path === 'rpc/match_ingredient') return { data: matchIngredient(opts.body.q) };
      throw new Error(`unexpected path: ${path}`);
    }),
  };
}

describe('resolveIngredients', () => {
  it('resolves an exact name match to {id, name}', async () => {
    const db = fakeDb({ byName: [{ id: 31, name: 'whole wheat flour' }] });
    const { groups } = await resolveIngredients(db, [{ group: 'Dough', items: [{ name: 'Whole Wheat Flour', category: 'grain_whole', quantity: 1, unit: 'cup', preparation: '', optional: false }] }]);
    expect(groups[0].items[0].ingredient).toEqual({ id: 31, name: 'whole wheat flour' });
  });

  it('resolves an alias match when no exact name matches', async () => {
    const db = fakeDb({ byAlias: [{ alias: 'aubergine', ingredient: { id: 9, name: 'eggplant' } }] });
    const { groups } = await resolveIngredients(db, [{ group: 'G', items: [{ name: 'aubergine', category: 'vegetable', quantity: 1, unit: 'piece', preparation: '', optional: false }] }]);
    expect(groups[0].items[0].ingredient).toEqual({ id: 9, name: 'eggplant' });
  });

  it('falls back to trigram match_ingredient at >= 0.6, ignoring a lower score', async () => {
    const db = fakeDb({ matchIngredient: (q) => (q === 'panner' ? [{ id: 5, name: 'paneer', score: 0.7 }] : []) });
    const { groups } = await resolveIngredients(db, [{ group: 'G', items: [{ name: 'panner', category: 'dairy', quantity: 1, unit: 'cup', preparation: '', optional: false }] }]);
    expect(groups[0].items[0].ingredient).toEqual({ id: 5, name: 'paneer' });
  });

  it('treats a trigram score under 0.6 as unresolved (new ingredient)', async () => {
    const db = fakeDb({ matchIngredient: () => [{ id: 5, name: 'something-else', score: 0.4 }] });
    const { groups } = await resolveIngredients(db, [{ group: 'G', items: [{ name: 'mystery item', category: 'other', quantity: 1, unit: 'cup', preparation: '', optional: false }] }]);
    expect(groups[0].items[0].ingredient.isNew).toBe(true);
  });

  it('builds a new-ingredient entry with derived flags for a genuinely unresolved name', async () => {
    const db = fakeDb();
    const { groups } = await resolveIngredients(db, [{ group: 'G', items: [{ name: 'kasuri methi', category: 'herb', quantity: 1, unit: 'tsp', preparation: 'crushed', optional: false }] }]);
    expect(groups[0].items[0].ingredient).toEqual({
      name: 'kasuri methi', isNew: true, category: 'herb',
      flags: { contains_meat: false, contains_egg: false, contains_dairy: false, contains_nuts: false, contains_gluten: false },
    });
    expect(groups[0].items[0].preparation).toBe('crushed');
    expect(groups[0].items[0].is_optional).toBe(false);
  });

  it('derives contains_meat:true for a new ingredient whose name says so', async () => {
    const db = fakeDb();
    const { groups } = await resolveIngredients(db, [{ group: 'G', items: [{ name: 'chicken stock', category: 'condiment', quantity: 1, unit: 'cup', preparation: '', optional: false }] }]);
    expect(groups[0].items[0].ingredient.flags.contains_meat).toBe(true);
  });

  it('maps units through resolveDraftUnit and surfaces a warning for grams', async () => {
    const db = fakeDb({ byName: [{ id: 1, name: 'rice' }] });
    const { groups, warnings } = await resolveIngredients(db, [{ group: 'G', items: [{ name: 'rice', category: 'grain_whole', quantity: 200, unit: 'g', preparation: '', optional: false }] }]);
    expect(groups[0].items[0]).toMatchObject({ quantity: 200, unit: 'g' });
    expect(warnings).toEqual([{ code: 'non_cup_unit', field: 'rice' }]);
  });

  it('does nothing and makes no request for an empty ingredient list', async () => {
    const db = fakeDb();
    const { groups } = await resolveIngredients(db, []);
    expect(groups).toEqual([]);
    expect(db.request).not.toHaveBeenCalled();
  });
});
