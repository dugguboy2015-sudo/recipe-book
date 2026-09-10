import { mkdirSync, writeFileSync } from 'node:fs';
import { loadEnv } from './lib/env.mjs';
import { rest, sql } from './lib/supabase.mjs';

const env = loadEnv({
  required: ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'SUPABASE_ACCESS_TOKEN', 'SUPABASE_PROJECT_REF'],
});

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dir = `backups/${stamp}`;
mkdirSync(dir, { recursive: true });

const recipesRes = await rest(env, 'recipes?select=*&order=id', { secret: true });
if (recipesRes.status !== 200) {
  throw new Error(`Failed to read recipes: status ${recipesRes.status}: ${JSON.stringify(recipesRes.body)}`);
}
const recipes = recipesRes.body;
writeFileSync(`${dir}/recipes.json`, JSON.stringify(recipes, null, 2));

const policies = await sql(env, `select * from pg_policies where schemaname='public'`, { readOnly: true });
writeFileSync(`${dir}/policies.json`, JSON.stringify(policies, null, 2));

const grants = await sql(env, `select grantee, table_name, privilege_type from information_schema.role_table_grants where table_schema='public'`, { readOnly: true });
writeFileSync(`${dir}/grants.json`, JSON.stringify(grants, null, 2));

const columns = await sql(env, `select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema='public' order by table_name, ordinal_position`, { readOnly: true });
writeFileSync(`${dir}/columns.json`, JSON.stringify(columns, null, 2));

const rls = await sql(env, `select relname, relrowsecurity, relforcerowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r'`, { readOnly: true });
writeFileSync(`${dir}/rls.json`, JSON.stringify(rls, null, 2));

console.log(`Backup written to ${dir}`);
console.log(`recipes.json: ${recipes.length} rows`);

const countRows = await sql(env, `select count(*) as n from public.recipes`, { readOnly: true });
const liveCount = Number(countRows[0].n);
if (liveCount !== recipes.length) {
  console.error(`Row count mismatch: backup has ${recipes.length}, live count(*) is ${liveCount}`);
  process.exit(1);
}
console.log(`Row count verified against select count(*): ${liveCount}`);
