// Restores `recipes` rows from a backup folder created by `npm run backup` (backups/<timestamp>/recipes.json).
// Dry-run by default: reports what would change and writes nothing. Requires both --apply and
// --yes to actually write, so a single flag typo can't accidentally overwrite production rows.
//
// Usage:
//   node scripts/restore.mjs backups/2026-09-10T12-00-00-000Z
//   node scripts/restore.mjs backups/2026-09-10T12-00-00-000Z --apply --yes
//
// Scope: this restores the `recipes` table's own columns only (matching what `npm run backup`
// captures) — it does not touch `recipe_ingredients` rows, since those aren't part of any backup
// today. A recipe restored this way keeps whatever `recipe_ingredients` it currently has; only its
// own columns (name, times, nutrition, the legacy `ingredients` jsonb mirror, etc.) are reverted.
import { existsSync, readFileSync } from 'node:fs';
import { loadEnv } from './lib/env.mjs';
import { rest } from './lib/supabase.mjs';

const env = loadEnv({ required: ['SUPABASE_URL', 'SUPABASE_SECRET_KEY'] });

const args = process.argv.slice(2);
const folder = args.find((a) => !a.startsWith('--'));
const apply = args.includes('--apply');
const confirmed = args.includes('--yes');

if (!folder) {
  console.error('Usage: node scripts/restore.mjs <backup-folder> [--apply --yes]');
  process.exit(1);
}

const recipesPath = `${folder}/recipes.json`;
if (!existsSync(recipesPath)) {
  console.error(`No recipes.json in ${folder} — expected a folder created by "npm run backup".`);
  process.exit(1);
}

const backupRows = JSON.parse(readFileSync(recipesPath, 'utf8'));
if (!Array.isArray(backupRows) || backupRows.length === 0) {
  console.error(`${recipesPath} has no rows — refusing to run an upsert with nothing in it.`);
  process.exit(1);
}
console.log(`Backup: ${recipesPath} (${backupRows.length} rows)`);

const liveRes = await rest(env, 'recipes?select=id,updated_at', { secret: true });
if (liveRes.status !== 200) {
  throw new Error(`Failed to read live recipes: ${liveRes.status}: ${JSON.stringify(liveRes.body)}`);
}
const liveById = new Map(liveRes.body.map((r) => [r.id, r.updated_at]));

let toInsert = 0;
let toUpdate = 0;
let unchanged = 0;
for (const row of backupRows) {
  const liveUpdatedAt = liveById.get(row.id);
  if (liveUpdatedAt === undefined) toInsert += 1;
  else if (liveUpdatedAt !== row.updated_at) toUpdate += 1;
  else unchanged += 1;
}
console.log(`Would insert ${toInsert}, update ${toUpdate}, leave ${unchanged} unchanged.`);

if (!apply) {
  console.log('\nDry run only — nothing was written. Re-run with --apply --yes to restore for real.');
  process.exit(0);
}
if (!confirmed) {
  console.error('\n--apply also requires --yes, to confirm you mean to overwrite production rows. Nothing was written.');
  process.exit(1);
}

console.log(`\nUpserting ${backupRows.length} rows by id...`);
const res = await rest(env, 'recipes', {
  method: 'POST',
  secret: true,
  body: backupRows,
  prefer: 'resolution=merge-duplicates,return=minimal',
});
if (res.status >= 300) {
  console.error(`Restore failed: ${res.status}: ${JSON.stringify(res.body)}`);
  process.exit(1);
}
console.log('Restore complete.');
