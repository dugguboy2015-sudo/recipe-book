import { escapeHtml } from '../shared/html.js';
import { supabase } from '../lib/supabase-client.js';
import { fetchRecipeStats, fetchRecentRecipes, fetchCuisineCounts, fetchPlannerRecipesByIds, fetchRecipeById, fetchRecipeIngredients } from '../lib/queries.js';
import { normalizeRecipe, renderRecipeCard } from '../components/recipe-card.js';
import { mountRecipeModal, openRecipeModal } from '../components/recipe-modal.js';
import { mountAskDialog } from '../components/ask-dialog.js';
import { mountTip } from '../components/tips.js';
import { monogramSvg } from '../components/monogram.js';
import { openCookMode } from '../components/cook-mode.js';
import { formatIngredientsHtml } from '../shared/cook-mode-format.js';
import { getHousehold } from '../lib/household.js';
import { loadPlanState, DAYS, getWeekDays, mondayOf } from '../lib/planner-store.js';
import { computeProteinSmartShare, todayIso, addDaysIso, entriesOnDate, dayNameForIso, slotsForDay } from '../shared/plan-summary.js';
import { nearestWidthClass } from '../shared/nutrition-ri.js';

function greeting(now = new Date()) {
  const hour = now.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function isWeekEmpty(planDays) {
  return DAYS.every((day) => (planDays[day] || []).length === 0);
}

function renderStats(stats, cuisineCount, thisWeekPlannedCount) {
  const statsGrid = document.getElementById('statsGrid');
  if (!statsGrid) return;

  statsGrid.innerHTML = `
    <article class="metric-card"><div class="label">Recipes saved</div><div class="value">${stats.total}</div><div class="sub">Across the full collection</div></article>
    <article class="metric-card"><div class="label">Protein-smart</div><div class="value">${stats.protein_smart}</div><div class="sub">${stats.protein_smart} of ${stats.total} recipes are protein-smart</div></article>
    <article class="metric-card"><div class="label">Cuisines</div><div class="value">${cuisineCount}</div><div class="sub">Represented in the collection</div></article>
    <article class="metric-card"><div class="label">This week planned</div><div class="value">${thisWeekPlannedCount}</div><div class="sub">Meals assigned to this week</div></article>
  `;
}

const RECENT_COUNT = 4;

function renderRecentGrid(recipes, onAskFirst) {
  const box = document.getElementById('recentGrid');
  if (!box) return;

  if (!recipes.length) {
    box.innerHTML = `
      <div class="empty-state">
        <p>No recipes yet.</p>
        <button type="button" class="primary-button" id="askFirstRecipeButton">Ask for your first recipe</button>
      </div>
    `;
    document.getElementById('askFirstRecipeButton')?.addEventListener('click', onAskFirst);
    return;
  }

  box.innerHTML = recipes.map((recipe) => renderRecipeCard(recipe, { actions: false, showTime: false, tagLimit: 3 })).join('');
  box.querySelectorAll('.recipe-card').forEach((card) => {
    card.addEventListener('click', () => openRecipeModal(supabase, Number(card.dataset.id)));
  });
}

function renderErrorState(retry) {
  const statsGrid = document.getElementById('statsGrid');
  const recentGrid = document.getElementById('recentGrid');
  const errorHtml = `
    <div class="empty-state">
      <p>Couldn't load the dashboard. Check your connection.</p>
      <button type="button" class="primary-button" id="dashboardRetry">Retry</button>
    </div>
  `;
  if (statsGrid) statsGrid.innerHTML = errorHtml;
  if (recentGrid) recentGrid.innerHTML = '';
  document.getElementById('dashboardRetry')?.addEventListener('click', retry);
}

function renderSkeleton() {
  const statsGrid = document.getElementById('statsGrid');
  const recentGrid = document.getElementById('recentGrid');
  const thisWeekBody = document.getElementById('thisWeekBody');
  if (statsGrid) statsGrid.innerHTML = Array.from({ length: 4 }).map(() => '<div class="skeleton metric-card-skeleton"></div>').join('');
  if (recentGrid) recentGrid.innerHTML = Array.from({ length: RECENT_COUNT }).map(() => '<div class="skeleton recipe-card-skeleton"></div>').join('');
  if (thisWeekBody) thisWeekBody.innerHTML = '<div class="skeleton metric-card-skeleton"></div>';
}

function mealRowHtml(slot, entry, recipe) {
  return `
    <div class="today-meal-row">
      <span class="meal-slot-label">${escapeHtml(slot)}</span>
      <div class="slot-card-art" aria-hidden="true">${monogramSvg(recipe)}</div>
      <strong>${escapeHtml(recipe.name)}</strong>
      <div class="today-meal-actions">
        <button type="button" class="ghost-button" data-open-today="${entry.recipeId}" data-servings="${entry.servings}">Open</button>
        <button type="button" class="ghost-button" data-cook-today="${entry.recipeId}" data-servings="${entry.servings}">Cook</button>
      </div>
    </div>
  `;
}

// Every applicable slot for today, not just the ones already planned — an empty slot gets the
// dashed "+ Add something" affordance so the card is a way to fill gaps, not just a status readout.
function todaySlotRowHtml(slot, entries, resolvedById) {
  const resolvedEntries = entries.filter((entry) => resolvedById.has(entry.recipeId));
  if (!resolvedEntries.length) {
    return `
      <div class="today-meal-row">
        <span class="meal-slot-label">${escapeHtml(slot)}</span>
        <a class="slot-add-link" href="planner.html">+ Add something</a>
      </div>
    `;
  }
  return resolvedEntries.map((entry) => mealRowHtml(slot, entry, resolvedById.get(entry.recipeId))).join('');
}

export async function initDashboardPage() {
  mountRecipeModal();
  const askDialog = mountAskDialog();

  const dashboardGreeting = document.getElementById('dashboardGreeting');
  const thisWeekBody = document.getElementById('thisWeekBody');
  const askForm = document.getElementById('dashAskForm');
  const askInput = document.getElementById('dashAskInput');

  if (dashboardGreeting) dashboardGreeting.textContent = `${greeting()}! This week`;
  mountTip(document.getElementById('askRecipeTip'), 'askRecipe');

  askForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = askInput.value.trim();
    askDialog.open(value ? { initialPrompt: value } : {});
    askInput.value = '';
  });

  // Fills the input for review rather than asking immediately — same "pick a value" feel as every
  // other chip in the app, not an implicit submit.
  document.getElementById('askSuggestionChips')?.querySelectorAll('[data-ask-suggestion]').forEach((chip) => {
    chip.addEventListener('click', () => {
      if (!askInput) return;
      askInput.value = chip.dataset.askSuggestion;
      askInput.focus();
    });
  });

  async function renderThisWeek() {
    if (!thisWeekBody) return;
    const household = await getHousehold().catch(() => null);
    const { store } = loadPlanState({ defaultServings: household?.default_servings || 4 });
    const thisWeekDays = getWeekDays(store, mondayOf());
    const weekEmpty = isWeekEmpty(thisWeekDays);

    const plannedIds = [...new Set(DAYS.flatMap((day) => (thisWeekDays[day] || []).map((e) => e.recipeId)))];
    const resolved = plannedIds.length ? await fetchPlannerRecipesByIds(supabase, plannedIds) : { data: [] };
    const resolvedById = new Map(resolved.data.map((row) => [row.id, row]));

    const share = computeProteinSmartShare(thisWeekDays, resolvedById);
    const shareText = share === null ? 'Protein-smart: no meals resolved yet' : `Protein-smart: ${Math.round(share * 100)}% of this week's meals`;
    const shareClass = share === null ? 'w-pct-0' : nearestWidthClass(Math.round(share * 100));

    // Resolved by exact date (not just "this week's Tuesday"), so it's correct even right at a
    // week boundary — e.g. tomorrow from a Sunday belongs to next week, not this one.
    const packedEntry = entriesOnDate(store, addDaysIso(todayIso(), 1)).find((e) => e.slot === 'Packed Lunch');
    const packedRecipe = packedEntry && resolvedById.get(packedEntry.recipeId);
    const tomorrowHtml = packedRecipe
      ? `Tomorrow's packed lunch: <strong>${escapeHtml(packedRecipe.name)}</strong>`
      : "Tomorrow's packed lunch: <strong>not planned yet</strong>";

    const todayIsoDate = todayIso();
    const todayName = dayNameForIso(todayIsoDate);
    const todayEntries = entriesOnDate(store, todayIsoDate);
    const todayHtml = slotsForDay(todayName)
      .map((slot) => todaySlotRowHtml(slot, todayEntries.filter((entry) => entry.slot === slot), resolvedById))
      .join('');
    // A whole-week auto-fill shortcut sits alongside the per-slot view below, not instead of it —
    // the per-slot list already shows today is empty, but this is the one-click fix for the week.
    const weekEmptyHint = weekEmpty ? '<p class="hint">Your whole week is empty. <a href="planner.html">Auto-fill it?</a></p>' : '';

    thisWeekBody.innerHTML = `
      <div class="week-header-row">
        <div class="protein-share">
          <div class="progress-bar" aria-hidden="true">
            <span class="progress-bar-fill ${shareClass}"></span>
            <span class="progress-bar-target target-marker-60" title="60% target"></span>
          </div>
          <p>${shareText}</p>
        </div>
        <div class="tomorrow-packed-lunch">${tomorrowHtml}</div>
      </div>
      ${weekEmptyHint}
      <div class="content-head"><h3>Today</h3></div>
      <div class="today-meals">${todayHtml}</div>
    `;

    thisWeekBody.querySelectorAll('[data-open-today]').forEach((button) => {
      button.addEventListener('click', () => {
        openRecipeModal(supabase, Number(button.dataset.openToday), { serves: Number(button.dataset.servings) });
      });
    });
    thisWeekBody.querySelectorAll('[data-cook-today]').forEach((button) => {
      button.addEventListener('click', async () => {
        const id = Number(button.dataset.cookToday);
        const serves = Number(button.dataset.servings);
        const [recipe, ingredientGroups] = await Promise.all([fetchRecipeById(supabase, id), fetchRecipeIngredients(supabase, id)]);
        if (!recipe) return;
        openCookMode({
          recipeName: recipe.name,
          stepGroups: Array.isArray(recipe.steps) ? recipe.steps : [],
          ingredientsHtml: formatIngredientsHtml(ingredientGroups, serves || recipe.serves || 4, recipe.serves || 4),
        });
      });
    });
  }

  async function load() {
    renderSkeleton();
    // 3 bounded Supabase requests for the stats/recent tiles (originally 2 per 8.1; Phase C's
    // Cuisines tile reuses the same cuisine_counts view the recipes page's filter facet already
    // fetches, adding one more bounded read) — unchanged by "This week", which makes its own
    // bounded requests via loadPlanState/renderThisWeek.
    const [statsResult, recentResult, cuisineResult] = await Promise.all([
      fetchRecipeStats(supabase),
      fetchRecentRecipes(supabase, RECENT_COUNT),
      fetchCuisineCounts(supabase),
    ]);

    if (!statsResult.ok || !recentResult.ok) {
      renderErrorState(load);
      return;
    }

    // Cuisine count is a nice-to-have 4th tile, not core data — don't hard-fail the page for it.
    const cuisineCount = cuisineResult.ok ? cuisineResult.data.filter((row) => row.recipes > 0).length : 0;
    const household = await getHousehold().catch(() => null);
    const { store } = loadPlanState({ defaultServings: household?.default_servings || 4 });
    const thisWeekDays = getWeekDays(store, mondayOf());
    const thisWeekPlannedCount = DAYS.reduce((sum, day) => sum + (thisWeekDays[day] || []).length, 0);

    renderStats(statsResult.data, cuisineCount, thisWeekPlannedCount);
    renderRecentGrid(recentResult.data.map(normalizeRecipe), () => askDialog.open());
    await renderThisWeek();
  }

  await load();
}
