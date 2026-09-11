import { parseModelJson } from './parse.js';

/** estNeurons for llama-3.3-70b-fp8-fast ($0.29/M input, $2.25/M output, $0.011 per 1,000 neurons). */
export function estimateNeurons(inputTokens, outputTokens) {
  return Math.round(inputTokens * 0.02636 + outputTokens * 0.20455);
}

/**
 * @returns {Promise<{ok: boolean, raw: object|null, usage: {inputTokens: number, outputTokens: number, estNeurons: number}, provider: 'workers-ai', model: string, error?: string}>}
 */
export async function runWorkersAI(env, messages, schema) {
  const model = env.AI_MODEL;
  let result;
  try {
    result = await env.AI.run(model, {
      messages,
      response_format: { type: 'json_schema', json_schema: schema },
      max_tokens: 3000,
      temperature: 0.4,
    });
  } catch (err) {
    // A genuine service error (quota exhausted, capacity, schema rejected) — distinct from a
    // parse failure below, since the retry policy treats them differently (index.js).
    return { ok: false, isTransportError: true, raw: null, usage: { inputTokens: 0, outputTokens: 0, estNeurons: 0 }, provider: 'workers-ai', model, error: err.message || 'Workers AI request failed' };
  }

  const raw = parseModelJson(result?.response);
  const inputTokens = result?.usage?.prompt_tokens ?? Math.ceil(JSON.stringify(messages).length / 4);
  const outputTokens = result?.usage?.completion_tokens ?? Math.ceil((typeof result?.response === 'string' ? result.response.length : JSON.stringify(result?.response || {}).length) / 4);

  return {
    ok: raw !== null,
    isTransportError: false,
    raw,
    usage: { inputTokens, outputTokens, estNeurons: estimateNeurons(inputTokens, outputTokens) },
    provider: 'workers-ai',
    model,
    error: raw === null ? 'Could not parse a JSON object from the response' : undefined,
  };
}
