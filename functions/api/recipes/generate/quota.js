import { readConfig } from '../../../_lib/env.js';
import { json, problem } from '../../../_lib/http.js';
import { assertAllowedOrigin } from '../../../_lib/origin.js';
import { createDb } from '../../../_lib/db.js';
import { clientIp, hashIp } from '../../../_lib/ip.js';
import { todayStartUtcIso, nextMidnightUtcIso } from '../../../_lib/ai/daily-window.js';
import { fetchRecentProteinSmartRecords } from '../../../_lib/ai/recent-generations.js';
import { computeEffectiveGoal } from '../../../_lib/ai/protein-goal.js';

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
  const ip = clientIp(request);
  const ipHash = await hashIp(ip, config.IP_HASH_SALT);
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

  const recentRecords = await fetchRecentProteinSmartRecords(db).catch((err) => {
    console.error('recentProteinSmartRecords lookup failed (continuing with an empty pool):', err);
    return [];
  });
  const { share } = computeEffectiveGoal('auto', recentRecords);

  return json(200, {
    remainingToday: Math.max(0, config.GEN_GLOBAL_DAILY - globalCount),
    remainingForYou: Math.max(0, config.GEN_PER_IP_DAILY - ipCount),
    resetsAt: nextMidnightUtcIso(),
    proteinSmartShare: share,
  });
}
