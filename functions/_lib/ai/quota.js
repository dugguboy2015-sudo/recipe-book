import { json } from '../http.js';
import { todayStartUtcIso, nextMidnightUtcIso } from './daily-window.js';

/**
 * Today's AI usage (UTC day): site-wide, which protects the free Workers AI allowance, and this
 * household's, which is the per-household quota (decision 5). Recipe drafts and nutrition
 * estimates share both budgets.
 */
export async function generationCounts(db, householdId) {
  const since = encodeURIComponent(todayStartUtcIso());
  const [globalCount, householdCount] = await Promise.all([
    db.count('recipe_generations', `created_at=gte.${since}`),
    householdId ? db.count('recipe_generations', `household_id=eq.${householdId}&created_at=gte.${since}`) : Promise.resolve(0),
  ]);
  return { globalCount, householdCount };
}

/** A 429 response when either budget is spent, otherwise null. */
export function quotaExceeded(config, { globalCount, householdCount }) {
  if (globalCount >= config.GEN_GLOBAL_DAILY) return json(429, { code: 'generation_limit', scope: 'site', resetsAt: nextMidnightUtcIso() });
  if (householdCount >= config.GEN_PER_HOUSEHOLD_DAILY) return json(429, { code: 'generation_limit', scope: 'you', resetsAt: nextMidnightUtcIso() });
  return null;
}
