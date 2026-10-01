# Recipe Book — the plan

| | |
|---|---|
| **Version** | 4.0 — 2026-10-01 |
| **Status** | Current. Sections 1–5 describe what is true today; section 6 is the work that remains |
| **Live** | https://recipe-book-9eo.pages.dev · Cloudflare Pages, git-connected (push to `main` = production deploy) |
| **Repo** | `github.com/dugguboy2015-sudo/recipe-book` |
| **Database** | Supabase project `xtxufygmwqicrgzjwdxc` |
| **History** | `docs/progress.md` — one appended entry per phase. This file says what to do; that file says what was done |

---

## 0. How to use this file

**This is the only plan.** One file, at this path, for every roadmap, spec, backlog and
improvement plan. Do not create `plan.md`, `ux-uplift-plan.md`, `improvement_plan_v2.md`,
`roadmap.md`, or a new plan beside this one — amend this one. When a slice ships, move it from
section 6 to the shipped list in section 1 and append the real outcome to `docs/progress.md`.

The surrounding documents each have a different job and are **not** plans:

| File | Job |
|---|---|
| `improvement_plan.md` (this) | What to build and why. The single source of truth for intent |
| `docs/progress.md` | What was actually built, with deviations. Append-only history |
| `docs/architecture.md` | How the system is shaped today — data model, pipelines, trust boundaries |
| `docs/operations.md` | How to run it — limits, secrets, restores, the audit log |
| `README.md` | How to get it running |
| `public/styleguide.html` | Every design-system component, both themes |
| `design_handoff_recipe_book_redesign/` | The 2026-09-15 design handoff; source of record for the visual language |

This file replaced four overlapping plan documents on 2026-10-01 — see section 8.

---

## 1. Where things stand

Everything specified before today is **shipped and live**: the 13 phases of the original build
spec, the A–D responsive uplift, milestones M0–M6. 433 tests pass; production smoke is green.

### Capability today

| Area | What exists |
|---|---|
| Catalogue | 31 recipes, structured ingredients, display-only servings scaling, nutrition with traffic lights, curated dish illustrations |
| Search | Full-text, cuisine, tag, meal type, dietary, spice ceiling, favourites-only; filters live in the URL |
| Fridge search | Rank recipes by what you already have, by fewest items still to buy |
| AI | Draft a recipe from a description, estimate nutrition; 5/day per household; the model never writes to the database |
| Planner | Day / Week / Month, multi-week, auto-fill that learns, shuffle, keep, servings, leftovers, cooked ticks, per-member attribution |
| Shopping | Built from the week's plan, aggregated across meals, pantry staples separated, manual items, ticks shared across the household |
| Kitchen | Cook mode: full screen, one step at a time, screen kept awake |
| Household | Accounts (email magic link), members, invites, roles, per-household diet and meal slots, curator approval for new recipes |
| Platform | Installable PWA, offline catalogue, print, share links, light/dark, RLS default-deny, append-only migrations |

### The honest assessment

The engineering is sound. **The interface is not**, and that is the whole of section 6.

Measured on production, signed out, 2026-10-01, at 375 / 834 / 1440×900:

| What | Measured |
|---|---|
| Hero before any content | 202–295px, all four pages, every width |
| Dashboard / Recipes / Planner / Shopping: first real content | 451 / 679 / 997 / 579px down a 973px viewport |
| Recipes at 1440×900 | First card at 992px — **no recipe above the fold** |
| Recipe detail on a phone | 343px wide in a 449px viewport, **9.4 screens** of scroll, only Close button at y=6,641 |
| Planner Week on a phone | Content 1,146px wide inside a 317px column — 3.6× horizontal scroll |
| Search field on a phone | **Not rendered** — it lives inside the filter sheet |
| Recipe grid at 834px | 1 column, 487px card, 347px empty beside it |
| Opening a recipe | URL does not change; **Back leaves the page** instead of closing the recipe |
| `?recipe=<slug>` deep link | Works on load, then **stripped from the address bar** |
| Recipe card title tap target | 24px tall (guideline: 44px) |
| Page JS: modules / bytes / import depth | recipes 34 / 200,574 / **7** · planner 29 / 203,226 / 7 · dashboard 28 / 155,719 / 7 |

Three causes underneath all of it:

1. **Every page opens with a magazine cover** — display type aimed at someone deciding whether to
   use the product, shown every time to people who already decided.
2. **The app has no sense of place** — no URL for what is on screen, so the phone's most-used
   gesture loses your place, and shareable links the app already generates do not survive arrival.
3. **The phone inherited the desktop's furniture** — floating dialogs and a 7-column grid on a
   375px screen.

The A–D uplift (2026-09-15) delivered the shell: desktop sidebar, theme switcher, filter
discoverability, dashboard composition. It did not cover hierarchy, routing, or the phone-specific
detail view, which is why those three remain.

---

## 2. Target state

What "finished" means for this app. Everything in section 6 is justified by moving toward one of
these; anything that is not, is out of scope.

1. **It opens on something useful.** On any page, at any width, the first 200px contain the thing
   that page is for — not a headline.
2. **It behaves like an app.** The URL describes what is on screen; Back undoes the last thing you
   did; a link to a recipe can be shared, bookmarked and refreshed.
3. **The phone is the primary device**, because that is where a recipe is read, a list is ticked and
   a week is planned. Desktop gets the extra column it has room for; it does not set the pattern.
4. **The daily things are one tap away** — search, cook, plan. The yearly things (export, import,
   reset) are behind a menu.
5. **It is honest about state** — signed out, you are told your week is on this device only, before
   you discover it on a second phone.
6. **It is fast on a cold phone** — first content in one network wave, not seven.
7. **Nothing regresses**: free tier, no build step, RLS default-deny, dietary booleans never
   defaulted, tests green.

---

## 3. Standing decisions

Owner decisions. These do not get relitigated by an implementing agent; they change only when the
owner changes them here.

### Product (2026-09-18)

1. **Household model** — one shared household login with members added to it; attribution tracked
   per member.
2. **Sign-in** — email magic link now; Google later.
3. **Who can create a household** — anybody; they then invite their own family.
4. **New households' recipes** — private to that household until the curator (the founding
   household) approves them into the shared catalogue.
5. **Diet is per household** — not vegetarian-only. It drives AI prompts, validation, planner,
   copy, and which catalogue recipes a household sees.
6. **Photos** — curated illustrations now; real photo upload later (still deferred, §6.3).
7. **AI quota** — 5/day, per household.
8. **Recipes are a shared catalogue**, not per-household silos.
9. **Audience** — family now, with commercialising in mind. Household rules live in the database,
   not in a config file baked into one deployment.
10. **Shopping list** — "to taste" never gets a number; pantry staples listed separately under
    "check you have these"; manual items allowed; ticks shared across the household.

### Design (2026-09-15, from the handoff)

11. **The visual language is settled** — Fraunces + Work Sans, the warm palette, every colour
    already a token. Changes are structural, never a re-skin.
12. **Household slot vocabulary wins over any mock** — Breakfast, Packed Lunch, Lunch, Dinner,
    Snacks, Dessert, per household settings. Packed Lunch carries real constraints.
13. **Snap to the scale** — `--sp-*` and `--fs-1..8` only; `lint-css.mjs` fails the build otherwise.
14. **CSS media queries for layout**; `matchMedia` only where *behaviour* branches.

### Autonomy (2026-09-18)

15. Work unattended, one PR per slice cut from and targeting `main` — never stacked. Self-merge
    after CI and preview smoke pass, then verify production. Permitted to change Supabase sign-in
    settings, set Cloudflare Pages vars and secrets, and create/delete test accounts in production
    auth (and clean them up).

---

## 4. Hard constraints

Never violate. If one of these blocks progress, **STOP** and report.

1. **Free tier only** across Cloudflare (Pages, Functions, Workers AI, Turnstile), Supabase,
   GitHub Actions and Google AI Studio. No paid plan, no card on file. Hitting a free limit is a
   STOP condition, not a prompt to upgrade.
2. **Secrets never leave the machine or Cloudflare.** Never committed, logged, echoed, or placed in
   URLs, fixtures or docs. `.env.local` and `.dev.vars` are gitignored. `npm run check:secrets`
   before every commit.
3. **The secret Supabase key is server-side only** — Pages secrets and `.dev.vars`. Nothing in
   `public/` may reference it.
4. **No hard deletes of recipe rows**, except `__smoke__*` rows the smoke script itself created.
5. **Production SQL only** through `migrations/*.sql` applied by `scripts/migrate.mjs`, or
   `npm run sql -- --read-only`. `npm run backup` before any phase that migrates.
6. **Expand/contract.** Every migration must work against the code currently live on `main`.
   Nothing the live code reads is removed or renamed until the code that stopped reading it is in
   production.
7. **Every new `public` table gets RLS and explicit revokes in the same migration** — Supabase
   grants new tables to `anon` by default. Views use `security_invoker = true`.
8. **No build step for the front end.** Native ES modules only; no framework, no bundler in
   `public/`. Permitted devDependencies: `wrangler`, `vitest`, `eslint`, `@eslint/js`, `globals`.
   Anything else needs a written justification in `docs/progress.md`.
9. **No runtime code generation in Functions** — no `ajv`, `eval`, `new Function`. Validation is
   hand-written.
10. **Functions stay light on CPU** — roughly 10 ms per request on the free plan. No heavy
    libraries, no large synchronous loops.
11. **The AI never writes a recipe.** Generation returns a draft; only `POST /api/recipes` inserts,
    after a human presses Save.
12. **Dietary booleans are never defaulted** — not in the database, not in the Function, not in the
    form. Missing is an error.
13. **All UI comes from the design system** — no one-off colours, sizes or components. Both themes
    are checked; `lint-css.mjs` and `contrast.mjs` enforce it.
14. **Household rules are product requirements**, not suggestions — now per household in the
    database (M1d), not a static file.
15. **Recipe quantities are stored per the recipe's `serves`.** Changing servings is display-only
    and never rewrites stored quantities.
16. **Nutrition values are estimates.** Label them as such; never present them as medical advice.
17. **DOM and browser-API behaviour is verified in a real browser** against a Cloudflare preview,
    not in Vitest — this project's tests run in plain Node with no jsdom. Pure logic is unit-tested;
    screens are verified by hand before merge.

> Two constraints from the original spec are now obsolete and have been removed deliberately:
> *"do not add user accounts"* (accounts shipped in M1) and *"generated recipes are always
> vegetarian and egg-free"* (superseded by per-household diet, decision 5).

---

## 5. Standard operating procedures

### 5.1 Git and deploy, every slice

```bash
git switch main && git pull --ff-only
git switch -c <short-slice-name>
# … small commits …
npm run check                 # lint + unit tests + secret scan + config sync + css lint + contrast
git push -u origin HEAD
```

1. **Preview.** Cloudflare builds every pushed branch. Wait for the `Cloudflare Pages` check on the
   head commit; preview URL is `https://<branch-alias>.recipe-book-9eo.pages.dev`.
2. `npm run smoke -- --base <preview-url>` must pass.
3. **Verify the screens in a real browser** on that preview — every slice in section 6 is a UI
   slice, so this is the acceptance step, not a formality.
4. Open a PR against `main` with the acceptance results and the preview URL.
5. Merge squash once CI and preview smoke pass (per decision 15), delete the branch.
6. **Production.** Wait for the deploy, then `npm run smoke -- --base https://recipe-book-9eo.pages.dev`.
7. If production smoke fails: revert the merge, push, confirm recovery, **STOP**.

Branches are cut from and merged to `main`, never stacked. Migrations are **not** branch-scoped —
preview and production share one database — so they are applied before the branch is pushed, and
only when they satisfy expand/contract.

### 5.2 Migrations

1. `npm run backup` — verify the row count matches `select count(*) from recipes`.
2. Write `migrations/NNN_name.sql`. No `BEGIN`/`COMMIT`; the runner wraps each file in one
   transaction and records it in `public.schema_migrations`.
3. `npm run migrate -- --dry-run`, then `npm run migrate`.
4. Run the phase's verification SQL read-only, then the RLS audit — it must return zero rows.

Trial-run first against production with `begin; … rollback;` for anything non-trivial.

### 5.3 Verification ladder

| Rung | Command | When |
|---|---|---|
| Lint, tests, secrets, CSS, contrast | `npm run check` | every commit |
| Local smoke, writes | `npm run dev`, then `npm run smoke -- --base http://localhost:8788 --write` | slices touching Functions |
| Preview smoke, read-only | `npm run smoke -- --base <preview>` | every slice |
| **Browser verification** | by hand, on the preview, both widths | **every UI slice** |
| Production smoke | `npm run smoke -- --base https://recipe-book-9eo.pages.dev` | after every merge |

### 5.4 STOP conditions

- A migration fails, or its verification SQL returns something unexpected.
- A backup's row count does not match the live count.
- A Cloudflare deploy fails twice for the same commit.
- Production smoke fails after a merge — revert first, then stop.
- Any free-tier limit is hit, or anything would need a paid plan.
- A credential is missing a permission the step needs.
- This plan contradicts observed reality in a way that changes data. Record both and stop.

### 5.5 Progress log

Append one entry per slice to `docs/progress.md` — date, branch/PR, migrations, backup,
acceptance results **with the measured numbers**, deviations from this plan and why, and notes for
the next slice. Deviations are the most valuable part; write them down even when they are
embarrassing.

---

## 6. The roadmap

Six UI slices, then a short backlog. One branch and one PR each, in this order — the shell first
because every later screen sits inside it, routing second because the detail rebuild depends on it.
Sizes are relative, not calendar promises. Each slice is independently shippable: stopping after
any one of them leaves the app better, not half-rebuilt.

```
P1 shell ─▶ P2 routing ─▶ P3 recipe detail ─▶ P4 finding ─▶ P5 planner + shopping ─▶ P6 speed + a11y
```

### P1 — The app shell · *small*

Headers, navigation, and telling signed-out visitors the truth.

- Replace the four hero blocks with a compact page header (≤96px): page name, primary action,
  greeting on the dashboard. Keep the display type for the signed-out first visit and genuine
  empty states, where it is doing a real job.
- One navigation definition rendered per breakpoint, instead of three copies in every page
  (12 across the app). At ≥1200 the header nav currently survives as a single stray "Ask for a
  recipe" button while the sidebar carries navigation — fold that into one decision.
- Add a permanent, quiet line to the planner, shopping and favourites empty states when signed
  out: *saved on this device; sign in to share with your household*. Today this is said only
  inside error snackbars.
- Give the sign-in control a visible label at phone width — it is a 44px 👤 emoji today.
- Make the empty-week call to action a button, not an inline text link. Hide the protein meter
  when it has nothing to measure.

**Files:** `public/*.html`, `css/pages.css`, `css/components.css`, `js/components/account.js`,
`js/pages/dashboard.js`

**Acceptance** — first content ≤200px on all four pages at 375 and 1440 (today 451/679/997/579);
at 1440×900 at least one full recipe card above 900px (today 992); exactly one navigation visible
at any width, one "Main navigation" landmark; `npm run check` green.

### P2 — URLs and the Back button · *small*

- Opening a recipe pushes `?recipe=<slug>` (plus `serves` when scaled); closing pops it;
  `popstate` closes the dialog instead of leaving the page.
- Stop stripping `?recipe=` on load, so refresh, bookmark and re-share survive.
- Put the planner's view mode and selected date in the URL too — they are already state, just not
  addressable.
- Recipe card titles become real links, progressively enhanced by the existing click handler, with
  the hit area covering the card.

**Files:** `js/components/recipe-modal.js`, `js/components/recipe-card.js`, `js/lib/url-state.js`,
`js/pages/recipes.js`, `js/pages/planner.js`

**Acceptance** — open a recipe and the URL carries the slug; Back closes the recipe and stays on
Recipes (today it leaves the page); Forward reopens it; reload restores the same recipe and
servings; middle-click opens it in a new tab; unit tests for the URL ↔ state mapping.

### P3 — The recipe detail, rebuilt for a phone · *medium*

The core screen of the product, and the worst one.

- Below 768px: full-screen sheet, no backdrop margin, **sticky header** with title and Close, and a
  **sticky bottom bar** holding Cook mode and Add to planner.
- Secondary actions (Share, Print, Edit, Delete, Approve) into an overflow menu in that header.
- Nutrition and Notes collapsed by default on phones; Ingredients and Method open, as tabs so
  neither requires scrolling past the other.
- Desktop keeps its dialog and gains the same sticky header and action bar.

Cook mode is already right — full screen, one step at a time, screen kept awake. It is the model to
copy, not something to rebuild.

**Files:** `js/components/recipe-modal.js`, `css/components.css`, `recipes.html`

**Acceptance** (375) — Close reachable from any scroll position (today y=6,641); Cook mode one tap
from the top (today ~9 screens); sheet full viewport width (today 343 of 449); first screen to
method under 2 screens; **print output verified unchanged** — the print stylesheet keys off this
markup and has broken this way before.

### P4 — Finding a recipe · *medium*

- A persistent search field at the top of the list at every width, result count beside it, staying
  visible while scrolling on phones. It is not rendered at all on a phone today.
- Active filters as removable chips under it; the sheet keeps the long tail.
- Fridge search promoted to a peer of search, out of its collapsed `<details>`.
- Grid steps 1 column <600, 2 at ≥600, 3 at ≥1000, 4 at ≥1400 — today it jumps 1 → 3 with nothing
  in between, so an iPad gets one 487px card and 347px of blank.
- Replace pagination with load-more at this catalogue size. (This reverses the 2026-09-15 decision
  to keep paging, which was taken when the grid and filters were the problem; 31 recipes across 3
  pages is now pure friction. Keep paging in the code path for growth beyond ~100.)
- Drop the cuisine suffix from card titles where the chip beside them already says it.

**Files:** `recipes.html`, `js/pages/recipes.js`, `js/components/fridge-search.js`,
`js/components/recipe-card.js`, `css/pages.css`

**Acceptance** — search visible without interaction at 375/834/1440; "paneer" to results in two
actions from landing (today five); at 834px two columns, no card wider than ~420px; fridge search
visible without opening a disclosure.

### P5 — Planner and shopping in one hand · *medium*

- Phone planner defaults to Day. Week becomes a vertical list of day sections; the 7-column grid
  stays for ≥768px. Today Week is 1,146px wide inside a 317px column.
- Month cells ≥44px with legible per-slot dots (45×45 including gap today).
- Auto-fill and the plan itself at the top; **Export, Import and Reset this week into an overflow
  menu** — maintenance actions currently outrank the week they act on, with Reset a full-width
  warm button above the plan. Reset keeps its confirm and keeps naming the week.
- Shopping: list first; Copy, Share and Print appear only when there is a list (they are shown on
  an empty one today); bigger tick rows; the add-item field gets full width instead of truncating
  mid-placeholder.

**Files:** `planner.html`, `shopping.html`, `js/pages/planner.js`, `js/pages/shopping.js`,
`css/pages.css`

**Acceptance** (375) — first meal slot ≤300px down (today 997); no horizontal scroll in any planner
view; month cells ≥44×44 of real tap area; empty shopping list shows no Copy/Share/Print; a real
week planned and shopped end-to-end on the preview before merge.

### P6 — Speed and accessibility · *small*

- `<link rel="modulepreload">` for each page's static graph, flatten the deepest import chains, and
  dynamic-import anything only needed after an interaction. Depth 7 means seven sequential network
  waves before a cold phone renders anything.
- Tap targets to 44px — recipe card titles are 24px.
- Keyboard pass over every new sheet, menu and sticky bar: focus trap, focus return, visible focus,
  Esc.
- Re-run `scripts/contrast.mjs` over anything recoloured.

**Acceptance** — import depth ≤3 per page entry (today 7), modules fetched in ≤2 waves; first card
painted measurably sooner on a cold, service-worker-disabled 4G profile, recorded as before → after
in `docs/progress.md`; nothing interactive below 44px; every new surface operable by keyboard alone.

> Within the no-build-step constraint, modulepreload is the right answer. If that constraint were
> ever relaxed, a ~20-line esbuild step would beat it comfortably. Noting the trade-off only so it
> is on the record — the constraint stands.

### 6.1 Backlog — small, unscheduled

- Recipe titles repeat the cuisine shown in the chip beside them (folded into P4).
- The duplicate `household_members`/`households` row from M5 testing — a second household named
  "The Babre's" created 2026-09-24 with one planned week and no recipes. Confirm it is disposable
  and remove it.

### 6.2 Owner-only — cannot be done by an agent

- **Custom SMTP sender.** Supabase's built-in sender allows **2 sign-in emails per hour** for the
  whole site, and blocks branded templates. Resend's free tier or a Gmail app password lifts both.
- **Sign-in captcha.** The client already sends a Turnstile token and fails open; switching on
  enforcement needs the owner, because it gates the owner's own sign-in.
- **Three manual checks** nobody has done: a real print preview, Copy on the shopping list, and an
  airplane-mode load plus "Add to Home Screen" on a phone.

### 6.3 Deferred by decision

- **Photo upload** (Supabase Storage, resized on upload, household-scoped). Deferred by decision 6;
  M1 made the scoping available whenever it is wanted.
- **Legacy `recipes.ingredients` column.** The UI reads the structured `recipe_ingredients` table;
  the JSON column is dead weight. Dropping it is an expand/contract migration whenever something
  else touches that table.

---

## 7. Explicitly not doing

- **Paid tiers of anything** — free tier is a standing constraint, not a budget target.
- **A framework or bundler rewrite.**
- **A visual redesign.** Tokens, type and colour stay; section 6 is layout and priority.
- **New features.** The capability list in section 1 is the capability list afterwards.
- **Native apps.** The PWA installs; P1–P6 are what would make it worth keeping on a home screen.
- **Social features or cross-household sharing.**
- **Recipe import-from-URL.**
- **Database changes** — section 6 touches no SQL.

---

## 8. What this file replaced

Consolidated on 2026-10-01 from four overlapping documents, all of whose work had shipped:

| Was | Covering | Fate |
|---|---|---|
| `improvement_plan.md` v2.0 (2,631 lines) | The original build spec, phases 0–13 | Deleted. Constraints and procedures live on in §4–§5; the appendices described work that is now the code, documented in `docs/architecture.md` and `public/styleguide.html` |
| `plan.md` | M0–M6: accounts, shopping list, visuals, PWA, depth, polish | Deleted. Decisions carried into §3, outcomes already in `docs/progress.md` |
| `docs/ux-uplift-plan.md` | The A–D responsive uplift (shipped, PRs #33/#37) | Deleted. Design rulings carried into §3 |
| `docs/parity-checklist.md` | A Phase 4 refactor checklist from PR #9 | Deleted — the refactor shipped in 2026-09 |
| `improvement_plan.md` v3.0 (2026-10-01) | The UX review | Folded into §1 and §6 |

All four remain in git history at commit `39ce284` and its ancestors if anything needs recovering.
Nothing was summarised away without being carried forward or deliberately retired, and the two
retirements are called out at the end of §4.
