import { readConfig } from '../../_lib/env.js';
import { json, problem, readJson } from '../../_lib/http.js';
import { assertAllowedOrigin } from '../../_lib/origin.js';
import { createDb } from '../../_lib/db.js';
import { verifyTurnstile } from '../../_lib/turnstile.js';
import { clientIp, hashIp } from '../../_lib/ip.js';
import { getCuisines } from '../../_lib/cuisines.js';
import { getKnownIngredients } from '../../_lib/ingredient-usage.js';
import { buildRecipeDraftSchema } from '../../_lib/ai/schema.js';
import { buildMessages, RUNTIME_UNITS, RUNTIME_CATEGORIES } from '../../_lib/ai/prompt.js';
import { generateDraft } from '../../_lib/ai/index.js';
import { evaluateDraft } from '../../_lib/ai/evaluate-draft.js';
import { computeEffectiveGoal } from '../../_lib/ai/protein-goal.js';
import { MEAL_TYPES } from '../../../public/js/shared/recipe-rules.js';
import { todayStartUtcIso, nextMidnightUtcIso } from '../../_lib/ai/daily-window.js';

const CONSTRAINT_KEYS = ['serves', 'vegetarian', 'eggFree', 'dairyFree', 'maxTotalMinutes'];
const GOALS = ['auto', 'protein_smart', 'balanced'];

function validateBody(body) {
  const errors = {};
  const prompt = String(body?.prompt ?? '').trim();
  if (prompt.length < 3 || prompt.length > 400) errors.prompt = 'prompt must be 3-400 characters.';

  const constraints = {};
  const rawConstraints = body?.constraints;
  if (rawConstraints !== undefined) {
    if (typeof rawConstraints !== 'object' || rawConstraints === null || Array.isArray(rawConstraints)) {
      errors.constraints = 'constraints must be an object.';
    } else {
      for (const key of Object.keys(rawConstraints)) {
        if (!CONSTRAINT_KEYS.includes(key)) errors.constraints = `Unknown constraint "${key}".`;
      }
      if (rawConstraints.serves !== undefined) {
        const serves = Number(rawConstraints.serves);
        if (!Number.isInteger(serves) || serves < 1 || serves > 12) errors.constraints = 'serves must be an integer from 1 to 12.';
        else constraints.serves = serves;
      }
      for (const boolKey of ['vegetarian', 'eggFree', 'dairyFree']) {
        if (rawConstraints[boolKey] !== undefined) {
          if (typeof rawConstraints[boolKey] !== 'boolean') errors.constraints = `${boolKey} must be true or false.`;
          else constraints[boolKey] = rawConstraints[boolKey];
        }
      }
      if (rawConstraints.maxTotalMinutes !== undefined) {
        const minutes = Number(rawConstraints.maxTotalMinutes);
        if (!Number.isFinite(minutes) || minutes < 5 || minutes > 480) errors.constraints = 'maxTotalMinutes must be from 5 to 480.';
        else constraints.maxTotalMinutes = minutes;
      }
    }
  }

  const goal = body?.goal ?? 'auto';
  if (!GOALS.includes(goal)) errors.goal = 'goal must be auto, protein_smart or balanced.';

  const mealType = body?.mealType;
  if (mealType !== undefined && !MEAL_TYPES.includes(mealType)) errors.mealType = 'mealType must be a known meal type.';

  const force = Boolean(body?.force);

  return { ok: Object.keys(errors).length === 0, errors, prompt, constraints, goal, mealType, force };
}

async function findExistingBySlug(db, slug) {
  try {
    const { data } = await db.request(`recipes?select=id,name&slug=eq.${encodeURIComponent(slug)}&is_deleted=eq.false&limit=1`);
    return data?.[0] || null;
  } catch (err) {
    console.error('Name-collision lookup failed (continuing without it):', err);
    return null;
  }
}

/** Last 20 saved AI recipes' protein_smart flags, or every generated draft's when fewer than 5 are saved (J.3). */
async function fetchRecentProteinSmartRecords(db) {
  const { data: saved } = await db.request('recipe_generations?select=protein_smart&kind=eq.recipe&outcome=eq.saved&protein_smart=not.is.null&order=created_at.desc&limit=20');
  const savedRecords = saved || [];
  if (savedRecords.length >= 5) return savedRecords;
  const { data: allGenerated } = await db.request('recipe_generations?select=protein_smart&kind=eq.recipe&protein_smart=not.is.null&order=created_at.desc&limit=20');
  return allGenerated || [];
}

/** @returns {Promise<string|null>} the inserted row's id, or null if the insert failed. */
async function logGeneration(db, row) {
  try {
    const { data } = await db.request('recipe_generations', { method: 'POST', body: row, prefer: 'return=representation' });
    return data?.[0]?.id ?? null;
  } catch (err) {
    console.error('Failed to log a recipe_generations row (continuing):', err);
    return null;
  }
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

  if (!validation.force) {
    let matches = [];
    try {
      const { data } = await db.request('rpc/similar_recipes', { method: 'POST', body: { q: validation.prompt, lim: 3 } });
      matches = (data || []).filter((m) => m.score >= 0.6);
    } catch (err) {
      console.error('similar_recipes lookup failed (continuing without a duplicate check):', err);
    }
    if (matches.length > 0) return problem(409, 'similar_exists', 'A similar recipe already exists.', { matches });
  }

  let cuisines;
  try {
    cuisines = await getCuisines(db);
  } catch (err) {
    console.error(err);
    return problem(500, 'internal_error', 'Something went wrong. Please try again.');
  }

  const recentRecords = await fetchRecentProteinSmartRecords(db);
  const { effectiveGoal: requestedEffectiveGoal, goalAdjusted } = computeEffectiveGoal(validation.goal, recentRecords);

  const knownIngredients = await getKnownIngredients(db).catch((err) => {
    console.error('ingredient_usage lookup failed (continuing with an empty list):', err);
    return [];
  });

  const schema = buildRecipeDraftSchema({ cuisines, units: RUNTIME_UNITS, categories: RUNTIME_CATEGORIES });
  const baseParams = { prompt: validation.prompt, constraints: validation.constraints, effectiveGoal: requestedEffectiveGoal, mealType: validation.mealType, knownIngredients };

  let evaluationForRetryCheck = null;
  const generation = await generateDraft(env, {
    buildMessages: (opts) => buildMessages({ ...baseParams, ...opts }),
    schema,
    getRetryFeedback: async (draft) => {
      if (!draft || draft.request_ok === false) return null;
      evaluationForRetryCheck = await evaluateDraft(db, draft, {
        constraints: validation.constraints,
        effectiveGoal: requestedEffectiveGoal,
        findExistingBySlug: (slug) => findExistingBySlug(db, slug),
      });
      return evaluationForRetryCheck.hardFailure ? null : evaluationForRetryCheck.retryFeedback;
    },
  });

  if (!generation.ok) {
    for (const attempt of generation.attempts) {
      await logGeneration(db, {
        prompt: validation.prompt, constraints: validation.constraints, provider: attempt.provider, model: attempt.model,
        kind: 'recipe', goal: validation.goal, effective_goal: requestedEffectiveGoal, protein_smart: null, outcome: 'error',
        draft: attempt.raw || null, warnings: [], error: attempt.error || null,
        input_tokens: attempt.usage?.inputTokens ?? null, output_tokens: attempt.usage?.outputTokens ?? null, est_neurons: attempt.usage?.estNeurons ?? null,
        ip_hash: ipHash,
      });
    }
    if (generation.unavailable) {
      return problem(503, 'generation_unavailable', 'Recipe generation is unavailable right now. Add the recipe by hand, or try again after midnight UTC.');
    }
    return problem(502, 'invalid_output', 'The model did not return a usable recipe. Please try again.');
  }

  const draft = generation.raw;
  const finalAttempt = generation.attempts[generation.attempts.length - 1];

  if (draft.request_ok === false) {
    for (const attempt of generation.attempts) {
      await logGeneration(db, {
        prompt: validation.prompt, constraints: validation.constraints, provider: attempt.provider, model: attempt.model,
        kind: 'recipe', goal: validation.goal, effective_goal: requestedEffectiveGoal, protein_smart: null,
        outcome: attempt.ok ? 'refused' : 'error', draft: attempt.raw || null, warnings: [], error: attempt.error || null,
        input_tokens: attempt.usage?.inputTokens ?? null, output_tokens: attempt.usage?.outputTokens ?? null, est_neurons: attempt.usage?.estNeurons ?? null,
        ip_hash: ipHash,
      });
    }
    return problem(422, 'not_a_recipe', draft.refusal_reason || "That doesn't look like a food or drink request.");
  }

  // The evaluation from inside getRetryFeedback covers attempt 1's draft; if a retry happened, or
  // no retry was ever triggered, evaluate whichever draft is actually being used one more time.
  const usedRetry = generation.attempts.length === 2;
  const finalEvaluation = (!usedRetry && evaluationForRetryCheck) || await evaluateDraft(db, draft, {
    constraints: validation.constraints,
    effectiveGoal: requestedEffectiveGoal,
    findExistingBySlug: (slug) => findExistingBySlug(db, slug),
  });

  if (finalEvaluation.hardFailure) {
    for (const attempt of generation.attempts) {
      await logGeneration(db, {
        prompt: validation.prompt, constraints: validation.constraints, provider: attempt.provider, model: attempt.model,
        kind: 'recipe', goal: validation.goal, effective_goal: requestedEffectiveGoal, protein_smart: null,
        outcome: attempt.ok ? 'invalid' : 'error', draft: attempt.raw || null, warnings: [], error: attempt.error || null,
        input_tokens: attempt.usage?.inputTokens ?? null, output_tokens: attempt.usage?.outputTokens ?? null, est_neurons: attempt.usage?.estNeurons ?? null,
        ip_hash: ipHash,
      });
    }
    return problem(502, 'invalid_output', `The model's recipe was missing required content (${finalEvaluation.hardFailure}). Please try again.`);
  }

  // The household hard rule and missing nutrition are "second failure -> invalid" (v2); a
  // still-unmet protein goal after the retry budget is spent downgrades to a warning instead.
  if (finalEvaluation.householdIssues.length > 0 || finalEvaluation.nutritionIssues.length > 0) {
    for (const attempt of generation.attempts) {
      await logGeneration(db, {
        prompt: validation.prompt, constraints: validation.constraints, provider: attempt.provider, model: attempt.model,
        kind: 'recipe', goal: validation.goal, effective_goal: requestedEffectiveGoal, protein_smart: null,
        outcome: attempt.ok ? 'invalid' : 'error', draft: attempt.raw || null, warnings: [], error: attempt.error || null,
        input_tokens: attempt.usage?.inputTokens ?? null, output_tokens: attempt.usage?.outputTokens ?? null, est_neurons: attempt.usage?.estNeurons ?? null,
        ip_hash: ipHash,
      });
    }
    return problem(502, 'invalid_output', 'The recipe still did not meet the household’s dietary rules or was missing nutrition after one retry. Please try again.');
  }

  const warnings = [...finalEvaluation.warnings];
  let effectiveGoal = requestedEffectiveGoal;
  if (finalEvaluation.goalIssue) {
    warnings.push({ field: 'protein_g', code: 'goal_not_met', message: 'This recipe could not be made protein-smart within the retry budget; treated as balanced.' });
    effectiveGoal = 'balanced';
  }

  let generationId = null;
  for (const attempt of generation.attempts) {
    const isFinal = attempt === finalAttempt;
    const id = await logGeneration(db, {
      prompt: validation.prompt, constraints: validation.constraints, provider: attempt.provider, model: attempt.model,
      kind: 'recipe', goal: validation.goal, effective_goal: effectiveGoal, protein_smart: isFinal ? finalEvaluation.proteinSmart : null,
      // A non-final attempt that parsed fine was superseded by a content-validation retry (not a
      // parse failure, which generateDraft would already have marked ok:false) — 'invalid', not
      // 'generated', since its content is what triggered the retry.
      outcome: isFinal ? 'generated' : (attempt.ok ? 'invalid' : 'error'),
      draft: attempt.raw || null, warnings: isFinal ? warnings : [], error: attempt.error || null,
      input_tokens: attempt.usage?.inputTokens ?? null, output_tokens: attempt.usage?.outputTokens ?? null, est_neurons: attempt.usage?.estNeurons ?? null,
      ip_hash: ipHash,
    });
    if (isFinal) generationId = id;
  }

  return json(200, {
    generationId,
    draft: {
      ...draft,
      ingredients: finalEvaluation.resolvedIngredients.map((g) => ({
        group: g.group,
        items: g.items.map((item) => ({
          ingredient: item.ingredient,
          quantity: item.quantity,
          unit: item.unit,
          preparation: item.preparation,
          is_optional: item.is_optional,
        })),
      })),
    },
    warnings,
    effectiveGoal,
    goalAdjusted,
    proteinSmart: finalEvaluation.proteinSmart,
    usage: { provider: finalAttempt.provider, model: finalAttempt.model, inputTokens: finalAttempt.usage.inputTokens, outputTokens: finalAttempt.usage.outputTokens, estNeurons: finalAttempt.usage.estNeurons },
  });
}
