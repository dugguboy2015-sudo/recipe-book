import { escapeHtml, debounce, showSnackbar } from '../lib/dom.js';
import { supabase } from '../lib/supabase-client.js';
import { searchRecipes, fetchPlannerCandidates, fetchPlannerRecipesByIds } from '../lib/queries.js';
import { normalizeRecipe } from '../components/recipe-card.js';
import { mountRecipeModal, openRecipeModal } from '../components/recipe-modal.js';
import { monogramSvg } from '../components/monogram.js';
import { wireDialog } from '../components/dialog.js';
import { getHousehold } from '../lib/household.js';
import { nearestWidthClass } from '../shared/nutrition-ri.js';
import { planWeek, shuffleEntry, WEEKDAYS } from '../shared/planner-engine.js';
import { computeProteinSmartShare, tomorrowName } from '../shared/plan-summary.js';
import {
  DAYS, SLOTS, loadPlanState, persistPlan, persistPrefs, addEntry, removeEntry, keepEntry,
  replaceEntry, updateServings, applyPrefEvent, dismissWeekReview, exportPlanData,
  parseImportedPlanData, resetPlan,
} from '../lib/planner-store.js';
import { mountAskDialog, storePendingPlannerSlot } from '../components/ask-dialog.js';
import { mountTip } from '../components/tips.js';
import { MEAL_TYPES } from '../shared/html.js';

const SLOT_PROMPTS = {
  Breakfast: 'a tasty, protein-forward vegetarian breakfast',
  'Packed Lunch': 'a protein-rich vegetarian packed lunch, good cold',
  Lunch: 'a satisfying vegetarian lunch',
  Dinner: 'a flavourful vegetarian dinner',
  Snacks: 'a healthy vegetarian snack',
  Dessert: 'a lighter vegetarian dessert',
};

function pluralize(n, singular, plural) {
  return n === 1 ? singular : plural;
}

const NEEDS_PROMPTS = {
  Breakfast: (n) => `${n} tasty, protein-forward vegetarian ${pluralize(n, 'breakfast', 'breakfasts')}`,
  'Packed Lunch': (n) => `${n} protein-rich vegetarian ${pluralize(n, 'packed lunch', 'packed lunches')}, good cold`,
  Lunch: (n) => `${n} satisfying vegetarian ${pluralize(n, 'lunch', 'lunches')}`,
  Dinner: (n) => `${n} flavourful vegetarian ${pluralize(n, 'dinner', 'dinners')}`,
  Snacks: (n) => `${n} healthy vegetarian ${pluralize(n, 'snack', 'snacks')}`,
  Dessert: (n) => `${n} lighter vegetarian ${pluralize(n, 'dessert', 'desserts')}`,
};

const state = {
  recipes: [], // browse-panel search results
  selectedRecipe: null,
  browseTerm: '',
  browsePage: 1,
  browseTotalCount: 0,
  plan: null,
  prefs: null,
  weekReview: null,
  storageAvailable: true,
  candidates: [], // the bounded planner_candidates pool, for planWeek/shuffleEntry
  resolvedById: new Map(), // planned-recipe display data, resolved by id (task 11.2)
  household: null,
  pickerContext: null, // { day, slot } while the add-recipe picker dialog is open
};

function findEntry(day, slot, recipeId) {
  return (state.plan.days[day] || []).find((e) => e.slot === slot && e.recipeId === recipeId);
}

async function ensureResolvedForCurrentPlan() {
  const ids = new Set();
  for (const day of DAYS) for (const entry of state.plan.days[day] || []) ids.add(entry.recipeId);
  if (state.weekReview) for (const entry of state.weekReview.entries) ids.add(entry.recipeId);
  const missing = [...ids].filter((id) => !state.resolvedById.has(id));
  if (missing.length === 0) return;
  const result = await fetchPlannerRecipesByIds(supabase, missing);
  for (const row of result.data) state.resolvedById.set(row.id, row);
}

export async function initPlannerPage() {
  const plannerGrid = document.getElementById('plannerGrid');
  const plannerList = document.getElementById('plannerList');
  const plannerSearch = document.getElementById('plannerSearch');
  const selectedRecipeSummary = document.getElementById('selectedRecipeSummary');
  const browseShowMore = document.getElementById('browseShowMore');

  const proteinShareBar = document.getElementById('proteinShareBar');
  const proteinShareText = document.getElementById('proteinShareText');
  const tomorrowPackedLunch = document.getElementById('tomorrowPackedLunch');
  const cuisineMix = document.getElementById('cuisineMix');
  const autoFillSettingsGrid = document.getElementById('autoFillSettingsGrid');
  const autoFillWeek = document.getElementById('autoFillWeek');
  const plannerStorageWarning = document.getElementById('plannerStorageWarning');

  const weekReviewCard = document.getElementById('weekReviewCard');
  const weekReviewList = document.getElementById('weekReviewList');
  const dismissWeekReviewButton = document.getElementById('dismissWeekReview');

  const exportPlanButton = document.getElementById('exportPlan');
  const importPlanButton = document.getElementById('importPlanButton');
  const importPlanInput = document.getElementById('importPlanInput');
  const resetWeekButton = document.getElementById('resetWeek');

  if (!plannerGrid || !plannerList || !plannerSearch || !selectedRecipeSummary) return;

  mountRecipeModal();
  const askDialog = mountAskDialog();
  const pickerDialog = wireDialog(document.getElementById('plannerPickerDialog'));
  const resetDialog = wireDialog(document.getElementById('resetWeekConfirm'));
  const importDialog = wireDialog(document.getElementById('importPlanConfirm'));
  let pendingImport = null;

  state.household = await getHousehold().catch(() => null);
  const loaded = loadPlanState({ defaultServings: state.household?.default_servings || 4 });
  state.plan = loaded.plan;
  state.prefs = loaded.prefs;
  state.weekReview = loaded.weekReview;
  state.storageAvailable = loaded.storageAvailable;
  if (plannerStorageWarning) plannerStorageWarning.hidden = state.storageAvailable !== false;

  const candidatesResult = await fetchPlannerCandidates(supabase);
  state.candidates = candidatesResult.data;
  for (const row of state.candidates) state.resolvedById.set(row.id, row);
  await ensureResolvedForCurrentPlan();

  function renderAll() {
    renderWeekHeader();
    renderWeekReview();
    renderPlannerBoard();
  }

  function renderWeekHeader() {
    const share = computeProteinSmartShare(state.plan.days, state.resolvedById);
    if (share === null) {
      proteinShareText.textContent = 'Protein-smart: no meals planned yet';
      proteinShareBar.className = 'progress-bar-fill w-pct-0';
    } else {
      const pct = Math.round(share * 100);
      proteinShareText.textContent = `Protein-smart: ${pct}% of this week's meals`;
      proteinShareBar.className = `progress-bar-fill ${nearestWidthClass(pct)}`;
    }

    // "Tomorrow" only resolves within this Mon-Sun plan; on a Sunday, tomorrow belongs to next
    // week's (not-yet-created) plan, so it simply shows as not planned yet.
    const packedEntry = (state.plan.days[tomorrowName()] || []).find((e) => e.slot === 'Packed Lunch');
    const packedRecipe = packedEntry && state.resolvedById.get(packedEntry.recipeId);
    tomorrowPackedLunch.innerHTML = packedRecipe
      ? `Tomorrow's packed lunch: <strong>${escapeHtml(packedRecipe.name)}</strong>`
      : "Tomorrow's packed lunch: <strong>not planned yet</strong>";

    const cuisineCounts = new Map();
    for (const day of DAYS) {
      for (const entry of state.plan.days[day] || []) {
        const recipe = state.resolvedById.get(entry.recipeId);
        if (!recipe?.cuisine) continue;
        cuisineCounts.set(recipe.cuisine, (cuisineCounts.get(recipe.cuisine) || 0) + 1);
      }
    }
    const topCuisines = [...cuisineCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    cuisineMix.innerHTML = topCuisines.length
      ? `Cuisine mix: <div class="chip-group">${topCuisines.map(([cuisine, count]) => `<span class="chip">${escapeHtml(cuisine)} (${count})</span>`).join('')}</div>`
      : 'Cuisine mix: nothing planned yet';
  }

  function renderAutoFillSettings() {
    autoFillSettingsGrid.innerHTML = SLOTS.map((slot) => {
      if (slot === 'Lunch') {
        const value = state.prefs.settings.autoSlots.Lunch;
        return `
          <div class="auto-fill-setting-row">
            <label for="autoSlot-Lunch">Lunch</label>
            <select id="autoSlot-Lunch" data-auto-slot="Lunch">
              <option value="off" ${value === false ? 'selected' : ''}>Off</option>
              <option value="weekends" ${value === 'weekends' ? 'selected' : ''}>Weekends</option>
              <option value="on" ${value === true ? 'selected' : ''}>On</option>
            </select>
          </div>`;
      }
      const checked = state.prefs.settings.autoSlots[slot] === true;
      return `
        <div class="auto-fill-setting-row">
          <label for="autoSlot-${slot}">${slot}</label>
          <input type="checkbox" id="autoSlot-${slot}" data-auto-slot="${slot}" ${checked ? 'checked' : ''} />
        </div>`;
    }).join('');

    autoFillSettingsGrid.querySelectorAll('[data-auto-slot]').forEach((el) => {
      el.addEventListener('change', () => {
        const slot = el.dataset.autoSlot;
        const value = slot === 'Lunch' ? (el.value === 'on' ? true : el.value === 'weekends' ? 'weekends' : false) : el.checked;
        state.prefs = { ...state.prefs, settings: { autoSlots: { ...state.prefs.settings.autoSlots, [slot]: value } } };
        persistPrefs(state.prefs);
      });
    });
  }

  function renderWeekReview() {
    if (!state.weekReview || !state.weekReview.entries.length) {
      weekReviewCard.hidden = true;
      return;
    }
    weekReviewCard.hidden = false;
    weekReviewList.innerHTML = state.weekReview.entries.map((entry, index) => {
      const recipe = state.resolvedById.get(entry.recipeId);
      const name = recipe ? escapeHtml(recipe.name) : 'a recipe that is no longer available';
      return `
        <div class="week-review-row" data-review-index="${index}">
          <span>${entry.day} ${entry.slot}: <strong>${name}</strong></span>
          <div class="week-review-row-buttons">
            <button type="button" class="small-button" data-review-action="loved" data-review-index="${index}">Loved it</button>
            <button type="button" class="small-button" data-review-action="fine" data-review-index="${index}">Fine</button>
            <button type="button" class="small-button" data-review-action="notAgain" data-review-index="${index}">Not again</button>
          </div>
        </div>
      `;
    }).join('');

    weekReviewList.querySelectorAll('[data-review-action]').forEach((button) => {
      button.addEventListener('click', () => {
        const index = Number(button.dataset.reviewIndex);
        const entry = state.weekReview.entries[index];
        if (!entry) return;
        const action = button.dataset.reviewAction;
        if (action === 'loved') state.prefs = applyPrefEvent(state.prefs, entry.recipeId, 'loved', state.plan.weekOf);
        else if (action === 'notAgain') state.prefs = applyPrefEvent(state.prefs, entry.recipeId, 'notAgain', state.plan.weekOf);
        persistPrefs(state.prefs);
        state.weekReview.entries.splice(index, 1);
        renderWeekReview();
      });
    });
  }

  function renderSlotCard(day, entry) {
    const recipe = state.resolvedById.get(entry.recipeId);
    if (!recipe) {
      return `
        <div class="slot-card">
          <div class="slot-unavailable">Recipe no longer available</div>
          <button type="button" class="remove-slot" data-remove-day="${day}" data-remove-slot="${entry.slot}" data-remove-id="${entry.recipeId}">Remove</button>
        </div>
      `;
    }
    const reasonsMarkup = entry.source === 'auto' && entry.reasons?.length
      ? `<div class="slot-reasons">${entry.reasons.map((reason) => `<span class="chip">${escapeHtml(reason)}</span>`).join('')}</div>`
      : '';
    const autoActions = entry.source === 'auto'
      ? `
        <div class="slot-card-actions">
          <button type="button" class="small-button" data-shuffle-day="${day}" data-shuffle-slot="${entry.slot}" data-shuffle-id="${entry.recipeId}">Shuffle</button>
          <button type="button" class="small-button" data-keep-day="${day}" data-keep-slot="${entry.slot}" data-keep-id="${entry.recipeId}">Keep</button>
        </div>
      `
      : '';
    return `
      <div class="slot-card">
        <div class="slot-card-header">
          <div class="slot-card-art" aria-hidden="true">${monogramSvg(recipe)}</div>
          <button type="button" class="slot-recipe-link" data-open-recipe="${entry.recipeId}" data-servings="${entry.servings}">${escapeHtml(recipe.name)}</button>
        </div>
        ${reasonsMarkup}
        <div class="servings-stepper">
          <button type="button" data-servings="minus" data-day="${day}" data-slot="${entry.slot}" data-id="${entry.recipeId}" aria-label="Fewer servings">−</button>
          <output>${entry.servings}</output>
          <button type="button" data-servings="plus" data-day="${day}" data-slot="${entry.slot}" data-id="${entry.recipeId}" aria-label="More servings">+</button>
        </div>
        ${autoActions}
        <button type="button" class="remove-slot" data-remove-day="${day}" data-remove-slot="${entry.slot}" data-remove-id="${entry.recipeId}">Remove</button>
      </div>
    `;
  }

  function renderPlannerBoard() {
    plannerGrid.innerHTML = DAYS.map((day) => {
      const daySlots = SLOTS.filter((slot) => slot !== 'Packed Lunch' || WEEKDAYS.includes(day));
      const slotsMarkup = daySlots.map((slot) => {
        const entries = (state.plan.days[day] || []).filter((e) => e.slot === slot);
        return `
          <div class="meal-slot ${entries.length ? 'filled' : ''}" data-day="${day}" data-slot="${slot}">
            <div class="meal-slot-header">
              <strong>${slot}</strong>
              <button type="button" class="small-button" data-day-add="${day}" data-slot="${slot}" aria-label="Add recipe to ${slot} on ${day}">+</button>
            </div>
            ${entries.length ? entries.map((entry) => renderSlotCard(day, entry)).join('') : '<div class="slot-empty">No recipe planned</div>'}
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

    wirePlannerBoardEvents();
  }

  function addRecipeToSlot(day, slot, recipeId, servings, source) {
    const before = state.plan.days[day] || [];
    if (before.some((e) => e.slot === slot && e.recipeId === recipeId)) {
      showSnackbar('Already planned.', 'error');
      return;
    }
    state.plan = addEntry(state.plan, day, slot, recipeId, servings ?? state.household?.default_servings ?? 4, source);
    persistPlan(state.plan);
    if (source === 'manual') {
      state.prefs = applyPrefEvent(state.prefs, recipeId, 'manual', state.plan.weekOf);
      persistPrefs(state.prefs);
    }
    ensureResolvedForCurrentPlan().then(() => { renderWeekHeader(); renderPlannerBoard(); });
  }

  function wirePlannerBoardEvents() {
    plannerGrid.querySelectorAll('[data-day-add]').forEach((button) => {
      button.addEventListener('click', () => {
        const day = button.dataset.dayAdd;
        const slot = button.dataset.slot;
        if (state.selectedRecipe) {
          addRecipeToSlot(day, slot, state.selectedRecipe.id, undefined, 'manual');
        } else {
          openPicker(day, slot);
        }
      });
    });

    plannerGrid.querySelectorAll('[data-open-recipe]').forEach((button) => {
      button.addEventListener('click', () => {
        openRecipeModal(supabase, Number(button.dataset.openRecipe), { serves: Number(button.dataset.servings) });
      });
    });

    plannerGrid.querySelectorAll('[data-servings]').forEach((button) => {
      button.addEventListener('click', () => {
        const { day, slot, id } = button.dataset;
        const recipeId = Number(id);
        const entry = findEntry(day, slot, recipeId);
        if (!entry) return;
        const next = button.dataset.servings === 'minus' ? entry.servings - 1 : entry.servings + 1;
        if (next < 1) return;
        state.plan = updateServings(state.plan, day, slot, recipeId, next);
        persistPlan(state.plan);
        renderPlannerBoard();
      });
    });

    plannerGrid.querySelectorAll('[data-shuffle-day]').forEach((button) => {
      button.addEventListener('click', () => {
        const day = button.dataset.shuffleDay;
        const slot = button.dataset.shuffleSlot;
        const recipeId = Number(button.dataset.shuffleId);
        const entry = findEntry(day, slot, recipeId);
        if (!entry) return;
        const replacement = shuffleEntry({
          plan: state.plan.days, day, slot, recipeId, servings: entry.servings,
          recipes: state.candidates, prefs: state.prefs, household: state.household, weekOf: state.plan.weekOf,
        });
        if (!replacement) {
          showSnackbar('No other recipe fits this slot right now.', 'error');
          return;
        }
        state.prefs = applyPrefEvent(state.prefs, recipeId, 'removed', state.plan.weekOf);
        persistPrefs(state.prefs);
        state.plan = replaceEntry(state.plan, day, slot, recipeId, replacement);
        persistPlan(state.plan);
        ensureResolvedForCurrentPlan().then(() => { renderWeekHeader(); renderPlannerBoard(); });
      });
    });

    plannerGrid.querySelectorAll('[data-keep-day]').forEach((button) => {
      button.addEventListener('click', () => {
        const day = button.dataset.keepDay;
        const slot = button.dataset.keepSlot;
        const recipeId = Number(button.dataset.keepId);
        state.plan = keepEntry(state.plan, day, slot, recipeId);
        persistPlan(state.plan);
        renderPlannerBoard();
        showSnackbar('Kept — auto-fill will leave this alone.', 'success');
      });
    });

    plannerGrid.querySelectorAll('[data-remove-day]').forEach((button) => {
      button.addEventListener('click', () => {
        const day = button.dataset.removeDay;
        const slot = button.dataset.removeSlot;
        const recipeId = Number(button.dataset.removeId);
        const entry = findEntry(day, slot, recipeId);
        if (entry?.source === 'auto') {
          state.prefs = applyPrefEvent(state.prefs, recipeId, 'removed', state.plan.weekOf);
          persistPrefs(state.prefs);
        }
        state.plan = removeEntry(state.plan, day, slot, recipeId);
        persistPlan(state.plan);
        renderWeekHeader();
        renderPlannerBoard();
      });
    });
  }

  function renderPlannerRecipes() {
    selectedRecipeSummary.textContent = state.selectedRecipe ? `Selected: ${state.selectedRecipe.name}` : 'No recipe selected';
    selectedRecipeSummary.classList.toggle('has-selection', Boolean(state.selectedRecipe));

    if (!state.recipes.length) {
      plannerList.innerHTML = '<div class="empty-state">No matching recipes.</div>';
      browseShowMore.hidden = true;
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

    browseShowMore.hidden = state.recipes.length >= state.browseTotalCount;
  }

  function renderPlannerError() {
    plannerList.innerHTML = `
      <div class="empty-state">
        <p>Couldn't load recipes. Check your connection.</p>
        <button type="button" class="primary-button" id="plannerRetry">Retry</button>
      </div>
    `;
    browseShowMore.hidden = true;
    document.getElementById('plannerRetry')?.addEventListener('click', () => search(plannerSearch.value));
  }

  // BUG-6/8.5: the same searchRecipes() the recipes page uses, server-side, so a match beyond
  // one page is still found. `append` powers the "Show more" button (task 11.3).
  async function search(term, { append = false } = {}) {
    state.browseTerm = term;
    if (!append) {
      plannerList.innerHTML = Array.from({ length: 6 }).map(() => '<div class="skeleton browser-item-skeleton"></div>').join('');
      state.browsePage = 1;
    }
    const result = await searchRecipes(supabase, { term }, { page: state.browsePage, pageSize: 12 });
    if (!result.ok) {
      renderPlannerError();
      return;
    }
    const normalized = result.data.map(normalizeRecipe);
    state.recipes = append ? [...state.recipes, ...normalized] : normalized;
    state.browseTotalCount = result.totalCount;
    renderPlannerRecipes();
  }

  const debouncedSearch = debounce(() => search(plannerSearch.value.trim()), 300);
  plannerSearch.addEventListener('input', debouncedSearch);
  browseShowMore.addEventListener('click', () => {
    state.browsePage += 1;
    search(state.browseTerm, { append: true });
  });

  // ---------- Picker dialog (task 11.3: "+" with nothing selected) ----------
  const pickerList = document.getElementById('pickerList');
  const pickerShowAll = document.getElementById('pickerShowAll');
  const pickerSuggestNew = document.getElementById('pickerSuggestNew');
  const plannerPickerTitle = document.getElementById('plannerPickerTitle');

  function openPicker(day, slot) {
    state.pickerContext = { day, slot };
    plannerPickerTitle.textContent = `Add to ${slot}, ${day}`;
    pickerShowAll.checked = false;
    loadPickerResults();
    pickerDialog.open();
  }

  async function loadPickerResults() {
    const { day, slot } = state.pickerContext;
    pickerList.innerHTML = '<div class="skeleton browser-item-skeleton"></div>';
    const filters = pickerShowAll.checked ? {} : { mealTypes: [slot] };
    const result = await searchRecipes(supabase, filters, { page: 1, pageSize: 20 });
    if (!result.ok) {
      pickerList.innerHTML = '<div class="empty-state">Couldn\'t load recipes.</div>';
      return;
    }
    const alreadyPlannedIds = new Set((state.plan.days[day] || []).filter((e) => e.slot === slot).map((e) => e.recipeId));
    pickerList.innerHTML = result.data.length
      ? result.data.map((recipe) => `
        <div class="picker-row">
          <div><strong>${escapeHtml(recipe.name)}</strong> <small>${escapeHtml(recipe.cuisine || 'General')}</small></div>
          <button type="button" class="small-button" data-picker-add="${recipe.id}" ${alreadyPlannedIds.has(recipe.id) ? 'disabled' : ''}>
            ${alreadyPlannedIds.has(recipe.id) ? 'Already planned' : 'Add'}
          </button>
        </div>
      `).join('')
      : '<div class="empty-state">No matching recipes.</div>';

    pickerList.querySelectorAll('[data-picker-add]').forEach((button) => {
      button.addEventListener('click', () => {
        addRecipeToSlot(day, slot, Number(button.dataset.pickerAdd), undefined, 'manual');
        pickerDialog.close();
      });
    });
  }

  pickerShowAll.addEventListener('change', loadPickerResults);
  pickerSuggestNew.addEventListener('click', () => {
    const { day, slot } = state.pickerContext;
    storePendingPlannerSlot({ day, slot });
    pickerDialog.close();
    askDialog.open({ initialPrompt: SLOT_PROMPTS[slot] || SLOT_PROMPTS.Dinner, mealType: MEAL_TYPES.includes(slot) ? slot : undefined });
  });
  document.getElementById('closePlannerPicker')?.addEventListener('click', () => pickerDialog.close());

  // ---------- Auto-fill (task 11.4 / Appendix K.3) ----------
  autoFillWeek.addEventListener('click', async () => {
    const result = planWeek({ recipes: state.candidates, plan: state.plan.days, prefs: state.prefs, household: state.household, weekOf: state.plan.weekOf });
    state.plan = { ...state.plan, days: result.plan };
    persistPlan(state.plan);
    await ensureResolvedForCurrentPlan();
    renderWeekHeader();
    renderPlannerBoard();

    if (result.needs.length) {
      const shortfall = result.needs[0];
      showSnackbar(`You need ${shortfall.count} more ${shortfall.slot.toLowerCase()} recipe${shortfall.count === 1 ? '' : 's'}. Ask for some?`, 'success', {
        label: 'Ask',
        duration: 10000,
        onClick: () => {
          const buildPrompt = NEEDS_PROMPTS[shortfall.slot];
          askDialog.open({ initialPrompt: buildPrompt ? buildPrompt(shortfall.count) : SLOT_PROMPTS.Dinner, mealType: MEAL_TYPES.includes(shortfall.slot) ? shortfall.slot : undefined });
        },
      });
    } else if (result.added.length) {
      const pct = Math.round(result.proteinSmartShare * 100);
      // L.4's celebration toast: a gentle nod when the week clears the 60% protein-smart target.
      showSnackbar(
        result.proteinSmartShare >= 0.6 ? `🎉 Week auto-filled — ${pct}% protein-smart!` : `Week auto-filled — ${pct}% protein-smart.`,
        'success',
      );
    } else {
      showSnackbar('Nothing to fill — every enabled slot already has a plan.', 'success');
    }
  });

  // ---------- Week review (task 11.5) ----------
  dismissWeekReviewButton.addEventListener('click', () => {
    state.prefs = dismissWeekReview(state.prefs, state.weekReview.weekOf);
    persistPrefs(state.prefs);
    state.weekReview = null;
    weekReviewCard.hidden = true;
  });

  // ---------- Reset / Export / Import (task 11.8) ----------
  resetWeekButton.addEventListener('click', () => resetDialog.open());
  document.getElementById('cancelResetWeek')?.addEventListener('click', () => resetDialog.close());
  document.getElementById('confirmResetWeek')?.addEventListener('click', () => {
    state.plan = resetPlan();
    persistPlan(state.plan);
    resetDialog.close();
    renderAll();
    showSnackbar('Week reset.', 'success');
  });

  exportPlanButton.addEventListener('click', () => {
    const data = exportPlanData(state.plan, state.prefs);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `recipe-plan-${state.plan.weekOf}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  });

  importPlanButton.addEventListener('click', () => importPlanInput.click());
  importPlanInput.addEventListener('change', () => {
    const file = importPlanInput.files[0];
    importPlanInput.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        pendingImport = parseImportedPlanData(reader.result);
        importDialog.open();
      } catch (err) {
        showSnackbar(err.message || 'This file is not a recognized recipe planner export.', 'error');
      }
    };
    reader.readAsText(file);
  });
  document.getElementById('cancelImportPlan')?.addEventListener('click', () => { pendingImport = null; importDialog.close(); });
  document.getElementById('confirmImportPlan')?.addEventListener('click', async () => {
    if (!pendingImport) return;
    state.plan = pendingImport.plan;
    state.prefs = pendingImport.prefs;
    state.weekReview = null;
    persistPlan(state.plan);
    persistPrefs(state.prefs);
    pendingImport = null;
    importDialog.close();
    await ensureResolvedForCurrentPlan();
    renderAll();
    renderAutoFillSettings();
    showSnackbar('Plan imported.', 'success');
  });

  renderAll();
  renderAutoFillSettings();
  mountTip(document.getElementById('autoFillTip'), 'autoFill');
  await search('');
}
