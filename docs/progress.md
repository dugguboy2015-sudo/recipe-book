# Recipe Book — Build Progress Log

## Phase 0 — Preflight, backup, emergency lockdown — DONE
- Date: 2026-09-10
- Branch / PR: phase-0-lockdown / [#1](https://github.com/dugguboy2015-sudo/recipe-book/pull/1) (merged 83ab4b3)
- Migrations applied: 000_lockdown.sql, 000a_lockdown_maintain.sql
- Backup: backups/2026-09-10T22-31-51-087Z (32 rows; recipes.json, policies.json, grants.json, columns.json, rls.json)
- Acceptance:
  - [x] Preflight: all required checks PASS (Node 22.18, gh as dugguboy2015-sudo with push, Supabase secret key + SQL API, Cloudflare token + Pages project, Workers AI, Turnstile secret + site key)
  - [x] Backup folder exists; recipes.json holds 32 rows, verified against `select count(*)`
  - [x] All 0.9 probes return the stated statuses: PATCH/POST/DELETE with publishable key → 401, code 42501; GET → 200 with 30 rows; GET is_deleted=true → 200 `[]`
  - [x] `schema_migrations` contains 000_lockdown.sql (and 000a_lockdown_maintain.sql, see deviation below)
  - [x] RLS audit (A.0, corrected per deviation below) returns zero rows
- Preview smoke: PASS https://8739ea62.recipe-book-9eo.pages.dev (no `npm run smoke` yet — Phase 1 adds it; verified manually: pages 200, publishable-key probes match)   Production smoke: PASS https://recipe-book-9eo.pages.dev (all three pages 200; GET returns 30 rows; POST without the write API → 401/42501)
- Deviations from spec:
  1. **Appendix A.0's third audit query is unreliable and was replaced.** The Supabase Management API's `/database/query` endpoint always executes as `supabase_read_only_user` regardless of the `read_only` flag (confirmed: `select current_user` returns `supabase_read_only_user` even with `read_only: false`). `information_schema.role_table_grants` only surfaces grants where the *current* role is grantor/grantee/PUBLIC, so querying it from this role can never see grants held by `anon`/`authenticated` — it always returns zero rows, which would be a false pass even with no lockdown applied at all. Verified this by running the original query against the *pre-lockdown* database: it returned `[]` despite `anon` holding every privilege. Replaced it with a query over `pg_class.relacl` via `aclexplode()`, which is visible to any role with `SELECT` on `pg_class`:
     ```sql
     select c.relname, a.privilege_type, a.grantee::regrole::text as grantee
     from pg_class c, aclexplode(c.relacl) a
     where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
       and a.grantee::regrole::text in ('anon','authenticated') and a.privilege_type <> 'SELECT';
     ```
     This becomes the standing A.0 audit for the rest of the project. The first two A.0 queries (RLS enabled, security_invoker views) behaved as documented and are unchanged.
  2. **`000_lockdown.sql`'s revoke list was missing `MAINTAIN`.** PostgreSQL 15 added a `MAINTAIN` table privilege (VACUUM/ANALYZE/CLUSTER/REINDEX/etc.) that didn't exist when the older revoke-list idiom in Appendix A.1 was written, so `anon`/`authenticated` kept it after 000_lockdown.sql ran. Caught by the corrected audit above (query 3 returned two `MAINTAIN` rows instead of zero). Since `000_lockdown.sql` was already applied and its checksum locked, fixed with a follow-up file `migrations/000a_lockdown_maintain.sql` (`revoke maintain on public.recipes from anon, authenticated;`) rather than editing the applied file. Re-ran the audit: zero rows.
- Confirmed findings from 2026-09-10 verification (§1.4) reproduced exactly: 4 pre-lockdown policies (`Allow anon recipe reads` SELECT, `Allow anon recipe updates` UPDATE, `Allow public inserts on recipes` INSERT, `Allow public read access to recipes` SELECT), no DELETE policy, and `anon`/`authenticated` holding every table privilege on `recipes` via `relacl` (`arwdDxtm`) before this migration — confirming anon hard DELETE was never possible only because no DELETE *policy* existed under RLS-off PostgREST semantics, while the raw grant existed underneath.
- Notes for next phase: Phase 1 (repo restructure & tooling) is next. `scripts/lib/env.mjs` bakes in the known public constants (`SUPABASE_URL`, `SUPABASE_PROJECT_REF`, `SUPABASE_PUBLISHABLE_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `AI_MODEL`, `GEMINI_MODEL`) so `.env.local` only needs to carry owner-provided secrets/decisions — Phase 1's `wrangler.toml` `[vars]` should still hardcode these same values per the spec, since Workers can't read `.env.local`.
