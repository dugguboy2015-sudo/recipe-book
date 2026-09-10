import { writeFileSync, unlinkSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../../scripts/lib/env.mjs';

const FIXTURE = '.env.local.test-fixture';

afterEach(() => {
  try {
    unlinkSync(FIXTURE);
  } catch {
    // fixture already removed
  }
});

describe('loadEnv', () => {
  it('parses KEY=VALUE lines, trims values and skips comments', () => {
    writeFileSync(
      FIXTURE,
      ['# a comment', 'FOO=bar', 'BAZ = qux  ', '', 'QUOTED=has spaces # inline comment'].join('\n'),
    );
    const env = loadEnv({ path: FIXTURE });
    expect(env.FOO).toBe('bar');
    expect(env.BAZ).toBe('qux');
    expect(env.QUOTED).toBe('has spaces');
  });

  it('throws naming missing required keys without leaking values', () => {
    writeFileSync(FIXTURE, 'PRESENT=value\n');
    expect(() => loadEnv({ path: FIXTURE, required: ['PRESENT', 'MISSING_ONE', 'MISSING_TWO'] }))
      .toThrowError(/MISSING_ONE, MISSING_TWO/);
  });

  it('merges in the known public project constants', () => {
    writeFileSync(FIXTURE, '');
    const env = loadEnv({ path: FIXTURE });
    expect(env.SUPABASE_URL).toBe('https://xtxufygmwqicrgzjwdxc.supabase.co');
  });
});
