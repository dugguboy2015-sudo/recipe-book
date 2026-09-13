import { escapeHtml, showSnackbar } from '../lib/dom.js';
import { supabase } from '../lib/supabase-client.js';
import { searchRecipes, fetchPlannerCandidates, fetchPlannerRecipesByIds } from '../lib/queries.js';
import { mountRecipeModal, openRecipeModal } from '../components/recipe-modal.js';
import { monogramSvg } from '../components/monogram.js';
import { wireDialog } from '../components/dialog.js';
import { getHousehold } from '../lib/household.js';
import { nearestWidthClass } from '../shared/nutrition-ri.js';
import { planWeek, shuffleEntry, WEEKDAYS } from '../shared/planner-engine.js';
import {
  DAYS, SLOTS, loadPlanState, persistStore, persistPrefs, addEntry, removeEntry, keepEntry,
  replaceEntry, updateServings, applyPrefEvent, dismissWeekReview, exportPlanData,
  parseImportedPlanData, resetWeekDays, getWeekDays, setWeekDays, mondayOf,
} from '../lib/planner-store.js';
import { todayIso, addDaysIso, dayNameForIso, entriesOnDate, parseLocalDate, computeProteinSmartShare } from '../shared/plan-summary.js';
import { mountAskDialog, storePendingPlannerSlot } from '../components/ask-dialog.js';
import { mountTip } from '../components/tips.js';
import { MEAL_TYPES } from '../shared/html.js';

const VIEW_MODE_KEY = 'recipeBook.plannerViewMode';
const VIEW_MODES = ['day', 'week', 'month'];

function loadViewMode() {
  try {
    const value = localStorage.getItem(VIEW_MODE_KEY);
    return VIEW_MODES.includes(value) ? value : 'week';
  } catch {
    return 'week';
  }
}
function persistViewMode(mode) {
  try { localStorage.setItem(VIEW_MODE_KEY, mode); } catch { /* best-effort */ }
}

function isoOfDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Every date shown in a month's calendar grid (leading/trailing days from adjacent months included, to fill complete Mon-Sun rows). */
function monthGridDates(anchorIso) {
  const anchor = parseLocalDate(anchorIso);
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7; // Monday = 0 .. Sunday = 6
  const totalDaysInMonth = new Date(year, month + 1, 0).getDate();
  const rows = Math.ceil((firstWeekday + totalDaysInMonth) / 7);
  const gridStart = new Date(year, month, 1 - firstWeekday);
  return Array.from({ length: rows * 7 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });
}

function pluralize(n, singular, plural) {
  return n === 1 ? singular : plural;
}

const SLOT_PROMPTS = {
  Breakfast: 'a tasty, protein-forward vegetarian breakfast',
  'Packed Lunch': 'a protein-rich vegetarian packed lunch, good cold',
  Lunch: 'a satisfying vegetarian lunch',
  Dinner: 'a flavourful vegetarian dinner',
  Snacks: 'a healthy vegetarian snack',
  Dessert: 'a lighter vegetarian dessert',
};

const NEEDS_PROMPTS = {
  Breakfast: (n) => `${n} tasty, protein-forward vegetarian ${pluralize(n, 'breakfast', 'breakfasts')}`,
  'Packed Lunch': (n) => `${n} protein-rich vegetarian ${pluralize(n, 'packed lunch', 'packed lunches')}, good cold`,
  Lunch: (n) => `${n} satisfying vegetarian ${pluralize(n, 'lunch', 'lunches')}`,
  Dinner: (n) => `${n} flavourful vegetarian ${pluralize(n, 'dinner', 'dinners')}`,
  Snacks: (n) => `${n} healthy vegetarian ${pluralize(n, 'snack', 'snacks')}`,
  Dessert: (n) => `${n} lighter vegetarian ${pluralize(n, 'dessert', 'desserts')}`,
};

const state = {
  store: null,
  prefs: null,
  weekReview: null,
  storageAvailable: true,
  candidates: [], // the bounded planner_candidates pool, for planWeek/shuffleEntry
  resolvedById: new Map(), // planned-recipe display data, resolved by id
  household: null,
  pickerContext: null, // { weekOf, day, slot } while the add-recipe picker dialog is open
  viewMode: 'week', // 'day' | 'week' | 'month'
  selectedDate: todayIso(), // the navigation anchor (an exact ISO date, not just a weekday name)
};

function selectedWeekOf() {
  return mondayOf(parseLocalDate(state.selectedDate));
}

function isoOfDayInWeek(weekOf, dayName) {
  return addDaysIso(weekOf, DAYS.indexOf(dayName));
}

function mutateWeek(weekOf, days) {
  state.store = setWeekDays(state.store, weekOf, days);
  persistStore(state.store);
}

function idsForWeek(weekOf) {
  const days = getWeekDays(state.store, weekOf);
  return DAYS.flatMap((day) => (days[day] || []).map((e) => e.recipeId));
}

async function ensureResolvedIds(ids) {
  const missing = [...new Set(ids)].filter((id) => id != null && !state.resolvedById.has(id));
  if (missing.length === 0) return;
  const result = await fetchPlannerRecipesByIds(supabase, missing);
  for (const row of result.data) state.resolvedById.set(row.id, row);
}

async function ensureResolvedForView() {
  let ids;
  if (state.viewMode === 'month') {
    const weeksNeeded = new Set(monthGridDates(state.selectedDate).map((d) => mondayOf(d)));
    ids = [...weeksNeeded].flatMap((weekOf) => idsForWeek(weekOf));
  } else {
    ids = idsForWeek(selectedWeekOf());
  }
  if (state.weekReview) ids = [...ids, ...state.weekReview.entries.map((e) => e.recipeId)];
  await ensureResolvedIds(ids);
}

export async function initPlannerPage() {
  const plannerHeading = document.getElementById('plannerHeading');
  const navPrev = document.getElementById('navPrev');
  const navNext = document.getElementById('navNext');
  const navToday = document.getElementById('navToday');
  const navLabel = document.getElementById('navLabel');
  const dayTab = document.getElementById('dayTab');
  const weekTab = document.getElementById('weekTab');
  const monthTab = document.getElementById('monthTab');

  const weekView = document.getElementById('weekView');
  const dayView = document.getElementById('dayView');
  const monthView = document.getElementById('monthView');
  const plannerGrid = document.getElementById('plannerGrid');
  const dayViewSlots = document.getElementById('dayViewSlots');
  const monthCalendar = document.getElementById('monthCalendar');

  const proteinShareBar = document.getElementById('proteinShareBar');
  const proteinShareText = document.getElementById('proteinShareText');
  const tomorrowPackedLunch = document.getElementById('tomorrowPackedLunch');
  const cuisineMix = document.getElementById('cuisineMix');
  const autoFillSettingsGrid = document.getElementById('autoFillSettingsGrid');
  const autoFillWeek = document.getElementById('autoFillWeek');
  const autoFillSettingsButton = document.getElementById('autoFillSettingsButton');
  const plannerStorageWarning = document.getElementById('plannerStorageWarning');

  const weekReviewCard = document.getElementById('weekReviewCard');
  const weekReviewList = document.getElementById('weekReviewList');
  const dismissWeekReviewButton = document.getElementById('dismissWeekReview');

  const exportPlanButton = document.getElementById('exportPlan');
  const importPlanButton = document.getElementById('importPlanButton');
  const importPlanInput = document.getElementById('importPlanInput');
  const resetWeekButton = document.getElementById('resetWeek');
  const resetWeekConfirmCopy = document.getElementById('resetWeekConfirmCopy');

  if (!plannerGrid || !dayViewSlots || !monthCalendar) return;

  mountRecipeModal();
  const askDialog = mountAskDialog();
  const pickerDialog = wireDialog(document.getElementById('plannerPickerDialog'));
  const resetDialog = wireDialog(document.getElementById('resetWeekConfirm'));
  const importDialog = wireDialog(document.getElementById('importPlanConfirm'));
  const autoFillSettingsDialog = wireDialog(document.getElementById('autoFillSettingsDialog'));
  let pendingImport = null;

  state.viewMode = loadViewMode();
  state.household = await getHousehold().catch(() => null);
  const loaded = loadPlanState({ defaultServings: state.household?.default_servings || 4 });
  state.store = loaded.store;
  state.prefs = loaded.prefs;
  state.weekReview = loaded.weekReview;
  state.storageAvailable = loaded.storageAvailable;
  if (plannerStorageWarning) plannerStorageWarning.hidden = state.storageAvailable !== false;

  const candidatesResult = await fetchPlannerCandidates(supabase);
  state.candidates = candidatesResult.data;
  for (const row of state.candidates) state.resolvedById.set(row.id, row);

  function formatHeading() {
    if (state.viewMode === 'day') {
      const label = state.selectedDate === todayIso() ? 'Today' : parseLocalDate(state.selectedDate).toLocaleDateString(undefined, { weekday: 'long' });
      return `${label}'s meals`;
    }
    if (state.viewMode === 'week') {
      return selectedWeekOf() === mondayOf() ? "This week's meals" : "That week's meals";
    }
    return parseLocalDate(state.selectedDate).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }

  function formatNavLabel() {
    if (state.viewMode === 'day') {
      return parseLocalDate(state.selectedDate).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
    }
    if (state.viewMode === 'week') {
      const start = parseLocalDate(selectedWeekOf());
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      return `Week of ${start.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${end.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
    }
    return parseLocalDate(state.selectedDate).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }

  function updateTabsUI() {
    [[dayTab, 'day'], [weekTab, 'week'], [monthTab, 'month']].forEach(([tab, mode]) => {
      tab?.setAttribute('aria-selected', String(mode === state.viewMode));
    });
  }

  function toggleViewContainers() {
    weekView.hidden = state.viewMode !== 'week';
    dayView.hidden = state.viewMode !== 'day';
    monthView.hidden = state.viewMode !== 'month';
    // Month is navigate-and-glance only — editing (auto-fill included) always happens in Day/Week.
    autoFillWeek.hidden = state.viewMode === 'month';
    autoFillSettingsButton.hidden = state.viewMode === 'month';
  }

  function renderHeaderStats() {
    const weekOf = selectedWeekOf();
    const days = getWeekDays(state.store, weekOf);
    const share = computeProteinSmartShare(days, state.resolvedById);
    if (share === null) {
      proteinShareText.textContent = 'Protein-smart: no meals planned yet';
      proteinShareBar.className = 'progress-bar-fill w-pct-0';
    } else {
      const pct = Math.round(share * 100);
      proteinShareText.textContent = `Protein-smart: ${pct}% of this week's meals`;
      proteinShareBar.className = `progress-bar-fill ${nearestWidthClass(pct)}`;
    }

    // Always real tomorrow (not "the day after whatever's selected") — correctly resolves across
    // a week boundary now that any week is independently addressable.
    const tomorrowIso = addDaysIso(todayIso(), 1);
    const packedEntry = entriesOnDate(state.store, tomorrowIso).find((e) => e.slot === 'Packed Lunch');
    const packedRecipe = packedEntry && state.resolvedById.get(packedEntry.recipeId);
    tomorrowPackedLunch.innerHTML = packedRecipe
      ? `Tomorrow's packed lunch: <strong>${escapeHtml(packedRecipe.name)}</strong>`
      : "Tomorrow's packed lunch: <strong>not planned yet</strong>";

    const cuisineCounts = new Map();
    for (const day of DAYS) {
      for (const entry of days[day] || []) {
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
        if (action === 'loved') state.prefs = applyPrefEvent(state.prefs, entry.recipeId, 'loved', state.weekReview.weekOf);
        else if (action === 'notAgain') state.prefs = applyPrefEvent(state.prefs, entry.recipeId, 'notAgain', state.weekReview.weekOf);
        persistPrefs(state.prefs);
        state.weekReview.entries.splice(index, 1);
        renderWeekReview();
      });
    });
  }

  function renderSlotCard(weekOf, day, entry) {
    const recipe = state.resolvedById.get(entry.recipeId);
    if (!recipe) {
      return `
        <div class="slot-card">
          <div class="slot-unavailable">Recipe no longer available</div>
          <button type="button" class="remove-slot" data-remove-day="${day}" data-remove-slot="${entry.slot}" data-remove-id="${entry.recipeId}" data-week-of="${weekOf}">Remove</button>
        </div>
      `;
    }
    const reasonsMarkup = entry.source === 'auto' && entry.reasons?.length
      ? `<div class="slot-reasons">${entry.reasons.map((reason) => `<span class="chip">${escapeHtml(reason)}</span>`).join('')}</div>`
      : '';
    const autoActions = entry.source === 'auto'
      ? `
        <div class="slot-card-actions">
          <button type="button" class="small-button" data-shuffle-day="${day}" data-shuffle-slot="${entry.slot}" data-shuffle-id="${entry.recipeId}" data-week-of="${weekOf}">Shuffle</button>
          <button type="button" class="small-button" data-keep-day="${day}" data-keep-slot="${entry.slot}" data-keep-id="${entry.recipeId}" data-week-of="${weekOf}">Keep</button>
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
          <button type="button" data-servings="minus" data-day="${day}" data-slot="${entry.slot}" data-id="${entry.recipeId}" data-week-of="${weekOf}" aria-label="Fewer servings">−</button>
          <output>${entry.servings}</output>
          <button type="button" data-servings="plus" data-day="${day}" data-slot="${entry.slot}" data-id="${entry.recipeId}" data-week-of="${weekOf}" aria-label="More servings">+</button>
        </div>
        ${autoActions}
        <button type="button" class="remove-slot" data-remove-day="${day}" data-remove-slot="${entry.slot}" data-remove-id="${entry.recipeId}" data-week-of="${weekOf}">Remove</button>
      </div>
    `;
  }

  function slotsForDay(day) {
    return SLOTS.filter((slot) => slot !== 'Packed Lunch' || WEEKDAYS.includes(day));
  }

  function renderMealSlot(weekOf, day, slot, days) {
    const entries = (days[day] || []).filter((e) => e.slot === slot);
    return `
      <div class="meal-slot ${entries.length ? 'filled' : ''}" data-day="${day}" data-slot="${slot}">
        <div class="meal-slot-header">
          <strong>${slot}</strong>
          <button type="button" class="small-button" data-day-add="${day}" data-slot="${slot}" aria-label="Add recipe to ${slot} on ${day}">+</button>
        </div>
        ${entries.length ? entries.map((entry) => renderSlotCard(weekOf, day, entry)).join('') : '<div class="slot-empty">No recipe planned</div>'}
      </div>
    `;
  }

  function renderWeekView() {
    const weekOf = selectedWeekOf();
    const days = getWeekDays(state.store, weekOf);
    plannerGrid.innerHTML = DAYS.map((day) => {
      const slotsMarkup = slotsForDay(day).map((slot) => renderMealSlot(weekOf, day, slot, days)).join('');
      const isToday = isoOfDayInWeek(weekOf, day) === todayIso();
      return `
        <div class="planner-day" data-day="${day}">
          <h3>${day}${isToday ? ' <span class="today-badge">Today</span>' : ''}</h3>
          <div class="day-slot-group">${slotsMarkup}</div>
        </div>
      `;
    }).join('');
    wirePlannerBoardEvents(plannerGrid);
  }

  function renderDayView() {
    const iso = state.selectedDate;
    const weekOf = mondayOf(parseLocalDate(iso));
    const dayName = dayNameForIso(iso);
    const days = getWeekDays(state.store, weekOf);
    dayViewSlots.innerHTML = slotsForDay(dayName).map((slot) => renderMealSlot(weekOf, dayName, slot, days)).join('');
    wirePlannerBoardEvents(dayViewSlots);
  }

  function renderMonthView() {
    const dates = monthGridDates(state.selectedDate);
    const currentMonth = parseLocalDate(state.selectedDate).getMonth();
    const today = todayIso();
    monthCalendar.innerHTML = `
      <div class="month-grid-header">${DAYS.map((d) => `<div>${d.slice(0, 3)}</div>`).join('')}</div>
      <div class="month-grid-body">
        ${dates.map((d) => {
          const iso = isoOfDate(d);
          const classes = ['month-cell'];
          if (d.getMonth() !== currentMonth) classes.push('outside');
          if (iso === today) classes.push('today');
          const entries = entriesOnDate(state.store, iso);
          const dots = entries.length ? `<div class="month-cell-dots">${entries.map(() => '<span class="month-cell-dot"></span>').join('')}</div>` : '';
          return `
            <button type="button" class="${classes.join(' ')}" data-goto-date="${iso}" aria-label="${d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}">
              <span class="month-cell-date">${d.getDate()}</span>
              ${dots}
            </button>
          `;
        }).join('')}
      </div>
    `;
    monthCalendar.querySelectorAll('[data-goto-date]').forEach((button) => {
      button.addEventListener('click', () => {
        state.selectedDate = button.dataset.gotoDate;
        setViewMode('day');
      });
    });
  }

  function renderView() {
    if (state.viewMode === 'week') renderWeekView();
    else if (state.viewMode === 'day') renderDayView();
    else renderMonthView();
  }

  async function renderAll() {
    updateTabsUI();
    toggleViewContainers();
    plannerHeading.textContent = formatHeading();
    navLabel.textContent = formatNavLabel();
    navToday.textContent = state.viewMode === 'day' ? 'Today' : state.viewMode === 'week' ? 'This week' : 'This month';
    await ensureResolvedForView();
    renderHeaderStats();
    renderWeekReview();
    renderView();
  }

  function setViewMode(mode) {
    state.viewMode = mode;
    persistViewMode(mode);
    renderAll();
  }

  function navigate(direction) {
    if (state.viewMode === 'day') {
      state.selectedDate = addDaysIso(state.selectedDate, direction);
    } else if (state.viewMode === 'week') {
      state.selectedDate = addDaysIso(state.selectedDate, direction * 7);
    } else {
      const d = parseLocalDate(state.selectedDate);
      d.setDate(1); // avoid month-length overflow (e.g. Jan 31 + 1 month skipping to March)
      d.setMonth(d.getMonth() + direction);
      state.selectedDate = isoOfDate(d);
    }
    renderAll();
  }

  dayTab?.addEventListener('click', () => setViewMode('day'));
  weekTab?.addEventListener('click', () => setViewMode('week'));
  monthTab?.addEventListener('click', () => setViewMode('month'));
  navPrev?.addEventListener('click', () => navigate(-1));
  navNext?.addEventListener('click', () => navigate(1));
  navToday?.addEventListener('click', () => { state.selectedDate = todayIso(); renderAll(); });

  function addRecipeToSlot(weekOf, day, slot, recipeId, servings, source) {
    const days = getWeekDays(state.store, weekOf);
    if ((days[day] || []).some((e) => e.slot === slot && e.recipeId === recipeId)) {
      showSnackbar('Already planned.', 'error');
      return;
    }
    mutateWeek(weekOf, addEntry(days, day, slot, recipeId, servings ?? state.household?.default_servings ?? 4, source));
    if (source === 'manual') {
      state.prefs = applyPrefEvent(state.prefs, recipeId, 'manual', weekOf);
      persistPrefs(state.prefs);
    }
    ensureResolvedIds([recipeId]).then(() => { renderHeaderStats(); renderView(); });
  }

  function wirePlannerBoardEvents(container) {
    container.querySelectorAll('[data-day-add]').forEach((button) => {
      button.addEventListener('click', () => {
        const day = button.dataset.dayAdd;
        const slot = button.dataset.slot;
        openPicker(selectedWeekOf(), day, slot);
      });
    });

    container.querySelectorAll('[data-open-recipe]').forEach((button) => {
      button.addEventListener('click', () => {
        openRecipeModal(supabase, Number(button.dataset.openRecipe), { serves: Number(button.dataset.servings) });
      });
    });

    container.querySelectorAll('[data-servings]').forEach((button) => {
      button.addEventListener('click', () => {
        const { day, slot, id, weekOf } = button.dataset;
        const recipeId = Number(id);
        const days = getWeekDays(state.store, weekOf);
        const entry = (days[day] || []).find((e) => e.slot === slot && e.recipeId === recipeId);
        if (!entry) return;
        const next = button.dataset.servings === 'minus' ? entry.servings - 1 : entry.servings + 1;
        if (next < 1) return;
        mutateWeek(weekOf, updateServings(days, day, slot, recipeId, next));
        renderView();
      });
    });

    container.querySelectorAll('[data-shuffle-day]').forEach((button) => {
      button.addEventListener('click', () => {
        const day = button.dataset.shuffleDay;
        const slot = button.dataset.shuffleSlot;
        const recipeId = Number(button.dataset.shuffleId);
        const weekOf = button.dataset.weekOf;
        const days = getWeekDays(state.store, weekOf);
        const entry = (days[day] || []).find((e) => e.slot === slot && e.recipeId === recipeId);
        if (!entry) return;
        const replacement = shuffleEntry({
          plan: days, day, slot, recipeId, servings: entry.servings,
          recipes: state.candidates, prefs: state.prefs, household: state.household, weekOf,
        });
        if (!replacement) {
          showSnackbar('No other recipe fits this slot right now.', 'error');
          return;
        }
        state.prefs = applyPrefEvent(state.prefs, recipeId, 'removed', weekOf);
        persistPrefs(state.prefs);
        mutateWeek(weekOf, replaceEntry(days, day, slot, recipeId, replacement));
        ensureResolvedIds([replacement.recipeId]).then(() => { renderHeaderStats(); renderView(); });
      });
    });

    container.querySelectorAll('[data-keep-day]').forEach((button) => {
      button.addEventListener('click', () => {
        const day = button.dataset.keepDay;
        const slot = button.dataset.keepSlot;
        const recipeId = Number(button.dataset.keepId);
        const weekOf = button.dataset.weekOf;
        mutateWeek(weekOf, keepEntry(getWeekDays(state.store, weekOf), day, slot, recipeId));
        renderView();
        showSnackbar('Kept — auto-fill will leave this alone.', 'success');
      });
    });

    container.querySelectorAll('[data-remove-day]').forEach((button) => {
      button.addEventListener('click', () => {
        const day = button.dataset.removeDay;
        const slot = button.dataset.removeSlot;
        const recipeId = Number(button.dataset.removeId);
        const weekOf = button.dataset.weekOf;
        const days = getWeekDays(state.store, weekOf);
        const entry = (days[day] || []).find((e) => e.slot === slot && e.recipeId === recipeId);
        if (entry?.source === 'auto') {
          state.prefs = applyPrefEvent(state.prefs, recipeId, 'removed', weekOf);
          persistPrefs(state.prefs);
        }
        mutateWeek(weekOf, removeEntry(days, day, slot, recipeId));
        renderHeaderStats();
        renderView();
      });
    });
  }

  // ---------- Picker dialog (the only way to add a recipe to a slot) ----------
  const pickerList = document.getElementById('pickerList');
  const pickerShowAll = document.getElementById('pickerShowAll');
  const pickerSuggestNew = document.getElementById('pickerSuggestNew');
  const plannerPickerTitle = document.getElementById('plannerPickerTitle');

  function openPicker(weekOf, day, slot) {
    state.pickerContext = { weekOf, day, slot };
    plannerPickerTitle.textContent = `Add to ${slot}, ${day}`;
    pickerShowAll.checked = false;
    loadPickerResults();
    pickerDialog.open();
  }

  async function loadPickerResults() {
    const { weekOf, day, slot } = state.pickerContext;
    pickerList.innerHTML = '<div class="skeleton browser-item-skeleton"></div>';
    const filters = pickerShowAll.checked ? {} : { mealTypes: [slot] };
    const result = await searchRecipes(supabase, filters, { page: 1, pageSize: 20 });
    if (!result.ok) {
      pickerList.innerHTML = '<div class="empty-state">Couldn\'t load recipes.</div>';
      return;
    }
    const days = getWeekDays(state.store, weekOf);
    const alreadyPlannedIds = new Set((days[day] || []).filter((e) => e.slot === slot).map((e) => e.recipeId));
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
        addRecipeToSlot(weekOf, day, slot, Number(button.dataset.pickerAdd), undefined, 'manual');
        pickerDialog.close();
      });
    });
  }

  pickerShowAll.addEventListener('change', loadPickerResults);
  pickerSuggestNew.addEventListener('click', () => {
    const { weekOf, day, slot } = state.pickerContext;
    storePendingPlannerSlot({ weekOf, day, slot });
    pickerDialog.close();
    askDialog.open({ initialPrompt: SLOT_PROMPTS[slot] || SLOT_PROMPTS.Dinner, mealType: MEAL_TYPES.includes(slot) ? slot : undefined });
  });
  document.getElementById('closePlannerPicker')?.addEventListener('click', () => pickerDialog.close());

  // ---------- Auto-fill settings dialog (fixes the stretched-action-bar bug: settings used to be
  // an inline <details> sibling of these buttons in a flex row with default align-items:stretch) ----------
  autoFillSettingsButton?.addEventListener('click', () => autoFillSettingsDialog.open());
  document.getElementById('closeAutoFillSettings')?.addEventListener('click', () => autoFillSettingsDialog.close());

  // ---------- Auto-fill (task 11.4 / Appendix K.3) — operates on whichever week is selected ----------
  autoFillWeek.addEventListener('click', async () => {
    const weekOf = selectedWeekOf();
    const days = getWeekDays(state.store, weekOf);
    const result = planWeek({ recipes: state.candidates, plan: days, prefs: state.prefs, household: state.household, weekOf });
    mutateWeek(weekOf, result.plan);
    await ensureResolvedIds(idsForWeek(weekOf));
    renderHeaderStats();
    renderView();

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
  resetWeekButton.addEventListener('click', () => {
    if (resetWeekConfirmCopy) resetWeekConfirmCopy.textContent = `This clears every recipe planned for ${formatNavLabel()}. It can't be undone.`;
    resetDialog.open();
  });
  document.getElementById('cancelResetWeek')?.addEventListener('click', () => resetDialog.close());
  document.getElementById('confirmResetWeek')?.addEventListener('click', () => {
    const weekOf = selectedWeekOf();
    state.store = resetWeekDays(state.store, weekOf);
    persistStore(state.store);
    resetDialog.close();
    renderHeaderStats();
    renderView();
    showSnackbar('Week reset.', 'success');
  });

  exportPlanButton.addEventListener('click', () => {
    const data = exportPlanData(state.store, state.prefs);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `recipe-plan-${todayIso()}.json`;
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
    state.store = pendingImport.store;
    state.prefs = pendingImport.prefs;
    state.weekReview = null;
    persistStore(state.store);
    persistPrefs(state.prefs);
    pendingImport = null;
    importDialog.close();
    await renderAll();
    renderAutoFillSettings();
    showSnackbar('Plan imported.', 'success');
  });

  await renderAll();
  renderAutoFillSettings();
  mountTip(document.getElementById('autoFillTip'), 'autoFill');
}
