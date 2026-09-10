# Recipe Book — agent notes

Read `docs/progress.md` first. If resumed in a new session, continue from the first phase not marked `DONE` there. The full spec is `improvement_plan.md` — read its §§1–4 before touching anything; phases are in §5.

## Project map

```
public/            static site served by Cloudflare Pages (no build step; native ES modules only)
  js/               front-end logic
  _headers          CSP and other response headers
functions/api/      Cloudflare Pages Functions (server-side; holds the secret Supabase key)
migrations/         SQL applied only via scripts/migrate.mjs, in filename order, never edited once applied
scripts/            tooling: preflight, backup, migrate, sql, check-secrets, smoke, dev:vars, secrets:push
config/household.json   the household profile driving AI prompts, validation, planner and UI
docs/progress.md    one entry per phase — append, don't rewrite
```

## Commands

```bash
npm run check       # lint + unit tests + secret scan — run before every commit
npm run preflight    # verify every credential works
npm run backup       # snapshot recipes/policies/grants/columns before a migration
npm run migrate       # apply pending migrations/*.sql
npm run migrate -- --dry-run
npm run sql -- --read-only "select …"
npm run dev           # wrangler pages dev, local Functions + Workers AI
npm run dev:vars      # regenerate .dev.vars from .env.local
npm run smoke -- --base <url>          # read-only checks against any deployment
npm run smoke -- --base http://localhost:8788 --write   # local only, uses Turnstile test keys
```

## Hard constraints (see improvement_plan.md §2 for the full list)

- Free tier only across Cloudflare, Supabase, GitHub, Google AI Studio. Hit a limit → STOP.
- Secrets never committed, logged, or echoed. `.env.local` and `.dev.vars` are gitignored.
- The Supabase **secret** key lives only in Pages secrets and `.dev.vars`; nothing in `public/` may reference it.
- No hard deletes of recipe rows except `__smoke__*` rows the smoke script itself created.
- SQL against production only through `migrations/*.sql` + `scripts/migrate.mjs`, or `scripts/sql.mjs --read-only`. Back up first.
- Expand/contract migrations: never remove or rename something the *currently live* code reads.
- Every new `public` table gets RLS and explicit revokes in the same migration; views use `security_invoker = true`.
- No build step, no framework/bundler in `public/`. No `ajv`/`eval`/`new Function` in Functions.
- The AI never writes a recipe directly — it returns a draft; only `POST /api/recipes` inserts.
- Dietary booleans (`is_vegetarian`, `is_egg_free`, `contains_dairy`, …) are never defaulted anywhere.
- No user accounts/sign-in (out of scope by owner decision, for now).
- All UI comes from the Phase 5 design system — no one-off colours, sizes or components.
- Household rules (`config/household.json`) are product requirements, not suggestions.
- Recipe quantities are stored per the recipe's `serves`; changing servings is display-only scaling.
- Nutrition values are estimates — label them as such.

## Git & deploy workflow

One branch per phase (`phase-N-name`), small commits, `npm run check` before pushing, PR against `main` with acceptance results and the preview URL, merge (squash) once CI and preview smoke pass, then verify production smoke. Full detail in `improvement_plan.md` §4.
