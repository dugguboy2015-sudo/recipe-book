import { readConfig } from '../../_lib/env.js';
import { json, problem, readJson } from '../../_lib/http.js';
import { assertAllowedOrigin } from '../../_lib/origin.js';
import { createDb, DbError } from '../../_lib/db.js';
import { getUser } from '../../_lib/auth.js';
import { INVITE_CODE_PATTERN, validateJoin } from '../../_lib/household.js';

const INVALID_INVITE = 'This invite link has expired or has already been used. Ask for a new one.';

function configOrProblem(env) {
  try {
    return { config: readConfig(env) };
  } catch (err) {
    console.error(err);
    return { response: problem(500, 'internal_error', 'Something went wrong. Please try again.') };
  }
}

/**
 * GET /api/household/join?code=… — the name of the household an invite is for, so the join screen
 * can say who invited you before you sign in. Reveals nothing without a live 192-bit code.
 */
export async function onRequestGet({ request, env }) {
  const { config, response } = configOrProblem(env);
  if (response) return response;

  const code = new URL(request.url).searchParams.get('code') || '';
  if (!INVITE_CODE_PATTERN.test(code)) return problem(404, 'invite_invalid', INVALID_INVITE);

  const db = createDb(config);
  try {
    const now = encodeURIComponent(new Date().toISOString());
    const { data } = await db.request(
      `household_invites?select=households(name)&code=eq.${code}&used_at=is.null&expires_at=gt.${now}&limit=1`,
    );
    const name = data?.[0]?.households?.name;
    if (!name) return problem(404, 'invite_invalid', INVALID_INVITE);
    return json(200, { householdName: name });
  } catch (err) {
    console.error(err);
    return problem(500, 'internal_error', 'Something went wrong. Please try again.');
  }
}

/** POST /api/household/join — redeem a single-use invite, joining that household as a member. */
export async function onRequestPost({ request, env }) {
  if (!assertAllowedOrigin(request)) return problem(403, 'origin_not_allowed', 'This request did not come from an allowed site.');

  const { config, response } = configOrProblem(env);
  if (response) return response;

  let body;
  try {
    body = await readJson(request, 2_000);
  } catch (err) {
    if (err.code === 'payload_too_large') return problem(413, 'payload_too_large', 'That request is too large.');
    return problem(400, 'invalid_json', 'That request was not valid.');
  }

  const user = await getUser(request, config);
  if (!user) return problem(401, 'sign_in_required', 'Please sign in first.');
  if (!user.emailConfirmed) return problem(403, 'email_unconfirmed', 'Please confirm your email address first.');

  const { ok, value, errors } = validateJoin(body);
  if (!ok) return problem(400, 'validation_failed', 'Please fix the highlighted fields.', { errors });

  const db = createDb(config);
  try {
    const { data } = await db.request('rpc/redeem_household_invite', {
      method: 'POST',
      body: { p_user_id: user.id, p_code: value.code, p_display_name: value.displayName },
    });
    return json(200, { household: { id: data, role: 'member' } });
  } catch (err) {
    if (err instanceof DbError) {
      if (err.code === 'PT404') return problem(404, 'invite_invalid', INVALID_INVITE);
      if (err.code === '23505') return problem(409, 'already_in_household', 'You already belong to a household.');
    }
    console.error(err);
    return problem(500, 'internal_error', 'Something went wrong. Please try again.');
  }
}
