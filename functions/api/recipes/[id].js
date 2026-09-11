import { readConfig } from '../../_lib/env.js';
import { json, problem, readJson } from '../../_lib/http.js';
import { assertAllowedOrigin } from '../../_lib/origin.js';
import { createDb, DbError } from '../../_lib/db.js';
import { verifyTurnstile } from '../../_lib/turnstile.js';
import { clientIp, hashIp } from '../../_lib/ip.js';
import { countSince } from '../../_lib/ratelimit.js';
import { writeAudit } from '../../_lib/audit.js';
import { getCuisines } from '../../_lib/cuisines.js';
import { normalizeRecipeInput, deriveIngredientFlags } from '../../../public/js/shared/recipe-rules.js';

const ONE_HOUR_MS = 60 * 60 * 1000;
const ID_RE = /^[1-9][0-9]{0,9}$/;

function resolveIngredients(rawIngredients) {
  if (!Array.isArray(rawIngredients)) return null;
  return rawIngredients.map((group) => ({
    group: String(group?.group || 'Ingredients').slice(0, 60),
    items: (Array.isArray(group?.items) ? group.items : []).map((item) => {
      const ingredient = item?.ingredient || {};
      if (ingredient.id != null) {
        return { ingredient: { id: Number(ingredient.id) }, quantity: item.quantity ?? null, unit: item.unit ?? null, preparation: item.preparation ?? null, is_optional: Boolean(item.is_optional), scales: item.scales !== false, original_text: item.original_text ?? null };
      }
      const name = String(ingredient.name || '').trim().toLowerCase();
      return {
        ingredient: { name, display_name: ingredient.display_name || ingredient.name, category: ingredient.category || 'other', flags: deriveIngredientFlags(name) },
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

async function commonPreamble(request, env) {
  if (!assertAllowedOrigin(request)) return { errorResponse: problem(403, 'origin_not_allowed', 'This request did not come from an allowed site.') };

  let config;
  try {
    config = readConfig(env);
  } catch (err) {
    console.error(err);
    return { errorResponse: problem(500, 'internal_error', 'Something went wrong. Please try again.') };
  }

  let body;
  try {
    body = await readJson(request);
  } catch (err) {
    if (err.code === 'payload_too_large') return { errorResponse: problem(413, 'payload_too_large', 'That request is too large.') };
    return { errorResponse: problem(400, 'invalid_json', 'That request was not valid.') };
  }

  const ip = clientIp(request);
  const ipHash = await hashIp(ip, config.IP_HASH_SALT);
  const turnstileResult = await verifyTurnstile(body.turnstileToken, ip, config.TURNSTILE_SECRET_KEY);
  if (!turnstileResult.ok) return { errorResponse: problem(403, 'verification_failed', "We couldn't confirm you're not a bot. Try saving again.") };

  const db = createDb(config);

  let recentWrites;
  try {
    recentWrites = await countSince(db, 'recipe_audit_log', 'actor_ip_hash', ipHash, new Date(Date.now() - ONE_HOUR_MS).toISOString());
  } catch (err) {
    console.error(err);
    return { errorResponse: problem(500, 'internal_error', 'Something went wrong. Please try again.') };
  }
  if (recentWrites >= config.WRITES_PER_IP_HOURLY) {
    return {
      errorResponse: new Response(JSON.stringify({ code: 'rate_limited', message: 'Too many changes from your network. Try again later.' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Retry-After': '3600' },
      }),
    };
  }

  return { config, body, db, ipHash };
}

export async function onRequestPatch({ request, env, params }) {
  const id = params.id;
  if (!ID_RE.test(id)) return problem(404, 'not_found', 'This recipe could not be found.');

  const pre = await commonPreamble(request, env);
  if (pre.errorResponse) return pre.errorResponse;
  const { body, db, ipHash } = pre;

  if (typeof body.expectedUpdatedAt !== 'string' || !body.expectedUpdatedAt) {
    return problem(400, 'invalid_request', 'Missing expectedUpdatedAt.');
  }

  let before;
  try {
    const { data } = await db.request(`recipes?select=*&id=eq.${id}&is_deleted=eq.false&limit=1`);
    before = data?.[0] || null;
  } catch (err) {
    console.error(err);
    return problem(500, 'internal_error', 'Something went wrong. Please try again.');
  }
  if (!before) return problem(404, 'not_found', 'This recipe could not be found.');

  const cuisines = await getCuisines(db);
  // See index.js: B.4 sends ingredients as a sibling of recipe, not nested inside it.
  const { ok, value, errors } = normalizeRecipeInput({ ...body.recipe, ingredients: body.ingredients }, { cuisines, mode: 'strict', partial: true });
  if (!ok) return problem(400, 'validation_failed', 'Please fix the highlighted fields.', { errors });

  const ingredients = resolveIngredients(body.ingredients);

  let updated;
  try {
    const { data } = await db.request('rpc/save_recipe', {
      method: 'POST',
      body: { p_id: Number(id), p_expected_updated_at: body.expectedUpdatedAt, p_recipe: value, p_ingredients: ingredients },
    });
    updated = data;
  } catch (err) {
    if (err instanceof DbError) {
      if (err.message === 'edit_conflict' || err.code === 'PT409') {
        const { data: current } = await db.request(`recipes?select=*&id=eq.${id}&limit=1`);
        return problem(409, 'edit_conflict', 'This recipe changed since you opened it.', { current: current?.[0] });
      }
      if (err.message === 'not_found' || err.code === 'PT404') {
        return problem(404, 'not_found', 'This recipe could not be found.');
      }
      if (err.message === 'dietary_mismatch' || err.code === 'PT400') {
        const evidence = safeParseDetail(err.details);
        const errorsOut = {};
        for (const [field, names] of Object.entries(evidence || {})) {
          if (Array.isArray(names) && names.length > 0) {
            errorsOut[field] = `Ingredients include ${names[0]}, so this can't be right.`;
          }
        }
        return problem(400, 'validation_failed', 'The dietary answers don’t match the ingredients.', { errors: errorsOut });
      }
      if (err.code === '23505') {
        return problem(409, 'duplicate_recipe', 'Another recipe already has this name.', { existing: null });
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
    await writeAudit(db, { recipeId: Number(id), action: 'update', source: body.source === 'ai' ? 'ai' : 'manual', ipHash, before, after: updated });
  } catch (err) {
    console.error('Audit write failed after a successful save:', err);
  }

  return json(200, { recipe: updated });
}

export async function onRequestDelete({ request, env, params }) {
  const id = params.id;
  if (!ID_RE.test(id)) return problem(404, 'not_found', 'This recipe could not be found.');

  const pre = await commonPreamble(request, env);
  if (pre.errorResponse) return pre.errorResponse;
  const { db, ipHash } = pre;

  let before;
  try {
    const { data } = await db.request(`recipes?select=*&id=eq.${id}&is_deleted=eq.false&limit=1`);
    before = data?.[0] || null;
  } catch (err) {
    console.error(err);
    return problem(500, 'internal_error', 'Something went wrong. Please try again.');
  }
  if (!before) return problem(404, 'not_found', 'This recipe could not be found.');

  const deletedAt = new Date().toISOString();
  try {
    await db.request(`recipes?id=eq.${id}&is_deleted=eq.false`, {
      method: 'PATCH',
      body: { is_deleted: true, deleted_at: deletedAt },
    });
  } catch (err) {
    console.error(err);
    return problem(500, 'internal_error', 'Something went wrong. Please try again.');
  }

  try {
    await writeAudit(db, { recipeId: Number(id), action: 'delete', ipHash, before, after: null });
  } catch (err) {
    console.error('Audit write failed after a successful delete:', err);
  }

  return json(200, { id: Number(id), deletedAt });
}

function safeParseDetail(details) {
  try {
    return JSON.parse(details);
  } catch {
    return {};
  }
}
