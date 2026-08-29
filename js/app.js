const pageType = document.body.dataset.page || 'dashboard';
const recipeSupabase = window.recipeBookSupabase;

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const plannerKey = 'recipeBookPlanner';
const defaultPlanner = Object.fromEntries(DAYS.map(day => [day, []]));

const state = {
  recipes: [],
  page: 1,
  pageSize: 12,
  totalFilteredCount: 0,
  filters: {
    search: '',
    cuisine: '',
    tags: [],
    vegetarian: false,
    eggFree: false,
    dairyFree: false
  },
  plannerSearch: '',
  selectedRecipe: null,
  planner: loadPlanner()
};

function loadPlanner() {
  try {
    const saved = JSON.parse(localStorage.getItem(plannerKey) || 'null');
    if (!saved) return structuredClone(defaultPlanner);
    const normalized = structuredClone(defaultPlanner);
    Object.keys(normalized).forEach(day => {
      normalized[day] = Array.isArray(saved[day]) ? saved[day] : [];
    });
    return normalized;
  } catch {
    return structuredClone(defaultPlanner);
  }
}

function persistPlanner() {
  localStorage.setItem(plannerKey, JSON.stringify(state.planner));
}

function normalizeRecipe(recipe) {
  return {
    ...recipe,
    tags: Array.isArray(recipe.tags) ? recipe.tags : [],
    cuisine: recipe.cuisine || 'General',
    serves: recipe.serves || 4,
    totalTime: recipe.total_time_minutes ?? '—',
    is_vegetarian: Boolean(recipe.is_vegetarian),
    is_egg_free: Boolean(recipe.is_egg_free),
    contains_dairy: Boolean(recipe.contains_dairy)
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function fetchRecipes() {
  const selectCols = 'id,name,description,cuisine,tags,serves,total_time_minutes,is_egg_free,is_vegetarian,contains_dairy';

  let countQuery = recipeSupabase.from('recipes').select('id', { count: 'exact', head: true });
  let query = recipeSupabase.from('recipes').select(selectCols);

  if (state.filters.search) {
    const searchTerm = state.filters.search.trim();
    countQuery = countQuery.or(`name.ilike.%${searchTerm}%,description.ilike.%${searchTerm}%`);
    query = query.or(`name.ilike.%${searchTerm}%,description.ilike.%${searchTerm}%`);
  }

  if (state.filters.cuisine) {
    countQuery = countQuery.eq('cuisine', state.filters.cuisine);
    query = query.eq('cuisine', state.filters.cuisine);
  }

  if (state.filters.tags.length) {
    state.filters.tags.forEach(tag => {
      countQuery = countQuery.contains('tags', [tag]);
      query = query.contains('tags', [tag]);
    });
  }

  if (state.filters.vegetarian) {
    countQuery = countQuery.eq('is_vegetarian', true);
    query = query.eq('is_vegetarian', true);
  }

  if (state.filters.eggFree) {
    countQuery = countQuery.eq('is_egg_free', true);
    query = query.eq('is_egg_free', true);
  }

  if (state.filters.dairyFree) {
    countQuery = countQuery.eq('contains_dairy', false);
    query = query.eq('contains_dairy', false);
  }

  const { count: totalCount, error: countError } = await countQuery;
  if (countError) {
    console.error(countError);
  }

  state.totalFilteredCount = Number(totalCount || 0);
  const totalPages = Math.max(1, Math.ceil(state.totalFilteredCount / state.pageSize));
  if (state.page > totalPages) {
    state.page = totalPages;
  }

  const from = (state.page - 1) * state.pageSize;
  const to = from + state.pageSize - 1;
  query = query.range(from, to);

  const { data, error } = await query.order('name', { ascending: true });
  if (error) {
    console.error(error);
    return [];
  }

  const mapped = (data || []).map(normalizeRecipe);
  state.recipes = mapped;
  return mapped;
}

function renderRecentRecipes(recipes) {
  const box = document.getElementById('recentGrid');
  if (!box) return;

  const recent = Array.isArray(recipes) ? recipes.slice(0, 3) : [];
  if (!recent.length) {
    box.innerHTML = '<div class="empty-state">No recent recipes yet.</div>';
    return;
  }

  box.innerHTML = recent.map(recipe => `
    <article class="recipe-card" data-id="${recipe.id}">
      <h3>${escapeHtml(recipe.name)}</h3>
      <div class="recipe-meta">
        <span>${escapeHtml(recipe.cuisine || 'General')}</span>
        <span>•</span>
        <span>${recipe.serves || 4} serves</span>
      </div>
      <div class="tag-list">${(recipe.tags || []).slice(0, 3).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>
      <div class="badge-list">
        ${recipe.is_vegetarian ? '<span class="badge veg">Vegetarian</span>' : ''}
        ${recipe.is_egg_free ? '<span class="badge egg">Egg-free</span>' : ''}
        ${recipe.contains_dairy ? '' : '<span class="badge dairy">Dairy-free</span>'}
      </div>
    </article>
  `).join('');

  box.querySelectorAll('.recipe-card').forEach(card => {
    card.addEventListener('click', () => openRecipeModal(Number(card.dataset.id)));
  });
}

async function loadDashboard() {
  const statsGrid = document.getElementById('statsGrid');
  if (!statsGrid) return;

  const { data, error } = await recipeSupabase.from('recipes').select('id,cuisine,is_vegetarian,is_egg_free,contains_dairy,name,created_at');
  if (error) {
    console.error(error);
    statsGrid.innerHTML = '<div class="empty-state">Unable to load dashboard stats.</div>';
    return;
  }

  const list = (data || []).map(normalizeRecipe);
  const total = list.length;
  const cuisineMap = {};
  list.forEach(item => {
    const key = item.cuisine || 'General';
    cuisineMap[key] = (cuisineMap[key] || 0) + 1;
  });

  const vegCount = list.filter(item => item.is_vegetarian).length;
  const eggFreeCount = list.filter(item => item.is_egg_free).length;
  const topCuisine = Object.entries(cuisineMap).sort((a, b) => b[1] - a[1])[0];

  statsGrid.innerHTML = `
    <article class="metric-card"><div class="label">Total recipes</div><div class="value">${total}</div><div class="sub">Across the full collection</div></article>
    <article class="metric-card"><div class="label">Top cuisine</div><div class="value">${escapeHtml(topCuisine ? topCuisine[0] : 'N/A')}</div><div class="sub">${topCuisine ? topCuisine[1] : 0} recipes</div></article>
    <article class="metric-card"><div class="label">Vegetarian</div><div class="value">${vegCount}</div><div class="sub">Family-friendly picks</div></article>
    <article class="metric-card"><div class="label">Egg-free</div><div class="value">${eggFreeCount}</div><div class="sub">Easy meal options</div></article>
  `;

  renderRecentRecipes(list.slice().sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)));
}

async function loadRecipesPage() {
  const recipeGrid = document.getElementById('recipeGrid');
  const resultCount = document.getElementById('resultCount');
  const cuisineFilter = document.getElementById('cuisineFilter');
  const tagFilters = document.getElementById('tagFilters');
  const prevPage = document.getElementById('prevPage');
  const nextPage = document.getElementById('nextPage');
  const pageStatus = document.getElementById('pageStatus');
  const searchInput = document.getElementById('searchInput');
  const applyFilters = document.getElementById('applyFilters');
  const clearFilters = document.getElementById('clearFilters');

  if (!recipeGrid || !resultCount || !cuisineFilter || !tagFilters || !prevPage || !nextPage || !pageStatus) return;

  const { data: cuisineData, error: cuisineError } = await recipeSupabase.from('recipes').select('cuisine').not('cuisine', 'is', null).order('cuisine');
  if (!cuisineError) {
    const distinct = [...new Set((cuisineData || []).map(item => item.cuisine).filter(Boolean))];
    cuisineFilter.innerHTML = '<option value="">All cuisines</option>' + distinct.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  }

  const { data: tagData, error: tagError } = await recipeSupabase.from('recipes').select('tags');
  if (!tagError) {
    const allTags = [...new Set((tagData || []).flatMap(item => Array.isArray(item.tags) ? item.tags : []).filter(Boolean))].sort();
    tagFilters.innerHTML = allTags.map(tag => `<button type="button" class="chip" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`).join('');
    tagFilters.querySelectorAll('.chip').forEach(button => {
      button.addEventListener('click', () => {
        const tag = button.dataset.tag;
        const active = state.filters.tags.includes(tag);
        state.filters.tags = active ? state.filters.tags.filter(item => item !== tag) : [...state.filters.tags, tag];
        button.classList.toggle('active', !active);
      });
    });
  }

  function updateStatus(count) {
    const totalPages = Math.max(1, Math.ceil(state.totalFilteredCount / state.pageSize));
    const hasPrevPage = state.page > 1;
    const hasNextPage = state.page < totalPages;

    resultCount.textContent = `${count} recipes`;
    pageStatus.textContent = `Page ${state.page} of ${totalPages}`;
    prevPage.disabled = !hasPrevPage;
    nextPage.disabled = !hasNextPage;
  }

  function renderCards(recipes) {
    recipeGrid.innerHTML = '';
    if (!recipes.length) {
      recipeGrid.innerHTML = '<div class="empty-state">No recipes match your filters.</div>';
      updateStatus(0);
      return;
    }

    recipeGrid.innerHTML = recipes.map(recipe => `
      <article class="recipe-card" data-id="${recipe.id}">
        <div>
          <h3>${escapeHtml(recipe.name)}</h3>
        </div>
        <div class="recipe-meta">
          <span>${escapeHtml(recipe.cuisine || 'General')}</span>
          <span>•</span>
          <span>${recipe.serves || 4} serves</span>
          <span>•</span>
          <span>${recipe.totalTime !== '—' ? `${recipe.totalTime} min` : 'Time TBD'}</span>
        </div>
        <div class="tag-list">${(recipe.tags || []).slice(0, 4).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>
        <div class="badge-list">
          ${recipe.is_vegetarian ? '<span class="badge veg">Vegetarian</span>' : ''}
          ${recipe.is_egg_free ? '<span class="badge egg">Egg-free</span>' : ''}
          ${recipe.contains_dairy ? '' : '<span class="badge dairy">Dairy-free</span>'}
        </div>
      </article>
    `).join('');

    recipeGrid.querySelectorAll('.recipe-card').forEach(card => {
      card.addEventListener('click', () => openRecipeModal(Number(card.dataset.id)));
    });

    updateStatus(recipes.length);
  }

  async function refreshRecipes() {
    const recipes = await fetchRecipes();
    renderCards(recipes);
  }

  searchInput.addEventListener('input', (event) => {
    state.filters.search = event.target.value.trim();
  });

  cuisineFilter.addEventListener('change', (event) => {
    state.filters.cuisine = event.target.value;
  });

  applyFilters.addEventListener('click', () => {
    state.page = 1;
    refreshRecipes();
  });

  clearFilters.addEventListener('click', () => {
    state.filters = {
      search: '',
      cuisine: '',
      tags: [],
      vegetarian: false,
      eggFree: false,
      dairyFree: false
    };
    searchInput.value = '';
    cuisineFilter.value = '';
    document.querySelectorAll('#tagFilters .chip').forEach(chip => chip.classList.remove('active'));
    document.querySelectorAll('#dietaryFilters .chip').forEach(chip => chip.classList.remove('active'));
    state.page = 1;
    refreshRecipes();
  });

  prevPage.addEventListener('click', () => {
    if (state.page > 1) {
      state.page -= 1;
      refreshRecipes();
    }
  });

  nextPage.addEventListener('click', () => {
    state.page += 1;
    refreshRecipes();
  });

  document.querySelectorAll('#dietaryFilters .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const key = chip.dataset.dietary;
      const active = chip.classList.contains('active');
      chip.classList.toggle('active', !active);

      if (key === 'vegetarian') state.filters.vegetarian = !active;
      if (key === 'egg-free') state.filters.eggFree = !active;
      if (key === 'dairy-free') state.filters.dairyFree = !active;
    });
  });

  await refreshRecipes();
}

async function openRecipeModal(id) {
  const { data, error } = await recipeSupabase.from('recipes').select('*').eq('id', id).single();
  if (error) {
    console.error(error);
    return;
  }

  const modal = document.getElementById('recipeModal');
  if (!modal) return;

  const title = document.getElementById('modalTitle');
  const meta = document.getElementById('modalMeta');
  const ingredients = document.getElementById('modalIngredients');
  const steps = document.getElementById('modalSteps');
  const nutrition = document.getElementById('modalNutrition');
  const notes = document.getElementById('modalNotes');

  title.textContent = data.name;
  meta.innerHTML = `
    <span class="tag">${escapeHtml(data.cuisine || 'General')}</span>
    <span class="tag">${data.serves || 4} serves</span>
    <span class="tag">${data.total_time_minutes ? `${data.total_time_minutes} min` : 'Time TBD'}</span>
  `;

  const ingredientList = Array.isArray(data.ingredients) ? data.ingredients : [];
  ingredients.innerHTML = ingredientList.map(group => {
    const items = Array.isArray(group.items) ? group.items : [];
    return `<li><strong>${escapeHtml(group.group || 'Ingredients')}</strong><ul>${items.map(item => `<li>${escapeHtml(item.name || '')}</li>`).join('')}</ul></li>`;
  }).join('') || '<li>No ingredients listed.</li>';

  const stepList = Array.isArray(data.steps) ? data.steps : [];
  steps.innerHTML = stepList.map(block => {
    const list = Array.isArray(block.steps) ? block.steps : [];
    return `<li><strong>${escapeHtml(block.group || 'Method')}</strong><ol>${list.map(step => `<li>${escapeHtml(step)}</li>`).join('')}</ol></li>`;
  }).join('') || '<li>No steps listed.</li>';

  nutrition.textContent = `Calories: ${data.calories_kcal ?? '—'} kcal | Protein: ${data.protein_g ?? '—'} g | Carbs: ${data.carbs_g ?? '—'} g | Fat: ${data.fat_g ?? '—'} g | Fibre: ${data.fibre_g ?? '—'} g. ${data.nutrition_basis || ''}`;

  const notesList = [
    data.egg_check_notes ? `Egg check: ${data.egg_check_notes}` : '',
    data.common_mistakes ? `Common mistakes: ${data.common_mistakes}` : '',
    data.uk_sourcing_notes ? `UK sourcing: ${data.uk_sourcing_notes}` : '',
    data.storage_notes ? `Storage: ${data.storage_notes}` : '',
    data.kid_friendly_notes ? `Kid-friendly: ${data.kid_friendly_notes}` : ''
  ].filter(Boolean);

  notes.textContent = notesList.length ? notesList.join(' ') : 'No additional notes.';
  modal.classList.add('visible');
  modal.setAttribute('aria-hidden', 'false');
}

function closeRecipeModal() {
  const modal = document.getElementById('recipeModal');
  if (!modal) return;
  modal.classList.remove('visible');
  modal.setAttribute('aria-hidden', 'true');
}

function assignRecipeToDay(day, recipe) {
  if (!day || !recipe) return;
  const current = Array.isArray(state.planner[day]) ? state.planner[day] : [];
  const exists = current.some(item => item.id === recipe.id);
  if (!exists) {
    state.planner[day] = [...current, { id: recipe.id, name: recipe.name, slot: 'Dinner' }];
    persistPlanner();
  }
}

function initPlanner() {
  const plannerGrid = document.getElementById('plannerGrid');
  const plannerList = document.getElementById('plannerList');
  const plannerSearch = document.getElementById('plannerSearch');
  const resetWeek = document.getElementById('resetWeek');

  if (!plannerGrid || !plannerList || !plannerSearch || !resetWeek) return;

  function renderPlannerBoard() {
    plannerGrid.innerHTML = DAYS.map(day => `
      <div class="planner-day" data-day="${day}">
        <h3>${day}</h3>
        <div class="day-slot" data-day="${day}">
          <strong>Plan</strong>
          ${state.planner[day].length ? state.planner[day].map(item => `
            <div>
              <div class="slot-recipe">${escapeHtml(item.name)}</div>
              <div class="slot-actions">
                <span class="slot-name">${escapeHtml(item.slot || 'Meal')}</span>
                <button type="button" class="remove-slot" data-remove-day="${day}" data-remove-id="${item.id}">Remove</button>
              </div>
            </div>
          `).join('') : '<div class="slot-name">No recipe planned</div>'}
        </div>
        <button type="button" class="primary-button" data-day-add="${day}" style="margin-top:12px; width:100%;">Add selected recipe</button>
      </div>
    `).join('');

    plannerGrid.querySelectorAll('[data-day-add]').forEach(button => {
      button.addEventListener('click', () => {
        const day = button.dataset.dayAdd;
        if (!state.selectedRecipe) {
          window.alert('Select a recipe first from the list on the left.');
          return;
        }
        assignRecipeToDay(day, state.selectedRecipe);
        renderPlannerBoard();
      });
    });

    plannerGrid.querySelectorAll('.remove-slot').forEach(button => {
      button.addEventListener('click', () => {
        const day = button.dataset.removeDay;
        const id = Number(button.dataset.removeId);
        state.planner[day] = (state.planner[day] || []).filter(item => item.id !== id);
        persistPlanner();
        renderPlannerBoard();
      });
    });
  }

  function renderPlannerRecipes() {
    const searchTerm = plannerSearch.value.trim().toLowerCase();
    const list = (state.recipes || []).filter(recipe => {
      const text = `${recipe.name} ${recipe.description || ''}`.toLowerCase();
      return !searchTerm || text.includes(searchTerm);
    }).slice(0, 12);

    if (!list.length) {
      plannerList.innerHTML = '<div class="empty-state">No matching recipes.</div>';
      return;
    }

    plannerList.innerHTML = list.map(recipe => `
      <div class="browser-item${state.selectedRecipe && state.selectedRecipe.id === recipe.id ? ' active' : ''}" data-id="${recipe.id}">
        <strong>${escapeHtml(recipe.name)}</strong>
        <small>${escapeHtml(recipe.cuisine || 'General')}</small>
      </div>
    `).join('');

    plannerList.querySelectorAll('.browser-item').forEach(item => {
      item.addEventListener('click', () => {
        const selected = state.recipes.find(recipe => recipe.id === Number(item.dataset.id));
        if (!selected) return;
        state.selectedRecipe = selected;
        renderPlannerRecipes();
      });
    });
  }

  plannerSearch.addEventListener('input', () => {
    renderPlannerRecipes();
  });

  resetWeek.addEventListener('click', () => {
    state.planner = structuredClone(defaultPlanner);
    persistPlanner();
    renderPlannerBoard();
  });

  renderPlannerBoard();
  renderPlannerRecipes();
}

async function initApp() {
  if (!recipeSupabase) {
    console.error('Supabase client is not available.');
    return;
  }

  if (pageType === 'dashboard') {
    const { data } = await recipeSupabase.from('recipes').select('id,name,description,cuisine,tags,serves,total_time_minutes,is_egg_free,is_vegetarian,contains_dairy,created_at').order('created_at', { ascending: false }).limit(10);
    renderRecentRecipes((data || []).map(normalizeRecipe));
    loadDashboard();

    const closeButton = document.getElementById('closeModal');
    closeButton?.addEventListener('click', closeRecipeModal);
    const recipeModal = document.getElementById('recipeModal');
    recipeModal?.addEventListener('click', (event) => {
      if (event.target.id === 'recipeModal') closeRecipeModal();
    });
    return;
  }

  if (pageType === 'recipes') {
    await loadRecipesPage();
    const closeButton = document.getElementById('closeModal');
    closeButton?.addEventListener('click', closeRecipeModal);
    const recipeModal = document.getElementById('recipeModal');
    recipeModal?.addEventListener('click', (event) => {
      if (event.target.id === 'recipeModal') closeRecipeModal();
    });
    return;
  }

  if (pageType === 'planner') {
    const { data } = await recipeSupabase.from('recipes').select('id,name,description,cuisine,tags,serves,total_time_minutes,is_egg_free,is_vegetarian,contains_dairy').order('name', { ascending: true }).limit(50);
    state.recipes = (data || []).map(normalizeRecipe);
    initPlanner();
  }
}

window.initApp = initApp;
window.fetchRecipes = fetchRecipes;
window.openRecipeModal = openRecipeModal;
window.closeRecipeModal = closeRecipeModal;
window.renderRecentRecipes = renderRecentRecipes;
window.escapeHtml = escapeHtml;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => initApp());
} else {
  initApp();
}
