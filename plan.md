# Recipe Book — from family project to product

**Status: approved 2026-09-18.** Decisions recorded below. Updated with findings from a live
production data survey run the same day.

Companion docs: `docs/ux-uplift-plan.md` (completed A–D uplift), `docs/progress.md` (build log),
`improvement_plan.md` (original spec).

---

## Where things stand

| | |
|---|---|
| **Live** | Phases A, B, C and D — all deployed and verified on production |
| **Merged** | #37 (synced B/C/D to `main`), #38 (dead CSS removed) |
| **Repo** | Clean. One branch (`main`), no stray files. Every PR now cuts from and targets `main` — no stacking |
| **🔴 Blocker** | `SUPABASE_ACCESS_TOKEN` returns **401** — the Supabase management PAT has expired |

### About the blocker
`npm run preflight` passes every check except the SQL API. That token is what `scripts/migrate.mjs`
and `scripts/sql.mjs` use, so **all DDL is blocked** — which blocks M1 entirely (it needs new
tables). The Supabase *secret key* still works, so REST reads/writes on existing rows are fine and
**M0 is unaffected**.

**Action for you:** regenerate a Personal Access Token at supabase.com → Account → Access Tokens and
put it in `.env.local` as `SUPABASE_ACCESS_TOKEN`. Don't paste it in chat — I only need to know when
it's done.

---

## Decisions taken (2026-09-18)

1. **Household model** — one shared household login, with members added to it. Attribution tracked
   per member, so "loved it" and "who added this to the shopping list" are answerable.
2. **Order** — M1 (accounts) first, then M2 (shopping list).
3. **Photos** — curated illustrations now; real photo upload later.
4. **Audience** — family now, **commercialising in the near future**.
5. **AI quota** — keep 5/day (becomes per-household at M1).

### What decision 4 really costs — read this one

`config/household.json` is a **file in the repo** that drives AI prompt building, recipe validation,
planner scoring and UI copy. Today one household = one deployment. To sell this, those rules have to
become **per-household rows in the database**, and every read path that currently imports a static
config has to take a household id instead.

That is the single largest piece of M1, larger than authentication itself, and it reaches into the
AI pipeline, the validation layer, the planner engine and the dashboard. It is also dramatically
cheaper to do now, before there is a second household, than to retrofit later — which is exactly
why this decision was worth asking about first.

---

## M0 — Ship what exists, fix what's embarrassing
**Status: partly done. Remaining work is data repair + one code change. No DDL, so the blocker
doesn't stop it.**

| # | Item | Status |
|---|---|---|
| 0.1 | Merge #37 so Phases B/C/D reach production | ✅ done |
| 0.7 | Remove dead CSS (`.slot-recipe`, `.info-card`) | ✅ done (#38) |
| 0.2 | **Soft-delete junk recipe #2** "Aloo Paratha Roll with Ketchup" — steps were `asdfasdf`, 234g protein, 2,345g carbs, serves 10, and it sorted *first alphabetically* | ✅ done — live count 31, first card is now the real Aloo Paratha |
| 0.3 | Repair recipes with no ingredients | ✅ **false alarm, nothing to fix** — see below |
| 0.4 | **Nutrition validation bounds** — per-nutrient per-serving ceilings replacing one blanket 5000 | ✅ done + regression tests |
| 0.6 | **Clear the `time_note` junk** — the bare string `"Cooking Time:"` rendering as a dangling label | ✅ done — 30 rows cleared, verified gone on the live detail view |

Data changes were applied over REST with a full row-level snapshot of all 34 recipes taken first
(`backups/recipes-rest-snapshot-*.json`), since `npm run backup` is itself blocked by the expired
PAT. Both changes are reversible from that snapshot.

### 0.3 was a false alarm — and it exposed real tech debt

The survey flagged #4 "Basundi" and #27 "Shrikhand" as having no ingredients. They render fine:
**all 31 live recipes have structured ingredients** (Basundi 7, Shrikhand 6), and Basundi's detail
view lists milk, sugar, saffron, cardamom and pistachios correctly.

The flag was wrong because it read `recipes.ingredients` — a **legacy JSON column that the UI never
reads**. The app reads the structured `recipe_ingredients` table instead. The legacy column is still
written and validated on the write path, but is empty or stale on some rows.

→ **New tech-debt item:** either keep `recipes.ingredients` in sync or drop it (expand/contract).
A column that looks authoritative, is still validated, and silently disagrees with the real source
will mislead the next person who queries it — it already misled this audit.

### 0.5 was wrong — correcting it

The plan previously said *"backfill `is_protein_smart` (`task_cf7d7dfc`)"*. **That premise is false
and the task should be closed as mis-diagnosed.** The survey shows:

- `is_protein_smart` is a **stored generated column** (migration 006) — it cannot be written to at all.
- Its inputs are essentially complete: `sugars_g` NULL on **1** row (the junk one), `refined_carb_heavy`
  NULL on **0**, `protein_g` and `calories_kcal` NULL on **0**.
- Only **2** of 32 recipes pass the protein maths, and one of those is the junk row. The other is
  already correctly flagged `true`.

So the flag is accurate and there is nothing to backfill. **The collection itself genuinely is not
protein-smart** — 15 of 32 recipes are refined-carb-heavy, and most are simply low in protein against
a rule of ≥15g *and* ≥20% of calories from protein *and* ≤8g sugars.

**The real task is content, not code:** grow the collection with genuinely high-protein recipes
(paneer, tofu, dal, soya, hung curd). That is precisely what the AI generator's protein-smart goal
exists to do, and it demonstrably works — the one qualifying recipe is an AI-generated one. Until
then, the planner's 60% target is unreachable, and the dashboard will keep reporting ~3%.

→ Tracked as **M0.5: raise protein-smart coverage** (target: a realistic interim number such as 30%,
not 60%, before re-pointing the planner at the household goal).

---

## M1 — Accounts and multi-tenancy
**Blocked until the Supabase PAT is restored. Design now, build then.**

Two user-facing problems and one commercial requirement, all solved by the same work:

- Any visitor can **edit or delete** any recipe — Edit/Delete render for everyone.
- The planner lives in **one browser's `localStorage`**. New phone or cleared cache = the week is gone.
- Decision 4 means the app must support **many households**, isolated from each other, from day one.

| # | Item |
|---|---|
| 1.1 | Supabase Auth (email magic link) — free tier is ample |
| 1.2 | `households`, `household_members` (with roles), `profiles`; `household_id` on every domain table |
| 1.3 | RLS on every table scoped to household membership, with explicit revokes — per project rules, in the same migration |
| 1.4 | **Move household rules out of `config/household.json` into a `household_settings` row** — diet, packed-lunch days, spice level, protein targets, servings. Update the AI prompt builder, validation, planner engine and dashboard to read per-household |
| 1.5 | Gate Add/Edit/Delete behind membership; keep recipe *reading* public so a shared link still works |
| 1.6 | Planner moves from `localStorage` to a `plans` table, scoped by household, with a one-time import of the existing browser plan so nothing is lost |
| 1.7 | Attribution: `created_by` / `loved_by` per member (decision 1) |
| 1.8 | AI quota becomes per-household (decision 5) |

**Open question for you (only one left):** when this goes multi-household, are recipes a **shared
public catalogue** that every household can see, or does **each household own its own recipes**? Or
both — a curated starter library plus private additions? All 32 recipes are currently global, so
this decides whether `recipes` gets a nullable `household_id` or a join table. It changes 1.2
materially, but it does not block starting on 1.1.

---

## M2 — The shopping list
**The planner's missing payoff.** Deferred since Phase 14 (`ENABLE_SHOPPING_LIST=false`) — but the
data model was already built in Phase 3.

- Generate from any planned range, aggregating duplicate ingredients across meals
- Group by aisle; scale quantities to planned servings
- Tickable, persistent, and **attributed per member** (decision 1) — "who added this"
- Printable and shareable (overlaps M3)

---

## M3 — Visual and shareable

| # | Item |
|---|---|
| 3.1 | **Curated illustrations now** (decision 3) — a small set mapped by cuisine/dish type, no storage cost, no upload flow. Replaces the initial-letter monograms |
| 3.2 | **Real photo upload later** — Supabase Storage, resized on upload; needs `household_id` scoping from M1 |
| 3.3 | **Print stylesheet** — there is no `@media print` anywhere today, so a recipe can't be printed for the counter |
| 3.4 | **Share** — link + `navigator.share` |

---

## M4 — Mobile and the kitchen

| # | Item | Measured |
|---|---|---|
| 4.1 | **PWA + offline** | No service worker or manifest. Patchy kitchen wifi shows a blank app, and it can't go on her home screen |
| 4.2 | **Recipes page IA on mobile** | The recipe list starts ~1,960px down, behind the AI panel and filters. Collapse the AI panel into a button/sheet |
| 4.3 | **Planner on mobile** | Was 6.4 screens of scrolling. **Phase D has since shipped** — re-measure before doing more |
| 4.4 | **Header actions vanish below 760px** | `.site-nav` is `display:none`, taking "Ask for a recipe" with it; bottom tabs hold only three links |

---

## M5 — Depth (after 0–4)

Favourites surfaced at recipe level (the planner already records loved/not-again privately — she
just can't see or sort by it) · ingredient-led "what's in the fridge" search (the structured
ingredient model already exists) · leftovers and batch cooking · cooked history vs planned.

---

## Polish backlog

- "Vegetarian" and "Egg-free" badges appear on **every** recipe — the household is 100% both, so
  they carry no information. Already gone from filters; finish the job on cards and detail
- Spice meter shows five chilli glyphs on every recipe (fill is colour-only) and none when spice is
  null — needs a text equivalent like "Spice 3 of 5" for screen readers
- Result count flashes **"0 recipes"** while loading, reading as "nothing found"
- Add-recipe is **48 fields in one ~4,000px scroll** — even 3–4 steps would transform it
- Recipe detail shows "Prep 20 · Cook 20 · Total 55" with no explanation of the gap. The gap is
  real (resting/soaking time) on 9 recipes — label it rather than "fix" it
- Nutrition shown as "% of adult reference intake" on a family app including a teenager

---

## Explicitly not doing

Paid tiers of anything (free tier only, standing constraint) · a framework/bundler rewrite · social
features or cross-household sharing · recipe import-from-URL.

---

## Order

**M0 → M1 → M2 → M3/M4 → M5**

M0 needs no DDL, so it proceeds now regardless of the token. M1 starts the moment the PAT is
restored — and M1 before M2 because building a shopping list on browser-only storage means building
it twice.
