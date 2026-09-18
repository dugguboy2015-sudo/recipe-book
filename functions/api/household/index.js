import household from '../../../config/household.json';
import { readConfig } from '../../_lib/env.js';
import { json, problem, readJson } from '../../_lib/http.js';
import { assertAllowedOrigin } from '../../_lib/origin.js';
import { createDb, DbError } from '../../_lib/db.js';
import { getUser } from '../../_lib/auth.js';
import { isFoundingEmail, validateCreateHousehold } from '../../_lib/household.js';
import { DIET_PRESET_KEYS, buildNewHouseholdSettings } from '../../../public/js/shared/household-settings.js';

/**
 * POST /api/household — create a household with the signed-in user as its owner (M1b). Anyone may
 * create one (owner decision, 2026-09-18). The account matching FOUNDING_OWNER_EMAIL instead gets
 * this family's own rules from config/household.json, becomes the catalogue's curator, and claims
 * the recipes that predate accounts — all inside create_household(), in one transaction.
 */
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
    body = await readJson(request, 4_000);
  } catch (err) {
    if (err.code === 'payload_too_large') return problem(413, 'payload_too_large', 'That request is too large.');
    return problem(400, 'invalid_json', 'That request was not valid.');
  }

  const user = await getUser(request, config);
  if (!user) return problem(401, 'sign_in_required', 'Please sign in first.');
  if (!user.emailConfirmed) return problem(403, 'email_unconfirmed', 'Please confirm your email address first.');

  const founding = isFoundingEmail(user.email, config.FOUNDING_OWNER_EMAIL);
  const { ok, value, errors } = validateCreateHousehold(body, DIET_PRESET_KEYS, { requireDiet: !founding });
  if (!ok) return problem(400, 'validation_failed', 'Please fix the highlighted fields.', { errors });

  const settings = founding ? household : buildNewHouseholdSettings(household, value.diet);
  const db = createDb(config);

  let householdId;
  try {
    const { data } = await db.request('rpc/create_household', {
      method: 'POST',
      body: { p_user_id: user.id, p_name: value.name, p_display_name: value.displayName, p_settings: settings, p_founding: founding },
    });
    householdId = data;
  } catch (err) {
    if (err instanceof DbError && err.code === '23505') {
      return problem(409, 'already_in_household', 'You already belong to a household.');
    }
    console.error(err);
    return problem(500, 'internal_error', 'Something went wrong. Please try again.');
  }

  return json(201, { household: { id: householdId, name: value.name, role: 'owner', isCurator: founding } });
}
