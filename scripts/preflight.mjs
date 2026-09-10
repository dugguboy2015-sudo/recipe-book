import { loadEnv } from './lib/env.mjs';
import { rest, sql } from './lib/supabase.mjs';

const REQUIRED = [
  'SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'SUPABASE_ACCESS_TOKEN', 'SUPABASE_PROJECT_REF',
  'SUPABASE_PUBLISHABLE_KEY', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID',
  'TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY',
];

const env = loadEnv({ required: REQUIRED });

const results = [];

async function check(name, required, fn) {
  try {
    const detail = await fn();
    results.push({ name, required, pass: true, detail: detail ?? '' });
  } catch (err) {
    results.push({ name, required, pass: false, detail: err.message });
  }
}

async function ghJson(args) {
  const { execFileSync } = await import('node:child_process');
  const out = execFileSync('gh', args, { encoding: 'utf8' });
  return JSON.parse(out);
}

await check('Node >= 20', true, () => {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 20) throw new Error(`node ${process.versions.node} < 20`);
  return `node ${process.versions.node}`;
});

await check('gh account', true, async () => {
  const { execFileSync } = await import('node:child_process');
  const login = execFileSync('gh', ['api', 'user', '--jq', '.login'], { encoding: 'utf8' }).trim();
  if (login !== 'dugguboy2015-sudo') throw new Error(`logged in as ${login}`);
  return login;
});

await check('gh push permission', true, async () => {
  const { execFileSync } = await import('node:child_process');
  const push = execFileSync('gh', ['api', 'repos/dugguboy2015-sudo/recipe-book', '--jq', '.permissions.push'], { encoding: 'utf8' }).trim();
  if (push !== 'true') throw new Error(`push=${push}`);
  return 'push=true';
});

await check('Supabase secret key', true, async () => {
  const res = await rest(env, 'recipes?select=id&limit=1', { secret: true });
  if (res.status !== 200) throw new Error(`status ${res.status}: ${JSON.stringify(res.body)}`);
  return `status 200`;
});

await check('Supabase SQL API', true, async () => {
  const rows = await sql(env, 'select 1 as ok', { readOnly: true });
  if (!(Array.isArray(rows) && rows[0] && Number(rows[0].ok) === 1)) throw new Error(`unexpected: ${JSON.stringify(rows)}`);
  return 'select 1 -> ok';
});

await check('Cloudflare token', true, async () => {
  const res = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', {
    headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
  });
  const json = await res.json();
  if (json?.result?.status !== 'active') throw new Error(`status ${JSON.stringify(json?.result)}`);
  return 'active';
});

await check('Cloudflare Pages project', true, async () => {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/pages/projects/recipe-book`, {
    headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
  });
  if (res.status !== 200) throw new Error(`status ${res.status}`);
  return 'status 200';
});

await check('Workers AI', true, async () => {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/meta/llama-3.1-8b-instruct`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Reply with OK' }], max_tokens: 5 }),
  });
  const json = await res.json();
  if (json?.success !== true) throw new Error(`success=${json?.success}: ${JSON.stringify(json?.errors)}`);
  return 'success';
});

await check('Turnstile secret', true, async () => {
  const form = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: 'dummy' });
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  const json = await res.json();
  const codes = json['error-codes'] || [];
  if (!codes.includes('invalid-input-response') || codes.includes('invalid-input-secret')) {
    throw new Error(`error-codes: ${JSON.stringify(codes)}`);
  }
  return 'secret valid';
});

await check('Turnstile site key', true, () => {
  if (!env.TURNSTILE_SITE_KEY || !env.TURNSTILE_SITE_KEY.startsWith('0x')) {
    throw new Error(`unexpected format`);
  }
  return 'present, 0x-prefixed';
});

if (env.GEMINI_API_KEY) {
  await check('Gemini API', false, async () => {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${env.GEMINI_API_KEY}`);
    if (res.status !== 200) throw new Error(`status ${res.status}`);
    return 'status 200';
  });
} else {
  results.push({ name: 'Gemini API', required: false, pass: true, detail: 'skipped (no key set)' });
}

const nameWidth = Math.max(...results.map((r) => r.name.length));
console.log('');
for (const r of results) {
  const status = r.pass ? 'PASS' : 'FAIL';
  const req = r.required ? 'required' : 'optional';
  console.log(`${status.padEnd(5)} ${r.name.padEnd(nameWidth)} ${req.padEnd(9)} ${r.detail}`);
}
console.log('');

const failedRequired = results.filter((r) => r.required && !r.pass);
if (failedRequired.length > 0) {
  console.error(`${failedRequired.length} required check(s) failed.`);
  process.exit(1);
}
console.log('All required checks passed.');
