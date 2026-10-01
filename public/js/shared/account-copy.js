// What the app owes a signed-out visitor: a plain statement that their week, list and favourites
// live in this browser only. Before P1 the app said this exactly once — inside an *error*
// snackbar, which you only see when something has already gone wrong. People found out instead by
// opening the app on a second phone and finding it empty.
//
// Pure and DOM-free so it can be unit tested; the pages pass their own account state in.

export const DEVICE_ONLY_NOTE = 'Saved on this device only — sign in to share with your household.';

/**
 * @param {{session?: object|null, ready?: boolean}|null} account - from components/account.js
 * @returns {string} the note, or '' when signed in (or not yet known, so it never flickers in)
 */
export function deviceOnlyNote(account) {
  if (!account?.ready) return '';
  return account.session ? '' : DEVICE_ONLY_NOTE;
}
