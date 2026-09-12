import { escapeHtml } from '../shared/html.js';
import { supabase } from '../lib/supabase-client.js';
import { fetchRecipeStats, fetchRecentRecipes, fetchPlannerRecipesByIds, fetchRecipeById, fetchRecipeIngredients } from '../lib/queries.js';
import { normalizeRecipe, renderRecipeCard } from '../components/recipe-card.js';
import { mountRecipeModal, openRecipeModal } from '../components/recipe-modal.js';
import { mountAskDialog } from '../components/ask-dialog.js';
import { mountTip } from '../components/tips.js';
import { monogramSvg } from '../components/monogram.js';
import { openCookMode } from '../components/cook-mode.js';
import { formatIngredientsHtml } from '../shared/cook-mode-format.js';
import { getHousehold } from '../lib/household.js';
import { loadPlanState, DAYS } from '../lib/planner-store.js';
import { computeProteinSmartShare, todayName, tomorrowName } from '../shared/plan-summary.js';
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

function renderStats(stats) {
  const statsGrid = document.getElementById('statsGrid');
  if (!statsGrid) return;

  statsGrid.innerHTML = `
    <article class="metric-card"><div class="label">Total recipes</div><div class="value">${stats.total}</div><div class="sub">Across the full collection</div></article>
    <article class="metric-card"><div class="label">Top cuisine</div><div class="value">${escapeHtml(stats.top_cuisine || 'N/A')}</div><div class="sub">${stats.top_cuisine_count || 0} recipes</div></article>
    <article class="metric-card"><div class="label">Vegetarian</div><div class="value">${stats.vegetarian}</div><div class="sub">Family-friendly picks</div></article>
    <article class="metric-card"><div class="label">Egg-free</div><div class="value">${stats.egg_free}</div><div class="sub">Easy meal options</div></article>
    <article class="metric-card"><div class="label">Protein-smart</div><div class="value">${stats.protein_smart}</div><div class="sub">${stats.protein_smart} of ${stats.total} recipes are protein-smart</div></article>
  `;
}

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
  if (statsGrid) statsGrid.innerHTML = Array.from({ length: 5 }).map(() => '<div class="skeleton metric-card-skeleton"></div>').join('');
  if (recentGrid) recentGrid.innerHTML = Array.from({ length: 3 }).map(() => '<div class="skeleton recipe-card-skeleton"></div>').join('');
  if (thisWeekBody) thisWeekBody.innerHTML = '<div class="skeleton metric-card-skeleton"></div>';
}

function mealRowHtml(day, entry, recipe) {
  if (!recipe) return '';
  return `
    <div class="today-meal-row">
      <span class="meal-slot-label">${escapeHtml(entry.slot)}</span>
      <div class="slot-card-art" aria-hidden="true">${monogramSvg(recipe)}</div>
      <strong>${escapeHtml(recipe.name)}</strong>
      <div class="today-meal-actions">
        <button type="button" class="ghost-button" data-open-today="${entry.recipeId}" data-servings="${entry.servings}">Open</button>
        <button type="button" class="ghost-button" data-cook-today="${entry.recipeId}" data-servings="${entry.servings}">Cook</button>
      </div>
    </div>
  `;
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

  async function renderThisWeek() {
    if (!thisWeekBody) return;
    const household = await getHousehold().catch(() => null);
    const { plan } = loadPlanState({ defaultServings: household?.default_servings || 4 });

    if (isWeekEmpty(plan.days)) {
      thisWeekBody.innerHTML = `
        <div class="empty-state">
          <p>Your week is empty.</p>
          <a class="primary-button" href="planner.html">Auto-fill it?</a>
        </div>
      `;
      return;
    }

    const plannedIds = [...new Set(DAYS.flatMap((day) => (plan.days[day] || []).map((e) => e.recipeId)))];
    const resolved = await fetchPlannerRecipesByIds(supabase, plannedIds);
    const resolvedById = new Map(resolved.data.map((row) => [row.id, row]));

    const share = computeProteinSmartShare(plan.days, resolvedById);
    const shareText = share === null ? 'Protein-smart: no meals resolved yet' : `Protein-smart: ${Math.round(share * 100)}% of this week's meals`;
    const shareClass = share === null ? 'w-pct-0' : nearestWidthClass(Math.round(share * 100));

    const packedEntry = (plan.days[tomorrowName()] || []).find((e) => e.slot === 'Packed Lunch');
    const packedRecipe = packedEntry && resolvedById.get(packedEntry.recipeId);
    const tomorrowHtml = packedRecipe
      ? `Tomorrow's packed lunch: <strong>${escapeHtml(packedRecipe.name)}</strong>`
      : "Tomorrow's packed lunch: <strong>not planned yet</strong>";

    const todayEntries = (plan.days[todayName()] || []).filter((e) => resolvedById.has(e.recipeId));
    const todayHtml = todayEntries.length
      ? todayEntries.map((entry) => mealRowHtml(todayName(), entry, resolvedById.get(entry.recipeId))).join('')
      : '<p class="hint">Nothing planned for today.</p>';

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
    // Exactly 2 Supabase requests for the stats/recent tiles (8.1 acceptance), unchanged by
    // 12.1's "This week" card, which makes its own bounded requests via loadPlanState/renderThisWeek.
    const [statsResult, recentResult] = await Promise.all([
      fetchRecipeStats(supabase),
      fetchRecentRecipes(supabase, 3),
    ]);

    if (!statsResult.ok || !recentResult.ok) {
      renderErrorState(load);
      return;
    }

    renderStats(statsResult.data);
    renderRecentGrid(recentResult.data.map(normalizeRecipe), () => askDialog.open());
    await renderThisWeek();
  }

  await load();
}
