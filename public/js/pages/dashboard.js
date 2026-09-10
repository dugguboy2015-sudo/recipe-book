import { escapeHtml } from '../shared/recipe-rules.js';
import { supabase } from '../lib/supabase-client.js';
import { fetchDashboardRecipes } from '../lib/queries.js';
import { normalizeRecipe, renderRecipeCard } from '../components/recipe-card.js';
import { mountRecipeModal, openRecipeModal } from '../components/recipe-modal.js';

function renderRecentGrid(recipes) {
  const box = document.getElementById('recentGrid');
  if (!box) return;

  const recent = recipes.slice(0, 3);
  if (!recent.length) {
    box.innerHTML = '<div class="empty-state">No recent recipes yet.</div>';
    return;
  }

  box.innerHTML = recent.map((recipe) => renderRecipeCard(recipe, { actions: false, showTime: false, tagLimit: 3 })).join('');
  box.querySelectorAll('.recipe-card').forEach((card) => {
    card.addEventListener('click', () => openRecipeModal(supabase, Number(card.dataset.id)));
  });
}

function renderStats(list) {
  const statsGrid = document.getElementById('statsGrid');
  if (!statsGrid) return;

  const total = list.length;
  const cuisineMap = {};
  list.forEach((item) => {
    const key = item.cuisine || 'General';
    cuisineMap[key] = (cuisineMap[key] || 0) + 1;
  });
  const vegCount = list.filter((item) => item.is_vegetarian).length;
  const eggFreeCount = list.filter((item) => item.is_egg_free).length;
  const topCuisine = Object.entries(cuisineMap).sort((a, b) => b[1] - a[1])[0];

  statsGrid.innerHTML = `
    <article class="metric-card"><div class="label">Total recipes</div><div class="value">${total}</div><div class="sub">Across the full collection</div></article>
    <article class="metric-card"><div class="label">Top cuisine</div><div class="value">${escapeHtml(topCuisine ? topCuisine[0] : 'N/A')}</div><div class="sub">${topCuisine ? topCuisine[1] : 0} recipes</div></article>
    <article class="metric-card"><div class="label">Vegetarian</div><div class="value">${vegCount}</div><div class="sub">Family-friendly picks</div></article>
    <article class="metric-card"><div class="label">Egg-free</div><div class="value">${eggFreeCount}</div><div class="sub">Easy meal options</div></article>
  `;
}

export async function initDashboardPage() {
  mountRecipeModal();

  const statsGrid = document.getElementById('statsGrid');
  const data = await fetchDashboardRecipes(supabase);
  if (data === null) {
    if (statsGrid) statsGrid.innerHTML = '<div class="empty-state">Unable to load dashboard stats.</div>';
    return;
  }

  const list = data.map(normalizeRecipe);
  renderStats(list);
  renderRecentGrid(list.slice().sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)));
}
