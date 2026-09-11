import { deriveIngredientFlags } from '../../../public/js/shared/recipe-rules.js';
import { resolveDraftUnit } from './units-mapping.js';

const TRIGRAM_THRESHOLD = 0.6;

function escapeForInList(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Resolves a draft's ingredient names against the database: exact name, then alias, then
 * `rpc/match_ingredient` (trigram >= 0.6). Unresolved names become new-ingredient rows with flags
 * derived from Appendix E keywords, and units are mapped/converted (units-mapping.js). Returns the
 * B.4 ingredient shape, ready for the generate response and for save_recipe if the draft is saved.
 * @param {{ request: (path: string, opts?: object) => Promise<{data: any}> }} db
 * @param {Array<{group: string, items: Array<{name: string, category: string, quantity: number|null, unit: string, preparation: string, optional: boolean}>}>} draftGroups
 * @returns {Promise<{ groups: Array, warnings: Array<{code: string, field: string}> }>}
 */
export async function resolveIngredients(db, draftGroups) {
  const allItems = (draftGroups || []).flatMap((g) => g.items || []);
  const names = [...new Set(allItems.map((item) => String(item.name || '').trim().toLowerCase()).filter(Boolean))];

  const resolvedByName = new Map();
  if (names.length > 0) {
    const inList = names.map(escapeForInList).join(',');
    const [byName, byAlias] = await Promise.all([
      db.request(`ingredients?select=id,name&name=in.(${inList})`),
      db.request(`ingredient_aliases?select=alias,ingredient:ingredients(id,name)&alias=in.(${inList})`),
    ]);
    for (const row of byName.data || []) resolvedByName.set(row.name, { id: row.id, name: row.name });
    for (const row of byAlias.data || []) {
      if (row.ingredient && !resolvedByName.has(row.alias)) resolvedByName.set(row.alias, { id: row.ingredient.id, name: row.ingredient.name });
    }

    const unresolved = names.filter((name) => !resolvedByName.has(name));
    await Promise.all(unresolved.map(async (name) => {
      const { data } = await db.request('rpc/match_ingredient', { method: 'POST', body: { q: name } });
      const best = (data || [])[0];
      if (best && best.score >= TRIGRAM_THRESHOLD) resolvedByName.set(name, { id: best.id, name: best.name });
    }));
  }

  const warnings = [];
  const groups = (draftGroups || []).map((group) => ({
    group: group.group,
    items: (group.items || []).map((item) => {
      const name = String(item.name || '').trim().toLowerCase();
      const match = resolvedByName.get(name);
      const ingredient = match
        ? { id: match.id, name: match.name }
        : { name, isNew: true, category: item.category, flags: deriveIngredientFlags(name) };

      const { quantity, unit, warning } = resolveDraftUnit(item.quantity, item.unit);
      if (warning) warnings.push({ code: warning, field: name });

      return {
        ingredient,
        quantity,
        unit,
        preparation: item.preparation || null,
        is_optional: Boolean(item.optional),
        // Carried alongside (not part of the B.4 shape recipe_ingredients writes) so the caller can
        // compute J.2's refined_carb_heavy without a second DB round trip for existing ingredients'
        // categories — the model already states one per item (D.1).
        category: item.category,
      };
    }),
  }));

  return { groups, warnings };
}
