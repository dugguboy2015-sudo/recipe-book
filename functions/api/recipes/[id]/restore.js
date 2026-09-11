import { readConfig } from '../../../_lib/env.js';
import { json, problem, readJson } from '../../../_lib/http.js';
import { assertAllowedOrigin } from '../../../_lib/origin.js';
import { createDb, DbError } from '../../../_lib/db.js';
import { verifyTurnstile } from '../../../_lib/turnstile.js';
import { clientIp, hashIp } from '../../../_lib/ip.js';
import { countSince } from '../../../_lib/ratelimit.js';
import { writeAudit } from '../../../_lib/audit.js';

const ONE_HOUR_MS = 60 * 60 * 1000;
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

  let body;
  try {
    body = await readJson(request);
  } catch (err) {
    if (err.code === 'payload_too_large') return problem(413, 'payload_too_large', 'That request is too large.');
    return problem(400, 'invalid_json', 'That request was not valid.');
  }

  const ip = clientIp(request);
  const ipHash = await hashIp(ip, config.IP_HASH_SALT);
  const turnstileResult = await verifyTurnstile(body.turnstileToken, ip, config.TURNSTILE_SECRET_KEY);
  if (!turnstileResult.ok) return problem(403, 'verification_failed', "We couldn't confirm you're not a bot. Try saving again.");

  const db = createDb(config);

  let recentWrites;
  try {
    recentWrites = await countSince(db, 'recipe_audit_log', 'actor_ip_hash', ipHash, new Date(Date.now() - ONE_HOUR_MS).toISOString());
  } catch (err) {
    console.error(err);
    return problem(500, 'internal_error', 'Something went wrong. Please try again.');
  }
  if (recentWrites >= config.WRITES_PER_IP_HOURLY) {
    return new Response(JSON.stringify({ code: 'rate_limited', message: 'Too many changes from your network. Try again later.' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Retry-After': '3600' },
    });
  }

  let before;
  try {
    const { data } = await db.request(`recipes?select=*&id=eq.${id}&is_deleted=eq.true&limit=1`);
    before = data?.[0] || null;
  } catch (err) {
    console.error(err);
    return problem(500, 'internal_error', 'Something went wrong. Please try again.');
  }
  if (!before) return problem(404, 'not_found', 'This recipe could not be found.');

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
    await writeAudit(db, { recipeId: Number(id), action: 'restore', ipHash, before, after: restored });
  } catch (err) {
    console.error('Audit write failed after a successful restore:', err);
  }

  return json(200, { recipe: restored });
}
