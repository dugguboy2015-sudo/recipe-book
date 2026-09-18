import { readConfig } from '../../../_lib/env.js';
import { json, problem } from '../../../_lib/http.js';
import { assertAllowedOrigin } from '../../../_lib/origin.js';
import { createDb } from '../../../_lib/db.js';
import { getUser } from '../../../_lib/auth.js';
import { getMembership } from '../../../_lib/household.js';
import { nextMidnightUtcIso } from '../../../_lib/ai/daily-window.js';
import { generationCounts } from '../../../_lib/ai/quota.js';
import { fetchRecentProteinSmartRecords } from '../../../_lib/ai/recent-generations.js';
import { computeEffectiveGoal } from '../../../_lib/ai/protein-goal.js';

/**
 * GET /api/recipes/generate/quota. M1c: the personal allowance belongs to a household, so a
 * visitor who isn't a signed-in member gets `requiresSignIn` and no `remainingForYou`.
 */
export async function onRequestGet({ request, env }) {
  if (!assertAllowedOrigin(request)) return problem(403, 'origin_not_allowed', 'This request did not come from an allowed site.');

  let config;
  try {
    config = readConfig(env);
  } catch (err) {
    console.error(err);
    return problem(500, 'internal_error', 'Something went wrong. Please try again.');
  }

  const db = createDb(config);
  let counts;
  let membership = null;
  try {
    const user = await getUser(request, config);
    if (user) membership = await getMembership(db, user.id);
    counts = await generationCounts(db, membership?.household_id);
  } catch (err) {
    console.error(err);
    return problem(500, 'internal_error', 'Something went wrong. Please try again.');
  }

  const recentRecords = await fetchRecentProteinSmartRecords(db).catch((err) => {
    console.error('recentProteinSmartRecords lookup failed (continuing with an empty pool):', err);
    return [];
  });
  const { share } = computeEffectiveGoal('auto', recentRecords);

  return json(200, {
    remainingToday: Math.max(0, config.GEN_GLOBAL_DAILY - counts.globalCount),
    remainingForYou: membership ? Math.max(0, config.GEN_PER_HOUSEHOLD_DAILY - counts.householdCount) : null,
    requiresSignIn: !membership,
    resetsAt: nextMidnightUtcIso(),
    proteinSmartShare: share,
  });
}
