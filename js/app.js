const pageType = document.body.dataset.page || 'dashboard';
const recipeSupabase = window.recipeBookSupabase;

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MEAL_SLOTS = ['Breakfast', 'Lunch', 'Dinner', 'Snacks', 'Dessert', 'Other'];
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

const recipeFormState = {
  mode: 'add',
  currentRecipeId: null
};

let pendingDeleteRecipeId = null;
const softDeleteSupport = { checked: false, enabled: false };

async function checkSoftDeleteSupport() {
  if (softDeleteSupport.checked) {
    return softDeleteSupport.enabled;
  }

  try {
    const { error } = await recipeSupabase
      .from('recipes')
      .select('id,is_deleted,deleted_at')
      .limit(1);

    softDeleteSupport.enabled = !error;
  } catch {
    softDeleteSupport.enabled = false;
  }

  softDeleteSupport.checked = true;
  return softDeleteSupport.enabled;
}

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

  const supportsSoftDelete = await checkSoftDeleteSupport();
  if (supportsSoftDelete) {
    countQuery = countQuery.eq('is_deleted', false);
    query = query.eq('is_deleted', false);
  }

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

  let query = recipeSupabase.from('recipes').select('id,cuisine,is_vegetarian,is_egg_free,contains_dairy,name,created_at');
  if (await checkSoftDeleteSupport()) {
    query = query.eq('is_deleted', false);
  }

  const { data, error } = await query;
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

  let cuisineQuery = recipeSupabase.from('recipes').select('cuisine').not('cuisine', 'is', null).order('cuisine');
  let tagQuery = recipeSupabase.from('recipes').select('tags');

  if (await checkSoftDeleteSupport()) {
    cuisineQuery = cuisineQuery.eq('is_deleted', false);
    tagQuery = tagQuery.eq('is_deleted', false);
  }

  const { data: cuisineData, error: cuisineError } = await cuisineQuery;
  if (!cuisineError) {
    const distinct = [...new Set((cuisineData || []).map(item => item.cuisine).filter(Boolean))];
    cuisineFilter.innerHTML = '<option value="">All cuisines</option>' + distinct.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  }

  const { data: tagData, error: tagError } = await tagQuery;
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
        <div class="recipe-card-header">
          <h3>${escapeHtml(recipe.name)}</h3>
          <div class="recipe-card-actions">
            <button type="button" class="icon-button edit-button" data-action="edit" data-id="${recipe.id}" aria-label="Edit recipe">✎</button>
            <button type="button" class="icon-button delete-button" data-action="delete" data-id="${recipe.id}" aria-label="Delete recipe">🗑</button>
          </div>
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
      card.addEventListener('click', (event) => {
        if (event.target.closest('[data-action]')) return;
        openRecipeModal(Number(card.dataset.id));
      });
    });

    recipeGrid.querySelectorAll('[data-action]').forEach(button => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        const action = button.dataset.action;
        const id = Number(button.dataset.id);

        if (action === 'edit') {
          const recipe = state.recipes.find(item => item.id === id);
          if (recipe) {
            openRecipeFormModal('edit', recipe);
          }
          return;
        }

        if (action === 'delete') {
          openDeleteConfirm(id);
        }
      });
    });

    updateStatus(recipes.length);
  }

  function showSnackbar(message, type = 'success') {
    const snackbar = document.getElementById('snackbar');
    if (!snackbar) return;
    snackbar.textContent = message;
    snackbar.className = `snackbar show ${type}`;
    clearTimeout(showSnackbar.timeoutId);
    showSnackbar.timeoutId = setTimeout(() => {
      snackbar.classList.remove('show');
    }, 3000);
  }

  function clearFieldErrors(form) {
    form.querySelectorAll('.field-error').forEach(node => {
      node.textContent = '';
    });
    form.querySelectorAll('input, textarea').forEach(node => {
      node.classList.remove('input-error');
    });
  }

  function setFieldError(form, fieldName, message) {
    const input = form.querySelector(`[name="${fieldName}"]`);
    const error = form.querySelector(`[data-error-for="${fieldName}"]`);
    if (input) input.classList.toggle('input-error', Boolean(message));
    if (error) error.textContent = message || '';
  }

  function parseNumberValue(rawValue) {
    if (rawValue === null || rawValue === undefined || rawValue === '') return null;
    const value = Number(rawValue);
    return Number.isFinite(value) ? value : null;
  }

  function buildRecipePayload(form) {
    const formData = new FormData(form);
    const fields = Object.fromEntries(formData.entries());

    const name = String(fields.name || '').trim();
    const cuisine = String(fields.cuisine || '').trim();
    const description = String(fields.description || '').trim();
    const serves = parseNumberValue(fields.serves);
    const totalTime = parseNumberValue(fields.total_time_minutes);
    const calories = parseNumberValue(fields.calories_kcal);
    const protein = parseNumberValue(fields.protein_g);
    const carbs = parseNumberValue(fields.carbs_g);
    const fat = parseNumberValue(fields.fat_g);
    const fibre = parseNumberValue(fields.fibre_g);

    const ingredientsText = String(fields.ingredients || '').trim();
    const stepsText = String(fields.steps || '').trim();
    const tagsText = String(fields.tags || '').trim();

    const ingredientItems = ingredientsText
      .split(/\n+/)
      .map(item => item.trim())
      .filter(Boolean)
      .map(item => ({ name: item }));

    const stepItems = stepsText
      .split(/\n+/)
      .map(item => item.trim())
      .filter(Boolean);

    const tags = tagsText
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);

    return {
      name,
      description,
      cuisine,
      serves,
      total_time_minutes: totalTime,
      tags,
      ingredients: ingredientItems.length ? [{ group: 'Ingredients', items: ingredientItems }] : [],
      steps: stepItems.length ? [{ group: 'Method', steps: stepItems }] : [],
      is_vegetarian: Boolean(fields.is_vegetarian),
      is_egg_free: Boolean(fields.is_egg_free),
      contains_dairy: Boolean(fields.contains_dairy),
      calories_kcal: calories,
      protein_g: protein,
      carbs_g: carbs,
      fat_g: fat,
      fibre_g: fibre
    };
  }

  function validateNewRecipeForm(form) {
    const errors = {};
    const values = buildRecipePayload(form);

    if (!values.name) errors.name = 'Recipe name is required.';
    if (!values.cuisine) errors.cuisine = 'Cuisine is required.';
    if (!values.description) errors.description = 'Description is required.';
    if (!values.serves || values.serves <= 0) errors.serves = 'Serves must be greater than 0.';
    if (!values.total_time_minutes || values.total_time_minutes <= 0) errors.total_time_minutes = 'Time must be greater than 0 minutes.';
    if (!values.ingredients.length) errors.ingredients = 'Add at least one ingredient.';
    if (!values.steps.length) errors.steps = 'Add at least one cooking step.';
    if (values.calories_kcal !== null && values.calories_kcal < 0) errors.calories_kcal = 'Calories must be 0 or more.';
    if (values.protein_g !== null && values.protein_g < 0) errors.protein_g = 'Protein must be 0 or more.';
    if (values.carbs_g !== null && values.carbs_g < 0) errors.carbs_g = 'Carbs must be 0 or more.';
    if (values.fat_g !== null && values.fat_g < 0) errors.fat_g = 'Fat must be 0 or more.';
    if (values.fibre_g !== null && values.fibre_g < 0) errors.fibre_g = 'Fibre must be 0 or more.';

    return { valid: Object.keys(errors).length === 0, errors, values };
  }

  const fillRecipeForm = (form, recipe) => {
    const ingredientLines = [];
    if (Array.isArray(recipe.ingredients)) {
      recipe.ingredients.forEach(group => {
        if (Array.isArray(group.items)) {
          group.items.forEach(item => ingredientLines.push(item.name || item));
        }
      });
    }

    const stepLines = [];
    if (Array.isArray(recipe.steps)) {
      recipe.steps.forEach(group => {
        if (Array.isArray(group.steps)) {
          group.steps.forEach(step => stepLines.push(step));
        }
      });
    }

    form.elements.name.value = recipe.name || '';
    form.elements.cuisine.value = recipe.cuisine || '';
    form.elements.description.value = recipe.description || '';
    form.elements.serves.value = recipe.serves || '';
    form.elements.total_time_minutes.value = recipe.total_time_minutes || '';
    form.elements.tags.value = Array.isArray(recipe.tags) ? recipe.tags.join(', ') : '';
    form.elements.ingredients.value = ingredientLines.join('\n');
    form.elements.steps.value = stepLines.join('\n');
    form.elements.is_vegetarian.checked = Boolean(recipe.is_vegetarian);
    form.elements.is_egg_free.checked = Boolean(recipe.is_egg_free);
    form.elements.contains_dairy.checked = Boolean(recipe.contains_dairy);
    form.elements.calories_kcal.value = recipe.calories_kcal ?? '';
    form.elements.protein_g.value = recipe.protein_g ?? '';
    form.elements.carbs_g.value = recipe.carbs_g ?? '';
    form.elements.fat_g.value = recipe.fat_g ?? '';
    form.elements.fibre_g.value = recipe.fibre_g ?? '';
  };

  function openRecipeFormModal(mode = 'add', recipe = null) {
    const modal = document.getElementById('addRecipeModal');
    const form = document.getElementById('addRecipeForm');
    const title = document.getElementById('addRecipeTitle');
    const submitButton = document.getElementById('submitRecipeButton');
    if (!modal || !form || !title || !submitButton) return;

    recipeFormState.mode = mode;
    recipeFormState.currentRecipeId = recipe ? Number(recipe.id) : null;
    title.textContent = mode === 'edit' ? 'Edit recipe' : 'Add a new recipe';
    submitButton.textContent = mode === 'edit' ? 'Update recipe' : 'Save recipe';

    form.reset();
    clearFieldErrors(form);

    if (mode === 'edit' && recipe) {
      fillRecipeForm(form, recipe);
    }

    modal.classList.add('visible');
    modal.setAttribute('aria-hidden', 'false');
  }

  function openAddRecipeModal() {
    openRecipeFormModal('add', null);
  }

  function closeAddRecipeModal() {
    const modal = document.getElementById('addRecipeModal');
    const form = document.getElementById('addRecipeForm');
    if (!modal) return;
    if (form) {
      form.reset();
      clearFieldErrors(form);
    }
    modal.classList.remove('visible');
    modal.setAttribute('aria-hidden', 'true');
    recipeFormState.mode = 'add';
    recipeFormState.currentRecipeId = null;
  }

  async function saveNewRecipe(event) {
    event.preventDefault();
    const form = event.currentTarget;
    clearFieldErrors(form);

    const validation = validateNewRecipeForm(form);
    if (!validation.valid) {
      Object.entries(validation.errors).forEach(([fieldName, message]) => setFieldError(form, fieldName, message));
      showSnackbar('Please fix the highlighted fields before saving.', 'error');
      const firstInvalid = form.querySelector('.input-error');
      firstInvalid?.focus();
      return;
    }

    try {
      if (recipeFormState.mode === 'edit' && recipeFormState.currentRecipeId) {
        const { data, error } = await recipeSupabase
          .from('recipes')
          .update(validation.values)
          .eq('id', recipeFormState.currentRecipeId)
          .select()
          .single();

        if (error) throw error;

        showSnackbar('Recipe updated successfully!', 'success');
        closeAddRecipeModal();
        state.page = 1;
        const recipes = await fetchRecipes();
        renderCards(recipes);

        if (data) {
          const updated = normalizeRecipe(data);
          state.recipes = state.recipes.map(recipe => recipe.id === updated.id ? updated : recipe);
          const index = state.recipes.findIndex(recipe => recipe.id === updated.id);
          if (index >= 0) {
            state.recipes[index] = updated;
          }
        }
        return;
      }

      const { data, error } = await recipeSupabase.from('recipes').insert([validation.values]).select().single();
      if (error) throw error;

      showSnackbar('Recipe added successfully!', 'success');
      closeAddRecipeModal();
      state.page = 1;
      const recipes = await fetchRecipes();
      renderCards(recipes);
      if (data) {
        const created = normalizeRecipe(data);
        if (!state.recipes.some(recipe => recipe.id === created.id)) {
          state.recipes = [created, ...state.recipes];
        }
      }
    } catch (error) {
      console.error(error);
      showSnackbar(error.message || 'Unable to save recipe. Please try again.', 'error');
    }
  }

  async function refreshRecipes() {
    const recipes = await fetchRecipes();
    renderCards(recipes);
  }

  const addRecipeButton = document.getElementById('addRecipeButton');
  const addRecipeModal = document.getElementById('addRecipeModal');
  const addRecipeForm = document.getElementById('addRecipeForm');
  const cancelAddRecipe = document.getElementById('cancelAddRecipe');
  const deleteConfirmModal = document.getElementById('deleteConfirmModal');
  const cancelDeleteRecipe = document.getElementById('cancelDeleteRecipe');
  const confirmDeleteRecipe = document.getElementById('confirmDeleteRecipe');

  function openDeleteConfirm(recipeId) {
    pendingDeleteRecipeId = recipeId;
    if (!deleteConfirmModal) return;
    deleteConfirmModal.classList.add('visible');
    deleteConfirmModal.setAttribute('aria-hidden', 'false');
  }

  function closeDeleteConfirm() {
    pendingDeleteRecipeId = null;
    if (!deleteConfirmModal) return;
    deleteConfirmModal.classList.remove('visible');
    deleteConfirmModal.setAttribute('aria-hidden', 'true');
  }

  async function confirmSoftDelete() {
    if (!pendingDeleteRecipeId) return;
    const recipeId = pendingDeleteRecipeId;
    closeDeleteConfirm();

    const supportsSoftDelete = await checkSoftDeleteSupport();
    if (!supportsSoftDelete) {
      showSnackbar('Soft delete is not enabled in Supabase yet. Add is_deleted and deleted_at columns to the recipes table first.', 'error');
      return;
    }

    try {
      const deletionTimestamp = new Date().toISOString();
      const softDeletePayload = { is_deleted: true, deleted_at: deletionTimestamp };

      const { error } = await recipeSupabase
        .from('recipes')
        .update(softDeletePayload)
        .eq('id', recipeId);

      if (error) throw error;

      showSnackbar('Recipe deleted successfully.', 'success');
      state.page = 1;
      const recipes = await fetchRecipes();
      renderCards(recipes);
    } catch (error) {
      console.error(error);
      showSnackbar(error.message || 'Unable to delete recipe. Please try again.', 'error');
    }
  }

  addRecipeButton?.addEventListener('click', openAddRecipeModal);
  cancelAddRecipe?.addEventListener('click', closeAddRecipeModal);
  cancelDeleteRecipe?.addEventListener('click', closeDeleteConfirm);
  confirmDeleteRecipe?.addEventListener('click', confirmSoftDelete);
  addRecipeModal?.addEventListener('click', (event) => {
    if (event.target.id === 'addRecipeModal') closeAddRecipeModal();
  });
  deleteConfirmModal?.addEventListener('click', (event) => {
    if (event.target.id === 'deleteConfirmModal') closeDeleteConfirm();
  });
  addRecipeForm?.addEventListener('submit', saveNewRecipe);

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
  let query = recipeSupabase.from('recipes').select('*').eq('id', id);
  if (await checkSoftDeleteSupport()) {
    query = query.eq('is_deleted', false);
  }

  const { data, error } = await query.single();
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

function assignRecipeToDay(day, slot, recipe) {
  if (!day || !slot || !recipe) return;
  const current = Array.isArray(state.planner[day]) ? state.planner[day] : [];
  const updated = [...current.filter(item => !(item.id === recipe.id && (item.slot || 'Dinner') === slot))];
  updated.push({ id: recipe.id, name: recipe.name, slot });
  state.planner[day] = updated;
  persistPlanner();
}

function initPlanner() {
  const plannerGrid = document.getElementById('plannerGrid');
  const plannerList = document.getElementById('plannerList');
  const plannerSearch = document.getElementById('plannerSearch');
  const resetWeek = document.getElementById('resetWeek');
  const selectedRecipeSummary = document.getElementById('selectedRecipeSummary');

  if (!plannerGrid || !plannerList || !plannerSearch || !resetWeek || !selectedRecipeSummary) return;

  function renderPlannerBoard() {
    plannerGrid.innerHTML = DAYS.map(day => {
      const slotsMarkup = MEAL_SLOTS.map(slot => {
        const slotItems = (state.planner[day] || []).filter(item => (item.slot || 'Dinner') === slot);

        return `
          <div class="meal-slot ${slotItems.length ? 'filled' : ''}" data-day="${day}" data-slot="${slot}">
            <div class="meal-slot-header">
              <strong>${slot}</strong>
              <button type="button" class="small-button" data-day-add="${day}" data-slot="${slot}" aria-label="Add recipe to ${slot} on ${day}">+</button>
            </div>
            ${slotItems.length ? slotItems.map(item => `
              <div class="slot-card">
                <div class="slot-recipe">${escapeHtml(item.name)}</div>
                <button type="button" class="remove-slot" data-remove-day="${day}" data-remove-id="${item.id}" data-remove-slot="${slot}">Remove</button>
              </div>
            `).join('') : '<div class="slot-empty">No recipe planned</div>'}
          </div>
        `;
      }).join('');

      return `
        <div class="planner-day" data-day="${day}">
          <h3>${day}</h3>
          <div class="day-slot-group">${slotsMarkup}</div>
        </div>
      `;
    }).join('');

    plannerGrid.querySelectorAll('[data-day-add]').forEach(button => {
      button.addEventListener('click', () => {
        const day = button.dataset.dayAdd;
        const slot = button.dataset.slot;
        if (!state.selectedRecipe) {
          window.alert('Select a recipe first from the list on the left.');
          return;
        }
        assignRecipeToDay(day, slot, state.selectedRecipe);
        renderPlannerBoard();
      });
    });

    plannerGrid.querySelectorAll('.remove-slot').forEach(button => {
      button.addEventListener('click', () => {
        const day = button.dataset.removeDay;
        const slot = button.dataset.removeSlot;
        const id = Number(button.dataset.removeId);
        state.planner[day] = (state.planner[day] || []).filter(item => !(item.id === id && (item.slot || 'Dinner') === slot));
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

    selectedRecipeSummary.textContent = state.selectedRecipe
      ? `Selected: ${state.selectedRecipe.name}`
      : 'No recipe selected';
    selectedRecipeSummary.classList.toggle('has-selection', Boolean(state.selectedRecipe));

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
    state.selectedRecipe = null;
    persistPlanner();
    renderPlannerBoard();
    renderPlannerRecipes();
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
    let query = recipeSupabase.from('recipes').select('id,name,description,cuisine,tags,serves,total_time_minutes,is_egg_free,is_vegetarian,contains_dairy,created_at').order('created_at', { ascending: false }).limit(10);
    if (await checkSoftDeleteSupport()) {
      query = query.eq('is_deleted', false);
    }

    const { data } = await query;
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
    let query = recipeSupabase.from('recipes').select('id,name,description,cuisine,tags,serves,total_time_minutes,is_egg_free,is_vegetarian,contains_dairy').order('name', { ascending: true }).limit(50);
    if (await checkSoftDeleteSupport()) {
      query = query.eq('is_deleted', false);
    }

    const { data } = await query;
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
