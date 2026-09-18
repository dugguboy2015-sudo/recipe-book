import { readConfig } from '../../_lib/env.js';
import { json, problem } from '../../_lib/http.js';
import { assertAllowedOrigin } from '../../_lib/origin.js';
import { createDb } from '../../_lib/db.js';
import { getUser } from '../../_lib/auth.js';
import { INVITE_TTL_DAYS, MAX_ACTIVE_INVITES, generateInviteCode, getMembership } from '../../_lib/household.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * POST /api/household/invites — the household owner makes a single-use invite link, valid for
 * INVITE_TTL_DAYS. The code is a bearer secret: it is returned once, here, and no client can ever
 * read household_invites back.
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

  const user = await getUser(request, config);
  if (!user) return problem(401, 'sign_in_required', 'Please sign in first.');

  const db = createDb(config);
  try {
    const membership = await getMembership(db, user.id);
    if (!membership) return problem(403, 'no_household', 'Create or join a household first.');
    if (membership.role !== 'owner') return problem(403, 'owner_only', 'Only the household owner can invite people.');

    const now = new Date().toISOString();
    const active = await db.count(
      'household_invites',
      `household_id=eq.${membership.household_id}&used_at=is.null&expires_at=gt.${encodeURIComponent(now)}`,
    );
    if (active >= MAX_ACTIVE_INVITES) {
      return problem(429, 'too_many_invites', `You already have ${MAX_ACTIVE_INVITES} unused invite links. Wait for some to be used or to expire.`);
    }

    const code = generateInviteCode();
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * DAY_MS).toISOString();
    await db.request('household_invites', {
      method: 'POST',
      prefer: 'return=minimal',
      body: { code, household_id: membership.household_id, created_by: user.id, expires_at: expiresAt },
    });
    return json(201, { code, expiresAt });
  } catch (err) {
    console.error(err);
    return problem(500, 'internal_error', 'Something went wrong. Please try again.');
  }
}
