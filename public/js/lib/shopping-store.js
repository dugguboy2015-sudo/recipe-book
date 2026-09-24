// M2: what a person did to the shopping list — which items are ticked, and anything they added by
// hand. The list itself is always derived from the plan and the recipes, so only this is stored.
//
// A signed-in household shares one row per week (migration 020), so one person can tick things off
// in the shop while another watches the list shrink at home; signed out it lives in localStorage.

const STORAGE_KEY = 'recipeBook.shopping.v1';
const SAVE_DEBOUNCE_MS = 500;

export function emptyState() {
  return { checked: {}, manual: [] };
}

function normalize(state) {
  return {
    checked: state?.checked && typeof state.checked === 'object' ? { ...state.checked } : {},
    manual: Array.isArray(state?.manual) ? state.manual.filter((item) => item && typeof item.text === 'string') : [],
  };
}

/** Ticks and manual items for every week this browser knows about. */
function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function loadLocalState(weekOf) {
  return normalize(readAll()[weekOf]);
}

export function saveLocalState(weekOf, state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readAll(), [weekOf]: state }));
    return true;
  } catch {
    return false;
  }
}

export async function fetchRemoteState(client, householdId, weekOf) {
  const { data, error } = await client.from('shopping_lists').select('state').eq('household_id', householdId).eq('week_of', weekOf).maybeSingle();
  if (error) {
    console.error(error);
    return { ok: false, state: emptyState() };
  }
  return { ok: true, state: normalize(data?.state) };
}

/**
 * A debounced writer for one household's week — ticking several things in a row sends one write.
 * @param {{ client: object, householdId: string, userId: string, weekOf: string, onError?: () => void }} options
 */
export function createShoppingSync({ client, householdId, userId, weekOf, onError }) {
  let pending = null;
  let timer = null;

  async function flush() {
    clearTimeout(timer);
    timer = null;
    if (!pending) return;
    const state = pending;
    pending = null;
    const { error } = await client.from('shopping_lists')
      .upsert({ household_id: householdId, week_of: weekOf, state, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: 'household_id,week_of' });
    if (error) {
      console.error('Saving the shopping list failed:', error);
      onError?.();
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => { if (pending) flush(); });
  }

  return {
    queue(state) {
      pending = state;
      clearTimeout(timer);
      timer = setTimeout(flush, SAVE_DEBOUNCE_MS);
    },
    flush,
  };
}

/** Toggling and adding are pure so the page never mutates state it is rendering from. */
export function toggleChecked(state, key) {
  const checked = { ...state.checked };
  if (checked[key]) delete checked[key];
  else checked[key] = true;
  return { ...state, checked };
}

export function addManualItem(state, text, addedBy = null) {
  const clean = String(text || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  if (!clean) return state;
  const key = `manual:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return { ...state, manual: [...state.manual, { key, text: clean, ...(addedBy ? { addedBy } : {}) }] };
}

export function removeManualItem(state, key) {
  const checked = { ...state.checked };
  delete checked[key];
  return { ...state, checked, manual: state.manual.filter((item) => item.key !== key) };
}

/** Clearing ticks at the end of a shop leaves the manual items alone. */
export function clearChecks(state) {
  return { ...state, checked: {} };
}
