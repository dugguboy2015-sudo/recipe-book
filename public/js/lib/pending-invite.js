// An invite code has to survive the sign-in email round trip, and the sign-in link opens in a new
// tab — so it lives in localStorage (sessionStorage is per-tab), with the same 7-day expiry as the
// invite itself.

const KEY = 'recipeBook.pendingInvite';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const CODE = /^[A-Za-z0-9_-]{32}$/;

export function isInviteCode(code) {
  return CODE.test(String(code || ''));
}

export function setPendingInvite(code) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ code, at: Date.now() }));
  } catch {
    /* storage unavailable — the invite link itself still works if reopened */
  }
}

export function clearPendingInvite() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}

export function getPendingInvite() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const { code, at } = JSON.parse(raw);
    if (!isInviteCode(code) || Date.now() - at > MAX_AGE_MS) {
      clearPendingInvite();
      return null;
    }
    return code;
  } catch {
    return null;
  }
}

/** Moves `?invite=…` out of the address bar into storage, keeping any sign-in hash intact. */
export function captureInviteFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('invite');
  if (!code) return;
  if (isInviteCode(code)) setPendingInvite(code);
  params.delete('invite');
  const query = params.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
}

/** Accepts a pasted invite link or a bare code. */
export function inviteCodeFrom(text) {
  const value = String(text || '').trim();
  try {
    const fromUrl = new URL(value).searchParams.get('invite');
    if (fromUrl) return fromUrl;
  } catch {
    /* not a URL — treat as a bare code */
  }
  return value;
}
