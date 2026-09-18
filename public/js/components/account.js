import { escapeHtml } from '../shared/html.js';
import { getSession, onAuthChange, fetchMyHousehold } from '../lib/auth.js';
import { captureInviteFromUrl, getPendingInvite } from '../lib/pending-invite.js';

// The header account control (M1b). Kept small because every page loads it; the dialogs behind it
// (account-dialogs.js) load on first use, the same pattern as the ask dialog.

const ONBOARDING_SHOWN_KEY = 'recipeBook.onboardingShown';
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

async function openAccount(view) {
  const { openAccountDialog } = await import('./account-dialogs.js');
  openAccountDialog({ state: getAccountState(), view, refresh });
}

/** Re-reads the session and household, re-renders, and notifies subscribers. */
export async function refresh() {
  const session = await getSession();
  const household = session ? await fetchMyHousehold(session) : null;
  Object.assign(state, { session, household, ready: true });
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

export async function mountAccount(slotElement) {
  if (!slotElement) return;
  slot = slotElement;
  captureInviteFromUrl();
  await refresh();
  // A sign-in link leaves a bare "#" behind once supabase-js has read the tokens out of it.
  if (window.location.href.endsWith('#')) {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  }
  maybeAutoOpen();
  onAuthChange(async (_session, event) => {
    if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') return;
    const next = await refresh();
    if (event !== 'SIGNED_IN') return;
    if (accountDialogIsOpen()) {
      const { handleSignedIn } = await import('./account-dialogs.js');
      await handleSignedIn(next);
    } else {
      maybeAutoOpen();
    }
  });
}
