// P7: the email address is the account. Nothing in the app said so, and the field started empty on
// every visit — so signing in with a different address than last time was exactly as easy as
// signing in with the right one, and it silently made a second person with an empty household.
// That is how production ended up with two accounts, two households both called "The Babre's", and
// all 31 recipes stranded on the one that has not been signed into since.
//
// This remembers the last address used *in this browser*. It is never sent anywhere and never
// synced: it exists so returning is one tap, and so the app can notice when the address in front of
// it is not the one this browser knows.
//
// The storage calls are wrapped because this runs in private windows and on devices with site data
// blocked, where every one of them throws. The pure functions below are what the tests exercise.

const KEY = 'recipeBook.lastSignInEmail';
// Deliberately a second key. The one above records whichever address last asked for a link, which
// is what to prefill — but asking for a link as somebody else immediately overwrites it, so it
// cannot also answer "whose browser is this?". This one records the address that last had a real
// household here, and only changes when another account actually gets one.
const HOUSEHOLD_ACCOUNT_KEY = 'recipeBook.householdAccountEmail';

export function rememberEmail(email) {
  const value = String(email || '').trim();
  if (!value) return;
  try { localStorage.setItem(KEY, value); } catch { /* best-effort; prefill is a convenience */ }
}

/** @returns {string} the address this browser last signed in with, or '' */
export function recalledEmail() {
  try { return localStorage.getItem(KEY) || ''; } catch { return ''; }
}

export function forgetEmail() {
  try { localStorage.removeItem(KEY); } catch { /* nothing to forget */ }
}

/** Called when a signed-in session with a household is observed: this browser belongs to them. */
export function rememberHouseholdAccount(email) {
  const value = String(email || '').trim();
  if (!value) return;
  try { localStorage.setItem(HOUSEHOLD_ACCOUNT_KEY, value); } catch { /* best-effort */ }
}

/** @returns {string} the address that last had a household in this browser, or '' */
export function recalledHouseholdAccount() {
  try { return localStorage.getItem(HOUSEHOLD_ACCOUNT_KEY) || ''; } catch { return ''; }
}

/**
 * Whether to warn before this person sets up a household.
 *
 * The warning is for one case only: this browser remembers an address, the person is signed in as a
 * different one, and they are about to create a household — which is the exact step that produced
 * the duplicate. Signing in as the remembered address, or on a browser that remembers nothing, says
 * nothing at all.
 *
 * Pure so it can be tested; the caller passes both addresses.
 * @param {string} currentEmail - the address actually signed in
 * @param {string} rememberedEmail - what this browser last used
 * @returns {boolean}
 */
export function isDifferentAccount(currentEmail, rememberedEmail) {
  const now = normalise(currentEmail);
  const before = normalise(rememberedEmail);
  if (!now || !before) return false;
  return now !== before;
}

/** Addresses are case-insensitive in practice, and people paste them with stray spaces. */
function normalise(email) {
  return String(email || '').trim().toLowerCase();
}

/**
 * Hides the middle of an address so it can be shown back on screen without putting someone's full
 * email in front of whoever is holding the phone. "priya.sharma@gmail.com" -> "pr…a@gmail.com".
 */
export function maskEmail(email) {
  const value = String(email || '').trim();
  const at = value.lastIndexOf('@');
  if (at < 1) return value;
  const name = value.slice(0, at);
  const domain = value.slice(at);
  if (name.length <= 3) return `${name[0]}…${domain}`;
  return `${name.slice(0, 2)}…${name.slice(-1)}${domain}`;
}
