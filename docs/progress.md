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

---

## Phase 2 — Schema hardening & health columns (expand-only) — DONE
- Date: 2026-09-11
- Branch / PR: phase-2-schema / [#5](https://github.com/dugguboy2015-sudo/recipe-book/pull/5) (merged 86fe961)
- Migrations applied: 001_constraints.sql, 002_cuisines.sql, 003_slug.sql, 004_meal_types.sql, 005_audit_and_generations.sql, 005a_recipe_audit_log_seq_fix.sql, 006_health_columns.sql, 007_read_views.sql, 008_default_privileges.sql
- Backup: backups/2026-09-10T23-07-46-476Z (32 rows) — taken before this phase's migrations
- Acceptance:
  - [x] `schema_migrations` lists 000–008 (plus the two follow-up fixes 000a, 005a)
  - [x] Every A.9 expectation holds (all 10 checks; see below); corrected A.0 audit returns zero rows
  - [x] `is_protein_smart` exists and is `false` for every current row (confirmed: `count(*) filter (where is_protein_smart) = 0`)
  - [x] The live site still reads correctly (production smoke + manual browser check, zero console errors)
- Preview smoke: PASS https://33e1187c.recipe-book-9eo.pages.dev   Production smoke: PASS https://recipe-book-9eo.pages.dev
- A.9 verification results:
  1. Dietary columns: `is_egg_free`/`is_vegetarian`/`contains_dairy` all default `null`/`NOT NULL`; `is_deleted` default `false`/`NOT NULL`; `cuisine` `NOT NULL` — matches exactly.
  2. Trigger `recipes_set_updated_at` present.
  3. Zero rows with `total_time_minutes` < parts.
  4. Cuisine distribution matches exactly: Chaat 3, Fusion 6, Gujarati 1, Indo-Chinese 3, Maharashtrian 9, North Indian 4, Other 2, Rajasthani 2, South Indian 2 (32 total).
  5. Zero rows with missing slug.
  6. Meal-type counts (non-deleted) match §1.4's tag vocabulary with the Snack→Snacks and Packed Lunch Friendly→Packed Lunch renames: Breakfast 9, Dessert 5, Dinner 13, Lunch 18, Packed Lunch 8, Snacks 16.
  7. `similar_recipes('kanda poha', 3)` (called via service-role REST RPC, since the Management API's read-only role can't execute it — same pattern as the A.0 audit fix) returns Kanda Poha, score 1.0.
  8. `recipe_stats`: `total: 30, vegetarian: 30, egg_free: 30, dairy_free: 0, protein_smart: 0, top_cuisine: Maharashtrian, top_cuisine_count: 9`.
  9. Corrected A.0 audit (RLS enabled, security_invoker views, non-select anon/authenticated table privileges via relacl): all three return zero rows.
  10. `count(*) filter (where is_protein_smart)` = 0, as expected.
- Deviations from spec:
  1. **`scripts/migrate.mjs`'s checksum guard was broken by Windows line-ending normalization.** It hashed migration files' raw bytes, but `core.autocrlf=true` (this machine's git config) rewrites LF→CRLF on every checkout. The very first `git switch` after Phase 0 changed `000_lockdown.sql`'s on-disk bytes without changing its content, and `migrate.mjs` refused to proceed ("Applied migration has changed on disk"). Fixed by normalizing `\r\n`→`\n` before hashing in both the already-applied-check and the new-file digest — this made the two Phase 0 files re-match immediately (they were LF when first hashed), no data or `schema_migrations` changes needed.
  2. **`001_constraints.sql`'s `recipes_serves_range` check (1–50) failed** against the pre-existing junk soft-deleted row id 39 ("Hdjd", `serves: 7022`) — the same row `002_cuisines.sql` already special-cases for its junk cuisine/tags. Added `update ... set serves = 4 where id = 39 and is_deleted and serves > 50` immediately before the constraint, scoped tightly to that one known-junk row.
  3. **`recipe_audit_log`'s identity-column sequence was exposed to `anon`/`authenticated`** (SELECT/UPDATE/USAGE) by this Supabase project's default grant behaviour for sequences — the same phenomenon Phase 0 found on tables (`public.recipes` originally had anon holding every privilege), just for sequences, and only affecting objects created before `008_default_privileges.sql` locks down future defaults. Found by extending the standing A.0 audit to also check `pg_class.relkind='S'`. Fixed with `migrations/005a_recipe_audit_log_seq_fix.sql`. This relkind='S' check is now part of the standing audit for every future phase that creates a table with a `generated ... as identity` column.
- Notes for next phase: Phase 3 (structured ingredients, units & nutrition backfill) is next. `scripts/fixtures/recipes.snapshot.json` (32 rows, timestamps stripped, taken from the pre-migration backup) and `scripts/fixtures/slugs.json` are ready for the ingredient-backfill authoring work. Remember to check every new identity-column table's backing sequence against `anon`/`authenticated` after applying, until the pattern is proven to no longer occur (008's default-privilege revoke should prevent it for anything created from Phase 3 onward, but verify rather than assume).

---

## Phase 3 — Structured ingredients, units & nutrition backfill — DONE
- Date: 2026-09-11
- Branch / PR: phase-3-ingredients / [#7](https://github.com/dugguboy2015-sudo/recipe-book/pull/7) (merged d2998ed)
- Migrations applied: 009_ingredients_schema.sql, 010_ingredients_backfill.sql, 011_nutrition_backfill.sql, 012_derived_flags.sql, 012a_contains_dairy_correction.sql
- Backup: backups/2026-09-10T23-22-16-151Z (before 009) and backups/2026-09-10T23-36-46-148Z (before 010-012a), both 32 rows
- Acceptance:
  - [x] `validate-backfill.mjs` passes with zero structural errors (unit/category validity, no shared aliases, full line coverage per recipe)
  - [x] Every live recipe has structured ingredients and a spice level, **except id 2** (documented data-loss case below); every live recipe with ingredients has sugars, saturates and salt
  - [x] The dietary derivation matches for all 29 recipes with ingredients (14 `contains_dairy` mismatches were found, logged, and corrected by 012a; `is_vegetarian`/`is_egg_free` had zero mismatches)
  - [x] The protein-smart share of the collection is recorded: 0/30 (see below)
- Preview smoke: PASS (verified locally against production REST API before pushing, since this phase touches no served files)   Production smoke: PASS https://recipe-book-9eo.pages.dev (all 6 checks; recipes page manually verified in-browser, zero console errors, structured ingredients read correctly via `recipe_ingredients` join)
- **Data-loss recipes** (pre-existing corruption from the known edit-flattening bug, BUG-5/BUG-10, not something this migration caused):
  - **Id 2, "Aloo Paratha Roll with Ketchup"**: both `ingredients` and `steps` are literally `"asDfasdf"`/`"asdfasdf"` in the live database — nothing to recover from. Skipped rather than fabricated: this is the one live recipe with zero `recipe_ingredients` rows and no nutrition backfill entry. **Needs the owner to re-enter this recipe by hand** (or delete it) — flagging here since it's the only unresolved data-quality issue left from Phase 3.
  - **Id 4, "Basundi"**: stored `ingredients` was `[]`, but the method text fully describes the dish (milk, sugar, saffron-soaked milk, cardamom, pistachios, almonds, cashews). Reconstructed a plausible ingredient list with judgment-based quantities (`scripts/data/ingredient-overrides.mjs`, `RECONSTRUCTED_GROUPS[4]`) — these are reasonable estimates, not recovered originals. Worth a quick owner glance.
  - **Id 12, "Kothimbir Vadi"**: stored `ingredients` only had the tempering group; the method describes a full batter (coriander, gram flour, rice flour, ginger-garlic, chillies, spices, sugar, lemon) that was missing entirely. Reconstructed the missing "For the batter" group the same way, prepended before the surviving tempering group.
  - **Id 27, "Shrikhand"**: same situation as Basundi (`ingredients` was `[]`, method intact — strained yoghurt, sugar, saffron milk, cardamom, nuts). Reconstructed similarly.
- **Contains_dairy correction** (012a): recipes 3, 5, 7, 11, 12, 13, 14, 15, 18, 19, 25, 26, 28, 29 were changed from `contains_dairy: true` to `false` — this is exactly the bug described in improvement_plan.md §1.4 ("all 30 live recipes are marked contains_dairy: true, which can't all be right, e.g. Lemon Rice, Schezwan Noodles"); both of those named examples are in the corrected list. Not a silent change — logged here and in the migration's own comment.
- Protein-smart share: 0/30. None of the existing recipes clear J.2's `protein_g * 4 >= 0.20 * calories_kcal` bar even where `protein_g >= 15` (Chilli Paneer, Paneer Tikka Wrap, Paneer Tikka Paratha Roll all fail this specific check — their calories are too high relative to protein). Expected: this collection predates the household health goals: Phase 9's AI generation is what drives new recipes toward the 60% target, not a retroactive rewrite of existing ones.
- Deviations from spec:
  1. The three items above (data-loss reconstruction/skip) aren't strictly "deviations" from a spec instruction, but are deviations from a clean backfill — recorded here per §0.5's spirit of logging anything the spec's normative appendices didn't anticipate.
  2. Extended the standing A.0 RLS/grants audit (see Phase 0's deviation entry) to also check `pg_class.relkind = 'S'` for stray `anon`/`authenticated` sequence grants on every new table. Came back clean this time — confirms `008_default_privileges.sql`'s revoke is working for objects created from Phase 3 onward, unlike `recipe_audit_log` in Phase 2 (created in 005, before 008 took effect).
  3. One real migration bug caught and fixed before it ever committed: `009`'s `group_name` has a 60-char check constraint, but the live source data for Kothimbir Vadi's tempering group is `"For the tempering (optional, for extra flavour after steaming)"` (64 chars). `scripts/build-ingredients-backfill.mjs` now has a `fitGroupName()` helper that strips a trailing parenthetical before hard-truncating; no group name over 60 chars remains.
- Notes for next phase: Phase 4 (front-end modularisation) is next. The ingredient dictionary (`scripts/data/ingredient-dictionary.mjs`) and backfill scripts are one-time authoring tools, not part of the standing `npm run check` pipeline — they're not needed again until a future recipe needs re-backfilling. `public/js/shared/units.js` (cup/spoon display formatting, Appendix C.2) will need to agree with the `units` table's `to_base` values used here (cup=240ml, tbsp=15ml, tsp=5ml).
