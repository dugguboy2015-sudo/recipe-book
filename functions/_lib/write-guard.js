import { problem } from './http.js';
import { getUser } from './auth.js';
import { getMembership } from './household.js';
import { countSince } from './ratelimit.js';
import { clientIp, hashIp } from './ip.js';

const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * M1c: every recipe write comes from a signed-in member of a household. A verified, rate-limited
 * identity replaces the anonymous Turnstile check, and the rate limit follows the person rather
 * than their network (a family behind one carrier NAT no longer shares a budget).
 *
 * @returns {Promise<{ errorResponse: Response } | { actor: Actor }>}
 * @typedef {{ userId: string, householdId: string, role: string, isCurator: boolean, ipHash: string }} Actor
 */
export async function requireMember(request, config, db) {
  const user = await getUser(request, config);
  if (!user) return { errorResponse: problem(401, 'sign_in_required', 'Please sign in first.') };

  let membership;
  try {
    membership = await getMembership(db, user.id);
  } catch (err) {
    console.error(err);
    return { errorResponse: problem(500, 'internal_error', 'Something went wrong. Please try again.') };
  }
  if (!membership) return { errorResponse: problem(403, 'no_household', 'Set up or join a household first.') };

  const ipHash = await hashIp(clientIp(request), config.IP_HASH_SALT);
  return {
    actor: {
      userId: user.id,
      householdId: membership.household_id,
      role: membership.role,
      isCurator: membership.isCurator,
      ipHash,
    },
  };
}

/** Per-member hourly write budget, counted from the audit log. Returns an error response or null. */
export async function checkWriteRate(db, actor, limit) {
  let recent;
  try {
    recent = await countSince(db, 'recipe_audit_log', 'actor_user_id', actor.userId, new Date(Date.now() - ONE_HOUR_MS).toISOString());
  } catch (err) {
    console.error(err);
    return problem(500, 'internal_error', 'Something went wrong. Please try again.');
  }
  if (recent < limit) return null;
  return new Response(JSON.stringify({ code: 'rate_limited', message: "You've made a lot of changes this hour. Try again later." }), {
    status: 429,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Retry-After': '3600' },
  });
}

// The rules themselves live in shared/permissions.js so the browser shows exactly what the server allows.
export { canEditRecipe, initialCatalogueStatus } from '../../public/js/shared/permissions.js';
