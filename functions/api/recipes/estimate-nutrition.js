import { readConfig } from '../../_lib/env.js';
import { json, problem, readJson } from '../../_lib/http.js';
import { assertAllowedOrigin } from '../../_lib/origin.js';
import { createDb } from '../../_lib/db.js';
import { verifyTurnstile } from '../../_lib/turnstile.js';
import { clientIp, hashIp } from '../../_lib/ip.js';
import { generateDraft } from '../../_lib/ai/index.js';
import { buildNutritionSchema } from '../../_lib/ai/schema.js';
import { buildNutritionMessages, formatIngredientLine } from '../../_lib/ai/nutrition-prompt.js';
import { todayStartUtcIso, nextMidnightUtcIso } from '../../_lib/ai/daily-window.js';

const NUTRITION_FIELDS = ['calories_kcal', 'protein_g', 'carbs_g', 'sugars_g', 'fibre_g', 'fat_g', 'saturates_g', 'salt_g'];

function validateBody(body) {
  const errors = {};
  const name = String(body?.name ?? '').trim();
  if (!name) errors.name = 'name is required.';

  const serves = Number(body?.serves);
  if (!Number.isInteger(serves) || serves < 1 || serves > 50) errors.serves = 'serves must be an integer from 1 to 50.';

  const ingredients = Array.isArray(body?.ingredients) ? body.ingredients : null;
  if (!ingredients || ingredients.length === 0 || !ingredients.some((g) => Array.isArray(g?.items) && g.items.length)) {
    errors.ingredients = 'Add at least one ingredient.';
  }

  return { ok: Object.keys(errors).length === 0, errors, name, serves, ingredients: ingredients || [] };
}

async function resolveIngredientNames(db, ingredientGroups) {
  const ids = ingredientGroups.flatMap((g) => (g.items || []).map((item) => item.ingredient?.id).filter((id) => id != null));
  const nameById = new Map();
  if (ids.length > 0) {
    const { data } = await db.request(`ingredients?select=id,display_name,name&id=in.(${[...new Set(ids)].join(',')})`);
    for (const row of data || []) nameById.set(row.id, row.display_name || row.name);
  }
  return ingredientGroups.flatMap((g) => (g.items || []).map((item) => {
    const name = item.ingredient?.name || nameById.get(item.ingredient?.id) || 'ingredient';
    return formatIngredientLine(item, name);
  }));
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

  const validation = validateBody(body);
  if (!validation.ok) return problem(400, 'validation_failed', 'Please fix the highlighted fields.', { errors: validation.errors });

  const ip = clientIp(request);
  const ipHash = await hashIp(ip, config.IP_HASH_SALT);
  const turnstileResult = await verifyTurnstile(body.turnstileToken, ip, config.TURNSTILE_SECRET_KEY);
  if (!turnstileResult.ok) return problem(403, 'verification_failed', "We couldn't confirm you're not a bot. Try saving again.");

  const db = createDb(config);
  const since = todayStartUtcIso();

  let globalCount;
  let ipCount;
  try {
    [globalCount, ipCount] = await Promise.all([
      db.count('recipe_generations', `created_at=gte.${encodeURIComponent(since)}`),
      db.count('recipe_generations', `ip_hash=eq.${encodeURIComponent(ipHash)}&created_at=gte.${encodeURIComponent(since)}`),
    ]);
  } catch (err) {
    console.error(err);
    return problem(500, 'internal_error', 'Something went wrong. Please try again.');
  }
  if (globalCount >= config.GEN_GLOBAL_DAILY) return json(429, { code: 'generation_limit', scope: 'site', resetsAt: nextMidnightUtcIso() });
  if (ipCount >= config.GEN_PER_IP_DAILY) return json(429, { code: 'generation_limit', scope: 'you', resetsAt: nextMidnightUtcIso() });

  const ingredientLines = await resolveIngredientNames(db, validation.ingredients);
  const schema = buildNutritionSchema();
  const generation = await generateDraft(env, {
    buildMessages: () => buildNutritionMessages({ name: validation.name, serves: validation.serves, ingredientLines }),
    schema,
  });

  try {
    await db.request('recipe_generations', {
      method: 'POST',
      body: {
        prompt: validation.name.slice(0, 400).padEnd(3, '.'), constraints: { serves: validation.serves }, provider: generation.attempts.at(-1)?.provider || 'workers-ai',
        model: generation.attempts.at(-1)?.model || config.AI_MODEL, kind: 'nutrition', outcome: generation.ok ? 'generated' : 'error',
        draft: generation.ok ? generation.raw : null, warnings: [], error: generation.ok ? null : 'generation failed',
        input_tokens: generation.attempts.at(-1)?.usage?.inputTokens ?? null, output_tokens: generation.attempts.at(-1)?.usage?.outputTokens ?? null,
        est_neurons: generation.attempts.at(-1)?.usage?.estNeurons ?? null, ip_hash: ipHash,
      },
    });
  } catch (err) {
    console.error('Failed to log a recipe_generations row (continuing):', err);
  }

  if (!generation.ok) {
    if (generation.unavailable) return problem(503, 'generation_unavailable', 'Nutrition estimation is unavailable right now. Add the values by hand, or try again after midnight UTC.');
    return problem(502, 'invalid_output', 'The model did not return usable nutrition values. Please try again.');
  }

  const nutrition = generation.raw;
  const missing = NUTRITION_FIELDS.filter((field) => nutrition[field] === null || nutrition[field] === undefined);
  if (missing.length > 0) return problem(502, 'invalid_output', `The model's nutrition estimate was missing ${missing.join(', ')}. Please try again.`);

  const warnings = [];
  const kcalCalc = 4 * nutrition.protein_g + 4 * nutrition.carbs_g + 9 * nutrition.fat_g + 2 * nutrition.fibre_g;
  if (nutrition.calories_kcal && Math.abs(nutrition.calories_kcal - kcalCalc) / nutrition.calories_kcal > 0.2) {
    warnings.push({ field: 'calories_kcal', code: 'nutrition_inconsistent', message: 'calories don’t match 4×protein + 4×carbs + 9×fat + 2×fibre within 20%.' });
  }

  return json(200, { nutrition, warnings });
}
