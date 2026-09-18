import { readConfig } from '../../_lib/env.js';
import { json, problem, readJson } from '../../_lib/http.js';
import { assertAllowedOrigin } from '../../_lib/origin.js';
import { createDb, DbError } from '../../_lib/db.js';
import { requireMember, checkWriteRate, initialCatalogueStatus } from '../../_lib/write-guard.js';
import { writeAudit } from '../../_lib/audit.js';
import { getCuisines } from '../../_lib/cuisines.js';
import { normalizeRecipeInput, deriveIngredientFlags } from '../../../public/js/shared/recipe-rules.js';

function resolveIngredients(rawIngredients) {
  if (!Array.isArray(rawIngredients)) return [];
  return rawIngredients.map((group) => ({
    group: String(group?.group || 'Ingredients').slice(0, 60),
    items: (Array.isArray(group?.items) ? group.items : []).map((item) => {
      const ingredient = item?.ingredient || {};
      if (ingredient.id != null) {
        return { ingredient: { id: Number(ingredient.id) }, quantity: item.quantity ?? null, unit: item.unit ?? null, preparation: item.preparation ?? null, is_optional: Boolean(item.is_optional), scales: item.scales !== false, original_text: item.original_text ?? null };
      }
      const name = String(ingredient.name || '').trim().toLowerCase();
      return {
        ingredient: {
          name,
          display_name: ingredient.display_name || ingredient.name,
          category: ingredient.category || 'other',
          flags: deriveIngredientFlags(name),
        },
        quantity: item.quantity ?? null,
        unit: item.unit ?? null,
        preparation: item.preparation ?? null,
        is_optional: Boolean(item.is_optional),
        scales: item.scales !== false,
        original_text: item.original_text ?? null,
      };
    }),
  }));
}

function ensureRequiredForCreate(value) {
  // On create, every NOT NULL column with no default must be present (Appendix A.14 closing note).
  value.tags = value.tags ?? [];
  value.meal_types = value.meal_types ?? [];
  return value;
}

export async function onRequestPost({ request, env }) {
  if (!assertAllowedOrigin(request)) return problem(403, 'origin_not_allowed', 'This request did not come from an allowed site.');

  let config;
  try {
    config = readConfig(env);
  } catch (err) {
    console.error(err);
    return problem(500, 'internal_error', 'Something went wrong. Please try again.');
  }

  let body;
  try {
    body = await readJson(request);
  } catch (err) {
    if (err.code === 'payload_too_large') return problem(413, 'payload_too_large', 'That request is too large.');
    return problem(400, 'invalid_json', 'That request was not valid.');
  }

  const db = createDb(config);
  const guard = await requireMember(request, config, db);
  if (guard.errorResponse) return guard.errorResponse;
  const { actor } = guard;
  const limited = await checkWriteRate(db, actor, config.WRITES_PER_USER_HOURLY);
  if (limited) return limited;

  let cuisines;
  try {
    cuisines = await getCuisines(db);
  } catch (err) {
    console.error(err);
    return problem(500, 'internal_error', 'Something went wrong. Please try again.');
  }

  // B.4 sends ingredients as a sibling of recipe, but normalizeRecipeInput's ingredient-count
  // check (shared with the client-side form) looks for it on the object it validates.
  // Phase 10: all J.1 nutrition fields are required to save, manual and AI recipes alike.
  const { ok, value, errors } = normalizeRecipeInput({ ...body.recipe, ingredients: body.ingredients }, { cuisines, mode: 'strict', requireNutrition: true });
  if (!ok) return problem(400, 'validation_failed', 'Please fix the highlighted fields.', { errors });
  ensureRequiredForCreate(value);

  const ingredients = resolveIngredients(body.ingredients);

  let created;
  try {
    const { data } = await db.request('rpc/save_household_recipe', {
      method: 'POST',
      body: {
        p_id: null, p_expected_updated_at: null, p_recipe: value, p_ingredients: ingredients,
        p_household_id: actor.householdId, p_catalogue_status: initialCatalogueStatus(actor),
      },
    });
    created = data;
  } catch (err) {
    if (err instanceof DbError) {
      if (err.code === '23505') {
        const slugMatch = await findExistingBySlug(db, value.name);
        return problem(409, 'duplicate_recipe', `You already have ${slugMatch?.name || 'a recipe with this name'}.`, { existing: slugMatch });
      }
      if (err.code === '23502' || err.code === '23514') {
        console.error('Validation gap: server accepted input the database rejected.', err);
        return problem(400, 'validation_failed', 'Please check the recipe fields and try again.', { errors: {} });
      }
    }
    console.error(err);
    return problem(500, 'internal_error', 'Something went wrong. Please try again.');
  }

  try {
    await writeAudit(db, { recipeId: created.id, action: 'create', source: body.source === 'ai' ? 'ai' : 'manual', ipHash: actor.ipHash, actorUserId: actor.userId, before: null, after: created });
  } catch (err) {
    console.error('Audit write failed after a successful save:', err);
  }

  if (body.source === 'ai' && typeof body.generationId === 'string' && /^[0-9a-f-]{36}$/i.test(body.generationId)) {
    try {
      // Scoped to the saver's household, so nobody can claim another household's generation.
      await db.request(`recipe_generations?id=eq.${encodeURIComponent(body.generationId)}&household_id=eq.${actor.householdId}`, {
        method: 'PATCH',
        body: { saved_recipe_id: created.id, outcome: 'saved' },
      });
    } catch (err) {
      console.error('Failed to link generation to saved recipe:', err);
    }
  }

  return json(201, { recipe: created });
}

async function findExistingBySlug(db, name) {
  const slug = String(name || '').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase().replace(/^-+|-+$/g, '');
  try {
    const { data } = await db.request(`recipes?select=id,name&slug=eq.${encodeURIComponent(slug)}&is_deleted=eq.false&limit=1`);
    return data?.[0] || null;
  } catch {
    return null;
  }
}
