import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadEnv } from './lib/env.mjs';

const env = loadEnv({ required: ['SUPABASE_SECRET_KEY'] });

let ipHashSalt = env.IP_HASH_SALT;
if (!ipHashSalt) {
  ipHashSalt = randomBytes(32).toString('hex');
  const line = `\nIP_HASH_SALT=${ipHashSalt}\n`;
  if (existsSync('.env.local')) {
    const current = readFileSync('.env.local', 'utf8');
    if (!/^IP_HASH_SALT=/m.test(current)) appendFileSync('.env.local', line);
  } else {
    writeFileSync('.env.local', line.trimStart());
  }
  console.log('Generated IP_HASH_SALT and saved it to .env.local');
}

const lines = [
  `SUPABASE_SECRET_KEY=${env.SUPABASE_SECRET_KEY}`,
  `IP_HASH_SALT=${ipHashSalt}`,
  `TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA`,
];
if (env.GEMINI_API_KEY) lines.push(`GEMINI_API_KEY=${env.GEMINI_API_KEY}`);

writeFileSync('.dev.vars', lines.join('\n') + '\n');
console.log('.dev.vars written.');
