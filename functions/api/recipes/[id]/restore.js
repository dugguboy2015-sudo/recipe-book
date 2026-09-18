import { readConfig } from '../../../_lib/env.js';
import { json, problem, readJson } from '../../../_lib/http.js';
import { assertAllowedOrigin } from '../../../_lib/origin.js';
import { createDb, DbError } from '../../../_lib/db.js';
import { requireMember, checkWriteRate, canEditRecipe } from '../../../_lib/write-guard.js';
import { writeAudit } from '../../../_lib/audit.js';

const ID_RE = /^[1-9][0-9]{0,9}$/;

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

  try {
    await readJson(request);
  } catch (err) {
    if (err.code === 'payload_too_large') return problem(413, 'payload_too_large', 'That request is too large.');
    return problem(400, 'invalid_json', 'That request was not valid.');
  }

  const db = createDb(config);
  const guard = await requireMember(request, config, db);
  if (guard.errorResponse) return guard.errorResponse;
  const { actor } = guard;
  const limited = await checkWriteRate(db, actor, config.WRITES_PER_USER_HOURLY);
  if (limited) return limited;

  let before;
  try {
    const { data } = await db.request(`recipes?select=*&id=eq.${id}&is_deleted=eq.true&limit=1`);
    before = data?.[0] || null;
  } catch (err) {
    console.error(err);
    return problem(500, 'internal_error', 'Something went wrong. Please try again.');
  }
  if (!before || (!canEditRecipe(actor, before) && before.catalogue_status !== 'public')) {
    return problem(404, 'not_found', 'This recipe could not be found.');
  }
  if (!canEditRecipe(actor, before)) return problem(403, 'not_your_recipe', 'Only the household that added this recipe can restore it.');

  let restored;
  try {
    const { data } = await db.request(`recipes?id=eq.${id}&is_deleted=eq.true`, {
      method: 'PATCH',
      body: { is_deleted: false, deleted_at: null },
      prefer: 'return=representation',
    });
    restored = data?.[0];
  } catch (err) {
    if (err instanceof DbError && err.code === '23505') {
      return problem(409, 'duplicate_recipe', 'Another active recipe already has this name.', { existing: null });
    }
    console.error(err);
    return problem(500, 'internal_error', 'Something went wrong. Please try again.');
  }

  try {
    await writeAudit(db, { recipeId: Number(id), action: 'restore', ipHash: actor.ipHash, actorUserId: actor.userId, before, after: restored });
  } catch (err) {
    console.error('Audit write failed after a successful restore:', err);
  }

  return json(200, { recipe: restored });
}
