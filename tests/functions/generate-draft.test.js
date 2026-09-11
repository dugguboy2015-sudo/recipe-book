import { describe, expect, it, vi, afterEach } from 'vitest';
import { generateDraft } from '../../functions/_lib/ai/index.js';

function fakeEnv(overrides = {}) {
  return { AI_MODEL: '@cf/test-model', GEMINI_MODEL: 'gemini-test', AI: { run: vi.fn() }, ...overrides };
}

function buildMessagesSpy() {
  const calls = [];
  const buildMessages = vi.fn((opts) => {
    calls.push(opts);
    return [{ role: 'system', content: 'sys' }, { role: 'user', content: JSON.stringify(opts || {}) }];
  });
  return { buildMessages, calls };
}

const schema = { type: 'object' };

afterEach(() => {
  delete globalThis.fetch;
  vi.restoreAllMocks();
});

describe('generateDraft', () => {
  it('returns the parsed draft on a clean first attempt, using exactly one model call', async () => {
    const env = fakeEnv();
    env.AI.run.mockResolvedValue({ response: { name: 'Poha' } });
    const { buildMessages } = buildMessagesSpy();

    const result = await generateDraft(env, { buildMessages, schema });

    expect(result).toMatchObject({ ok: true, raw: { name: 'Poha' }, provider: 'workers-ai' });
    expect(result.attempts).toHaveLength(1);
    expect(env.AI.run).toHaveBeenCalledTimes(1);
  });

  it('handles response already-object, JSON string, or fenced JSON identically', async () => {
    const env = fakeEnv();
    for (const response of [{ name: 'A' }, '{"name":"A"}', '```json\n{"name":"A"}\n```']) {
      env.AI.run.mockResolvedValueOnce({ response });
      const { buildMessages } = buildMessagesSpy();
      const result = await generateDraft(env, { buildMessages, schema });
      expect(result.raw).toEqual({ name: 'A' });
    }
  });

  it('retries to Gemini when Workers AI returns unparseable garbage and a Gemini key is set', async () => {
    const env = fakeEnv({ GEMINI_API_KEY: 'test-key' });
    env.AI.run.mockResolvedValue({ response: 'not json' });
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: '{"name":"Gemini Draft"}' }] } }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
    }), { status: 200 }));
    const { buildMessages } = buildMessagesSpy();

    const result = await generateDraft(env, { buildMessages, schema });

    expect(result).toMatchObject({ ok: true, raw: { name: 'Gemini Draft' }, provider: 'gemini' });
    expect(result.attempts).toHaveLength(2);
    expect(env.AI.run).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('retries to Workers AI again with a clearer instruction when no Gemini key is set', async () => {
    const env = fakeEnv();
    env.AI.run
      .mockResolvedValueOnce({ response: 'garbage' })
      .mockResolvedValueOnce({ response: { name: 'Fixed' } });
    const { buildMessages, calls } = buildMessagesSpy();

    const result = await generateDraft(env, { buildMessages, schema });

    expect(result).toMatchObject({ ok: true, raw: { name: 'Fixed' } });
    expect(env.AI.run).toHaveBeenCalledTimes(2);
    expect(calls[1]).toEqual({ instruction: 'Return only the JSON object.' });
  });

  it('returns 502-worthy failure after two garbage responses with no Gemini configured', async () => {
    const env = fakeEnv();
    env.AI.run.mockResolvedValue({ response: 'still garbage' });
    const { buildMessages } = buildMessagesSpy();

    const result = await generateDraft(env, { buildMessages, schema });

    expect(result.ok).toBe(false);
    expect(result.unavailable).toBe(false);
    expect(result.attempts).toHaveLength(2);
  });

  it('returns unavailable (503) on a Workers AI transport error with no Gemini key, without a second call', async () => {
    const env = fakeEnv();
    env.AI.run.mockRejectedValue(new Error('capacity exceeded'));
    const { buildMessages } = buildMessagesSpy();

    const result = await generateDraft(env, { buildMessages, schema });

    expect(result).toMatchObject({ ok: false, unavailable: true });
    expect(result.attempts).toHaveLength(1);
    expect(env.AI.run).toHaveBeenCalledTimes(1);
  });

  it('falls through to Gemini on a Workers AI transport error when a Gemini key is configured', async () => {
    const env = fakeEnv({ GEMINI_API_KEY: 'test-key' });
    env.AI.run.mockRejectedValue(new Error('capacity exceeded'));
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: '{"name":"Gemini Rescue"}' }] } }],
    }), { status: 200 }));
    const { buildMessages } = buildMessagesSpy();

    const result = await generateDraft(env, { buildMessages, schema });

    expect(result).toMatchObject({ ok: true, provider: 'gemini', raw: { name: 'Gemini Rescue' } });
  });

  it('spends the retry budget on a content-validation retry when the caller flags one, not a parse retry', async () => {
    const env = fakeEnv();
    env.AI.run
      .mockResolvedValueOnce({ response: { is_vegetarian: false } })
      .mockResolvedValueOnce({ response: { is_vegetarian: true } });
    const { buildMessages, calls } = buildMessagesSpy();
    const getRetryFeedback = vi.fn((draft) => (draft.is_vegetarian ? null : 'The draft used chicken; make it vegetarian.'));

    const result = await generateDraft(env, { buildMessages, schema, getRetryFeedback });

    expect(result).toMatchObject({ ok: true, raw: { is_vegetarian: true } });
    expect(result.attempts).toHaveLength(2);
    expect(calls[1]).toEqual({ retryFeedback: 'The draft used chicken; make it vegetarian.' });
  });

  it('does not call getRetryFeedback at all when the first attempt fails to parse', async () => {
    const env = fakeEnv();
    env.AI.run.mockResolvedValue({ response: 'garbage' }).mockResolvedValueOnce({ response: 'garbage' }).mockResolvedValueOnce({ response: { ok: true } });
    const { buildMessages } = buildMessagesSpy();
    const getRetryFeedback = vi.fn(() => 'should never be called');

    await generateDraft(env, { buildMessages, schema, getRetryFeedback });

    expect(getRetryFeedback).not.toHaveBeenCalled();
  });

  it('falls back to the first (structurally valid) draft when a content-validation retry itself fails to parse', async () => {
    const env = fakeEnv();
    env.AI.run
      .mockResolvedValueOnce({ response: { is_vegetarian: false } })
      .mockResolvedValueOnce({ response: 'garbage on retry' });
    const { buildMessages } = buildMessagesSpy();
    const getRetryFeedback = () => 'fix it';

    const result = await generateDraft(env, { buildMessages, schema, getRetryFeedback });

    expect(result).toMatchObject({ ok: true, raw: { is_vegetarian: false }, retryFailed: true });
    expect(result.attempts).toHaveLength(2);
  });
});
