import { parseModelJson } from './parse.js';
import { toGeminiSchema } from './schema.js';

function splitMessages(messages) {
  const system = messages.find((m) => m.role === 'system')?.content || '';
  const user = messages.filter((m) => m.role !== 'system').map((m) => m.content).join('\n\n');
  return { system, user };
}

/**
 * @returns {Promise<{ok: boolean, raw: object|null, usage: {inputTokens: number, outputTokens: number, estNeurons: number}, provider: 'gemini', model: string, error?: string}>}
 */
export async function runGemini(env, messages, schema) {
  const model = env.GEMINI_MODEL;
  const { system, user } = splitMessages(messages);

  let response;
  try {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: toGeminiSchema(schema),
          temperature: 0.4,
          maxOutputTokens: 3000,
        },
      }),
    });
  } catch (err) {
    return { ok: false, isTransportError: true, raw: null, usage: { inputTokens: 0, outputTokens: 0, estNeurons: 0 }, provider: 'gemini', model, error: err.message || 'Gemini request failed' };
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    return { ok: false, isTransportError: true, raw: null, usage: { inputTokens: 0, outputTokens: 0, estNeurons: 0 }, provider: 'gemini', model, error: `Gemini ${response.status}: ${text.slice(0, 200)}` };
  }

  const body = await response.json();
  const text = body?.candidates?.[0]?.content?.parts?.[0]?.text;
  const raw = parseModelJson(text);
  const inputTokens = body?.usageMetadata?.promptTokenCount ?? 0;
  const outputTokens = body?.usageMetadata?.candidatesTokenCount ?? 0;

  return {
    ok: raw !== null,
    isTransportError: false,
    raw,
    usage: { inputTokens, outputTokens, estNeurons: 0 },
    provider: 'gemini',
    model,
    error: raw === null ? 'Could not parse a JSON object from the response' : undefined,
  };
}
