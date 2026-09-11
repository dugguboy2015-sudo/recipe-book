import { describe, expect, it } from 'vitest';
import { parseModelJson } from '../../functions/_lib/ai/parse.js';
import { toGeminiSchema } from '../../functions/_lib/ai/schema.js';

describe('parseModelJson', () => {
  it('passes through an already-parsed object', () => {
    expect(parseModelJson({ a: 1 })).toEqual({ a: 1 });
  });

  it('parses a clean JSON string', () => {
    expect(parseModelJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('extracts JSON wrapped in prose or markdown fences', () => {
    expect(parseModelJson('Here you go:\n```json\n{"a":1}\n```\nEnjoy!')).toEqual({ a: 1 });
  });

  it('returns null for garbage with no braces', () => {
    expect(parseModelJson('not json at all')).toBeNull();
  });

  it('returns null for garbage that merely contains braces', () => {
    expect(parseModelJson('{not valid json}')).toBeNull();
  });

  it('returns null for a non-string, non-object response', () => {
    expect(parseModelJson(null)).toBeNull();
    expect(parseModelJson(undefined)).toBeNull();
  });
});

describe('toGeminiSchema', () => {
  it('converts a nullable type array to {type, nullable: true}', () => {
    expect(toGeminiSchema({ type: ['string', 'null'] })).toEqual({ type: 'string', nullable: true });
  });

  it('leaves a plain type untouched', () => {
    expect(toGeminiSchema({ type: 'string' })).toEqual({ type: 'string' });
  });

  it('drops additionalProperties', () => {
    expect(toGeminiSchema({ type: 'object', additionalProperties: false, properties: {} })).toEqual({ type: 'object', properties: {} });
  });

  it('recurses into nested properties and array items', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: ['string', 'null'] },
        tags: { type: 'array', items: { type: 'string' } },
      },
    };
    expect(toGeminiSchema(schema)).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string', nullable: true },
        tags: { type: 'array', items: { type: 'string' } },
      },
    });
  });
});
