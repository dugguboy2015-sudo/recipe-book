# Architecture

For what the app does and how to run it, see [`README.md`](../README.md). This is the deeper
reference: the data model, the two write/generate pipelines, the trust boundary between the
browser and the database, and how authentication could be added later without a rewrite.

## 1. Overview

```
Browser (static, native ES modules, no build step)
  ├── READS  ───────────────────────────────▶ Supabase PostgREST (publishable key: SELECT only, RLS: public
  │                                            recipes for anon; + own household's and, for the curator,
  │                                            pending ones for a signed-in member)
  │                                            views: recipe_stats, cuisine_counts, tag_counts, planner_candidates
  └── WRITES + AI ──▶ Cloudflare Pages Functions (/api/*)
                        ├─ origin check → signed-in household member → per-member rate limit
                        ├─ ownership: a household edits its own recipes; the curator edits and approves any
                        ├─ shared validation (public/js/shared/recipe-rules.js)
                        ├─ save_recipe() RPC with the SECRET key ─▶ recipes, recipe_ingredients, recipe_audit_log
                        └─ /api/recipes/generate
                              ├─ similar_recipes() pre-check (no tokens spent on near-duplicates)
                              ├─ Workers AI (binding "AI", Llama 3.3 70B, JSON schema mode)
                              ├─ fallback: Gemini Flash (optional, free tier)
                              ├─ validate + dietary cross-check + time reconcile
                              └─ log to recipe_generations → return a DRAFT (never writes a recipe)
```

The browser never holds a credential that can write. `SUPABASE_PUBLISHABLE_KEY` (public,
committed to `public/js/config.js`) can only ever `SELECT` non-deleted rows from a handful of
tables and views, enforced by Postgres Row-Level Security, not by client-side discipline. Every
write and every AI call goes through a Cloudflare Pages Function, which is the only code that ever
sees `SUPABASE_SECRET_KEY`.

The weekly planner is the one significant piece of app state that lives **only in the browser**
(`localStorage`) — there is no `meal_plan_entries` table today. See §4 for what adding one would
involve.

## 2. Data model

### 2.1 Tables

| Table | Purpose |
|---|---|
| `recipes` | The recipe itself: name, cuisine, times, steps (jsonb), spice level, nutrition (per serving), three dietary booleans, soft-delete (`is_deleted`/`deleted_at`), plus a legacy `ingredients` jsonb mirror *intended* to stay in sync for backups/rollback but read by nothing new — **it is not reliably in sync** (M0 found it empty on rows whose structured ingredients are intact; tracked as tech debt in `plan.md`). `created_by_household` (M1a) records which household contributed a recipe — for edit rights only; recipes remain one shared public catalogue. |
| `ingredients` | The canonical ingredient catalogue: `name` (lowercase, unique), `display_name`, `category`, four allergen/diet flags (`contains_meat`/`egg`/`dairy`/`nuts`/`gluten` — never defaulted), and a `status` (`unreviewed`/`reviewed`) used to gate the dietary auto-suggestion feature. |
| `ingredient_aliases` | Alternate spellings mapped to a canonical `ingredients.id`, so "cilantro" and "coriander leaves" resolve to the same row. |
| `recipe_ingredients` | One row per ingredient line on a recipe: `group_name`/`group_position` (e.g. "For the dough"), `position` within the group, `quantity`/`unit`/`preparation`/`is_optional`/`scales`, and `original_text` (what the user typed, kept for reference). This is what makes "scale to N servings" and a future shopping list possible — quantities are structured, not flat text. |
| `units` | The controlled unit vocabulary (cup, tbsp, tsp, g, ml, piece, to_taste, …) used for conversion (Appendix C.2's cup/spoon display). |
| `cuisines` | The controlled cuisine vocabulary (a lookup + FK from `recipes.cuisine`, replacing the original free-text field). |
| `recipe_audit_log` | Append-only: every create/update/delete/restore, `source` (`manual`/`ai`), the actor's **hashed** IP (`actor_ip_hash`, never the raw IP), `before`/`after` jsonb snapshots, and (M1a) `actor_user_id` for signed-in writes — per-member attribution lives here rather than on `recipes`, because recipes are publicly readable. |
| `recipe_generations` | One row per AI model call (not per saved recipe): the prompt, `outcome` (`generated`/`refused`/`invalid`/`error`), the effective health goal, `is_protein_smart`, estimated neuron cost, and — if the draft was saved — the resulting `saved_recipe_id`. |
| `schema_migrations` | Filenames already applied, written by `scripts/migrate.mjs`; never edited by hand. |
| `households` | (M1a) One row per household — the tenant. |
| `household_members` | (M1a) Which users belong to which household, with a `role` (`owner`/`member`) and a `display_name`. `user_id` is unique: one household per user. |
| `household_invites` | (M1a) Unguessable, expiring invite codes. Bearer secrets — RLS on with no policy, so no client can read them; created and redeemed only through a Function. |
| `household_settings` | (M1a) The per-household rules `config/household.json` holds today, stored as jsonb in the same shape. Not yet read by anything — M1d moves the consumers over. |

### 2.2 Views (all `security_invoker = true`, so they run with the *caller's* privileges, not the view owner's)

| View | Purpose |
|---|---|
| `recipe_stats` | One aggregated row for the dashboard tiles (total, vegetarian, egg-free, protein-smart, top cuisine) — replaces a full-table scan. |
| `cuisine_counts` / `tag_counts` | Every cuisine/tag currently in use with its live recipe count, for filter facets. |
| `planner_candidates` | The bounded (`limit 500`) pool the planner's scoring engine reads: `id, name, slug, cuisine, meal_types, serves, total_time_minutes, is_protein_smart, spice_level, contains_nuts`. An explicitly allowed exception to "no full-table reads," since it's capped and the planner needs the whole live catalogue to score against. |
| `recipe_dietary_derived` | Per-recipe booleans **derived from ingredient flags** (true vegetarian/egg-free/dairy status by looking at what's actually in the recipe), used to cross-check the human-entered dietary answers on save. |
| `ingredient_usage` | Each ingredient's use count across all recipes, for the (not-yet-built) "merge a duplicate ingredient" operator tooling. |

### 2.3 Functions (RPCs)

| Function | Callable by | Purpose |
|---|---|---|
| `save_recipe(id, expected_updated_at, recipe jsonb, ingredients jsonb)` | `service_role` only | The one write path for create/update — see §3.1. |
| `similar_recipes(q text, lim int)` | `service_role` only | Trigram (`pg_trgm`) name similarity, internal cutoff 0.3; the generate endpoint applies its own 0.6 threshold on top before treating a match as a near-duplicate. |
| `match_ingredient(q text)` | `service_role` only | Trigram ingredient-name matching, used when resolving an AI draft's ingredient names to existing catalogue rows. |
| `refresh_recipe_derived(recipe_id)` | called internally by `save_recipe` | Recomputes `is_protein_smart` and the nutrition-derived flags after a save. |
| `set_updated_at()` | trigger only | Keeps `recipes.updated_at` current (the original schema had no such trigger — every row shared the same value as `created_at`). |
| `current_household_id()` | `authenticated`, `service_role` | (M1a) The caller's own household id, keyed on `auth.uid()`. Used by every household RLS policy. |

Every function is `security invoker` with `search_path = ''` (no privilege escalation, no
search-path hijacking), and every one but the trigger function and `current_household_id()` has
`execute` revoked from `public`/`anon`/`authenticated` and granted only to `service_role` — the
Pages Functions' key.

**The one exception is `current_household_id()`, which is `SECURITY DEFINER`.** A policy on
`household_members` that reads `household_members` through an invoker function recurses, so the
membership lookup has to bypass RLS. It is still safe: it takes no arguments, keeps
`search_path = ''`, and only ever returns the *caller's own* household — there is nothing for a
caller to escalate to.

### 2.4 Constraints worth knowing about

- **Dietary booleans are `NOT NULL` with no default.** The original schema defaulted
  `is_egg_free`/`is_vegetarian` to `true` — the single worst finding in the original review
  (SEC-adjacent DATA-1): a recipe with no answer looked "safe" for everyone. There is no code path
  anywhere (DB default, Function, form) that can now produce a dietary answer the human didn't
  explicitly give.
- **`is_deleted` is `NOT NULL DEFAULT false`** (was nullable, so `is_deleted = false` filters used
  to silently exclude legitimately-untouched rows).
- **Optimistic concurrency**: `save_recipe`'s update path requires the caller's
  `expected_updated_at` to still match the live row, or it raises `PT409` (→ HTTP 409, "someone
  else edited this"). A `PT404` distinguishes "doesn't exist or already deleted."

## 3. The two pipelines

### 3.1 Write pipeline (`POST/PATCH/DELETE /api/recipes[/:id]`)

1. **Origin check** — the request's `Origin` header must match the Pages domain, or it's rejected
   before anything else runs.
2. **Member check** (M1c, `functions/_lib/write-guard.js`) — the bearer token is validated with
   Supabase Auth and the user must belong to a household: no token → 401 `sign_in_required`, no
   household → 403 `no_household`. This replaced the per-request Turnstile check.
3. **Rate limit** — counts this *member's* recent rows in `recipe_audit_log` (`actor_user_id`)
   within the `WRITES_PER_USER_HOURLY` window; over the limit → 429.
3a. **Ownership** (edit, delete, restore) — `shared/permissions.js`'s `canEditRecipe`: the
   contributing household, or the curator. Another household's pending recipe is a 404 (it can't
   see it); its public one is a 403 `not_your_recipe`. Creates go through
   `save_household_recipe()`, which stamps `created_by_household` and `catalogue_status`
   (`public` for the curator, `pending` for everyone else) in the same transaction.
   `POST /api/recipes/:id/approve` is the curator's pending → public.
4. **Shared validation** (`public/js/shared/recipe-rules.js`'s `normalizeRecipeInput`) — the exact
   same validation the browser form runs, re-run server-side so a Function call bypassing the UI
   can't skip it. Whitelists writable fields (Appendix C), reconciles prep/cook/total time, and
   requires nutrition when appropriate.
5. **`save_recipe()` RPC**, called with the secret key — one transaction that upserts the recipe
   row, replaces its `recipe_ingredients` rows (resolving each ingredient by id or, for a brand-new
   one, by name/alias — creating it as `status='unreviewed'` if nothing matches), recomputes
   derived flags, and **raises `PT400: dietary_mismatch`** if the human's dietary answers disagree
   with what the ingredients actually contain (e.g. marked vegetarian but an ingredient is flagged
   `contains_meat`). The Function maps `PT400`/`PT404`/`PT409` to the matching HTTP status and a
   JSON error body the form displays inline.
6. **Audit log** — every successful write appends a `recipe_audit_log` row (`source: 'manual'` or
   `'ai'`, the acting member's user id, hashed IP, before/after snapshots). Deletes are soft (`is_deleted = true`); the only hard
   deletes this codebase ever performs are `__smoke__*` rows the smoke script itself created.

### 3.2 Generate pipeline (`POST /api/recipes/generate`)

1. Origin check → member check → quota, same shape as the write pipeline but against
   `recipe_generations` and both a global (`GEN_GLOBAL_DAILY`) and per-household
   (`GEN_PER_HOUSEHOLD_DAILY`) UTC-day window. Nutrition estimates share both budgets.
2. **`similar_recipes()` pre-check** — if the prompt closely matches an existing recipe name
   (≥0.6 trigram similarity), the endpoint returns that match instead of spending a model call.
3. **Workers AI** (binding `AI`, JSON schema mode) generates a draft against a prompt built from
   `config/household.json` (diet, favourite cuisines, protein goal) plus the request's own
   constraints (serves, max time, meal type). If Workers AI fails and `GEMINI_API_KEY` is set,
   Gemini Flash is the fallback.
4. **Validation** reuses the same `normalizeRecipeInput` as the write pipeline (`requireNutrition:
   true`), plus a household dietary cross-check and the protein-goal logic (Appendix J): the
   endpoint gets **at most two model calls per request total** — one retry, shared between a
   parse/transport failure and a content-validation failure, never both.
5. Every attempt is logged to `recipe_generations` with an `outcome` (`generated` — this became the
   returned draft; `invalid` — structurally fine but superseded by the retry or ultimately
   rejected; `error` — parse/transport failure; `refused` — the request itself didn't pass
   `request_ok` checks) so `docs/operations.md`'s usage queries can distinguish "the model produced
   something bad" from "the model call itself failed."
6. **The endpoint never inserts a recipe.** It returns the draft; the human reviews it in the exact
   same form used for manual entry (ingredients pre-populated, resolved against the catalogue) and
   saves through the normal write pipeline above — so every save, AI-originated or not, goes
   through the same validation and dietary cross-check.

### 3.3 The planner engine

`public/js/shared/planner-engine.js` is a pure, DOM-free, no-network module — the only pipeline
that runs entirely in the browser with zero AI cost. Given the household profile, the current
week's plan, and a small `localStorage`-backed preference record (`recipeBook.prefs.v1`: per-recipe
manual/kept/removed/loved/notAgain counts and a 12-week history), it scores every candidate recipe
on affinity, cuisine fit, slot fit, protein-smartness, day fit, novelty, and recency, then greedily
fills empty slots and repairs the fill until at least 60% of Packed Lunch/Lunch/Dinner slots are
protein-smart (or reports a shortfall instead of silently failing). `lib/planner-store.js` is the
only thing that touches `localStorage` — schema versioning (a v1→v2 migration ran once, when this
model replaced the original flat per-day array), week rollover/archival, and the reducers
(add/remove/keep/shuffle) all live there, kept deliberately separate from the scoring logic so
either can be tested without the other.

## 4. Trust boundaries

| Can... | anon (browser) | authenticated | service_role (Functions only) |
|---|---|---|---|
| `SELECT` `recipes` where `is_deleted = false` | ✅ | ✅ | ✅ |
| `SELECT` a soft-deleted recipe | ❌ | ❌ | ✅ |
| `SELECT` the read views (§2.2) | ✅ (each explicitly granted) | ✅ | ✅ |
| `INSERT`/`UPDATE`/`DELETE` `recipes` directly | ❌ | ❌ | ❌ — nothing has direct table write access; only `save_recipe()` writes, and only `service_role` can execute it |
| Execute `save_recipe`/`similar_recipes`/`match_ingredient` | ❌ | ❌ | ✅ |
| Read `recipe_audit_log` / `recipe_generations` | ❌ | ❌ | ✅ |
| `SELECT` `households` / `household_members` / `household_settings` | ❌ | ✅ own household only (RLS via `current_household_id()`) | ✅ |
| `SELECT` `household_invites` | ❌ | ❌ | ✅ |
| Write any household table | ❌ | ❌ | ✅ — through Functions only, like recipes |

The model is default-deny: `migrations/008_default_privileges.sql` revokes all table/sequence
privileges and function execute rights from `anon`/`authenticated`/`public` for anything created
from that point on, so a future migration that adds a table without an explicit grant is private by
default, not accidentally public. RLS is enabled on every table in `public`; `recipes`' own policy
(`migrations/000_lockdown.sql`) is the one that matters most, since it's what replaced the original
schema's anonymous INSERT/UPDATE policies (the review's SEC-1 finding).

Since M1c every write and every AI call carries a Supabase Auth bearer token for a member of a
household; anonymous visitors can only read the public catalogue. The anti-abuse layers are email
verification (sign-in is by emailed link), per-member write limits, per-household AI quotas, and
"private until approved" for new households' recipes. Turnstile protects the sign-in email instead
of each write — see §5.

## 5. Authentication and households (M1 — in progress)

The original sketch here keyed everything on a per-user `owner_id`. Owner decisions on 2026-09-18
(shared household login with members; recipes as one shared catalogue; commercialising later)
replaced that with **households as the tenant**. M1 is built in slices — see `plan.md`:

1. **Tenancy schema (M1a — shipped).** `households`, `household_members` (one household per user),
   `household_invites`, `household_settings` — §2.1. Every household table is readable only by its
   own members, through RLS on `current_household_id()` (§2.3); every write goes through a Function.
   `anon` keeps exactly the read-only recipe access it has always had.
   **Sign-in and onboarding (M1b — shipped).** Supabase Auth, emailed sign-in link only (no
   passwords), implicit flow so a link opened on another device still signs in; the browser client
   persists the session (`lib/supabase-client.js`). Functions never trust a client-supplied user id:
   `functions/_lib/auth.js` validates the bearer token against `GET /auth/v1/user` on every call.
   - `POST /api/household` → RPC `create_household` (household + owner membership + settings in
     one transaction; the unique `household_members.user_id` makes a second one fail with 409).
     If the verified email equals the `FOUNDING_OWNER_EMAIL` Pages secret, the household gets
     `config/household.json` as its settings, `is_curator = true`, and claims every recipe whose
     `created_by_household` is null. Otherwise settings are `buildNewHouseholdSettings()`
     (`shared/household-settings.js`): the file as a template with the chosen diet preset and
     household-specific fields reset.
   - `POST /api/household/invites` (owner only, ≤10 live) inserts a 32-char code, valid 7 days.
   - `GET /api/household/join?code=` names the household for the join screen (unknown, used and
     expired codes are one indistinguishable 404); `POST` → RPC `redeem_household_invite`, which
     locks the invite row, adds the member and marks the invite used, all in one transaction.
   - Both RPCs are `security invoker`, executable by `service_role` only (migration 016).
   - Client: `components/account.js` (header control, on every page, tiny) and
     `components/account-dialogs.js` (lazy). An `?invite=` link is moved into `localStorage` so it
     survives the email round trip. Supabase Auth settings are managed by
     `scripts/configure-auth.mjs` (`npm run auth:configure`, dry run by default).
2. **Recipes stay global.** Instead of `owner_id`, `recipes.created_by_household` records the
   contributing household, which governs *edit* rights (M1c) and never visibility. There is
   deliberately no user id on recipes, since they are public — per-member attribution goes to
   `recipe_audit_log.actor_user_id`.
3. **Planner storage (M1e)** replaces (or supplements) the browser-only planner, scoped by
   `household_id` rather than `owner_id`, with per-member attribution on entries. This lets a signed-in user's plan sync
   across devices instead of living only in one browser's `localStorage` — `lib/planner-store.js`'s
   reducers are already pure functions over a plan object, so swapping their persistence target
   from `localStorage` to this table is a smaller change than it sounds; the scoring engine
   (`planner-engine.js`) doesn't change at all.
4. **Member-only writes (M1c — shipped).** See §3.1–3.2: writes and AI calls need a signed-in
   household member; limits follow the member (writes) or household (AI) rather than a hashed IP,
   so a family behind one carrier NAT no longer shares a budget with strangers. Migration 017 adds
   `recipes.catalogue_status` and splits the recipes read policy — `anon`: public only;
   `authenticated`: public, plus its own household's, plus (curator) every pending recipe. The read
   views and `recipe_ingredients`' policy inherit this unchanged because they are
   `security_invoker` / read through `recipes`.
5. **Turnstile moved to sign-in.** The sign-in dialog obtains a Turnstile token (rendered inside the
   modal, since a challenge under a modal can't be clicked) and passes it to Supabase as
   `captchaToken`. It fails open, and Supabase only enforces it once its sign-in captcha is switched
   on (`security_captcha_enabled`, provider `turnstile`, the Turnstile secret) — deliberately not
   yet done; see `docs/operations.md`.

## 6. The shopping list (Phase 14, not built — `ENABLE_SHOPPING_LIST=false`)

If ever enabled, it builds directly on the ingredient model in §2.1: one `recipe_ingredients`
query (`in.(...)` over every planned recipe's id) scaled by `entry.servings ÷ recipe.serves`,
aggregated by `ingredient_id` and unit kind (volume/count/weight), and grouped by
`ingredients.category` into aisles. No new tables — the data model was built with this in mind from
Phase 3 onward, which is why `recipe_ingredients` stores structured quantities and units instead of
the original flat ingredient text.
