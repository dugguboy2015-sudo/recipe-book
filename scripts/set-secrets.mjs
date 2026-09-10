import { execFileSync } from 'node:child_process';
import { loadEnv } from './lib/env.mjs';

const env = loadEnv({ required: ['SUPABASE_SECRET_KEY', 'TURNSTILE_SECRET_KEY'] });

const secrets = {
  SUPABASE_SECRET_KEY: env.SUPABASE_SECRET_KEY,
  TURNSTILE_SECRET_KEY: env.TURNSTILE_SECRET_KEY,
  IP_HASH_SALT: env.IP_HASH_SALT,
};
if (env.GEMINI_API_KEY) secrets.GEMINI_API_KEY = env.GEMINI_API_KEY;

if (!secrets.IP_HASH_SALT) {
  throw new Error('IP_HASH_SALT is not set. Run `npm run dev:vars` first to generate one.');
}

for (const [name, value] of Object.entries(secrets)) {
  for (const envFlag of [[], ['--env', 'preview']]) {
    const args = ['wrangler', 'pages', 'secret', 'put', name, '--project-name', 'recipe-book', ...envFlag];
    console.log(`Setting ${name}${envFlag.length ? ' (preview)' : ' (production)'}...`);
    execFileSync('npx', args, { input: value, stdio: ['pipe', 'inherit', 'inherit'] });
  }
}
console.log('All secrets pushed to production and preview.');
