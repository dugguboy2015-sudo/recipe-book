# Handoff: Recipe Book — Responsive Redesign

## Overview
A responsive redesign of the Recipe Book family recipe manager, weekly planner, and AI recipe assistant, covering Dashboard, Recipe browse/filter, Recipe detail, Add/edit recipe, and Weekly planner (day/week/month). Optimized for desktop, tablet, and mobile with distinct navigation and layout patterns per breakpoint.

## About the Design Files
The bundled file (`recipe-book-design.html`) is a **design reference built in HTML** — a working prototype demonstrating layout, responsive behavior, and interactions, not production code to copy directly. The task is to **recreate this design in the target codebase's existing environment** — this project is a static site (vanilla HTML/CSS/JS on Cloudflare Pages, see its own `docs/architecture.md`) — using its existing token system (`public/css/tokens.css`), component patterns (`public/css/components.css`), and page structure (`public/js/pages/`). Reuse the app's existing local-storage-backed data layer; the prototype's recipe data and plan state are mocked in-memory only.

## Fidelity
**High-fidelity.** Colors, typography, spacing, and component shapes are final. Breakpoints, layout structure, and interaction patterns should be implemented as specified below. Copy/microcopy is illustrative — align final copy with the existing app's voice if it differs.

## Breakpoints
- **Mobile**: < 760px
- **Tablet**: 760–1099px
- **Desktop**: ≥ 1100px

Detect via `matchMedia`/`ResizeObserver` on container width, not `window.innerWidth` alone (the prototype uses container width to stay correct inside embedded frames).

## Screens / Views

### 1. Dashboard
**Purpose**: Landing screen — quick view of today's plan, an AI recipe assistant, collection stats, and recently added recipes.

**Layout**:
- Centered header: eyebrow pill label, H1 (Fraunces 40px/700, "Kitchen joy, *one menu* at a time" with the emphasized phrase in italic `#D95D39`), subhead paragraph (16px, `#5E6872`, max-width 560px).
- **Desktop (≥1100px)**: CSS grid, 2 columns (`1fr 380px`), areas: `"thisweek ask" / "recent stats"`. Row uses `align-items: stretch` so "This week" and "Ask AI" cards match height.
- **Tablet/Mobile**: single column, cards stack: This week → Ask AI → Stats → Recent.
- **This week card**: white card (`#FFFCF7`, 1px `#E8CDB8` border, 12px radius, shadow `0 12px 28px rgba(40,48,68,0.08)`, 20px padding). Title "This week · Monday" (Fraunces 22px). List of 5 meal-slot rows (Breakfast, Lunch, Snack, Dinner, Extra) — each a bordered row showing the slot label (11px uppercase, `#5E6872`) plus either a linked recipe name (bold, underlined, `#23665F`) or a dashed "+ Add something" button.
- **Ask AI card**: gradient background (`linear-gradient(135deg,#FFFCF7,#E2F3EC)`), `#4D9A8B` border, sparkle icon + "Ask AI for a recipe" H2 (`#1B6E4F`). Contains: a multi-line textarea (min-height 88px, placeholder "e.g. a quick protein-rich breakfast") + a fixed 44px-tall "✨ Ask AI" button aligned to the textarea's bottom edge (`align-items: flex-end` on the row, not stretched). Below: 3 suggestion chips ("Quick breakfast", "High protein dinner", "Kids will eat"). On submit, shows a result card with the matched recipe (name as link, description) pinned to the bottom of the card (`margin-top: auto`) so the card fills its full stretched height.
- **Stats grid**: 4 cards (Recipes saved, Protein-smart, Cuisines, This week planned) — desktop stacks 1-column in the sidebar area; tablet 4-across; mobile 2×2.
- **Recently added**: 4 most recent recipes as cards, 2-column grid (1-column mobile).

### 2. Recipe Browse + Filters
**Purpose**: Search and filter the recipe collection.

**Layout**:
- Centered header (eyebrow + H1 "Find the right dish *for the moment*" + italic accent).
- **Desktop/Tablet**: persistent left filter sidebar (260px, sticky at `top: 88px`) + result grid (3-col desktop, 2-col tablet).
- **Mobile**: no sidebar; a "Filters" pill button opens a bottom sheet (`border-radius: 20px 20px 0 0`, slide up from bottom, max-height 85vh) containing the same filter controls, closing via × or "Show N recipes".
- **Filters**: Search (text input), Cuisine (select), Meal type (chip multi-select: Breakfast/Lunch/Snack/Dinner), Dietary (chip multi-select: Dairy-free/Protein-smart/Nut-free — trimmed down from a longer original list since the household is always vegetarian/egg-free), Spice max (select 1–5), Clear filters button.
- **Recipe card**: cuisine tag (colored per-cuisine tint pair, background/ink from a fixed palette per cuisine), monogram badge (initials, same tint), recipe name (Fraunces 19px, `#23665F`), description, meta row (total time · serves N · chili-dot spice indicator using 5 dots, filled dots `#D95D39`, empty `#E8CDB8`), dietary badges, protein-per-serving line (`#1B6E4F`, bold).

### 3. Recipe Detail (modal)
**Purpose**: View full recipe, scale servings, add to plan.

**Layout**: Centered modal overlay (`rgba(40,48,68,0.45)` backdrop). Panel: desktop/tablet `min(760px,92vw)` rounded 20px card; mobile full-screen (`100%` width/height, no radius). Header: large monogram (56px) + name (Fraunces 24px) + cuisine tag + close ×. Description, dietary badges. Meta bar (`#FFFAF5` background): prep/cook time + servings stepper (−/+ buttons, circular, recalculates ingredient quantities live). Body: 2-column grid (desktop/tablet) or stacked (mobile) — Ingredients (grouped, scaled quantities) | Method (numbered steps) + Nutrition per serving. Footer actions: "Add to Monday's dinner" (primary, `#23665F`) + Close (outline).

### 4. Add/Edit Recipe (modal wizard)
**Purpose**: Add a new recipe via a 4-step wizard instead of one long form.

**Layout**: Same modal sizing pattern as Recipe Detail. Step tabs (pill buttons, numbered "1. Basics", "2. Ingredients & method", "3. Dietary & nutrition", "4. Review") — active step filled `#23665F`, completed steps light green `#E2F3EC`/`#1B6E4F`.
- **Step 1 (Basics)**: an AI-assist card at the top (`#E2F3EC` bg, `#4D9A8B` border) — "Or describe it and let AI draft the recipe" with a text input + "Generate with AI" button that (mock) drafts a name and jumps to Review. Below it, manual fields: Recipe name, Cuisine (select), Serves (number), Description (textarea) in a responsive `auto-fit minmax(200px,1fr)` grid.
- **Step 2 (Ingredients & method)**: two `#FFFAF5` sub-cards — dynamic ingredient rows ("+ Add ingredient row") and method steps ("+ Add step").
- **Step 3 (Dietary & nutrition)**: 3 Yes/No pill toggles (Vegetarian?, Egg-free?, Contains dairy?) + 4 numeric nutrition fields (Calories, Protein, Carbs, Fat) in an auto-fit grid.
- **Step 4 (Review)**: confirmation summary card (`#E2F3EC` bg).
- Footer: Back (disabled on step 1) / Next (steps 1–3) / Save recipe (step 4, primary).

### 5. Weekly Planner (Day / Week / Month)
**Purpose**: Assign recipes to meal slots across time.

**Layout**: Centered header (eyebrow + H1 "Plan the week, *without the chaos*"). Control card: view tabs (Day/Week/Month, underline-active style) + day stepper (‹ Mon › — day view only) + protein-goal progress bar + Auto-fill button (label changes contextually: "Auto-fill Mon" in Day view, "Auto-fill this week" in Week view, "Auto-fill this month" in Month view — each only fills the scope shown) + "Reset" button (destructive red `#B42318`).
- **Default view by breakpoint**: Day view on mobile, Week view on tablet/desktop (still manually switchable via tabs).
- **Week view**: 7-column grid (desktop, no scroll) or horizontally scrollable 150px-min columns (tablet/mobile). Each day column: day label + 5 slot cards (Breakfast/Lunch/Snack/Dinner/Extra), filled slots tinted `#E2F3EC` with `#4D9A8B` border and a "Remove" link, empty slots show dashed "+ Add" button.
- **Day view**: single column, max-width 480px, same 5 slot cards, larger touch targets.
- **Month view**: 7×~5 calendar grid, today highlighted `#E2F3EC`, days with planned meals show up to 2 small green dots.
- Footer note: "Plans are saved in this browser only. Export a copy to move them to another device."

## Interactions & Behavior
- **Breakpoint switching**: live layout change (sidebar nav ↔ bottom tabs ↔ top tabs) via `matchMedia`/`ResizeObserver`, no page reload.
- **Navigation**: Dashboard / Recipes / Planner. Desktop: persistent left sidebar (240px) with icon + label nav items, active item highlighted `#E2F3EC`/`#23665F`. Tablet: top nav pills in header. Mobile: fixed bottom tab bar (56px min height, 3 tabs, icon above label).
- **"Add a recipe" button**: always visible in header/sidebar, opens the wizard modal.
- **Filters**: live-filter as you type/select; chip toggles are multi-select; "Clear filters" resets all.
- **Ask AI card**: keyword-matches the typed prompt against recipe name/description/meal type (mock "AI" — swap for a real model call in production); falls back to a random pick if no match; result card animates in below the input.
- **Recipe detail servings stepper**: recalculates all ingredient quantities proportionally (`qty * (newServings/baseServings)`, rounded to 2 decimals).
- **Wizard "Generate with AI"**: mock — takes the free-text description, drafts a name, and jumps straight to the Review step. Wire to a real recipe-generation call in production (see the project's `Claude API in prototypes` pattern if using Claude).
- **Planner auto-fill**: only fills empty slots (doesn't overwrite existing assignments) within the currently active scope (day/week/month).
- **Toast notifications**: bottom-center pill toast (`#283044` bg, white text), auto-dismiss after ~2.2s, used for auto-fill, reset, save, and "add to plan" confirmations.
- **Modals**: Recipe Detail, Add Recipe wizard, and mobile Filters sheet are all overlay modals (`rgba(40,48,68,0.45)` backdrop, click backdrop or × to close). On mobile, Recipe Detail and Add Recipe modals go full-screen instead of floating centered.

## State Management
- `screen`: 'dashboard' | 'recipes' | 'planner'
- `breakpoint`: 'mobile' | 'tablet' | 'desktop' (derived from container width)
- Recipe filters: `search`, `cuisineFilter`, `dietaryActive[]`, `mealTypeActive[]`, `spiceMax`
- `selectedRecipeId`, `servingsOverride` (detail modal)
- Wizard: `showAddRecipe`, `wizardStep` (0–3), `aiPrompt`, `wizardName`
- Ask AI: `askPrompt`, `askResultId`
- Planner: `plannerView` ('day'/'week'/'month', null = auto by breakpoint), `plannerDayIndex`, `plan` (nested map: day → slot → recipeId|null)
- `toast` (transient message string)
- Real data needed: recipe collection (id, name, cuisine, description, mealTypes[], serves, prep/cook time, spice 1–5, dairy/nutFree/proteinSmart/packedLunch flags, calories/protein/carbs/fat, grouped ingredients with qty/unit, grouped method steps) and the household's weekly plan — both should come from the app's existing storage layer, not be re-mocked.

## Design Tokens
Colors (should map onto the app's existing `public/css/tokens.css` — verify exact token names there before implementing):
- Background: `#FFF3E6` (page), `#FFFCF7` (card surface), `#FFFAF5` (inset surface)
- Ink: `#283044` (primary text), `#5E6872` (secondary text)
- Primary/brand green: `#23665F` (links, primary buttons, nav active), `#4D9A8B` (accent border/eyebrow), `#1B6E4F` / `#E2F3EC` (AI + success accents)
- Destructive: `#B42318`
- Warm accent: `#D95D39` (italic emphasis, filled spice dots)
- Border: `#E8CDB8`
- Per-cuisine tag tint pairs (bg/ink): South Indian `#F6EBDF`/`#6A421B`, North Indian `#F6E5DF`/`#6A2E1B`, Maharashtrian `#F6DFE3`/`#6A1B28`, Rajasthani `#F6F0DF`/`#6A561B`, Chaat `#ECDFF6`/`#491B6A`, Indo-Chinese `#F6E1DF`/`#6A211B`, Gujarati `#F6F4DF`/`#6A631B`, Fusion `#DFEEF6`/`#1B506A`, Other `#F0EAE3`/`#5E5548`

Typography: Fraunces (serif, weights 400/600/700, italic for emphasis) for headings; Work Sans (400/500/600/700) for body/UI.

Spacing scale in use: 4, 6, 8, 10, 12, 14, 16, 20, 24, 32px. Card radius: 6px (buttons/inputs/small chips), 8–10px (nested cards), 12px (cards), 20px (modals). Card shadow: `0 12px 28px rgba(40,48,68,0.08)` (rest), `0 12px 28px rgba(40,48,68,0.12)` (modals).

Minimum tap target: 44px height on all inputs/primary buttons.

## Assets
No image assets used — recipe "images" are represented by colored initial monograms, not photos. If real recipe photography exists, add it to the recipe cards and detail header in place of/alongside the monogram.

## Files
- `recipe-book-design.html` — full interactive prototype (all 5 screens, live breakpoint switching, mocked data and interactions). Open directly in a browser to explore.
