# Recipe Book — UX uplift: one app, phone and desktop

| | |
|---|---|
| **Version** | 3.0 — 2026-10-01 |
| **Scope** | The interface only. No new features, no schema change, no new dependencies |
| **Status** | Proposed — not started. Nothing here has been built |
| **Predecessor** | `docs/improvement_plan_v2.md` (the v2.0 build spec, all 13 phases shipped) and `plan.md` (M0–M6, all shipped). Both stay authoritative for constraints and history; this plan does not reopen them |
| **Problem** | The app can do nearly everything a family needs. It is hard to use on a phone, and it does not behave like an app on either phone or desktop |

---

## How this review was done

Everything below is measured against **production** (`recipe-book-9eo.pages.dev`) on
2026-10-01, signed out, at three widths: 375px (phone), 834px (iPad portrait) and 1440×900
(laptop). Numbers come from the live DOM — element positions, scroll heights, computed styles
and the Resource Timing API — not from reading the stylesheets. Module counts come from walking
the real `import` graph in `public/js/`.

Every claim in Part 2 has a number attached so it can be re-checked after the work, and the same
measurements become the acceptance criteria in Part 4.

**One caveat worth stating up front:** this was reviewed signed out, because sign-in is an emailed
magic link. Everything about layout, navigation, routing and speed is unaffected by that. What I
could *not* assess first-hand is how the app feels with a full week planned and a long shopping
list — so the planner and shopping findings are about structure and chrome, not about how a busy
list reads. That gap is worth closing with ten minutes of the owner's own use before P5 starts.

---

## Verdict

The engineering here is in good shape: data model, permissions, offline, tests, accessibility
basics. The problem is not capability — it is **that the interface is organised around the
product's story rather than the family's task**, and that it was designed as a desktop page that
was later made to fit a phone, rather than as an app.

Three things cause most of the clumsiness:

1. **Every page opens with a magazine cover.** 202–295px of display-type headline before any
   content, on all four pages, at every width. On a phone that is a quarter to a third of the
   screen, every single time, on an app the family opens daily and already knows the name of.
2. **The app has no sense of place.** Opening a recipe does not change the URL, so the phone's
   Back gesture leaves the page entirely instead of closing the recipe. Shareable recipe links
   exist and work — and the app deletes them from the address bar on arrival.
3. **The phone got the desktop's furniture.** The recipe detail is a floating 343px dialog
   containing 9.4 screens of scrolling whose only Close button is at the very bottom. The week
   planner is a 7-column grid 1,146px wide inside a 317px column.

None of this needs a rewrite, a framework or a build step. It is layout, routing and
prioritisation, in six shippable slices.

---

# Part 1 — What the app can already do

Worth stating plainly, because the plan below deliberately adds nothing to it. The gap is between
this list and how much of it a person can find.

| Area | Capability | How you reach it today |
|---|---|---|
| Catalogue | 31 recipes, structured ingredients, servings scaling, nutrition with traffic lights, dish illustrations | Recipes page |
| Search | Full-text, cuisine, tags, meal type, dietary, spice ceiling, favourites-only | **Inside a sheet behind a Filters button** |
| Fridge search | Rank recipes by what you already have | **Behind a collapsed `<details>` triangle** |
| AI | Draft a recipe from a description, estimate nutrition, 5/day per household | Top of Recipes; "Ask" tab |
| Planner | Day / Week / Month, multi-week, auto-fill with learning, shuffle, keep, servings, leftovers, cooked ticks, per-member attribution | Planner page |
| Shopping | Built from the plan, aggregated, pantry staples separated, manual items, shared ticks | Shopping page |
| Kitchen | Cook mode: full screen, one step at a time, screen kept awake | **Bottom of the recipe detail, ~9 screens down** |
| Household | Accounts, members, invites, roles, per-household diet and meal slots, curator approval | Account dialog |
| Platform | Installable PWA, offline catalogue, print, share links, light/dark, 433 tests | — |

The pattern is hard to miss: **the three features most worth showing off — fridge search, cook
mode and search itself — are the three hardest to find.**

---

# Part 2 — Findings

Grouped by cause. Each has the measurement, why it matters, and the direction of the fix.

## A. The first screen is spent on branding

| Page | Hero height | Where real content starts | Viewport |
|---|---|---|---|
| Dashboard | 295px | 451px | 973px |
| Recipes | 255px | 679px (first card) | 973px |
| Planner | 202px | 997px (first meal slot) | 973px |
| Shopping | 255px | 579px (empty state) | 973px |

**A1.** On the planner, the first actual meal is **one full screen down**, behind 14 controls
(3 view tabs, 3 date controls, auto-fill, a gear, Shopping list, Export, Import, Reset this week,
and two dismiss buttons).

**A2.** On the dashboard the whole page is 3,195px — 3.3 screens — and the first thing in it is
"Kitchen joy, one menu at a time", a line aimed at someone deciding whether to use the product.
The people using this already decided.

**A3.** On desktop at 1440×900 the Recipes page shows **no recipes above the fold at all**: the AI
"Describe a recipe" panel occupies 330–841px and the first card sits at 992px. The page is called
Recipe collection and you cannot see one without scrolling.

**Why it matters.** This is the single biggest contributor to "clumsy". Every task starts with the
same scroll past the same headline. It is also the cheapest thing on this list to fix.

**Direction.** A compact page header: page name, the one primary action, and on the dashboard a
greeting. Keep the display type for the signed-out first visit and empty states, where it is
doing a real job.

## B. The app has no URLs

**B1.** Opening a recipe does not change the URL. Measured: URL identical before and after.

**B2.** Consequently the phone Back gesture is wrong. Measured directly: with a recipe open,
Back navigated from Recipes to the previously visited page — it left the page entirely rather
than closing the recipe.

**B3.** `recipes.html?recipe=basundi&serves=6` **does** work on load (opens Basundi at 6
servings) — and the address bar is then rewritten to `/recipes`, discarding it. A link someone
shares works once; the recipient cannot bookmark, refresh or re-share where they landed.

**B4.** Recipe cards are `<article>` elements with a click handler, not links. No open-in-new-tab,
no middle-click, no "copy link address", and the only keyboard-reachable control is the title
button — which is **24px tall**, against a 44px target guideline.

**Why it matters.** B2 is the most-used gesture on a phone and it currently loses your place.
B1–B4 together are why the app feels like a page rather than an app.

**Direction.** Push a URL when a recipe opens, pop it on Back, stop stripping the parameter, and
make the card title a real link that the click handler enhances.

## C. The recipe detail is a desktop dialog on a phone

Measured at 375px, with a recipe open:

- Dialog **343px wide inside a 449px viewport** — 106px of the phone given to a backdrop.
- **6,716px of content inside a 713px box: 9.4 screens**, scrolling inside a page that also scrolls.
- The dialog header is `position: static`. **The only Close button is at y=6,641** — the bottom.
  There is no X at the top. The `×` that *is* on the first screen belongs to a tip banner.
- Everything you would actually do with a recipe — Add to planner, **Cook mode**, Share, Print —
  is in that same bottom cluster, past all nine screens.

**Why it matters.** To close a recipe you scroll to the end, or know that Esc works, or tap the
backdrop and hope. To cook from it you scroll past the entire method to find Cook mode. This is
the core screen of the product.

**Direction.** On phones, a full-screen sheet with a sticky header (title + Close) and a sticky
bottom action bar holding Cook mode and Add to planner. Collapse Nutrition and Notes by default.
Cook mode itself is already excellent — full screen, one step at a time, screen kept awake. It is
the model to copy, not something to rebuild.

## D. Search is hidden; browsing doesn't scale to the screen

**D1.** On a phone the search field **is not rendered at all** (measured 0×0, not visible). It
lives inside the filter sheet. Finding "paneer" costs: scroll → Filters → tap field → type →
Show N recipes. Search is the most common action in a recipe app and it is five steps and invisible.

**D2.** Fridge search sits behind a collapsed `<details>` labelled "What's in the fridge?" — a
33px-tall disclosure.

**D3.** The grid is **1 column at 834px** (iPad portrait): a 487px card with 347px of empty space
beside it. It becomes 3 columns only at 1440. Nothing sensible happens in between.

**D4.** 31 recipes are paginated 12 at a time across 3 pages, with the pager at the bottom of a
3,710px page. At this catalogue size, paging is pure friction.

**Direction.** A persistent search field at the top of Recipes at every width; filters as visible
chips with the sheet for the long tail; fridge search as a peer of search, not a disclosure; a
grid that steps 1 → 2 → 3 → 4 across the range; load-more or simply all 31.

## E. The planner and the shopping list fight the phone

**E1.** Week view is **1,146px wide inside a 317px column — 3.6× horizontal scroll**, nested
inside vertical page scroll. You see two days at a time and must swipe sideways to plan a week.

**E2.** Month cells are **45×45px**, which is both under a comfortable tap target once gaps are
counted and too small for the meal dots to mean much.

**E3.** Destructive and administrative actions outrank the content. **Reset this week** is a
full-width warm-coloured button above the plan; Export and Import sit beside it. These are
maintenance, shown with more prominence than the week itself.

**E4.** On Shopping, **Copy, Share and Print are displayed when the list is empty** — three
actions for content that does not exist — and Print is close to meaningless on the phone the list
is read on. The add-item field is truncated mid-placeholder at 280px.

**Direction.** Day-first on phones; Week as a vertical list of days rather than a horizontal
grid; month cells at 44px minimum; Export/Import/Reset behind an overflow menu; the shopping
toolbar appears when there is something to act on.

## F. Signed out, the app never says what it is not doing

A visitor can plan a week, tick a shopping list and favourite recipes entirely in localStorage.
The **only** place the app says so is inside error snackbars ("It's still saved in this browser")
— text you see when something has already gone wrong. Sign-in itself is a 44px 👤 emoji in the
top-right whose text label is hidden at phone width.

They find out when they open the app on a second phone and it is empty.

**Direction.** One quiet, permanent line in the empty/planner states — "Saved on this device.
Sign in to share with your household" — and a sign-in control that says "Sign in".

## G. Speed, as experienced

Walking the real import graph:

| Page entry | Static modules | Bytes | Import depth |
|---|---|---|---|
| `pages/recipes.js` | 34 | 200,574 | 7 |
| `pages/planner.js` | 29 | 203,226 | 7 |
| `pages/dashboard.js` | 28 | 155,719 | 7 |
| `pages/shopping.js` | 19 | 91,045 | 6 |

Live dashboard load: **42 requests, 451KB decoded, 33 JavaScript files**.

Depth 7 is the number that hurts: the browser cannot discover the seventh-level module until the
six above it have arrived, so a cold load on mobile data is seven sequential waves before
anything renders. The service worker hides this on repeat visits; the first visit, and the
first visit after each deploy, pay it in full.

**Direction, within the no-build-step constraint:** `<link rel="modulepreload">` for each page's
known graph (collapses seven waves to roughly one), flatten the few deepest chains, and move
anything only needed after an interaction to dynamic `import()`. That gets most of the win with
no bundler and no new dependency.

> If the "no build step" constraint were ever relaxed, a ~20-line esbuild step would beat all of
> this comfortably. I am **not** proposing that — the constraint is deliberate and the
> modulepreload path is enough. Noting it only so the trade-off is on the record.

## H. Smaller things found on the way

- **Three navigation systems** (sidebar, header nav, bottom tab bar) exist in the markup of all
  four pages — 12 copies to keep in step, three of them labelled "Main navigation". At 1440 the
  sidebar and the header nav are **both** on screen.
- Recipe titles repeat the cuisine that the chip beside them already shows:
  "Aloo Paratha with Curd (North Indian)" under a "North Indian" chip.
- The dashboard's protein-smart meter renders an empty bar with no label when there is nothing
  to measure.
- The empty-week call to action is a small inline text link ("Your whole week is empty.
  Auto-fill it?") rather than a button.
- `CLAUDE.md`'s constraint list still says "No user accounts/sign-in (out of scope by owner
  decision, for now)" — accounts shipped in M1. Worth correcting so the constraint list stays
  trustworthy.

---

# Part 3 — Principles for the uplift

1. **Content first, chrome second, branding third.** Something useful in the first 200px on every
   page at every width.
2. **One app, two layouts.** Not a desktop page that survives a phone. Phone gets sheets, sticky
   actions and vertical lists; desktop gets the extra column it has room for.
3. **The URL is the state.** If the screen changed, the address changed, and Back undoes it.
4. **Promote by frequency.** Search, cook, plan — daily. Export, import, reset — yearly. Lay them
   out in that order.
5. **Nothing new.** Every capability already exists. This plan moves, groups and labels; it does
   not add.
6. **Respect the standing constraints.** No build step, no framework, no new dependency, free
   tier, design-system tokens only, append-only migrations (none needed — this plan touches no SQL).

---

# Part 4 — The plan

Six slices, each one branch and one PR from and to `main`, in the order that compounds best:
the shell first because every later screen sits inside it; routing second because the detail
rebuild depends on it.

Estimates are relative sizes, not calendar promises.

---

### P1 — The app shell: headers, navigation, signed-out honesty · *small*

**Why first:** it fixes the most-felt problem, touches every page, and makes the later work
visible.

**Changes**
- Replace the four hero blocks with a compact page header (≤96px): page name, primary action,
  greeting on the dashboard only. Keep the display-type hero for the signed-out first visit and
  genuine empty states.
- Collapse three navigation definitions into one, rendered per breakpoint; one landmark named
  "Main navigation". Stop showing the sidebar and the header nav together at ≥1200.
- Add the device-only line to the planner, shopping and favourites empty states when signed out.
- Give the sign-in control a visible "Sign in" label at phone width.
- Fix the empty-week link into a real button; hide the protein meter when it has nothing to show.

**Files:** all four `public/*.html`, `css/pages.css`, `css/components.css`,
`js/components/account.js`, `js/pages/dashboard.js`.

**Acceptance (measured, phone 375 / laptop 1440×900)**
- First content ≤200px on all four pages at both widths (today: 451 / 679 / 997 / 579).
- Recipes at 1440×900: at least one full card above 900px (today: first card at 992px).
- Exactly one navigation visible at any width; one "Main navigation" landmark in the a11y tree.
- `npm run check` green.

---

### P2 — URLs and the Back button · *small*

**Why second:** P3 is much simpler once a recipe is a routable state.

**Changes**
- Opening a recipe pushes `?recipe=<slug>` (plus `serves` when scaled); closing pops it;
  `popstate` closes the dialog instead of leaving the page.
- Stop stripping `?recipe=` on load — reflect it, so refresh and bookmark survive.
- Same treatment for the planner's view mode and selected date, which are already in state but
  not in the URL.
- Recipe card titles become real `<a href="recipes.html?recipe=…">`, progressively enhanced by
  the existing click handler; the link's hit area covers the card.

**Files:** `js/components/recipe-modal.js`, `js/components/recipe-card.js`,
`js/lib/url-state.js`, `js/pages/recipes.js`, `js/pages/planner.js`.

**Acceptance**
- Open a recipe → URL contains the slug; Back closes the recipe and stays on Recipes
  (today: leaves the page); Forward reopens it.
- Reload with a recipe open → same recipe, same servings.
- Middle-click a card title opens that recipe in a new tab.
- Unit tests for the URL ↔ state mapping; browser verification on the preview.

---

### P3 — The recipe detail, rebuilt for a phone · *medium*

**Changes**
- Below 768px: full-screen sheet, no backdrop margin, sticky header (title + Close), sticky
  bottom bar with **Cook mode** and **Add to planner**.
- Secondary actions (Share, Print, Edit, Delete, Approve) into an overflow menu in the header.
- Nutrition and Notes collapsed by default on phones; Ingredients and Method open.
- Ingredients ↔ Method as tabs on phones, so neither requires scrolling past the other.
- Desktop keeps the dialog, gains the same sticky header and action bar.

**Files:** `js/components/recipe-modal.js`, `css/components.css`, `recipes.html`.

**Acceptance (phone 375)**
- Close reachable without scrolling, from any scroll position (today: y=6,641).
- Cook mode reachable in one tap from the top of the detail (today: ~9 screens).
- Sheet occupies the full viewport width (today: 343 of 449px).
- Collapsed default brings first-screen-to-method under 2 screens (today: 9.4 to the end).
- Print output unchanged — verified, since the print stylesheet keys off this markup.

---

### P4 — Finding a recipe · *medium*

**Changes**
- Persistent search field at the top of the Recipes list at every width, with the result count
  beside it; it stays visible while scrolling on phones.
- Active filters as removable chips under the search field; the sheet keeps the long tail.
- Fridge search promoted to a peer control next to search, not a `<details>`.
- Grid steps: 1 column <600, 2 at ≥600, 3 at ≥1000, 4 at ≥1400.
- Replace pagination with load-more (all 31 fit comfortably; keep paging for growth beyond ~100).
- Drop the cuisine suffix from card titles where the chip already shows it.

**Files:** `recipes.html`, `js/pages/recipes.js`, `js/components/fridge-search.js`,
`js/components/recipe-card.js`, `css/pages.css`.

**Acceptance**
- Search field visible without interaction at 375, 834 and 1440 (today: not rendered at 375).
- "paneer" → results in **two** actions from landing (tap field, type) — today five.
- At 834px: 2 columns, no card wider than ~420px (today: 1 column, 487px, 347px empty).
- Fridge search visible without opening a disclosure.

---

### P5 — Planner and shopping in one hand · *medium*

**Changes**
- Phone planner defaults to Day; Week becomes a vertical list of day sections (no horizontal
  scroll); the 7-column grid stays for ≥768px.
- Month cells ≥44px with legible per-slot dots.
- Auto-fill and the plan itself at the top; Export, Import and Reset this week into an overflow
  menu, with Reset keeping its confirm and naming the week.
- Shopping: list first; Copy/Share/Print appear only when the list has items; bigger tick rows;
  the add-item field gets full width with the button below or inline-but-not-truncating.

**Files:** `planner.html`, `shopping.html`, `js/pages/planner.js`, `js/pages/shopping.js`,
`css/pages.css`.

**Acceptance (phone 375)**
- First meal slot ≤300px down (today: 997px).
- No horizontal scroll in any planner view (today: Week is 1,146px in a 317px column).
- Month cells ≥44×44 (today: 45×45 including gap — verified against real tap area).
- Shopping with an empty list shows no Copy/Share/Print.
- A real week planned and shopped end-to-end on the preview before merge.

---

### P6 — Speed and an accessibility pass · *small*

**Changes**
- `<link rel="modulepreload">` for each page's static graph; flatten the deepest import chains;
  dynamic-import anything only needed after an interaction.
- Tap targets to 44px — card titles are 24px today.
- Full keyboard pass over the new sheet, menus and sticky bars: focus trap, focus return,
  visible focus, Esc.
- Re-run `scripts/contrast.mjs` over anything recoloured.

**Files:** all four `public/*.html`, `js/pages/*.js`, `css/components.css`.

**Acceptance**
- Import depth ≤3 for every page entry (today: 7); modules fetched in ≤2 waves.
- First card painted on a cold, SW-disabled 4G profile measurably sooner than today's baseline,
  recorded in `docs/progress.md` as before → after.
- No interactive element below 44px in either dimension.
- Every new surface operable by keyboard alone.

---

## Order and why

```
P1 shell ─▶ P2 routing ─▶ P3 recipe detail ─▶ P4 finding ─▶ P5 planner+shopping ─▶ P6 speed+a11y
```

P1 is felt immediately and everything later lives inside it. P2 is small and P3 depends on it.
P4 and P5 are independent of each other and could swap. P6 is last because preloading a graph
you are still changing is wasted work.

Each slice is independently shippable: stopping after any of them leaves the app better than it
is now, not half-rebuilt.

---

# Part 5 — Explicitly not proposing

- **A framework or a bundler.** The constraint is deliberate and the plan works within it.
- **A redesign of the visual language.** Tokens, type and colour stay; this is layout and
  priority. Nothing here needs a new colour or a new component.
- **New features.** Not one. The capability list in Part 1 is the capability list afterwards.
- **Native apps.** The PWA already installs; P1–P6 are what would make it worth keeping on a
  home screen.
- **Touching the database.** No migration, no schema change, no data edit.
- **Removing the brand voice.** The display type is good and it stays — on first visit, empty
  states and the signed-out dashboard, where it is working rather than blocking.

---

# Part 6 — Risks

| Risk | Handling |
|---|---|
| The print stylesheet keys off the recipe detail's markup, which P3 rewrites | Print verified as part of P3's acceptance; it has broken this way once before (M3) |
| The service worker caches the shells; a header change ships stale to installed devices | Network-first already handles it; confirm on a real installed instance after P1 |
| Hero removal is the owner's brand showing up least | Kept where it works (first visit, empty states); reversible in one commit if it reads as cold |
| DOM-heavy work, and this project has no jsdom | Follow the existing convention: pure logic in Vitest, every screen verified live on the preview before merge |
| Review was done signed out | Owner to spend ten minutes with a full week and a real shopping list before P5 is specified in detail |

---

# Appendix — Baseline measurements (2026-10-01, production, signed out)

| Metric | Phone 375 | Tablet 834 | Laptop 1440×900 |
|---|---|---|---|
| Dashboard: hero / first content | 295px / 451px | — | — |
| Recipes: hero / first card | 255px / 679px | — / 1,039px | — / 992px |
| Planner: hero / first meal slot | 202px / 997px | — | — |
| Shopping: hero / first content | 255px / 579px | — | — |
| Recipe grid columns | 1 | 1 (card 487px) | 3 |
| Recipe detail: width / scroll | 343 of 449px / 9.4 screens | — | — |
| Recipe detail: Close button at | y = 6,641 | — | — |
| Planner Week: content / column | 1,146px / 317px | — | — |
| Month cell | 45 × 45px | — | — |
| Search field | not rendered | 226 × 44 | 226 × 44 |
| Recipe card title tap target | 90–169 × **24px** | — | — |
| Recipes page: modules / bytes / depth | 34 / 200,574 / 7 | same | same |
| Dashboard live load | 42 requests, 451KB, 33 JS files | — | — |
| URL changes when a recipe opens | **no** | no | no |
| Back with a recipe open | **leaves the page** | same | same |

Re-running these after each slice is how the work is judged.
