import { escapeHtml, debounce } from '../lib/dom.js';
import { supabase } from '../lib/supabase-client.js';
import { searchRecipes } from '../lib/queries.js';
import { normalizeRecipe } from '../components/recipe-card.js';
import { DAYS, MEAL_SLOTS, loadPlanner, persistPlanner, assignRecipeToDay as assignRecipeToDayInStore, defaultPlanner } from '../lib/planner-store.js';

const state = {
  recipes: [],
  selectedRecipe: null,
  planner: loadPlanner(),
};

function assignRecipeToDay(day, slot, recipe) {
  assignRecipeToDayInStore(state.planner, day, slot, recipe);
  persistPlanner(state.planner);
}

export async function initPlannerPage() {
  const plannerGrid = document.getElementById('plannerGrid');
  const plannerList = document.getElementById('plannerList');
  const plannerSearch = document.getElementById('plannerSearch');
  const resetWeek = document.getElementById('resetWeek');
  const selectedRecipeSummary = document.getElementById('selectedRecipeSummary');

  if (!plannerGrid || !plannerList || !plannerSearch || !resetWeek || !selectedRecipeSummary) return;

  function renderPlannerBoard() {
    plannerGrid.innerHTML = DAYS.map((day) => {
      const slotsMarkup = MEAL_SLOTS.map((slot) => {
        const slotItems = (state.planner[day] || []).filter((item) => (item.slot || 'Dinner') === slot);
        return `
          <div class="meal-slot ${slotItems.length ? 'filled' : ''}" data-day="${day}" data-slot="${slot}">
            <div class="meal-slot-header">
              <strong>${slot}</strong>
              <button type="button" class="small-button" data-day-add="${day}" data-slot="${slot}" aria-label="Add recipe to ${slot} on ${day}">+</button>
            </div>
            ${slotItems.length ? slotItems.map((item) => `
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

    plannerGrid.querySelectorAll('[data-day-add]').forEach((button) => {
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

    plannerGrid.querySelectorAll('.remove-slot').forEach((button) => {
      button.addEventListener('click', () => {
        const day = button.dataset.removeDay;
        const slot = button.dataset.removeSlot;
        const id = Number(button.dataset.removeId);
        state.planner[day] = (state.planner[day] || []).filter((item) => !(item.id === id && (item.slot || 'Dinner') === slot));
        persistPlanner(state.planner);
        renderPlannerBoard();
      });
    });
  }

  function renderPlannerRecipes() {
    selectedRecipeSummary.textContent = state.selectedRecipe ? `Selected: ${state.selectedRecipe.name}` : 'No recipe selected';
    selectedRecipeSummary.classList.toggle('has-selection', Boolean(state.selectedRecipe));

    if (!state.recipes.length) {
      plannerList.innerHTML = '<div class="empty-state">No matching recipes.</div>';
      return;
    }

    plannerList.innerHTML = state.recipes.map((recipe) => `
      <div class="browser-item${state.selectedRecipe && state.selectedRecipe.id === recipe.id ? ' active' : ''}" data-id="${recipe.id}">
        <strong>${escapeHtml(recipe.name)}</strong>
        <small>${escapeHtml(recipe.cuisine || 'General')}</small>
      </div>
    `).join('');

    plannerList.querySelectorAll('.browser-item').forEach((item) => {
      item.addEventListener('click', () => {
        const selected = state.recipes.find((recipe) => recipe.id === Number(item.dataset.id));
        if (!selected) return;
        state.selectedRecipe = selected;
        renderPlannerRecipes();
      });
    });
  }

  function renderPlannerError() {
    plannerList.innerHTML = `
      <div class="empty-state">
        <p>Couldn't load recipes. Check your connection.</p>
        <button type="button" class="primary-button" id="plannerRetry">Retry</button>
      </div>
    `;
    document.getElementById('plannerRetry')?.addEventListener('click', () => search(plannerSearch.value));
  }

  // BUG-6/8.5: the same searchRecipes() the recipes page uses, server-side, so a match beyond
  // the old .limit(50) preload's alphabetical cutoff is still found.
  async function search(term) {
    plannerList.innerHTML = Array.from({ length: 6 }).map(() => '<div class="skeleton browser-item-skeleton"></div>').join('');
    const result = await searchRecipes(supabase, { term }, { page: 1, pageSize: 12 });
    if (!result.ok) {
      renderPlannerError();
      return;
    }
    state.recipes = result.data.map(normalizeRecipe);
    renderPlannerRecipes();
  }

  const debouncedSearch = debounce(() => search(plannerSearch.value.trim()), 300);
  plannerSearch.addEventListener('input', debouncedSearch);

  resetWeek.addEventListener('click', () => {
    state.planner = defaultPlanner();
    state.selectedRecipe = null;
    persistPlanner(state.planner);
    renderPlannerBoard();
    renderPlannerRecipes();
  });

  renderPlannerBoard();
  await search('');
}
