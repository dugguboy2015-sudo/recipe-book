import { escapeHtml, showSnackbar, debounce } from '../lib/dom.js';
import { supabase } from '../lib/supabase-client.js';
import { searchRecipes, fetchCuisineCounts, fetchTagCounts, fetchSearchSuggestions, fetchRecipeBySlug, fetchPendingCount } from '../lib/queries.js';
import { normalizeRecipe, renderRecipeCard } from '../components/recipe-card.js';
import { mountRecipeModal, openRecipeModal } from '../components/recipe-modal.js';
import { wireDialog } from '../components/dialog.js';
import { deleteRecipe, restoreRecipe, approveRecipe } from '../lib/api.js';
import { getAccountState, subscribeAccount, ensureMember } from '../components/account.js';
import { canEditRecipe, canApproveRecipe } from '../shared/permissions.js';
import { MEAL_TYPES } from '../shared/html.js';
import { filtersToSearchParams, searchParamsToFilters, searchParamsToPage } from '../lib/url-state.js';
import { createGenerateFlow } from '../components/generate-flow.js';
import { takePendingDraft, takePendingPlannerSlot } from '../components/ask-dialog.js';
import { loadPlanState, persistStore, addEntryToWeek, applyPrefEvent, persistPrefs, mondayOf } from '../lib/planner-store.js';
import { getHousehold } from '../lib/household.js';

function defaultFilters() {
  return {
    search: '', cuisine: '', tags: [], mealTypes: [],
    dairyFree: false, proteinSmart: false, nutFree: false, spiceMax: null, pendingOnly: false,
  };
}

/** The signed-in household as shared/permissions.js expects it, or null. */
function viewer() {
  const household = getAccountState().household;
  return household ? { householdId: household.id, isCurator: household.isCurator } : null;
}

function toDietaryFilter(filters) {
  return {
    dairyFree: filters.dairyFree, proteinSmart: filters.proteinSmart, nutFree: filters.nutFree, spiceMax: filters.spiceMax,
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
  const filterPanel = document.getElementById('filterPanel');
  const filterSheetBackdrop = document.getElementById('filterSheetBackdrop');
  const openFilterSheet = document.getElementById('openFilterSheet');
  const closeFilterSheet = document.getElementById('closeFilterSheet');
  const applyFilterSheet = document.getElementById('applyFilterSheet');
  const filterSheetCount = document.getElementById('filterSheetCount');

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
    const stateKey = { 'dairy-free': 'dairyFree', 'protein-smart': 'proteinSmart', 'nut-free': 'nutFree' }[key];
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

  // Always the true match count (state.totalFilteredCount), not just what fits on this page —
  // "Page X of Y" already communicates paging, so "N recipes" here and the filter sheet's
  // "Show N recipes" agree on what N means (found in passing while wiring the sheet's live count).
  function updateStatus() {
    const totalPages = Math.max(1, Math.ceil(state.totalFilteredCount / state.pageSize));
    resultCount.textContent = `${state.totalFilteredCount} recipes`;
    if (resultStatus) resultStatus.textContent = `${state.totalFilteredCount} recipes found`;
    if (filterSheetCount) filterSheetCount.textContent = String(state.totalFilteredCount);
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
      updateStatus();
      return;
    }

    const who = viewer();
    recipeGrid.innerHTML = recipes.map((recipe) => renderRecipeCard(recipe, { actions: canEditRecipe(who, recipe), showTime: true, tagLimit: 4 })).join('');

    recipeGrid.querySelectorAll('.recipe-card').forEach((card) => {
      card.addEventListener('click', (event) => {
        if (event.target.closest('[data-action]')) return;
        openRecipeModal(supabase, Number(card.dataset.id), modalActions());
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

    updateStatus();
  }

  async function refreshRecipes() {
    syncUrl();
    renderSkeleton();
    const filters = { term: state.filters.search, cuisine: state.filters.cuisine, tags: state.filters.tags, mealTypes: state.filters.mealTypes, dietary: toDietaryFilter(state.filters), pendingOnly: state.filters.pendingOnly };
    renderPendingNotice();
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

  // M1c: recipes waiting for the curator. The curator is told how many need review; a household
  // sees how many of its own are waiting. RLS decides which pending recipes each viewer can count.
  const pendingNotice = document.getElementById('pendingNotice');
  async function renderPendingNotice() {
    if (!pendingNotice) return;
    const who = viewer();
    if (state.filters.pendingOnly) {
      pendingNotice.innerHTML = `<p class="notice pending-notice">Showing recipes awaiting approval. <button type="button" class="ghost-button" data-pending-toggle>Show all recipes</button></p>`;
    } else {
      const count = who ? await fetchPendingCount(supabase) : 0;
      if (count === 0) {
        pendingNotice.innerHTML = '';
        return;
      }
      const plural = count === 1 ? 'recipe is' : 'recipes are';
      const text = who.isCurator
        ? `${count} ${plural} waiting for your approval.`
        : `${count} of your household's ${plural} waiting to be approved for the shared catalogue. Until then only your household can see them.`;
      pendingNotice.innerHTML = `<p class="notice pending-notice">${escapeHtml(text)} <button type="button" class="ghost-button" data-pending-toggle>${who.isCurator ? 'Review them' : 'Show them'}</button></p>`;
    }
    pendingNotice.querySelector('[data-pending-toggle]')?.addEventListener('click', async () => {
      state.filters.pendingOnly = !state.filters.pendingOnly;
      state.page = 1;
      await refreshRecipes();
    });
  }

  async function approve(id) {
    const result = await approveRecipe(id);
    if (!result.ok) {
      showSnackbar(result.message || "Couldn't approve that recipe. Please try again.", 'error');
      return;
    }
    showSnackbar(`${result.data.recipe?.name || 'Recipe'} is now in the shared catalogue.`, 'success');
    await refreshRecipes();
  }

  /** Detail-view actions, offered per recipe according to shared/permissions.js. */
  function modalActions(extra = {}) {
    return {
      ...extra,
      onEdit: async (id) => (await loadRecipeForm()).openEdit(id),
      onDelete: openDeleteConfirm,
      onApprove: approve,
      canEdit: (recipe) => canEditRecipe(viewer(), recipe),
      canApprove: (recipe) => canApproveRecipe(viewer(), recipe),
    };
  }

  // Signing in, out, or into a different household changes what's visible and what's editable.
  // The first render can't wait for the account to load, so it assumes a signed-out visitor; a
  // signed-in one gets a second render (with their Edit buttons and pending notice) once it has.
  let lastHouseholdId = null;
  subscribeAccount((account) => {
    if (!account.ready) return;
    const householdId = account.household?.id ?? null;
    if (householdId === lastHouseholdId) return;
    lastHouseholdId = householdId;
    refreshRecipes();
  });

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
                  const { store, prefs } = loadPlanState();
                  // pendingSlot carries the week it was requested for (the planner may have been
                  // showing a future week when "Suggest something new" was clicked); fall back to
                  // the current week for older pending-slot entries saved before this existed.
                  const weekOf = pendingSlot.weekOf || mondayOf();
                  persistStore(addEntryToWeek(store, weekOf, pendingSlot.day, pendingSlot.slot, savedAiRecipe.id, household?.default_servings || 4, 'manual'));
                  persistPrefs(applyPrefEvent(prefs, savedAiRecipe.id, 'manual', weekOf));
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

  const addRecipeTriggers = document.querySelectorAll('[data-open-add-recipe]'); // FAB + sidebar nav
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


  async function confirmSoftDelete() {
    if (!pendingDeleteRecipeId) return;
    const recipeId = pendingDeleteRecipeId;
    closeDeleteConfirm();

    const result = await deleteRecipe(recipeId);
    if (!result.ok) {
      const message = result.code === 'not_found' ? 'This recipe was already removed.' : (result.message || 'Unable to delete recipe. Please try again.');
      showSnackbar(message, 'error');
      return;
    }

    showSnackbar('Recipe deleted successfully.', 'success', {
      label: 'Undo',
      duration: 8000,
      onClick: async () => {
        const undoResult = await restoreRecipe(recipeId);
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

  addRecipeTriggers.forEach((button) => button.addEventListener('click', async () => {
    if (!(await ensureMember('to add recipes'))) return;
    (await loadRecipeForm()).openAdd();
  }));
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

  // ---------- Mobile filter sheet (task B.2): the same .filter-panel is a persistent sidebar on
  // desktop/tablet and a bottom sheet here — opened by the "Filters" pill, dismissed by its own
  // Close button, "Show N recipes", the backdrop, or Escape. `inert` on everything else stands in
  // for a real focus trap (this isn't a native <dialog>, so there's no free one from showModal()).
  if (filterPanel && filterSheetBackdrop && openFilterSheet) {
    const inertTargets = [
      document.querySelector('.sidebar-nav'),
      document.querySelector('.site-header'),
      document.querySelector('.page-header'),
      generatePanelContainer,
      document.querySelector('.recipes-results'),
      document.querySelector('.site-footer'),
      document.querySelector('.bottom-tab-bar'),
    ].filter(Boolean);
    let lastFocusedBeforeSheet = null;

    function onSheetKeydown(event) {
      if (event.key === 'Escape') closeSheet();
    }

    function openSheet() {
      lastFocusedBeforeSheet = document.activeElement;
      filterPanel.classList.add('filter-sheet-open');
      filterSheetBackdrop.classList.add('filter-sheet-open');
      inertTargets.forEach((el) => { el.inert = true; });
      (filterPanel.querySelector('input, select, button') || filterPanel).focus();
      document.addEventListener('keydown', onSheetKeydown);
    }

    function closeSheet() {
      filterPanel.classList.remove('filter-sheet-open');
      filterSheetBackdrop.classList.remove('filter-sheet-open');
      inertTargets.forEach((el) => { el.inert = false; });
      document.removeEventListener('keydown', onSheetKeydown);
      if (lastFocusedBeforeSheet?.isConnected) lastFocusedBeforeSheet.focus();
    }

    openFilterSheet.addEventListener('click', openSheet);
    closeFilterSheet?.addEventListener('click', closeSheet);
    applyFilterSheet?.addEventListener('click', closeSheet);
    filterSheetBackdrop.addEventListener('click', closeSheet);
  }

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
      openRecipeModal(supabase, deepLinkRecipe.id, modalActions({
        serves: Number.isFinite(requestedServes) && requestedServes > 0 ? requestedServes : undefined,
      }));
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

  // The sidebar's global "Add a recipe" link lands here from other pages via ?add=1.
  if (initialParams.get('add') === '1' && (await ensureMember('to add recipes'))) {
    (await loadRecipeForm()).openAdd();
  }
}
