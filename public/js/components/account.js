import { escapeHtml } from '../shared/html.js';
import { showSnackbar } from '../lib/dom.js';
import { getSession, onAuthChange, fetchMyHousehold } from '../lib/auth.js';
import { captureInviteFromUrl, getPendingInvite } from '../lib/pending-invite.js';

// The header account control (M1b). Kept small because every page loads it; the dialogs behind it
// (account-dialogs.js) load on first use, the same pattern as the ask dialog.

const ONBOARDING_SHOWN_KEY = 'recipeBook.onboardingShown';
const FLASH_KEY = 'recipeBook.flash';
const state = { session: null, household: null, ready: false };
const listeners = new Set();
let slot = null;

/** A snapshot of the current account: `{ session, household, ready }`. */
export function getAccountState() {
  return { ...state };
}

/** Calls back now and on every sign-in or household change. Returns an unsubscribe function. */
export function subscribeAccount(listener) {
  listeners.add(listener);
  listener(getAccountState());
  return () => listeners.delete(listener);
}

function render() {
  if (!slot) return;
  if (!state.ready) {
    slot.innerHTML = '';
    return;
  }
  if (!state.session) {
    slot.innerHTML = `
      <button type="button" class="ghost-button account-sign-in" data-account-open aria-label="Sign in">
        <span aria-hidden="true">👤</span><span class="account-label">Sign in</span>
      </button>`;
  } else {
    const name = state.household?.displayName || state.session.user.email || 'You';
    const initial = (name.trim()[0] || '?').toUpperCase();
    const tip = state.household ? state.household.name : 'Finish setting up';
    slot.innerHTML = `
      <button type="button" class="icon-button account-avatar${state.household ? '' : ' needs-setup'}" data-account-open
        data-tooltip="${escapeHtml(tip)}" aria-label="Your account: ${escapeHtml(name)}">${escapeHtml(initial)}</button>`;
  }
  slot.querySelector('[data-account-open]')?.addEventListener('click', () => openAccount());
}

async function openAccount(view, reason) {
  const { openAccountDialog } = await import('./account-dialogs.js');
  openAccountDialog({ state: getAccountState(), view, refresh, reason });
}

/**
 * Opens whichever step stands between this visitor and a member-only action — sign in, or set up
 * a household — explaining why. `reason` completes a sentence, e.g. "to add recipes".
 */
export async function promptAccount(reason) {
  const current = state.ready ? state : await refresh();
  if (current.session && current.household) return;
  openAccount(current.session ? 'create' : 'sign-in', reason);
}

/** True when the visitor can act as a member right now; otherwise opens the prompt and returns false. */
export async function ensureMember(reason) {
  const current = state.ready ? state : await refresh();
  if (current.session && current.household) return true;
  promptAccount(reason);
  return false;
}

/** A snapshot of the account once it has loaded (loading it if nothing has yet). */
export async function getReadyAccount() {
  return state.ready ? getAccountState() : refresh();
}

/**
 * Re-reads the session and household, re-renders, and notifies subscribers.
 *
 * When the household changes after the page has loaded — signing in or out, creating or joining
 * one — the page reloads: its settings, diet filter and plan all belong to a household, and a
 * fresh load is the one way every page picks that up consistently. `flash` is a snackbar
 * message shown after the reload.
 */
export async function refresh({ flash } = {}) {
  const session = await getSession();
  const household = session ? await fetchMyHousehold(session) : null;
  const wasReady = state.ready;
  const previousHouseholdId = state.household?.id ?? null;
  Object.assign(state, { session, household, ready: true });
  if (wasReady && (household?.id ?? null) !== previousHouseholdId) {
    if (flash) setFlash(flash);
    window.location.reload();
    return getAccountState();
  }
  render();
  for (const listener of listeners) listener(getAccountState());
  return getAccountState();
}

function accountDialogIsOpen() {
  return Boolean(document.getElementById('accountDialog')?.open);
}

// An invite always takes priority; otherwise a signed-in user with no household sees onboarding
// once per browser session, not on every page they visit.
function maybeAutoOpen() {
  if (accountDialogIsOpen()) return;
  if (getPendingInvite() && !state.household) {
    openAccount(state.session ? 'join' : 'sign-in');
    return;
  }
  if (state.session && !state.household) {
    let shown = false;
    try { shown = sessionStorage.getItem(ONBOARDING_SHOWN_KEY) === '1'; } catch { /* treat as not shown */ }
    if (shown) return;
    try { sessionStorage.setItem(ONBOARDING_SHOWN_KEY, '1'); } catch { /* best-effort */ }
    openAccount('onboarding');
  }
}

/** A snackbar message to show after the next page load (see refresh()). */
export function setFlash(message) {
  try { sessionStorage.setItem(FLASH_KEY, message); } catch { /* the message is optional */ }
}

function showFlash() {
  let message = null;
  try {
    message = sessionStorage.getItem(FLASH_KEY);
    sessionStorage.removeItem(FLASH_KEY);
  } catch { /* nothing to show */ }
  if (message) showSnackbar(message, 'success');
}

export async function mountAccount(slotElement) {
  if (!slotElement) return;
  slot = slotElement;
  showFlash();
  captureInviteFromUrl();
  await refresh();
  // A sign-in link leaves a bare "#" behind once supabase-js has read the tokens out of it.
  if (window.location.href.endsWith('#')) {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  }
  maybeAutoOpen();
  onAuthChange(async (_session, event) => {
    if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') return;
    const next = await refresh(event === 'SIGNED_IN' ? { flash: 'Signed in.' } : {});
    if (event !== 'SIGNED_IN') return;
    if (accountDialogIsOpen()) {
      const { handleSignedIn } = await import('./account-dialogs.js');
      await handleSignedIn(next);
    } else {
      maybeAutoOpen();
    }
  });
}
