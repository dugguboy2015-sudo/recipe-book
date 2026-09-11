import { runWorkersAI } from './workers-ai.js';
import { runGemini } from './gemini.js';

function pick(attempt) {
  return { raw: attempt.raw, usage: attempt.usage, provider: attempt.provider, model: attempt.model };
}

/**
 * Runs the provider chain for one generation request, spending at most two model calls total
 * (the shared budget covers both a parse/transport retry and a content-validation retry — never
 * both, since only one extra call exists).
 *
 * @param {{
 *   buildMessages: (opts?: { instruction?: string, retryFeedback?: string }) => Array,
 *   schema: object,
 *   getRetryFeedback?: (draft: object) => string|null,
 * }} options
 *   `buildMessages()` with no args builds the first attempt; called again for a retry with
 *   `{instruction}` (WAI-only garbage retry) or `{retryFeedback}` (content-validation retry).
 *   `getRetryFeedback(draft)`, given the first successfully-parsed draft, returns a feedback
 *   string if a content-validation retry is needed, or a falsy value if the draft is fine as-is.
 * @returns {Promise<{ ok: boolean, unavailable?: boolean, raw?: object, usage?: object,
 *   provider?: string, model?: string, attempts: Array, retryFailed?: boolean }>}
 */
export async function generateDraft(env, { buildMessages, schema, getRetryFeedback }) {
  const attempt1 = await runWorkersAI(env, buildMessages(), schema);

  if (!attempt1.ok) {
    if (attempt1.isTransportError && !env.GEMINI_API_KEY) {
      return { ok: false, unavailable: true, attempts: [attempt1] };
    }
    const attempt2 = env.GEMINI_API_KEY
      ? await runGemini(env, buildMessages(), schema)
      : await runWorkersAI(env, buildMessages({ instruction: 'Return only the JSON object.' }), schema);

    if (!attempt2.ok) return { ok: false, unavailable: false, attempts: [attempt1, attempt2] };
    return { ok: true, ...pick(attempt2), attempts: [attempt1, attempt2] };
  }

  const feedback = getRetryFeedback ? await getRetryFeedback(attempt1.raw) : null;
  if (!feedback) return { ok: true, ...pick(attempt1), attempts: [attempt1] };

  const attempt2 = await runWorkersAI(env, buildMessages({ retryFeedback: feedback }), schema);
  if (!attempt2.ok) return { ok: true, ...pick(attempt1), attempts: [attempt1, attempt2], retryFailed: true };
  return { ok: true, ...pick(attempt2), attempts: [attempt1, attempt2] };
}
