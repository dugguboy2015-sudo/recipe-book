# UX uplift plan — responsive redesign

Source: `design_handoff_recipe_book_redesign/` (a `README.md` spec plus `recipe-book-design.html`,
a high-fidelity prototype). Written 2026-09-15, finalised against owner decisions the same day,
targeting `main` at the "planner slot card cleanup" state. This plan is the canonical execution
reference; append outcomes to `docs/progress.md` as each phase lands, the same way phases 0–13 were
recorded.

## Decisions taken (2026-09-15)

| Question | Decision |
|---|---|
| Which handoff is authoritative? | `design_handoff_recipe_book_redesign/` — confirmed. The empty `Recipe-book UX analysis/` folder is not pending content and can be deleted. |
| Dashboard composition | **Follow the mocks.** Structure, grid areas and the four stat tiles as specified — see Phase C. |
| Stats tiles (3 or 4) | **Four**, per the mock: Recipes saved · Protein-smart · Cuisines · This week planned. |
| Pagination vs. "Load more" | **Keep pagination.** Prev/Next stays as-is. |
| Add/edit recipe wizard | **Omitted** — see "Explicitly out of scope". |
| Light/dark switcher | **Added**, as part of Phase A. |

## Headline finding: this is a layout uplift, not a re-skin

Every colour in the handoff is already a token in `public/css/tokens.css`, exactly:

| Handoff | Token | | Handoff | Token |
|---|---|---|---|---|
| `#FFF3E6` | `--bg` | | `#23665F` | `--brand-ink` |
| `#FFFCF7` | `--surface` | | `#4D9A8B` | `--brand` |
| `#FFFAF5` | `--surface-raised` | | `#1B6E4F` | `--ok` / `--protein` |
| `#283044` | `--ink` | | `#E2F3EC` | `--ok-bg` / `--protein-bg` |
| `#5E6872` | `--ink-muted` | | `#B42318` | `--danger` |
| `#E8CDB8` | `--line` | | `#D95D39` | `--spice` |

…and so do all nine cuisine tint pairs, the radii (6/12/20 → `--radius-control`/`--radius-card`/
`--radius-sheet`), `0 12px 28px rgba(40,48,68,0.08)` → `--shadow-2`, `rgba(40,48,68,0.45)` →
`--overlay`, and the type families (Fraunces 400/600/700 + Work Sans 400/500/600/700).

**Consequence:** there is no visual-language migration to fund. The work is structural — navigation
shell, filter discoverability, and dashboard composition. That also means the uplift ships
page-by-page without a jarring half-redesigned look, because every phase keeps using the palette the
app already uses.

## Already aligned — do not rebuild

- Tokens, fonts, radii, shadows, overlay (above).
- `.tabs` in `components.css` is already the underline-active pattern the planner spec asks for.
- Mobile bottom tab bar at `< 760px` — the handoff's mobile breakpoint is *already* the app's.
- Planner Day / Week / Month with tab switching, calendar grid, today highlight, per-day dots, and
  multi-week navigation — shipped in PR #28/#29, and richer than the prototype (the prototype's day
  stepper only walks one hardcoded week; the app navigates real dates across months).
- Protein-smart progress bar, servings stepper with live ingredient rescaling, recipe detail modal,
  cuisine bands, monograms, spice dots, dietary badges, snackbar toasts, 44px tap targets.
- **Dark theme itself.** `tokens.css` already defines a full, contrast-audited dark palette and
  handles all three viewer states (system / explicit light / explicit dark). Phase A adds the
  *control*, not the theme.
- Dietary filters trimmed of Vegetarian/Egg-free: the handoff calls for this and the dashboard tiles
  were already removed for the same reason. Phase B finishes the job on the filter chips.

## Where the design must yield to the app

The prototype is mocked in-memory and light-theme-only. These are the points where implementing it
literally would be wrong, and the ruling for each:

| # | Conflict | Ruling |
|---|---|---|
| 1 | **Meal slots.** Handoff uses 5: Breakfast / Lunch / Snack / Dinner / Extra. App uses 6 from `config/household.json`: Breakfast, **Packed Lunch** (weekdays only, for the son's school lunch), Lunch, Dinner, Snacks, Dessert. | **App wins.** Household rules are product requirements (`CLAUDE.md`), and Packed Lunch carries real constraints (cold-edible, nut-free, protein-forward). "Follow the mocks" governs *structure*, not slot vocabulary. |
| 2 | **Dark theme.** Handoff is light-only, hardcoded hex. | **App wins.** Style through tokens — `lint-css.mjs` fails the build on any colour literal outside `tokens.css`, so this is enforced, not merely advised. Phase A makes dark mode user-reachable, which raises the stakes on the both-themes check in every later phase. |
| 3 | **Off-scale values.** Handoff lists spacing 6/10/14/20px and font sizes 40/26/19/15/13/11px. App scales: `--sp-*` 4/8/12/16/24/32/48/64 and `--fs-1..8` 12/14/16/18/22/28/36/48. | **Snap to scale.** `lint-css.mjs` hard-fails any `font-size` that isn't `var(--fs-1..8)`. Nearest-token mapping (40→`--fs-7` 36px, 26→`--fs-6` 28px, 19→`--fs-4` 18px, 15/13→`--fs-2` 14px, 11→`--fs-1` 12px). Visually indistinguishable; mechanically required. |
| 4 | **Pagination.** Prototype renders every match in memory, no paging. | **App wins** — and confirmed by the owner. Server-side search and paging (`searchRecipes(..., {page, pageSize})`) stay exactly as they are. |
| 5 | **Recipe detail CTA.** Prototype hardcodes "Add to Monday's dinner". | **App wins.** The app has a real day/slot picker. Keep it. |
| 6 | **Protein bar semantics.** Prototype measures the whole *collection*; app measures the *planned week*. | **App wins** — the planned week is the number that can actually be acted on. |
| 7 | **AI.** Prototype's "Ask AI" is a keyword-matching mock. | **App wins.** The real pipeline (AI returns a draft; only `POST /api/recipes` inserts; dietary booleans never defaulted; free-tier only) stays as-is. |
| 8 | **`matchMedia`/`ResizeObserver` on container width.** | **Use CSS media queries.** The handoff itself explains this was to survive an embedded prototype frame. Use media queries for layout, and reach for `matchMedia` only where *behaviour* branches (planner's default view; filter sidebar vs. bottom sheet; resolving the system theme). Don't import a prototype workaround as production architecture. |
| 9 | **Stats tiles.** Handoff wants 4; app has 3 after the recent cleanup. | **Follow the mock — 4 tiles.** Sourcing confirmed migration-free; see Phase C. |

## Phases

One branch and PR per phase, per the project's existing workflow: `npm run check` before pushing,
preview smoke, live browser verification (DOM/browser behaviour is verified by hand here, not in
Vitest). Sized relatively — S/M/L — rather than in invented hours.

### Phase A — responsive shell, navigation & theme switcher · **M** · do first

The three-tier nav is the prerequisite for every layout below it, and it touches every page, so it
should land before other pages are rebuilt around a width that then changes.

**Navigation**
- Add the **desktop tier at ≥1100px**: 240px sticky left sidebar (`--surface`, `--line` right
  border) with wordmark, icon+label nav items (active = `--protein-bg` / `--brand-ink`), and a
  persistent **"Add a recipe"** button pinned to its bottom.
- Tablet (760–1099px) keeps today's centred top pills; mobile (<760px) keeps today's bottom tab
  bar. Both already exist — the only new breakpoint is 1100px.
- Promote "Add a recipe" from a recipes-page-only FAB (`#addRecipeButton`) to a persistent control
  on every screen, so adding a recipe stops being a page-specific action.
- Content column: `.wrap`'s 1200px max-width has to account for the sidebar so desktop doesn't end
  up narrower than tablet.

**Light/dark switcher** — smaller than it looks, because the theme already exists:
- `styleguide.js` already holds working 4-line toggle logic, and `tokens.css` already handles all
  three states. Promote that logic into a shared `public/js/theme.js`, persist the choice in
  `localStorage`, and have the style guide use the shared module instead of its own copy.
- **Three states, not two:** default is *follow the system* (no attribute set) until the user makes
  an explicit choice, which then stamps `data-theme="light"` or `"dark"` and wins over the OS in
  both directions. This is exactly what the token file is already structured for — don't collapse
  it to a two-way toggle that can't get back to "system".
- **Avoiding a flash of the wrong theme is the one real constraint.** `public/_headers` sets
  `script-src 'self'` with no `'unsafe-inline'`, so the usual inline pre-paint snippet would be
  **blocked by CSP**. Load `theme.js` as a *classic, non-deferred* `<script src="js/theme.js">` in
  `<head>` (same-origin, so CSP-clean) — it must not be `type="module"`, which defers and would
  paint the wrong theme first.
- Control sits in the nav shell, so it appears on all four pages at once.

Files: `public/css/base.css`, `public/css/components.css`, all four page HTMLs, `public/js/main.js`,
new `public/js/theme.js`, `public/js/styleguide.js`.
Acceptance: all three tiers switch cleanly on resize; theme choice survives reload with no flash, in
all three states; keyboard order sane; axe-core clean; the FAB's job preserved on mobile.

### Phase B — recipe browse filters · **M** · highest UX payoff

Today's filters sit in collapsed `<details>` disclosures above the grid — Tags, Dietary and Spice
are invisible until opened, which is the single biggest discoverability problem in the app.

- **Desktop/tablet**: persistent 260px filter sidebar, sticky under the header, all controls visible
  at once (Search, Cuisine, Meal type chips, Dietary chips, Spice max, Clear filters).
- **Mobile**: a "Filters" pill opens a bottom sheet (`--radius-sheet` top corners, slide-up,
  max-height 85vh) with the same controls, dismissed via × or a "Show N recipes" button.
- Trim Dietary chips to Dairy-free / Protein-smart / Nut-free (drop Vegetarian and Egg-free —
  constant for this household), finishing the cleanup already applied to the dashboard tiles.
- Keep server-side search **and Prev/Next paging**; keep the live result count and `aria-live`
  status region.

Files: `public/recipes.html`, `public/js/pages/recipes.js`, `public/css/pages.css`.
Acceptance: filters reachable without a click on desktop; sheet traps focus and restores it on
close; result count and paging still correct; existing debounce/query behaviour unchanged.

### Phase C — dashboard, per the mocks · **S**

Structure follows the handoff mock directly.

- **Grid**: desktop `≥1100px` two columns `1fr 380px`, areas `"thisweek ask" / "recent stats"`, with
  `align-items: stretch` so "This week" and "Ask AI" match height. Tablet/mobile stack in the mock's
  order: This week → Ask AI → Stats → Recent.
- **Four stat tiles**, replacing today's three. Sourcing is migration-free — confirmed:
  - *Recipes saved* → `recipe_stats.total` (exists).
  - *Protein-smart* → `recipe_stats.protein_smart` (exists).
  - *Cuisines* → count of rows with `recipes > 0` from the **existing** `cuisine_counts` view, which
    `queries.js` already fetches for the filter facet. Replaces today's "Top cuisine" tile.
  - *This week planned* → count of entries in the current week from `loadPlanState()`, already
    loaded on this page. No query at all.
  - Tile layout per mock: 1-column in the desktop sidebar, 4-across tablet, 2×2 mobile.
- **"This week" card becomes actionable**: render all of today's applicable slots, with a dashed
  "+ Add something" affordance on the empty ones, instead of only listing what's already planned.
  This is the best idea in the handoff — it turns a status readout into a way to fill gaps. Slots
  come from the household config (so Packed Lunch appears on weekdays), not the mock's five.
- Keep the app's protein-smart bar and "tomorrow's packed lunch" line, which the prototype drops but
  which carry real household meaning.
- **Recently added**: 4 recipes in a 2-column grid (1-column mobile) — today's call fetches 3.
- Ask AI card gets its gradient surface and suggestion chips; the result card pins to the bottom
  (`margin-top:auto`) so the stretched card doesn't end up with a hole in it.

Files: `public/index.html`, `public/js/pages/dashboard.js`, `public/css/pages.css`.

### Phase D — planner deltas · **S**

Small, well-understood gaps on top of the Day/Week/Month work just shipped:

- **Contextual auto-fill scope + label**: "Auto-fill Monday" / "this week" / "this month", each
  filling only what's on screen. No engine change needed — `planWeek()` is already week-pure and
  takes `weekOf`; this is orchestration in `planner.js` (day scope = run the week and merge back
  only the target day; month scope = iterate the visible weeks). Worth noting the day-scope tradeoff:
  scoring still reasons about the whole week, which is the desirable behaviour for variety anyway.
- **Default view by breakpoint** — Day on mobile, Week on tablet/desktop — while still honouring an
  explicit user choice once made (the app already persists `plannerViewMode`; the breakpoint should
  only supply the *initial* default).
- **Week view on narrow screens**: horizontal scroll with ~150px min columns instead of today's
  wrapping `auto-fit` grid, so a week reads as a week rather than reflowing into a list.
- **Empty slots** get the dashed "+ Add" affordance in place of the "No recipe planned" text.

Files: `public/js/pages/planner.js`, `public/planner.html`, `public/css/pages.css`.

## Explicitly out of scope

**The 4-step add/edit recipe wizard (former Phase E) is omitted by owner decision.** The existing
single-form `addRecipeModal` / `recipe-form.js` stays exactly as it is. This was the largest build in
the original plan and served the narrowest path (hand-entering a recipe, versus generating one), so
dropping it removes most of the risk from this uplift. Nothing in phases A–D depends on it. If it is
ever revived, the note that mattered: validation must stay per-step rather than deferred to a Review
step, or the wizard is worse than the form it replaces.

## Cross-cutting rules

- **Tokens only.** No colour literals outside `tokens.css`; no off-scale font sizes. Enforced by
  `npm run check`.
- **Both themes, and now they're reachable.** Once Phase A ships the switcher, dark mode stops being
  an OS-only state a user might never see. Every subsequent phase gets checked in both themes, and
  any new colour relationship gets a pair added to `scripts/contrast.mjs`.
- **Style guide is part of the work.** Every new component (sidebar nav item, bottom sheet, theme
  switcher, dashed add-slot affordance) gets added to `public/styleguide.html` in the same PR —
  that file is the design system's only inventory.
- **Accessibility does not regress.** The app is at zero axe-core violations. The sheet and sidebar
  need deliberate focus management; reuse the `wireDialog` helper and native `<dialog>` rather than
  hand-rolling overlays.
- **Performance budget.** No bundler means no tree-shaking: anything only needed after a user action
  keeps loading via dynamic `import()`. `theme.js` is the deliberate exception — it must be tiny and
  render-blocking by design.
- **No migrations.** None of phases A–D implies one; the four stat tiles were specifically checked
  against existing views. If a migration appears, it is a signal the design is being over-read.

## Sequencing rationale

A before everything: it changes the width every other layout is designed against, and the theme
switcher rides along with the nav shell it lives in. B next, because it is the largest real usability
gain and is self-contained. C and D are small and independent, so they can slot in around
interruptions — and with E dropped, D is now the finish line rather than a staging post.
