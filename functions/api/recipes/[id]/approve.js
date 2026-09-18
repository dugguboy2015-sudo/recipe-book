import { readConfig } from '../../../_lib/env.js';
import { json, problem } from '../../../_lib/http.js';
import { assertAllowedOrigin } from '../../../_lib/origin.js';
import { createDb } from '../../../_lib/db.js';
import { requireMember, checkWriteRate } from '../../../_lib/write-guard.js';
import { writeAudit } from '../../../_lib/audit.js';

const ID_RE = /^[1-9][0-9]{0,9}$/;

/**
 * POST /api/recipes/:id/approve — the curator household moves another household's pending
 * recipe into the shared catalogue (decision 8, "private until approved"). Audited as an update.
 */
export async function onRequestPost({ request, env, params }) {
  const id = params.id;
  if (!ID_RE.test(id)) return problem(404, 'not_found', 'This recipe could not be found.');
  if (!assertAllowedOrigin(request)) return problem(403, 'origin_not_allowed', 'This request did not come from an allowed site.');

  let config;
  try {
    config = readConfig(env);
  } catch (err) {
    console.error(err);
    return problem(500, 'internal_error', 'Something went wrong. Please try again.');
  }

  const db = createDb(config);
  const guard = await requireMember(request, config, db);
  if (guard.errorResponse) return guard.errorResponse;
  const { actor } = guard;
  if (!actor.isCurator) return problem(403, 'curator_only', 'Only the catalogue curator can approve recipes.');
  const limited = await checkWriteRate(db, actor, config.WRITES_PER_USER_HOURLY);
  if (limited) return limited;

  let approved;
  let before;
  try {
    const { data: rows } = await db.request(`recipes?select=*&id=eq.${id}&is_deleted=eq.false&limit=1`);
    before = rows?.[0] || null;
    if (!before) return problem(404, 'not_found', 'This recipe could not be found.');
    if (before.catalogue_status === 'public') return json(200, { recipe: before });

    const { data } = await db.request(`recipes?id=eq.${id}&is_deleted=eq.false&catalogue_status=eq.pending`, {
      method: 'PATCH',
      body: { catalogue_status: 'public' },
      prefer: 'return=representation',
    });
    approved = data?.[0];
  } catch (err) {
    console.error(err);
    return problem(500, 'internal_error', 'Something went wrong. Please try again.');
  }
  if (!approved) return problem(404, 'not_found', 'This recipe could not be found.');

  try {
    await writeAudit(db, { recipeId: Number(id), action: 'update', ipHash: actor.ipHash, actorUserId: actor.userId, before, after: approved });
  } catch (err) {
    console.error('Audit write failed after a successful approval:', err);
  }

  return json(200, { recipe: approved });
}
