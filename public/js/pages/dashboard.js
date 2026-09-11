import { escapeHtml } from '../shared/recipe-rules.js';
import { supabase } from '../lib/supabase-client.js';
import { fetchRecipeStats, fetchRecentRecipes } from '../lib/queries.js';
import { normalizeRecipe, renderRecipeCard } from '../components/recipe-card.js';
import { mountRecipeModal, openRecipeModal } from '../components/recipe-modal.js';

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

function renderRecentGrid(recipes) {
  const box = document.getElementById('recentGrid');
  if (!box) return;

  if (!recipes.length) {
    box.innerHTML = '<div class="empty-state">No recent recipes yet.</div>';
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
  if (statsGrid) statsGrid.innerHTML = Array.from({ length: 5 }).map(() => '<div class="skeleton metric-card-skeleton"></div>').join('');
  if (recentGrid) recentGrid.innerHTML = Array.from({ length: 3 }).map(() => '<div class="skeleton recipe-card-skeleton"></div>').join('');
}

export async function initDashboardPage() {
  mountRecipeModal();

  async function load() {
    renderSkeleton();
    // Exactly 2 Supabase requests (8.1 acceptance): the aggregated recipe_stats view for the
    // tiles, and one bounded (limit 3) query for the recently-added grid — never a full scan.
    const [statsResult, recentResult] = await Promise.all([
      fetchRecipeStats(supabase),
      fetchRecentRecipes(supabase, 3),
    ]);

    if (!statsResult.ok || !recentResult.ok) {
      renderErrorState(load);
      return;
    }

    renderStats(statsResult.data);
    renderRecentGrid(recentResult.data.map(normalizeRecipe));
  }

  await load();
}
