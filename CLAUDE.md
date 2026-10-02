# Recipe Book — agent notes

**`improvement_plan.md` is the one and only plan.** It holds the current state, the target state,
the owner's standing decisions, the hard constraints, the operating procedures and the roadmap.
There is exactly one such file and it lives at the repo root — never create a second plan,
roadmap, spec or backlog document beside it (`plan.md`, `ux-uplift-plan.md`,
`improvement_plan_v2.md` and `parity-checklist.md` were consolidated into it on 2026-10-01).
Amend that file instead, and append the outcome of each slice to `docs/progress.md`.

Everything specified so far is shipped and live: the 13 phases of the original build spec, the
A–D responsive uplift, and milestones M0–M6 (accounts and households, the shopping list, dish
illustrations and sharing, PWA/offline and mobile IA, favourites/fridge search/leftovers/cooked
history, and the polish backlog), and the six-slice UX uplift P1–P6 (the app shell, URL routing,
the recipe detail on a phone, finding a recipe, planner and shopping in one hand, speed and
accessibility). What remains is `improvement_plan.md` §6.1–§6.3: a stray household row, two things
only the owner can do, and two items deferred by decision. Read `docs/progress.md` before making further changes —
it is the actual history of what this codebase is and why, in more detail than fits here.
`README.md`, `docs/architecture.md` and `docs/operations.md` are the maintained, current-state
references for running, understanding and operating the app day to day.

## Project map

```
public/            static site served by Cloudflare Pages (no build step; native ES modules only)
  index.html, recipes.html, planner.html, shopping.html   the four pages
  js/               front-end logic — pages/, components/, lib/, shared/
  css/              tokens.css (design tokens) → base.css → components.css → pages.css
  styleguide.html   every design-system component in every state, both themes (not in the nav)
  _headers          CSP and other response headers
functions/api/      Cloudflare Pages Functions (server-side; holds the secret Supabase key)
migrations/         SQL applied only via scripts/migrate.mjs, in filename order, never edited once applied
scripts/            tooling: preflight, backup, restore, migrate, sql, check-secrets, smoke, dev:vars, secrets:push
config/household.json   the founding household's profile and the template for new ones (per-household
                        settings live in the database since M1d)
improvement_plan.md     THE plan — current state, target state, decisions, constraints, procedures,
                        roadmap. The only one; never add a second plan file
docs/architecture.md    data model, trust boundaries, the write/generate pipelines
docs/operations.md      changing limits, rotating secrets, restoring data, reading the audit log
docs/progress.md        one entry per slice — append, don't rewrite
```

Two things worth knowing before touching `public/js/`, since they're easy to get wrong by copying
the nearest existing import: **no bundler means no tree-shaking** — importing one named export
from a file costs that file's *entire* size over the network, so a widely-used small utility
(`escapeHtml`, the day/slot constants) lives in its own tiny module (`shared/html.js`,
`shared/planner-constants.js`) rather than a large one, and anything only needed after a user
action (the add/edit form, the AI ask-dialog's content) loads via dynamic `import()` on first use,
not a static import — see `docs/progress.md`'s Phase 12 entry for the measured impact. And DOM/
browser-API code (anything touching `document`, `localStorage`, a real `<dialog>`) is verified by
hand against a live Cloudflare Pages preview, not in Vitest — this project's tests run in a plain
Node environment (no jsdom), so only pure logic is unit-tested; UI behavior is confirmed in a real
browser at the end of the branch that changes it.

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

## Hard constraints (see `improvement_plan.md` §4 for the full list and the reasoning)

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
- All UI comes from the design system — no one-off colours, sizes or components; both themes checked.
- Household rules are product requirements, not suggestions — per household in the database since M1d, not a static config file.
- Recipe quantities are stored per the recipe's `serves`; changing servings is display-only scaling.
- Nutrition values are estimates — label them as such.

## Git & deploy workflow

One branch per slice, cut from and targeting `main` — never stacked. Small commits, `npm run check` before pushing, PR against `main` with acceptance results and the preview URL, merge (squash) once CI and preview smoke pass, then verify production smoke. Full detail in `improvement_plan.md` §5.
