import { readFileSync } from 'node:fs';

function parseEnvFile(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1);
    const hashIdx = value.search(/\s#/);
    if (hashIdx !== -1) value = value.slice(0, hashIdx);
    out[key] = value.trim();
  }
  return out;
}

// Public, non-secret facts about this project (spec §1.4, §3.2). Not owner-provided.
const KNOWN_DEFAULTS = {
  SUPABASE_URL: 'https://xtxufygmwqicrgzjwdxc.supabase.co',
  SUPABASE_PROJECT_REF: 'xtxufygmwqicrgzjwdxc',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_G7NG8ND3HlxS5FFdj57TBQ_WRdgc23V',
  CLOUDFLARE_ACCOUNT_ID: '913933566e3811466a563918f9f9655e',
  AI_MODEL: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  GEMINI_MODEL: 'gemini-2.5-flash',
};

export function loadEnv({ required = [], path = '.env.local' } = {}) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    text = '';
  }
  const fromFile = parseEnvFile(text);
  const env = { ...KNOWN_DEFAULTS, ...fromFile, ...process.env };
  const missing = required.filter((key) => env[key] === undefined || env[key] === '');
  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(', ')}`);
  }
  return env;
}
