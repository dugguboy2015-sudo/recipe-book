import { escapeHtml, showSnackbar } from '../lib/dom.js';
import { supabase } from '../lib/supabase-client.js';
import { fetchRecipesList, fetchCuisineOptions, fetchTagOptions, fetchSearchSuggestions } from '../lib/queries.js';
import { normalizeRecipe, renderRecipeCard } from '../components/recipe-card.js';
import { mountRecipeModal, openRecipeModal } from '../components/recipe-modal.js';
import { createRecipeForm } from '../components/recipe-form.js';
import { wireDialog } from '../components/dialog.js';
import { deleteRecipe, restoreRecipe } from '../lib/api.js';

const state = {
  recipes: [],
  page: 1,
  pageSize: 12,
  totalFilteredCount: 0,
  filters: { search: '', cuisine: '', tags: [], vegetarian: false, eggFree: false, dairyFree: false },
};

let pendingDeleteRecipeId = null;

export async function initRecipesPage() {
  const recipeGrid = document.getElementById('recipeGrid');
  const resultCount = document.getElementById('resultCount');
  const cuisineFilter = document.getElementById('cuisineFilter');
  const tagFilters = document.getElementById('tagFilters');
  const prevPage = document.getElementById('prevPage');
  const nextPage = document.getElementById('nextPage');
  const pageStatus = document.getElementById('pageStatus');
  const searchInput = document.getElementById('searchInput');
  const recipeSuggestions = document.getElementById('recipeSuggestions');
  const applyFilters = document.getElementById('applyFilters');
  const clearFilters = document.getElementById('clearFilters');

  if (!recipeGrid || !resultCount || !cuisineFilter || !tagFilters || !prevPage || !nextPage || !pageStatus) return;

  mountRecipeModal();

  const [cuisines, suggestions, tags] = await Promise.all([
    fetchCuisineOptions(supabase),
    fetchSearchSuggestions(supabase),
    fetchTagOptions(supabase),
  ]);

  cuisineFilter.innerHTML = '<option value="">All cuisines</option>' + cuisines.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');

  if (recipeSuggestions) {
    recipeSuggestions.innerHTML = suggestions.map((value) => `<option value="${escapeHtml(value)}"></option>`).join('');
  }

  tagFilters.innerHTML = tags.map((tag) => `<button type="button" class="chip" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`).join('');
  tagFilters.querySelectorAll('.chip').forEach((button) => {
    button.addEventListener('click', () => {
      const tag = button.dataset.tag;
      const active = state.filters.tags.includes(tag);
      state.filters.tags = active ? state.filters.tags.filter((item) => item !== tag) : [...state.filters.tags, tag];
      button.classList.toggle('active', !active);
    });
  });

  function updateStatus(count) {
    const totalPages = Math.max(1, Math.ceil(state.totalFilteredCount / state.pageSize));
    resultCount.textContent = `${count} recipes`;
    pageStatus.textContent = `Page ${state.page} of ${totalPages}`;
    prevPage.disabled = state.page <= 1;
    nextPage.disabled = state.page >= totalPages;
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
        openRecipeModal(supabase, Number(card.dataset.id));
      });
    });

    recipeGrid.querySelectorAll('[data-action]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        const id = Number(button.dataset.id);
        if (button.dataset.action === 'edit') {
          // Phase 6 acceptance: editing is disabled until the structured ingredient editor
          // ships in Phase 7. Add, delete and undo work now.
          showSnackbar('Editing is being upgraded and returns shortly.', 'error');
        } else if (button.dataset.action === 'delete') {
          openDeleteConfirm(id);
        }
      });
    });

    updateStatus(recipes.length);
  }

  async function refreshRecipes() {
    const { recipes, totalCount, page } = await fetchRecipesList(supabase, state.filters, { page: state.page, pageSize: state.pageSize });
    state.totalFilteredCount = totalCount;
    state.page = page;
    state.recipes = recipes.map(normalizeRecipe);
    renderCards(state.recipes);
  }

  const recipeForm = createRecipeForm({
    onSaved: async () => {
      state.page = 1;
      await refreshRecipes();
    },
  });

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

  addRecipeButton?.addEventListener('click', () => recipeForm.openAdd());
  cancelDeleteRecipe?.addEventListener('click', closeDeleteConfirm);
  confirmDeleteRecipe?.addEventListener('click', confirmSoftDelete);

  function commitSearch() {
    const nextSearch = searchInput.value.trim();
    if (nextSearch === state.filters.search) return;
    state.filters.search = nextSearch;
    state.page = 1;
    refreshRecipes();
  }

  searchInput.addEventListener('change', commitSearch);
  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitSearch();
    }
  });

  cuisineFilter.addEventListener('change', (event) => {
    state.filters.cuisine = event.target.value;
  });

  applyFilters.addEventListener('click', () => {
    state.page = 1;
    refreshRecipes();
  });

  clearFilters.addEventListener('click', () => {
    state.filters = { search: '', cuisine: '', tags: [], vegetarian: false, eggFree: false, dairyFree: false };
    searchInput.value = '';
    cuisineFilter.value = '';
    document.querySelectorAll('#tagFilters .chip').forEach((chip) => chip.classList.remove('active'));
    document.querySelectorAll('#dietaryFilters .chip').forEach((chip) => chip.classList.remove('active'));
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

  document.querySelectorAll('#dietaryFilters .chip').forEach((chip) => {
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
