import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { loadEnv } from './lib/env.mjs';
import { sql } from './lib/supabase.mjs';

const env = loadEnv({ required: ['SUPABASE_URL', 'SUPABASE_ACCESS_TOKEN', 'SUPABASE_PROJECT_REF'] });
const dryRun = process.argv.includes('--dry-run');

const BOOTSTRAP = `
create table if not exists public.schema_migrations (
  filename text primary key, checksum text not null, applied_at timestamptz not null default now());
alter table public.schema_migrations enable row level security;
revoke all on public.schema_migrations from anon, authenticated;
`;

await sql(env, BOOTSTRAP, { readOnly: false });

const applied = await sql(env, `select filename, checksum from public.schema_migrations order by filename`, { readOnly: true });
const appliedByFile = new Map(applied.map((r) => [r.filename, r.checksum]));

// Windows checks out files with CRLF line endings (core.autocrlf=true) even though they were
// authored and first hashed as LF. Normalize before hashing/sending so the checksum recorded in
// schema_migrations is stable across platforms and across a branch switch re-checking out the file.
function normalizeLineEndings(text) {
  return text.replace(/\r\n/g, '\n');
}

const files = readdirSync('migrations')
  .filter((f) => f.endsWith('.sql'))
  .sort();

const pending = [];
for (const file of files) {
  const contents = normalizeLineEndings(readFileSync(`migrations/${file}`, 'utf8'));
  const checksum = createHash('sha256').update(contents).digest('hex');
  if (appliedByFile.has(file)) {
    if (appliedByFile.get(file) !== checksum) {
      throw new Error(`Applied migration ${file} has changed on disk. Never edit applied migrations.`);
    }
    continue;
  }
  pending.push({ file, contents, checksum });
}

if (pending.length === 0) {
  console.log('No pending migrations.');
  process.exit(0);
}

console.log('Pending migrations:');
for (const p of pending) console.log(`  ${p.file}`);

if (dryRun) process.exit(0);

for (const p of pending) {
  console.log(`Applying ${p.file}...`);
  const query = [
    'begin;',
    p.contents,
    `insert into public.schema_migrations(filename, checksum) values ('${p.file}', '${p.checksum}');`,
    'commit;',
  ].join('\n');
  try {
    await sql(env, query, { readOnly: false });
    console.log(`  applied.`);
  } catch (err) {
    console.error(`Migration ${p.file} failed: ${err.message}`);
    process.exit(1);
  }
}
console.log('All pending migrations applied.');
