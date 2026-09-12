# Architecture

For what the app does and how to run it, see [`README.md`](../README.md). This is the deeper
reference: the data model, the two write/generate pipelines, the trust boundary between the
browser and the database, and how authentication could be added later without a rewrite.

## 1. Overview

```
Browser (static, native ES modules, no build step)
  ├── READS  ───────────────────────────────▶ Supabase PostgREST (anon key: SELECT only, is_deleted=false)
  │                                            views: recipe_stats, cuisine_counts, tag_counts, planner_candidates
  └── WRITES + AI ──▶ Cloudflare Pages Functions (/api/*)
                        ├─ origin check → Turnstile verify → rate limit (counts recent rows in Postgres)
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
| `recipes` | The recipe itself: name, cuisine, times, steps (jsonb), spice level, nutrition (per serving), three dietary booleans, soft-delete (`is_deleted`/`deleted_at`), plus a legacy `ingredients` jsonb mirror kept in sync for backups/rollback but read by nothing new. |
| `ingredients` | The canonical ingredient catalogue: `name` (lowercase, unique), `display_name`, `category`, four allergen/diet flags (`contains_meat`/`egg`/`dairy`/`nuts`/`gluten` — never defaulted), and a `status` (`unreviewed`/`reviewed`) used to gate the dietary auto-suggestion feature. |
| `ingredient_aliases` | Alternate spellings mapped to a canonical `ingredients.id`, so "cilantro" and "coriander leaves" resolve to the same row. |
| `recipe_ingredients` | One row per ingredient line on a recipe: `group_name`/`group_position` (e.g. "For the dough"), `position` within the group, `quantity`/`unit`/`preparation`/`is_optional`/`scales`, and `original_text` (what the user typed, kept for reference). This is what makes "scale to N servings" and a future shopping list possible — quantities are structured, not flat text. |
| `units` | The controlled unit vocabulary (cup, tbsp, tsp, g, ml, piece, to_taste, …) used for conversion (Appendix C.2's cup/spoon display). |
| `cuisines` | The controlled cuisine vocabulary (a lookup + FK from `recipes.cuisine`, replacing the original free-text field). |
| `recipe_audit_log` | Append-only: every create/update/delete/restore, `source` (`manual`/`ai`), the actor's **hashed** IP (`actor_ip_hash`, never the raw IP), and `before`/`after` jsonb snapshots. |
| `recipe_generations` | One row per AI model call (not per saved recipe): the prompt, `outcome` (`generated`/`refused`/`invalid`/`error`), the effective health goal, `is_protein_smart`, estimated neuron cost, and — if the draft was saved — the resulting `saved_recipe_id`. |
| `schema_migrations` | Filenames already applied, written by `scripts/migrate.mjs`; never edited by hand. |

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

Every function is `security invoker` with `search_path = ''` (no privilege escalation, no
search-path hijacking), and every one but the trigger function has `execute` revoked from
`public`/`anon`/`authenticated` and granted only to `service_role` — the Pages Functions' key.

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
2. **Turnstile verify** — a real `siteverify` round trip against Cloudflare; failure short-circuits
   with 403.
3. **Rate limit** — counts this IP's (hashed) recent rows in `recipe_audit_log` within the
   `WRITES_PER_IP_HOURLY` window; over the limit → 429.
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
   `'ai'`, hashed IP, before/after snapshots). Deletes are soft (`is_deleted = true`); the only hard
   deletes this codebase ever performs are `__smoke__*` rows the smoke script itself created.

### 3.2 Generate pipeline (`POST /api/recipes/generate`)

1. Origin check → Turnstile verify → rate limit, same shape as the write pipeline but against
   `recipe_generations` and both a global (`GEN_GLOBAL_DAILY`) and per-IP (`GEN_PER_IP_DAILY`)
   UTC-day window.
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

The model is default-deny: `migrations/008_default_privileges.sql` revokes all table/sequence
privileges and function execute rights from `anon`/`authenticated`/`public` for anything created
from that point on, so a future migration that adds a table without an explicit grant is private by
default, not accidentally public. RLS is enabled on every table in `public`; `recipes`' own policy
(`migrations/000_lockdown.sql`) is the one that matters most, since it's what replaced the original
schema's anonymous INSERT/UPDATE policies (the review's SEC-1 finding).

There is no session, cookie, or bearer token tied to an end user anywhere in this system today —
"the browser" and "an anonymous visitor" are the same trust level. Turnstile plus per-IP rate
limits are the only anti-abuse layer (SEC-2, deferred by owner decision — see below).

## 5. Adding authentication later

Not built, but designed for. If sign-in is ever added:

1. **Add an `owner_id uuid references auth.users` column** to `recipes` (nullable, for existing
   rows created before auth existed) and to a new `meal_plan_entries` table (see below).
2. **New RLS policies keyed on `auth.uid()`**: a signed-in user could get write access to rows they
   own directly (bypassing the Functions layer for their own data, or keeping it — a policy choice,
   not an architectural blocker either way), while `anon` keeps exactly the read-only access it has
   today.
3. **A `meal_plan_entries` table** replaces (or supplements) the browser-only planner: `owner_id,
   week_of, day, slot, recipe_id, servings, source, reasons`. This lets a signed-in user's plan sync
   across devices instead of living only in one browser's `localStorage` — `lib/planner-store.js`'s
   reducers are already pure functions over a plan object, so swapping their persistence target
   from `localStorage` to this table is a smaller change than it sounds; the scoring engine
   (`planner-engine.js`) doesn't change at all.
4. **Signed-in users could skip Turnstile** on writes (a known, rate-limitable identity is a
   reasonable substitute for a bot check) and have their rate limits scoped to `auth.uid()` instead
   of a hashed IP, which also fixes the one real gap hashed-IP limiting has today: a visitor behind
   shared/rotating IPs (mobile carrier NAT, a corporate proxy) is rate-limited less precisely than a
   stable per-user identity would allow.
5. None of the above requires touching the AI generation pipeline (§3.2) — it's already
   stateless per-request beyond the rate-limit counters, which would just move from IP-hash-keyed to
   user-id-keyed.

## 6. The shopping list (Phase 14, not built — `ENABLE_SHOPPING_LIST=false`)

If ever enabled, it builds directly on the ingredient model in §2.1: one `recipe_ingredients`
query (`in.(...)` over every planned recipe's id) scaled by `entry.servings ÷ recipe.serves`,
aggregated by `ingredient_id` and unit kind (volume/count/weight), and grouped by
`ingredients.category` into aisles. No new tables — the data model was built with this in mind from
Phase 3 onward, which is why `recipe_ingredients` stores structured quantities and units instead of
the original flat ingredient text.
