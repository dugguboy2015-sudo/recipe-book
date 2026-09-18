import householdTemplate from '../../../config/household.json';
import { readConfig } from '../../_lib/env.js';
import { json, problem, readJson } from '../../_lib/http.js';
import { assertAllowedOrigin } from '../../_lib/origin.js';
import { createDb } from '../../_lib/db.js';
import { requireMember } from '../../_lib/write-guard.js';
import { getHouseholdSettings } from '../../_lib/household.js';
import { getCuisines } from '../../_lib/cuisines.js';
import { applySettingsUpdate } from '../../../public/js/shared/household-settings.js';

/**
 * PATCH /api/household/settings — the household owner edits the family-specific settings (diet,
 * servings, spice, cuisines, packed lunches). Members read settings directly through RLS; only this
 * Function writes them. Partial: fields left out keep their current value.
 */
export async function onRequestPatch({ request, env }) {
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
    body = await readJson(request, 8000);
  } catch (err) {
    if (err.code === 'payload_too_large') return problem(413, 'payload_too_large', 'That request is too large.');
    return problem(400, 'invalid_json', 'That request was not valid.');
  }

  const db = createDb(config);
  const guard = await requireMember(request, config, db);
  if (guard.errorResponse) return guard.errorResponse;
  const { actor } = guard;
  if (actor.role !== 'owner') return problem(403, 'owner_only', 'Only the household owner can change its settings.');

  let current;
  let cuisines;
  try {
    [current, cuisines] = await Promise.all([getHouseholdSettings(db, actor.householdId, householdTemplate), getCuisines(db)]);
  } catch (err) {
    console.error(err);
    return problem(500, 'internal_error', 'Something went wrong. Please try again.');
  }

  // Cuisines already in the settings stay valid even if they aren't catalogue cuisines
  // ("Continental" in the founding household's file), so re-saving never rejects them.
  const allowed = [...new Set([...cuisines, ...(current.favourite_cuisines || []), ...(current.exploring_cuisines || [])])];
  const result = applySettingsUpdate(current, body, { cuisines: allowed });
  if (!result.ok) return problem(400, 'validation_failed', 'Please fix the highlighted fields.', { errors: result.errors });

  try {
    await db.request(`household_settings?household_id=eq.${actor.householdId}`, {
      method: 'PATCH',
      body: { settings: result.value, updated_by: actor.userId, updated_at: new Date().toISOString() },
      prefer: 'return=minimal',
    });
  } catch (err) {
    console.error(err);
    return problem(500, 'internal_error', 'Something went wrong. Please try again.');
  }

  return json(200, { settings: result.value });
}
