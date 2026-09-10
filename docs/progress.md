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

---

## Phase 1 — Repository restructure & tooling — DONE
- Date: 2026-09-10
- Branch / PR: phase-1-tooling / [#3](https://github.com/dugguboy2015-sudo/recipe-book/pull/3) (merged c085160)
- Migrations applied: none (no schema changes this phase)
- Backup: not required (no data-affecting changes)
- Acceptance:
  - [x] `npm run check` passes locally and in CI (GitHub Actions `check` job, added this phase, ran for the first time on the PR and passed)
  - [x] Preview: all three pages render and load 30 recipes; no CSP violations in the console
  - [x] Response headers include the CSP; the supabase-js `<script>` carries `integrity` (sha384, computed over the exact bytes served for `@supabase/supabase-js@2.116.0`'s UMD build)
  - [x] No `?v=` query strings remain; no `style="` attributes in `public/` (both instances were the same modal-footer rule, moved to a `.modal-footer` class)
  - [x] Production smoke passes after merge
- Preview smoke: PASS https://9627906a.recipe-book-9eo.pages.dev (all 6 checks)   Production smoke: PASS https://recipe-book-9eo.pages.dev (all 6 checks; also manually verified in-browser on all three pages — 30 recipes render, zero console errors)
- Deviations from spec:
  1. **Local `wrangler pages dev` cannot run the `AI` binding.** It needs to proxy to Workers AI in "remote" mode even for local dev, which requires broader account permission (Workers Scripts) than our custom Cloudflare token grants (Pages Edit, Workers AI Edit, Account Settings Read, Turnstile Edit, User Details Read, Memberships Read). `wrangler whoami` confirms the token itself authenticates fine and resolves the right account; the remote-binding session specifically is refused. Worked around it for this phase by verifying everything against the pushed Cloudflare Pages preview deployment instead (which is what the spec's own SOP does anyway). This will need revisiting in Phase 9 when Functions actually call the AI binding — either widen the token's scope or find another local-dev path for that one endpoint.
  2. **`scripts/smoke.mjs`'s write-guard check accepts 405 as well as 401/403/404.** Cloudflare Pages Functions returns `405 Method Not Allowed` (not `404`) for `POST /api/recipes` while no function file exists at that route yet, discovered running smoke against the phase-1-tooling preview. Not a bug in our code — Cloudflare's own Functions router — so the check was broadened rather than "fixed".
  3. Added `tests/lib/env.test.js`, one test file covering `scripts/lib/env.mjs` (KEY=VALUE parsing, missing-required-key errors, the known-defaults merge). Not in the original Phase 1 task list, but `npm test` / CI need at least one test file to pass, and Appendix G's fuller suite isn't due until Phase 4 (once `recipe-rules.js` exists). Kept intentionally small — just covers code already written this phase.
- Also noted (not a deviation, just an environment quirk worth recording): a fresh `npm install` on this Windows machine hit the known npm/cli#4828 optional-dependency bug (`Cannot find module @rollup/rollup-win32-x64-msvc`) after `npm ci`-equivalent installs. Fixed locally with `npm install --no-save @rollup/rollup-win32-x64-msvc`; doesn't affect `package-lock.json` and doesn't affect Linux CI, which resolves its own platform's optional binary normally.
- Notes for next phase: Phase 2 (schema hardening & health columns) is next. Migrations 001–008 apply against the now-locked-down database; nothing in `public/js` reads the new columns yet, so no expand/contract risk. `scripts/sync-config.mjs` (2.5) will need `public/config/` to exist — it doesn't yet, `scripts/sync-config.mjs` should create it.
