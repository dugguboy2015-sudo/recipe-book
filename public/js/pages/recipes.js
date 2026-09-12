import { escapeHtml, showSnackbar, debounce } from '../lib/dom.js';
import { supabase } from '../lib/supabase-client.js';
import { searchRecipes, fetchCuisineCounts, fetchTagCounts, fetchSearchSuggestions, fetchRecipeBySlug } from '../lib/queries.js';
import { normalizeRecipe, renderRecipeCard } from '../components/recipe-card.js';
import { mountRecipeModal, openRecipeModal } from '../components/recipe-modal.js';
import { wireDialog } from '../components/dialog.js';
import { deleteRecipe, restoreRecipe } from '../lib/api.js';
import { MEAL_TYPES } from '../shared/html.js';
import { filtersToSearchParams, searchParamsToFilters, searchParamsToPage } from '../lib/url-state.js';
import { createGenerateFlow } from '../components/generate-flow.js';
import { takePendingDraft, takePendingPlannerSlot } from '../components/ask-dialog.js';
import { loadPlanState, persistPlan, addEntry, applyPrefEvent, persistPrefs } from '../lib/planner-store.js';
import { getHousehold } from '../lib/household.js';

function defaultFilters() {
  return {
    search: '', cuisine: '', tags: [], mealTypes: [],
    vegetarian: false, eggFree: false, dairyFree: false, proteinSmart: false, nutFree: false, spiceMax: null,
  };
}

function toDietaryFilter(filters) {
  return {
    vegetarian: filters.vegetarian, eggFree: filters.eggFree, dairyFree: filters.dairyFree,
    proteinSmart: filters.proteinSmart, nutFree: filters.nutFree, spiceMax: filters.spiceMax,
  };
}

const initialParams = new URLSearchParams(window.location.search);
const state = {
  recipes: [],
  page: searchParamsToPage(initialParams),
  pageSize: 12,
  totalFilteredCount: 0,
  filters: { ...defaultFilters(), ...searchParamsToFilters(initialParams) },
};

let pendingDeleteRecipeId = null;

function syncUrl() {
  const params = filtersToSearchParams(state.filters, state.page);
  const query = params.toString();
  const url = `${window.location.pathname}${query ? `?${query}` : ''}`;
  window.history.replaceState(null, '', url);
}

export async function initRecipesPage() {
  const recipeGrid = document.getElementById('recipeGrid');
  const resultCount = document.getElementById('resultCount');
  const resultStatus = document.getElementById('resultStatus');
  const cuisineFilter = document.getElementById('cuisineFilter');
  const tagFilters = document.getElementById('tagFilters');
  const prevPage = document.getElementById('prevPage');
  const nextPage = document.getElementById('nextPage');
  const pageStatus = document.getElementById('pageStatus');
  const searchInput = document.getElementById('searchInput');
  const recipeSuggestions = document.getElementById('recipeSuggestions');
  const clearFilters = document.getElementById('clearFilters');
  const mealTypeFilters = document.getElementById('mealTypeFilters');
  const spiceMaxFilter = document.getElementById('spiceMaxFilter');

  if (!recipeGrid || !resultCount || !cuisineFilter || !tagFilters || !prevPage || !nextPage || !pageStatus) return;

  mountRecipeModal();

  // recipes.html already has the inline "Describe a recipe" panel (10.1) — its header button
  // scrolls to and focuses that instead of opening a second, redundant dialog for the same flow.
  const generatePanelContainer = document.getElementById('generatePanelContainer');
  if (generatePanelContainer) {
    createGenerateFlow({
      container: generatePanelContainer,
      onDraftReady: async (draft, generationId, warnings, goalInfo) => (await loadRecipeForm()).openDraft(draft, generationId, warnings, goalInfo),
    });
  }
  document.getElementById('scrollToGeneratePanel')?.addEventListener('click', () => {
    generatePanelContainer?.scrollIntoView({ behavior: 'smooth' });
    document.getElementById('generatePrompt')?.focus();
  });

  // 8.2: the cuisine facet and tag chips come from the read-only *_counts views (bounded, and
  // already reflect only live recipes) instead of scanning every recipe client-side.
  const [cuisineCountsResult, tagCountsResult] = await Promise.all([
    fetchCuisineCounts(supabase),
    fetchTagCounts(supabase),
  ]);

  const cuisineOptions = cuisineCountsResult.ok ? cuisineCountsResult.data.filter((row) => row.recipes > 0) : [];
  cuisineFilter.innerHTML = '<option value="">All cuisines</option>'
    + cuisineOptions.map((row) => `<option value="${escapeHtml(row.cuisine)}">${escapeHtml(row.cuisine)} (${row.recipes})</option>`).join('');
  cuisineFilter.value = state.filters.cuisine;

  const tagOptions = tagCountsResult.ok ? tagCountsResult.data : [];
  tagFilters.innerHTML = tagOptions.map((row) => `<button type="button" class="chip${state.filters.tags.includes(row.tag) ? ' active' : ''}" data-tag="${escapeHtml(row.tag)}">${escapeHtml(row.tag)} (${row.recipes})</button>`).join('');
  tagFilters.querySelectorAll('.chip').forEach((button) => {
    button.addEventListener('click', () => {
      const tag = button.dataset.tag;
      const active = state.filters.tags.includes(tag);
      state.filters.tags = active ? state.filters.tags.filter((item) => item !== tag) : [...state.filters.tags, tag];
      button.classList.toggle('active', !active);
      state.page = 1;
      refreshRecipes();
    });
  });

  if (mealTypeFilters) {
    mealTypeFilters.innerHTML = MEAL_TYPES.map((type) => `<button type="button" class="chip${state.filters.mealTypes.includes(type) ? ' active' : ''}" data-meal-type="${escapeHtml(type)}">${escapeHtml(type)}</button>`).join('');
    mealTypeFilters.querySelectorAll('.chip').forEach((button) => {
      button.addEventListener('click', () => {
        const mealType = button.dataset.mealType;
        const active = state.filters.mealTypes.includes(mealType);
        state.filters.mealTypes = active ? state.filters.mealTypes.filter((item) => item !== mealType) : [...state.filters.mealTypes, mealType];
        button.classList.toggle('active', !active);
        state.page = 1;
        refreshRecipes();
      });
    });
  }

  document.querySelectorAll('#dietaryFilters .chip').forEach((chip) => {
    const key = chip.dataset.dietary;
    const stateKey = { vegetarian: 'vegetarian', 'egg-free': 'eggFree', 'dairy-free': 'dairyFree', 'protein-smart': 'proteinSmart', 'nut-free': 'nutFree' }[key];
    if (stateKey && state.filters[stateKey]) chip.classList.add('active');
    chip.addEventListener('click', () => {
      const active = chip.classList.contains('active');
      chip.classList.toggle('active', !active);
      if (stateKey) state.filters[stateKey] = !active;
      state.page = 1;
      refreshRecipes();
    });
  });

  if (spiceMaxFilter) {
    spiceMaxFilter.value = state.filters.spiceMax ? String(state.filters.spiceMax) : '';
    spiceMaxFilter.addEventListener('change', (event) => {
      state.filters.spiceMax = event.target.value ? Number(event.target.value) : null;
      state.page = 1;
      refreshRecipes();
    });
  }

  searchInput.value = state.filters.search;

  function updateStatus(count) {
    const totalPages = Math.max(1, Math.ceil(state.totalFilteredCount / state.pageSize));
    resultCount.textContent = `${count} recipes`;
    if (resultStatus) resultStatus.textContent = `${count} recipes found`;
    pageStatus.textContent = `Page ${state.page} of ${totalPages}`;
    prevPage.disabled = state.page <= 1;
    nextPage.disabled = state.page >= totalPages;
  }

  function renderSkeleton() {
    recipeGrid.innerHTML = Array.from({ length: state.pageSize }).map(() => '<div class="skeleton recipe-card-skeleton"></div>').join('');
  }

  function renderErrorState() {
    recipeGrid.innerHTML = `
      <div class="empty-state">
        <p>Couldn't load recipes. Check your connection.</p>
        <button type="button" class="primary-button" id="recipesRetry">Retry</button>
      </div>
    `;
    document.getElementById('recipesRetry')?.addEventListener('click', refreshRecipes);
  }

  function renderCards(recipes) {
    recipeGrid.innerHTML = '';
    if (!recipes.length) {
      recipeGrid.innerHTML = '<div class="empty-state">No recipes match your filters.</div>';
      updateStatus(0);
      return;
    }

    recipeGrid.innerHTML = recipes.map((recipe) => renderRecipeCard(recipe, { actions: true, showTime: true, tagLimit: 4 })).join('');

    recipeGrid.querySelectorAll('.recipe-card').forEach((card) => {
      card.addEventListener('click', (event) => {
        if (event.target.closest('[data-action]')) return;
        openRecipeModal(supabase, Number(card.dataset.id), { onEdit: async (id) => (await loadRecipeForm()).openEdit(id), onDelete: openDeleteConfirm });
      });
    });

    recipeGrid.querySelectorAll('[data-action]').forEach((button) => {
      button.addEventListener('click', async (event) => {
        event.stopPropagation();
        const id = Number(button.dataset.id);
        if (button.dataset.action === 'edit') {
          (await loadRecipeForm()).openEdit(id);
        } else if (button.dataset.action === 'delete') {
          openDeleteConfirm(id);
        }
      });
    });

    updateStatus(recipes.length);
  }

  async function refreshRecipes() {
    syncUrl();
    renderSkeleton();
    const filters = { term: state.filters.search, cuisine: state.filters.cuisine, tags: state.filters.tags, mealTypes: state.filters.mealTypes, dietary: toDietaryFilter(state.filters) };
    const result = await searchRecipes(supabase, filters, { page: state.page, pageSize: state.pageSize });
    if (!result.ok) {
      renderErrorState();
      return;
    }
    state.totalFilteredCount = result.totalCount;
    state.page = result.page;
    state.recipes = result.data.map(normalizeRecipe);
    renderCards(state.recipes);
  }

  // recipe-form.js (+ ingredient-editor.js/method-editor.js) is ~46KB and only needed once the
  // user actually opens Add/Edit/a generated draft — not for merely browsing the list, so it's
  // loaded on first use instead of up front (task 12.7's per-page performance budget).
  let recipeFormPromise = null;
  function loadRecipeForm() {
    if (!recipeFormPromise) {
      recipeFormPromise = import('../components/recipe-form.js').then((mod) => mod.createRecipeForm({
        client: supabase,
        onSaved: async (isEdit, savedAiRecipe) => {
          // 6.6: only a create resets to page 1 (BUG-3) — an edit stays on the current page.
          if (!isEdit) state.page = 1;
          await refreshRecipes();

          // 10.5: a recipe generated for a specific empty planner slot offers to go straight there.
          if (savedAiRecipe) {
            const pendingSlot = takePendingPlannerSlot();
            if (pendingSlot) {
              showSnackbar(`Add to ${pendingSlot.day}'s ${pendingSlot.slot}?`, 'success', {
                label: 'Add',
                duration: 10000,
                onClick: async () => {
                  const household = await getHousehold().catch(() => null);
                  const { plan, prefs } = loadPlanState();
                  persistPlan(addEntry(plan, pendingSlot.day, pendingSlot.slot, savedAiRecipe.id, household?.default_servings || 4, 'manual'));
                  persistPrefs(applyPrefEvent(prefs, savedAiRecipe.id, 'manual', plan.weekOf));
                  showSnackbar(`Added to ${pendingSlot.day}'s ${pendingSlot.slot}.`, 'success');
                },
              });
            }
          }
        },
      }));
    }
    return recipeFormPromise;
  }

  const addRecipeButton = document.getElementById('addRecipeButton');
  const deleteConfirmModal = document.getElementById('deleteConfirmModal');
  const cancelDeleteRecipe = document.getElementById('cancelDeleteRecipe');
  const confirmDeleteRecipe = document.getElementById('confirmDeleteRecipe');
  const deleteDialog = deleteConfirmModal ? wireDialog(deleteConfirmModal, { onClose: () => { pendingDeleteRecipeId = null; } }) : null;

  function openDeleteConfirm(recipeId) {
    pendingDeleteRecipeId = recipeId;
    deleteDialog?.open();
  }

  function closeDeleteConfirm() {
    deleteDialog?.close();
  }

  const turnstileContainer = document.getElementById('turnstileContainer');

  async function confirmSoftDelete() {
    if (!pendingDeleteRecipeId) return;
    const recipeId = pendingDeleteRecipeId;
    closeDeleteConfirm();

    const result = await deleteRecipe(recipeId, { turnstileContainer });
    if (!result.ok) {
      const message = result.code === 'not_found' ? 'This recipe was already removed.' : (result.message || 'Unable to delete recipe. Please try again.');
      showSnackbar(message, 'error');
      return;
    }

    showSnackbar('Recipe deleted successfully.', 'success', {
      label: 'Undo',
      duration: 8000,
      onClick: async () => {
        const undoResult = await restoreRecipe(recipeId, { turnstileContainer });
        if (undoResult.ok) {
          showSnackbar('Recipe restored.', 'success');
          await refreshRecipes();
        } else {
          showSnackbar(undoResult.message || 'Unable to restore recipe.', 'error');
        }
      },
    });
    state.page = 1;
    await refreshRecipes();
  }

  addRecipeButton?.addEventListener('click', async () => (await loadRecipeForm()).openAdd());
  cancelDeleteRecipe?.addEventListener('click', closeDeleteConfirm);
  confirmDeleteRecipe?.addEventListener('click', confirmSoftDelete);

  // 8.3: live, debounced (250ms) suggestions at 2+ characters, instead of a whole-corpus datalist
  // fetched once. 8.6: every filter (including free text, debounced 300ms) applies on change —
  // there's no Apply button any more.
  const updateSuggestions = debounce(async (term) => {
    if (!recipeSuggestions) return;
    const result = await fetchSearchSuggestions(supabase, term);
    if (result.ok) recipeSuggestions.innerHTML = result.data.map((name) => `<option value="${escapeHtml(name)}"></option>`).join('');
  }, 250);

  const applySearch = debounce(() => {
    state.filters.search = searchInput.value.trim();
    state.page = 1;
    refreshRecipes();
  }, 300);

  searchInput.addEventListener('input', () => {
    updateSuggestions(searchInput.value);
    applySearch();
  });

  cuisineFilter.addEventListener('change', (event) => {
    state.filters.cuisine = event.target.value;
    state.page = 1;
    refreshRecipes();
  });

  clearFilters.addEventListener('click', () => {
    state.filters = defaultFilters();
    state.page = 1;
    searchInput.value = '';
    cuisineFilter.value = '';
    if (spiceMaxFilter) spiceMaxFilter.value = '';
    document.querySelectorAll('#tagFilters .chip').forEach((chip) => chip.classList.remove('active'));
    document.querySelectorAll('#mealTypeFilters .chip').forEach((chip) => chip.classList.remove('active'));
    document.querySelectorAll('#dietaryFilters .chip').forEach((chip) => chip.classList.remove('active'));
    refreshRecipes();
  });

  prevPage.addEventListener('click', () => {
    if (state.page > 1) {
      state.page -= 1;
      refreshRecipes();
    }
  });

  // 8.8: guard before incrementing, rather than incrementing and clamping afterwards.
  nextPage.addEventListener('click', () => {
    const totalPages = Math.max(1, Math.ceil(state.totalFilteredCount / state.pageSize));
    if (state.page < totalPages) {
      state.page += 1;
      refreshRecipes();
    }
  });

  await refreshRecipes();

  // Deep link (task 7.4): recipes.html?recipe=<slug>&serves=6 opens the detail view directly.
  const deepLinkSlug = initialParams.get('recipe');
  if (deepLinkSlug) {
    const deepLinkRecipe = await fetchRecipeBySlug(supabase, deepLinkSlug);
    if (deepLinkRecipe) {
      const requestedServes = Number(initialParams.get('serves'));
      openRecipeModal(supabase, deepLinkRecipe.id, {
        serves: Number.isFinite(requestedServes) && requestedServes > 0 ? requestedServes : undefined,
        onEdit: async (id) => (await loadRecipeForm()).openEdit(id),
        onDelete: openDeleteConfirm,
      });
    } else {
      showSnackbar('This recipe was removed.', 'error');
    }
  }

  // Task 10.5: a draft generated from another page (via the header's Ask dialog) arrives here.
  if (initialParams.get('review') === '1') {
    const pending = takePendingDraft();
    if (pending) {
      (await loadRecipeForm()).openDraft(pending.draft, pending.generationId, pending.warnings, pending.goalInfo);
    }
  }
}
