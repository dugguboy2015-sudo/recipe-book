# Recipe Book

A family recipe manager, weekly planner, and AI recipe generator — built as a static site on
Cloudflare Pages with a Supabase Postgres backend. No build step, no framework, no user accounts.

Live at **https://recipe-book-9eo.pages.dev**.

## What it does

- **Browse and search** a recipe collection by cuisine, tag, meal type, and dietary fit
  (vegetarian, egg-free, dairy-free, protein-smart, nut-free, spice level), with per-serving
  nutrition estimates and % reference-intake bars.
- **Ask for a recipe**: describe what you want in plain language and an AI model (Cloudflare
  Workers AI, with a Gemini fallback) drafts one — ingredients, method, nutrition estimate — for a
  human to review and save. The AI never writes to the database directly; it only ever returns a
  draft.
- **Plan the week**: a browser-only planner that learns from what you keep, remove, and rate.
  "Auto-fill my week" scores the catalogue against your household's preferences (favourite
  cuisines, a 60%-protein-smart target, recency, novelty) and fills empty slots; Shuffle and Keep
  let you steer it. Everything is saved to `localStorage` — there's no server-side planner state —
  and Export/Import move a plan between devices.
- Recipes scale to any number of servings (ingredients are structured rows with per-recipe
  `serves`, not flat text), and every recipe records who it's safe for via three dietary flags that
  are never defaulted — a missing answer is always treated as "don't know," never "safe."

Nutrition figures are computed estimates, not medical advice, and are always labelled as such.
"Protein-smart" (a generated flag reflecting your `config/household.json` protein goal) is a
convenience label for meal planning, not a nutritional guarantee.

## Architecture

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

See [`docs/architecture.md`](docs/architecture.md) for the full data model, trust boundaries, and
the two pipelines in detail.

## Local setup

You need Node 20+, a Supabase project, and Cloudflare/Turnstile/Google AI Studio accounts — all on
their free tiers.

```bash
git clone <this repo>
cd recipe-book
cp .env.local.example .env.local   # fill in the values described inline — never commit this file
npm install
npm run dev:vars                    # turns .env.local into .dev.vars for local Functions
npm run dev                         # wrangler pages dev — serves public/ + functions/api/* at :8788
```

`npm run preflight` checks every credential in `.env.local` actually works before you rely on it.

> **Known limitation:** `npm run dev` cannot currently start on every machine — `wrangler.toml`'s
> `[ai]` binding tries to establish a remote Workers AI session before serving any route, which
> needs a broader Workers Scripts token scope than a Pages-only token has. If `npm run dev` hangs
> or fails immediately, this is why; iterate against a Cloudflare Pages preview URL instead (every
> PR gets one automatically). See `docs/operations.md`'s troubleshooting section.

Run `npm run check` before every commit — it runs lint, the unit test suite, a secrets scan, and
CSS/contrast lint in one go.

## Deploys

Cloudflare Pages is git-connected: **pushing to `main` deploys to production**, and every other
branch/PR gets its own preview URL automatically. There is no separate deploy step or CI/CD
pipeline to trigger by hand.

## Database migrations

SQL only ever reaches production through `migrations/*.sql`, applied in filename order by
`npm run migrate` (dry-run with `npm run migrate -- --dry-run`). Migrations are expand/contract:
a migration never removes or renames something the code currently live on `main` still reads —
that cleanup happens in a later migration, after the code that stops reading it has already
deployed. Run `npm run backup` before applying anything to production.

## Configuration

[`config/household.json`](config/household.json) is the single source of truth for who the app
cooks for — diet, favourite cuisines, protein goal, serving defaults. It drives the AI prompt,
draft validation, form warnings, the planner engine, and dashboard copy. To change it: edit the
file, run `npm run check` (which verifies `public/config/household.json` is a synced copy — the
sync happens automatically via `scripts/sync-config.mjs`), then merge; the next deploy picks it up
with no other steps.

## Free-tier limits

Everything runs on free tiers by design (Cloudflare Pages + Functions + Workers AI + Turnstile,
Supabase, GitHub Actions, Google AI Studio). The two limits you're likely to actually hit:

- **AI generations**: `GEN_GLOBAL_DAILY` (default 18) per day site-wide, `GEN_PER_IP_DAILY`
  (default 5) per visitor per day, both UTC-day windows. Once hit, `/api/recipes/generate` returns
  429 with a "come back after midnight UTC" message instead of failing silently — the AI dialog
  shows this to the user directly. Workers AI's own daily neuron allocation is a separate, larger
  ceiling; if that runs out first, the endpoint automatically falls back to Gemini when
  `GEMINI_API_KEY` is set.
- **Writes**: `WRITES_PER_IP_HOURLY` (default 30) per visitor per hour, covering create/edit/delete
  together.

Raising any of these is a `wrangler.toml` `[vars]` edit + merge, no redeploy trigger needed beyond
the push itself — see `docs/operations.md`.

## Project layout

```
public/            the static site Cloudflare Pages serves (no build step; native ES modules only)
  js/               front-end logic — pages/, components/, lib/, shared/ (see CLAUDE.md for the split)
  css/              tokens.css (design tokens) → base.css → components.css → pages.css
  styleguide.html   every design-system component in every state, both themes (not in the nav)
functions/api/      Cloudflare Pages Functions — the only code that ever sees the Supabase secret key
migrations/         SQL, applied only via scripts/migrate.mjs, in filename order, never edited once applied
scripts/            tooling — preflight, backup, restore, migrate, sql, check-secrets, smoke, dev:vars
config/household.json   the household profile (see Configuration, above)
docs/               architecture.md, operations.md, progress.md (one entry per build phase), parity-checklist.md
```

## Testing

`npm test` runs the Vitest suite (pure logic and mocked Functions/DOM-adjacent code — no real
network or AI calls in CI). UI behavior that genuinely needs a DOM or a live Turnstile challenge is
verified by hand against a real Cloudflare Pages preview instead; see `docs/progress.md` for what
was checked at each phase.

## Further reading

- [`docs/architecture.md`](docs/architecture.md) — data model, trust boundaries, the write and
  generate pipelines, and how auth could be added later.
- [`docs/operations.md`](docs/operations.md) — changing limits, rotating secrets, restoring from
  backup, un-deleting a recipe, reading the audit log, and AI usage reporting.
- [`docs/progress.md`](docs/progress.md) — the build log: one entry per phase, with acceptance
  results and deviations from the original spec.
- [`CLAUDE.md`](CLAUDE.md) — project conventions and hard constraints for anyone (human or agent)
  extending this codebase.
