import { escapeHtml, showSnackbar } from '../lib/dom.js';
import { supabase } from '../lib/supabase-client.js';
import { fetchRecipesForShopping, fetchIngredientsForRecipes } from '../lib/queries.js';
import { getReadyAccount } from '../components/account.js';
import { getHousehold } from '../lib/household.js';
import { DAYS, loadPlanState, getWeekDays, mondayOf } from '../lib/planner-store.js';
import { fetchRemotePlan } from '../lib/planner-remote.js';
import { addDaysIso, parseLocalDate } from '../shared/plan-summary.js';
import { buildShoppingList, shoppingListText } from '../shared/shopping-list.js';
import {
  emptyState, loadLocalState, saveLocalState, fetchRemoteState, createShoppingSync,
  toggleChecked, addManualItem, removeManualItem, clearChecks,
} from '../lib/shopping-store.js';

// M2: the planner's payoff. The list itself is always derived — plan → recipes → ingredient rows —
// so it can never drift from the plan; only the ticks and hand-added items are stored.

const state = {
  weekOf: mondayOf(),
  store: null,
  list: { aisles: [], pantry: [], totalItems: 0 },
  shopping: emptyState(),
  sync: null,
  userId: null,
  household: null,
};

function formatWeekLabel(weekOf) {
  const start = parseLocalDate(weekOf);
  const end = parseLocalDate(addDaysIso(weekOf, 6));
  const fmt = (date, withMonth) => date.toLocaleDateString('en-GB', { day: 'numeric', ...(withMonth ? { month: 'short' } : {}) });
  const sameMonth = start.getMonth() === end.getMonth();
  return `${fmt(start, !sameMonth)}–${fmt(end, true)}`;
}

function entriesForWeek() {
  const days = getWeekDays(state.store, state.weekOf);
  return DAYS.flatMap((day) => days[day] || []);
}

function saveShopping() {
  saveLocalState(state.weekOf, state.shopping);
  state.sync?.queue(state.shopping);
}

// The checkbox sits next to its label rather than inside it: a checkbox nested in its own label
// can toggle twice from one tap in some browsers, which showed up as ticks that wouldn't stick.
function domId(key) {
  return `shop-${key.replace(/[^a-zA-Z0-9]+/g, '-')}`;
}

function checkboxRow(key, label, extras = '', trailing = '') {
  const checked = Boolean(state.shopping.checked[key]);
  const id = domId(key);
  return `
    <li class="shopping-item${checked ? ' is-checked' : ''}">
      <input type="checkbox" id="${id}" data-item-key="${escapeHtml(key)}"${checked ? ' checked' : ''} />
      <label for="${id}">
        <span class="shopping-item-name">${label}</span>
        ${extras}
      </label>
      ${trailing}
    </li>`;
}

function itemRow(item) {
  return checkboxRow(
    item.key,
    escapeHtml(item.name),
    item.amount ? `<span class="shopping-item-amount">${escapeHtml(item.amount)}</span>` : '',
    item.recipes.length ? `<span class="shopping-item-for">${escapeHtml(item.recipes.join(', '))}</span>` : '',
  );
}

function manualRow(item) {
  return checkboxRow(
    item.key,
    escapeHtml(item.text),
    '',
    `<button type="button" class="icon-button delete-button" data-remove-manual="${escapeHtml(item.key)}" data-tooltip="Remove" aria-label="Remove ${escapeHtml(item.text)}">🗑</button>`,
  );
}

/** "3 of 19 ticked off" — recomputed on every tick, without re-rendering the list itself. */
function renderSummary() {
  const buyable = [...state.list.aisles.flatMap((aisle) => aisle.items), ...state.shopping.manual];
  const ticked = buyable.filter((item) => state.shopping.checked[item.key]).length;
  const pantryCount = state.list.pantry.length;
  const summary = document.getElementById('shoppingSummary');
  summary.textContent = buyable.length
    ? `${ticked} of ${buyable.length} ticked off${pantryCount ? ` · ${pantryCount} to check at home` : ''}`
    : `${pantryCount} things to check you have`;
}

function render() {
  const container = document.getElementById('shoppingList');
  const summary = document.getElementById('shoppingSummary');
  document.getElementById('weekLabel').textContent = `Week of ${formatWeekLabel(state.weekOf)}`;

  const { aisles, pantry } = state.list;
  const manual = state.shopping.manual;
  const buyable = [...aisles.flatMap((aisle) => aisle.items), ...manual];

  if (buyable.length === 0 && pantry.length === 0) {
    summary.textContent = '';
    container.innerHTML = `
      <div class="empty-state">
        <h3>Nothing planned for this week yet</h3>
        <p>Plan some meals and they'll turn into a shopping list here.</p>
        <a class="primary-button" href="planner.html">Open the planner</a>
      </div>`;
    return;
  }

  renderSummary();

  const section = (label, itemsHtml, extraClass = '') => `
    <section class="panel shopping-aisle${extraClass}">
      <h2>${escapeHtml(label)}</h2>
      <ul class="shopping-items">${itemsHtml}</ul>
    </section>`;

  container.innerHTML = [
    ...aisles.map((aisle) => section(aisle.label, aisle.items.map(itemRow).join(''))),
    manual.length ? section('Also needed', manual.map(manualRow).join('')) : '',
    pantry.length
      ? `
        <section class="panel shopping-aisle shopping-pantry">
          <h2>Check you have these</h2>
          <p class="hint">Store-cupboard things the week's recipes need — no need to buy them if you already have them.</p>
          <ul class="shopping-items">${pantry.map(itemRow).join('')}</ul>
        </section>`
      : '',
  ].join('');

  // Ticking updates just that row: re-rendering the whole list under someone's finger in a shop
  // would lose their place, and the rest of the list hasn't changed.
  container.querySelectorAll('[data-item-key]').forEach((input) => {
    input.addEventListener('change', () => {
      state.shopping = toggleChecked(state.shopping, input.dataset.itemKey);
      input.closest('.shopping-item')?.classList.toggle('is-checked', input.checked);
      renderSummary();
      saveShopping();
    });
  });
  container.querySelectorAll('[data-remove-manual]').forEach((button) => {
    button.addEventListener('click', () => {
      state.shopping = removeManualItem(state.shopping, button.dataset.removeManual);
      saveShopping();
      render();
    });
  });
}

async function loadWeek() {
  const status = document.getElementById('shoppingStatus');
  status.textContent = 'Building your list…';

  const entries = entriesForWeek();
  const ids = entries.map((entry) => entry.recipeId);
  const [recipesResult, ingredientsResult] = await Promise.all([
    fetchRecipesForShopping(supabase, ids),
    fetchIngredientsForRecipes(supabase, ids),
  ]);
  const recipesById = Object.fromEntries(recipesResult.data.map((recipe) => [recipe.id, recipe]));
  state.list = buildShoppingList({ entries, recipesById, ingredientRows: ingredientsResult.data });

  // Ticks belong to the week, so they follow the week being viewed.
  if (state.household) {
    const remote = await fetchRemoteState(supabase, state.household, state.weekOf);
    state.shopping = remote.ok ? remote.state : loadLocalState(state.weekOf);
    state.sync = createShoppingSync({
      client: supabase,
      householdId: state.household,
      userId: state.userId,
      weekOf: state.weekOf,
      onError: () => showSnackbar("Couldn't save to your household's list. It's still saved in this browser.", 'error'),
    });
  } else {
    state.shopping = loadLocalState(state.weekOf);
    state.sync = null;
  }

  status.textContent = '';
  render();
}

function setWeek(weekOf) {
  state.weekOf = weekOf;
  const url = `${window.location.pathname}?week=${weekOf}`;
  window.history.replaceState(null, '', url);
  loadWeek();
}

export async function initShoppingPage() {
  const container = document.getElementById('shoppingList');
  if (!container) return;

  const params = new URLSearchParams(window.location.search);
  const requested = params.get('week');
  state.weekOf = /^\d{4}-\d{2}-\d{2}$/.test(requested || '') ? mondayOf(parseLocalDate(requested)) : mondayOf();

  const householdProfile = await getHousehold().catch(() => null);
  const local = loadPlanState({ defaultServings: householdProfile?.default_servings || 4 });
  state.store = local.store;

  const account = await getReadyAccount().catch(() => null);
  if (account?.household) {
    state.household = account.household.id;
    state.userId = account.session.user.id;
    const remote = await fetchRemotePlan(supabase, account.household.id);
    if (remote.ok && !remote.isEmpty) state.store = remote.store;
  }

  document.getElementById('prevWeek').addEventListener('click', () => setWeek(addDaysIso(state.weekOf, -7)));
  document.getElementById('nextWeek').addEventListener('click', () => setWeek(addDaysIso(state.weekOf, 7)));
  document.getElementById('thisWeek').addEventListener('click', () => setWeek(mondayOf()));

  document.getElementById('addItemForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = document.getElementById('addItemInput');
    const next = addManualItem(state.shopping, input.value, state.userId);
    if (next === state.shopping) return;
    state.shopping = next;
    input.value = '';
    saveShopping();
    render();
  });

  document.getElementById('clearTicks').addEventListener('click', () => {
    state.shopping = clearChecks(state.shopping);
    saveShopping();
    render();
    showSnackbar('Ticks cleared.', 'success');
  });

  const listText = () => shoppingListText(state.list, {
    weekLabel: `week of ${formatWeekLabel(state.weekOf)}`,
    manualItems: state.shopping.manual,
    checked: state.shopping.checked,
  });

  document.getElementById('copyList').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(listText());
      showSnackbar('Shopping list copied.', 'success');
    } catch {
      showSnackbar("Couldn't copy the list. Try Share or Print instead.", 'error');
    }
  });

  const shareButton = document.getElementById('shareList');
  if (typeof navigator.share === 'function') {
    shareButton.hidden = false;
    shareButton.addEventListener('click', () => {
      navigator.share({ title: 'Shopping list', text: listText() }).catch(() => {});
    });
  }

  document.getElementById('printList').addEventListener('click', () => window.print());

  await loadWeek();
}
