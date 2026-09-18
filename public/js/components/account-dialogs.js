import { escapeHtml } from '../shared/html.js';
import { showSnackbar } from '../lib/dom.js';
import { wireDialog } from './dialog.js';
import { sendSignInEmail, signOut, postAsUser, patchAsUser, fetchHouseholdMembers, fetchHouseholdSettings, fetchCuisineNames } from '../lib/auth.js';
import { DIET_PRESETS, WEEKDAYS, dietPresetKey } from '../shared/household-settings.js';
import { setFlash } from './account.js';
import { getPendingInvite, setPendingInvite, clearPendingInvite, inviteCodeFrom, isInviteCode } from '../lib/pending-invite.js';

// Everything behind the header account control (M1b): sign in, create or join a household, and the
// household panel with invites. Loaded on first use only.

const DIALOG_ID = 'accountDialog';
const ONBOARDING_SHOWN_KEY = 'recipeBook.onboardingShown';
const EXPIRED_INVITE = 'This invite link has expired or has already been used. Ask for a new one.';

let handle = null;
let ctx = null; // { state, refresh }
let signInEmail = '';

function body() {
  return document.getElementById('accountDialogBody');
}

function ensureDialog() {
  if (!document.getElementById(DIALOG_ID)) {
    document.body.insertAdjacentHTML('beforeend', `
      <dialog id="${DIALOG_ID}" class="recipe-detail confirmation-panel account-dialog" aria-labelledby="accountDialogTitle">
        <div id="accountDialogBody"></div>
        <div id="accountTurnstile"></div>
      </dialog>`);
    handle = wireDialog(document.getElementById(DIALOG_ID));
  }
}

function close() {
  handle?.close();
}

function focusFirst() {
  body()?.querySelector('input:not([type="hidden"]), button:not([data-account-close])')?.focus();
}

function setErrors(errors = {}) {
  body()?.querySelectorAll('[data-error-for]').forEach((el) => {
    el.textContent = errors[el.dataset.errorFor] || '';
  });
}

function setBusy(button, isBusy) {
  if (!button) return;
  button.disabled = isBusy;
  button.classList.toggle('is-busy', isBusy);
}

function wireCommon() {
  body().querySelectorAll('[data-account-close]').forEach((b) => b.addEventListener('click', close));
  body().querySelectorAll('[data-account-view]').forEach((b) => b.addEventListener('click', () => show(b.dataset.accountView)));
}

function friendlyAuthError(error) {
  const message = String(error?.message || '');
  if (/captcha/i.test(message)) return "We couldn't confirm you're not a bot. Please try again.";
  if (error?.status === 429 || /rate limit|too many/i.test(message)) {
    return 'Too many sign-in emails have gone out in the last hour. Please try again later — or use a link we already sent.';
  }
  return 'Something went wrong. Please try again.';
}

// "priya.sharma@…" → "Priya". Only a starting suggestion; anything too short to be a name is dropped.
function suggestedName() {
  const word = (ctx?.state.session?.user?.email || '').split('@')[0].split(/[^a-zA-Z]+/).find(Boolean) || '';
  return word.length > 1 ? word[0].toUpperCase() + word.slice(1).toLowerCase() : '';
}

function markOnboardingShown() {
  try { sessionStorage.setItem(ONBOARDING_SHOWN_KEY, '1'); } catch { /* best-effort */ }
}

// ---------- Sign in ----------

function reasonNotice(prefix) {
  return ctx?.reason ? `<p class="notice">${escapeHtml(`${prefix} ${ctx.reason}.`)}</p>` : '';
}

function renderSignIn() {
  const invited = Boolean(getPendingInvite());
  body().innerHTML = `
    <div class="detail-header"><h3 id="accountDialogTitle">Sign in</h3></div>
    ${invited ? '<p class="notice">Sign in first, then you can join the household that invited you.</p>' : reasonNotice('Sign in')}
    <p class="delete-confirm-copy">We'll email you a sign-in link — no password needed.</p>
    <form id="signInEmailForm" class="account-form" novalidate>
      <label class="field"><span>Email</span>
        <input type="email" id="signInEmail" autocomplete="email" inputmode="email" required value="${escapeHtml(signInEmail)}" />
      </label>
      <small class="field-error" data-error-for="email" role="alert"></small>
      <div class="form-actions">
        <button type="button" class="ghost-button" data-account-close>Not now</button>
        <button type="submit" class="primary-button">Email me a link</button>
      </div>
    </form>`;
  wireCommon();
  body().querySelector('#signInEmailForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = body().querySelector('#signInEmail').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setErrors({ email: 'Enter a valid email address.' });
      return;
    }
    const button = body().querySelector('#signInEmailForm button[type="submit"]');
    setBusy(button, true);
    // Inside the dialog, not the page: a challenge rendered under a modal dialog can't be clicked.
    // Fails open: if Turnstile can't run here (blocked script, privacy tools), try without a token
    // and let Supabase decide — it only insists when its sign-in captcha is switched on.
    let captchaToken;
    try {
      const { getToken } = await import('../lib/turnstile.js');
      captchaToken = await getToken(document.getElementById('accountTurnstile'), { timeoutMs: 15_000 });
    } catch (err) {
      console.warn('Sign-in bot check unavailable; continuing without it.', err);
    }
    const { error } = await sendSignInEmail(email, `${window.location.origin}${window.location.pathname}`, captchaToken);
    setBusy(button, false);
    if (error) {
      setErrors({ email: friendlyAuthError(error) });
      return;
    }
    signInEmail = email;
    renderCheckEmail();
  });
  focusFirst();
}

// Link only: Supabase's built-in mailer can't carry a 6-digit code on the free tier (template
// changes need custom SMTP — see scripts/configure-auth.mjs). The implicit flow means the link
// signs in whichever device it's opened on; if that's another tab in this browser, the session
// reaches this tab too and handleSignedIn() below moves this dialog on.
function renderCheckEmail() {
  body().innerHTML = `
    <div class="detail-header"><h3 id="accountDialogTitle">Check your email</h3></div>
    <p class="delete-confirm-copy">We sent a sign-in link to <strong>${escapeHtml(signInEmail)}</strong>.
      Tap it to sign in — on this device or any other. It works once and expires in an hour.</p>
    <p class="hint">Can't see it? Check your spam folder. It can take a minute or two to arrive.</p>
    <small class="field-error" data-error-for="email" role="alert"></small>
    <div class="form-actions">
      <button type="button" class="ghost-button" data-account-view="sign-in">Use a different email</button>
      <button type="button" class="primary-button" data-account-close>Done</button>
    </div>`;
  body().dataset.view = 'check-email';
  wireCommon();
  focusFirst();
}

/** Called by account.js when a sign-in completes while this dialog is open. */
export async function handleSignedIn(state) {
  if (!ctx || body()?.dataset.view !== 'check-email') return;
  ctx.state = state;
  await afterSignIn();
}

async function afterSignIn() {
  markOnboardingShown();
  const next = ctx.state.session ? ctx.state : await ctx.refresh();
  ctx.state = next;
  if (next.household) {
    close();
    showSnackbar(`Signed in${next.household.displayName ? ` — welcome back, ${next.household.displayName}` : ''}.`, 'success');
    return;
  }
  show(getPendingInvite() ? 'join' : 'create');
}

// ---------- Create a household ----------

function renderCreate() {
  const diets = Object.entries(DIET_PRESETS).map(([key, preset], index) => `
    <label class="choice"><input type="radio" name="diet" value="${key}"${index === 0 ? ' checked' : ''} /><span>${escapeHtml(preset.label)}</span></label>`).join('');
  body().innerHTML = `
    <div class="detail-header"><h3 id="accountDialogTitle">Set up your household</h3></div>
    ${reasonNotice('Set up or join a household')}
    <p class="delete-confirm-copy">A household shares one meal plan and its own food rules. You can invite your family once it's set up.</p>
    <form id="createHouseholdForm" class="account-form" novalidate>
      <label class="field"><span>Household name</span>
        <input type="text" id="householdName" maxlength="80" placeholder="e.g. The Sharma family" required />
      </label>
      <small class="field-error" data-error-for="name" role="alert"></small>
      <label class="field"><span>Your name</span>
        <input type="text" id="householdDisplayName" maxlength="60" autocomplete="given-name" required value="${escapeHtml(suggestedName())}" />
      </label>
      <small class="field-error" data-error-for="displayName" role="alert"></small>
      <fieldset class="choice-list"><legend>How does your household eat?</legend>${diets}</fieldset>
      <small class="field-error" data-error-for="diet" role="alert"></small>
      <div class="form-actions">
        <button type="button" class="ghost-button" data-account-close>Not now</button>
        <button type="submit" class="primary-button">Create household</button>
      </div>
    </form>
    <div class="account-section">
      <h4>Joining someone else's household?</h4>
      <p class="hint">Open the invite link they sent you, or paste it here.</p>
      <form id="pasteInviteForm" class="account-inline-form" novalidate>
        <label class="sr-only" for="pastedInvite">Invite link</label>
        <input type="text" id="pastedInvite" class="search-box" placeholder="Paste invite link" autocomplete="off" />
        <button type="submit" class="ghost-button">Continue</button>
      </form>
      <small class="field-error" data-error-for="invite" role="alert"></small>
    </div>`;
  wireCommon();

  body().querySelector('#createHouseholdForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = {
      name: form.querySelector('#householdName').value,
      displayName: form.querySelector('#householdDisplayName').value,
      diet: form.querySelector('input[name="diet"]:checked')?.value,
    };
    const button = form.querySelector('button[type="submit"]');
    setBusy(button, true);
    const { ok, status, data } = await postAsUser('/api/household', payload);
    setBusy(button, false);
    if (ok) {
      // The household changed, so refresh() reloads the page; the message shows after it.
      const curatorNote = data.household?.isCurator ? ' Your household curates the shared recipe catalogue.' : '';
      await ctx.refresh({ flash: `${data.household?.name || 'Your household'} is set up.${curatorNote}` });
      return;
    }
    if (status === 400) {
      setErrors(data.errors);
      return;
    }
    if (status === 409) {
      ctx.state = await ctx.refresh();
      show('account');
      return;
    }
    showSnackbar(data.message || 'Something went wrong. Please try again.', 'error');
  });

  body().querySelector('#pasteInviteForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const code = inviteCodeFrom(body().querySelector('#pastedInvite').value);
    if (!isInviteCode(code)) {
      setErrors({ invite: 'That does not look like an invite link. Check you copied all of it.' });
      return;
    }
    setPendingInvite(code);
    renderJoin(code);
  });
  focusFirst();
}

// ---------- Join a household ----------

function renderInviteGone(message) {
  clearPendingInvite();
  body().innerHTML = `
    <div class="detail-header"><h3 id="accountDialogTitle">That invite has run out</h3></div>
    <p class="delete-confirm-copy">${escapeHtml(message || EXPIRED_INVITE)}</p>
    <div class="form-actions">
      <button type="button" class="ghost-button" data-account-view="create">Create my own household</button>
      <button type="button" class="primary-button" data-account-close>Close</button>
    </div>`;
  wireCommon();
  focusFirst();
}

async function renderJoin(code) {
  if (!isInviteCode(code)) {
    renderCreate();
    return;
  }
  body().innerHTML = `
    <div class="detail-header"><h3 id="accountDialogTitle">Checking your invite…</h3></div>
    <p class="delete-confirm-copy">One moment.</p>`;
  let householdName;
  try {
    const response = await fetch(`/api/household/join?code=${encodeURIComponent(code)}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      renderInviteGone(data.message);
      return;
    }
    householdName = data.householdName;
  } catch {
    showSnackbar("Couldn't check that invite. Check your connection and try again.", 'error');
    renderCreate();
    return;
  }

  body().innerHTML = `
    <div class="detail-header"><h3 id="accountDialogTitle">Join ${escapeHtml(householdName)}</h3></div>
    <p class="delete-confirm-copy">You've been invited to share ${escapeHtml(householdName)}'s meal plan and recipes.</p>
    <form id="joinForm" class="account-form" novalidate>
      <label class="field"><span>Your name</span>
        <input type="text" id="joinDisplayName" maxlength="60" autocomplete="given-name" required value="${escapeHtml(suggestedName())}" />
      </label>
      <small class="field-error" data-error-for="displayName" role="alert"></small>
      <small class="field-error" data-error-for="code" role="alert"></small>
      <div class="form-actions">
        <button type="button" class="ghost-button" data-account-view="create">Create my own instead</button>
        <button type="submit" class="primary-button">Join household</button>
      </div>
    </form>`;
  wireCommon();
  body().querySelector('#joinForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    setBusy(button, true);
    const { ok, status, data } = await postAsUser('/api/household/join', {
      code,
      displayName: body().querySelector('#joinDisplayName').value,
    });
    setBusy(button, false);
    if (ok) {
      clearPendingInvite();
      await ctx.refresh({ flash: `You've joined ${householdName}.` });
      return;
    }
    if (status === 404) {
      renderInviteGone(data.message);
      return;
    }
    if (status === 409) {
      clearPendingInvite();
      ctx.state = await ctx.refresh();
      showSnackbar('You already belong to a household.', 'error');
      show('account');
      return;
    }
    if (status === 400) {
      setErrors(data.errors);
      return;
    }
    showSnackbar(data.message || 'Something went wrong. Please try again.', 'error');
  });
  focusFirst();
}

// ---------- Household panel ----------

async function renderAccount() {
  const { household, session } = ctx.state;
  if (!household) {
    renderCreate();
    return;
  }
  const [members, settings] = await Promise.all([fetchHouseholdMembers(household.id), fetchHouseholdSettings(household.id)]);
  const isOwner = household.role === 'owner';
  const memberItems = members.map((member) => `
    <li>
      <span>${escapeHtml(member.display_name || 'Member')}${member.user_id === session.user.id ? ' <span class="hint">(you)</span>' : ''}</span>
      <span class="hint">${member.role === 'owner' ? 'Owner' : 'Member'}</span>
    </li>`).join('');

  body().innerHTML = `
    <div class="detail-header"><h3 id="accountDialogTitle">${escapeHtml(household.name)}</h3></div>
    <p class="hint">Signed in as ${escapeHtml(session.user.email)}${household.isCurator ? ' · your household curates the shared recipe catalogue' : ''}</p>
    <h4 class="account-subheading">How you eat</h4>
    <p class="delete-confirm-copy">${escapeHtml(settingsSummary(settings))}</p>
    ${isOwner ? '<div><button type="button" class="ghost-button" data-account-view="settings">Edit household settings</button></div>' : ''}
    <h4 class="account-subheading">Members</h4>
    <ul class="member-list">${memberItems}</ul>
    ${isOwner ? `
      <div class="account-section">
        <p class="hint">Invite links work once and expire after 7 days.</p>
        <div><button type="button" class="primary-button" id="createInviteButton">Invite someone</button></div>
        <div id="inviteResult"></div>
      </div>` : ''}
    <div class="form-actions">
      <button type="button" class="ghost-button" id="signOutButton">Sign out</button>
      <button type="button" class="primary-button" data-account-close>Done</button>
    </div>`;
  wireCommon();

  body().querySelector('#signOutButton').addEventListener('click', async () => {
    // Signing out fires an auth event whose refresh() reloads the page; leave the message for it.
    setFlash('Signed out.');
    await signOut();
  });

  body().querySelector('#createInviteButton')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    setBusy(button, true);
    const { ok, data } = await postAsUser('/api/household/invites');
    setBusy(button, false);
    if (!ok) {
      showSnackbar(data.message || "Couldn't create an invite. Please try again.", 'error');
      return;
    }
    const link = `${window.location.origin}/?invite=${data.code}`;
    const canShare = typeof navigator.share === 'function';
    body().querySelector('#inviteResult').innerHTML = `
      <label class="field"><span>Invite link</span>
        <input type="text" id="inviteLinkInput" readonly value="${escapeHtml(link)}" />
      </label>
      <div class="form-actions form-actions-start">
        <button type="button" class="ghost-button" id="copyInviteButton">Copy link</button>
        ${canShare ? '<button type="button" class="primary-button" id="shareInviteButton">Share…</button>' : ''}
      </div>`;
    body().querySelector('#copyInviteButton').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(link);
        showSnackbar('Invite link copied.', 'success');
      } catch {
        const input = body().querySelector('#inviteLinkInput');
        input.select();
        showSnackbar('Select the link and copy it.', 'error');
      }
    });
    body().querySelector('#shareInviteButton')?.addEventListener('click', () => {
      navigator.share({ title: 'Join our household on Recipe Book', text: `Join ${household.name} on Recipe Book`, url: link }).catch(() => {});
    });
    body().querySelector('#inviteLinkInput').focus();
  });
  focusFirst();
}

// ---------- Household settings (M1d) ----------

function settingsSummary(settings) {
  if (!settings) return 'Settings unavailable right now.';
  const diet = DIET_PRESETS[dietPresetKey(settings)]?.label || 'Custom diet';
  const parts = [diet, `serves ${settings.default_servings || 4}`, `spice ${settings.spice?.default_level ?? 3} of 5`];
  const lunch = settings.packed_lunch;
  if (lunch?.days?.length) parts.push(`packed lunches ${lunch.days.map((d) => d.slice(0, 3)).join(', ')}`);
  return parts.join(' · ');
}

function checkboxes(name, options, selected) {
  return options.map((option) => `
    <label class="choice"><input type="checkbox" name="${name}" value="${escapeHtml(option)}"${selected.includes(option) ? ' checked' : ''} /><span>${escapeHtml(option)}</span></label>`).join('');
}

const SPICE_WORDS = ['mild', 'gentle', 'medium', 'hot', 'very hot'];

async function renderSettings() {
  const { household } = ctx.state;
  if (!household || household.role !== 'owner') {
    renderAccount();
    return;
  }
  body().innerHTML = '<div class="detail-header"><h3 id="accountDialogTitle">Household settings</h3></div><p class="delete-confirm-copy">Loading…</p>';
  const [settings, catalogueCuisines] = await Promise.all([fetchHouseholdSettings(household.id), fetchCuisineNames()]);
  if (!settings) {
    showSnackbar("Couldn't load your settings. Please try again.", 'error');
    renderAccount();
    return;
  }
  const favourites = settings.favourite_cuisines || [];
  const exploring = settings.exploring_cuisines || [];
  // Cuisines already chosen stay offered even if the catalogue doesn't list them ("Continental").
  const cuisines = [...new Set([...catalogueCuisines, ...favourites, ...exploring])];
  const currentDiet = dietPresetKey(settings);
  const lunch = settings.packed_lunch || { days: [] };
  const spiceLevel = settings.spice?.default_level ?? 3;
  const diets = Object.entries(DIET_PRESETS).map(([key, preset]) => `
    <label class="choice"><input type="radio" name="diet" value="${key}"${key === currentDiet ? ' checked' : ''} /><span>${escapeHtml(preset.label)}</span></label>`).join('');

  body().innerHTML = `
    <div class="detail-header"><h3 id="accountDialogTitle">Household settings</h3></div>
    <p class="hint">These shape the recipes you're shown, the planner's suggestions and the AI's recipes.</p>
    <form id="settingsForm" class="account-form" novalidate>
      <fieldset class="choice-list"><legend>How does your household eat?</legend>${diets}</fieldset>
      <small class="field-error" data-error-for="diet" role="alert"></small>
      <label class="field"><span>Usual servings</span>
        <input type="number" id="settingsServings" min="1" max="12" value="${settings.default_servings || 4}" />
      </label>
      <small class="field-error" data-error-for="defaultServings" role="alert"></small>
      <label class="field"><span>Spice level</span>
        <select id="settingsSpice">${[1, 2, 3, 4, 5].map((n) => `<option value="${n}"${n === spiceLevel ? ' selected' : ''}>${n} — ${SPICE_WORDS[n - 1]}</option>`).join('')}</select>
      </label>
      <small class="field-error" data-error-for="spiceLevel" role="alert"></small>
      <fieldset class="choice-list compact"><legend>Favourite cuisines</legend>${checkboxes('favourite', cuisines, favourites)}</fieldset>
      <small class="field-error" data-error-for="favouriteCuisines" role="alert"></small>
      <fieldset class="choice-list compact"><legend>Cuisines you're exploring</legend>${checkboxes('exploring', cuisines, exploring)}</fieldset>
      <small class="field-error" data-error-for="exploringCuisines" role="alert"></small>
      <fieldset class="choice-list compact"><legend>Packed-lunch days</legend>${checkboxes('lunchDay', WEEKDAYS, lunch.days || [])}</fieldset>
      <label class="field"><span>Packed lunches are for</span>
        <input type="text" id="settingsLunchFor" maxlength="60" placeholder="e.g. our son at secondary school" value="${escapeHtml(lunch.for || '')}" />
      </label>
      <small class="field-error" data-error-for="packedLunch" role="alert"></small>
      <div class="form-actions">
        <button type="button" class="ghost-button" data-account-view="account">Cancel</button>
        <button type="submit" class="primary-button">Save settings</button>
      </div>
    </form>`;
  wireCommon();
  body().querySelector('#settingsForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const checked = (name) => [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((input) => input.value);
    const payload = {
      diet: form.querySelector('input[name="diet"]:checked')?.value,
      defaultServings: Number(form.querySelector('#settingsServings').value),
      spiceLevel: Number(form.querySelector('#settingsSpice').value),
      favouriteCuisines: checked('favourite'),
      exploringCuisines: checked('exploring'),
      packedLunch: { days: checked('lunchDay'), for: form.querySelector('#settingsLunchFor').value },
    };
    const button = form.querySelector('button[type="submit"]');
    setBusy(button, true);
    const { ok, status, data } = await patchAsUser('/api/household/settings', payload);
    setBusy(button, false);
    if (ok) {
      // Every page reads these once at load, so reload to apply them everywhere.
      setFlash('Household settings saved.');
      window.location.reload();
      return;
    }
    if (status === 400) {
      setErrors(data.errors);
      return;
    }
    showSnackbar(data.message || "Couldn't save your settings. Please try again.", 'error');
  });
  focusFirst();
}

// ---------- Entry point ----------

function show(view) {
  delete body().dataset.view;
  if (view === 'sign-in') return renderSignIn();
  if (view === 'check-email') return renderCheckEmail();
  if (view === 'join') return renderJoin(getPendingInvite());
  if (view === 'create' || view === 'onboarding') return renderCreate();
  if (view === 'settings') return renderSettings();
  return renderAccount();
}

/** Opens the account dialog, choosing the right view for the current state unless one is given. */
export function openAccountDialog({ state, view, refresh, reason }) {
  ctx = { state, refresh, reason };
  ensureDialog();
  let chosen = view;
  if (!state.session) chosen = 'sign-in';
  else if (!chosen) chosen = state.household ? 'account' : (getPendingInvite() ? 'join' : 'create');
  if (!document.getElementById(DIALOG_ID).open) handle.open();
  show(chosen);
}
