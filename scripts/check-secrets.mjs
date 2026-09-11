import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const PATTERNS = [
  { name: 'Supabase secret key', re: /sb_secret_[A-Za-z0-9_-]{10,}/g },
  { name: 'JWT-shaped key', re: /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g },
  { name: 'Google API key', re: /AIza[0-9A-Za-z_-]{30,}/g },
];

// Vars that are deliberately public and belong in committed client code (Appendix §3.2 marks each
// of these "no (public)") — a literal match here is the feature working as designed, not a leak.
const PUBLIC_VAR_NAMES = new Set(['TURNSTILE_SITE_KEY']);

function literalSecretsFromEnvLocal() {
  if (!existsSync('.env.local')) return [];
  const text = readFileSync('.env.local', 'utf8');
  const values = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1);
    const hashIdx = value.search(/\s#/);
    if (hashIdx !== -1) value = value.slice(0, hashIdx);
    value = value.trim();
    if (!value) continue;
    if (/^(true|false)$/i.test(value)) continue;
    if (/^\d+$/.test(value)) continue;
    if (PUBLIC_VAR_NAMES.has(key)) continue;
    values.push({ name: key, value });
  }
  return values;
}

function listCandidateFiles() {
  let tracked = [];
  try {
    tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  } catch {
    tracked = [];
  }
  let staged = [];
  try {
    staged = execFileSync('git', ['diff', '--cached', '--name-only'], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  } catch {
    staged = [];
  }
  return [...new Set([...tracked, ...staged])];
}

const literalSecrets = literalSecretsFromEnvLocal();
const files = listCandidateFiles();
let hits = 0;

for (const file of files) {
  if (file === '.env.local' || file === '.env.local.example') continue;
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  const lines = text.split(/\r?\n/);
  lines.forEach((line, idx) => {
    for (const { name, re } of PATTERNS) {
      re.lastIndex = 0;
      if (re.test(line)) {
        console.error(`${file}:${idx + 1}: possible ${name}`);
        hits += 1;
      }
    }
    for (const { name, value } of literalSecrets) {
      if (line.includes(value)) {
        console.error(`${file}:${idx + 1}: literal value of ${name} from .env.local`);
        hits += 1;
      }
    }
  });
}

if (hits > 0) {
  console.error(`\ncheck:secrets found ${hits} potential secret leak(s).`);
  process.exit(1);
}
console.log('check:secrets: no secrets found.');
