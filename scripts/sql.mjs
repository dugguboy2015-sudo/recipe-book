import { loadEnv } from './lib/env.mjs';
import { sql } from './lib/supabase.mjs';

const env = loadEnv({ required: ['SUPABASE_URL', 'SUPABASE_ACCESS_TOKEN', 'SUPABASE_PROJECT_REF'] });

const args = process.argv.slice(2);
const readOnlyFlagIdx = args.indexOf('--read-only');
const readOnlyFlag = readOnlyFlagIdx !== -1;
if (readOnlyFlagIdx !== -1) args.splice(readOnlyFlagIdx, 1);

const query = args.join(' ');
if (!query.trim()) {
  console.error('Usage: node scripts/sql.mjs [--read-only] "<query>"');
  process.exit(1);
}

const isSelect = /^\s*select\b/i.test(query);
if (!readOnlyFlag && !isSelect) {
  console.error('Refusing to run a non-SELECT query without --read-only.');
  process.exit(1);
}

const rows = await sql(env, query, { readOnly: readOnlyFlag || isSelect });
console.log(JSON.stringify(rows, null, 2));
