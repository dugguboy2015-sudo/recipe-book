export const INVITE_TTL_DAYS = 7;
export const MAX_ACTIVE_INVITES = 10;
export const INVITE_CODE_PATTERN = /^[A-Za-z0-9_-]{32}$/;

/** 24 random bytes as base64url: 32 URL-safe characters, 192 bits — not guessable. */
export function generateInviteCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The founding owner is identified by a configured email, never by being first to sign up. */
export function isFoundingEmail(email, foundingEmail) {
  const a = String(email || '').trim().toLowerCase();
  const b = String(foundingEmail || '').trim().toLowerCase();
  return a !== '' && a === b;
}

function cleanText(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function validateDisplayName(value, errors) {
  const displayName = cleanText(value);
  if (displayName.length < 1 || displayName.length > 60) errors.displayName = 'Add your name (up to 60 characters).';
  return displayName;
}

export function validateCreateHousehold(body, dietKeys, { requireDiet = true } = {}) {
  const errors = {};
  const name = cleanText(body?.name);
  if (name.length < 1 || name.length > 80) errors.name = 'Give your household a name (up to 80 characters).';
  const displayName = validateDisplayName(body?.displayName, errors);
  const diet = String(body?.diet ?? '');
  if (requireDiet && !dietKeys.includes(diet)) errors.diet = 'Choose how your household eats.';
  return { ok: Object.keys(errors).length === 0, value: { name, displayName, diet }, errors };
}

export function validateJoin(body) {
  const errors = {};
  const code = String(body?.code ?? '').trim();
  if (!INVITE_CODE_PATTERN.test(code)) errors.code = 'That invite link is not valid. Check you copied all of it.';
  const displayName = validateDisplayName(body?.displayName, errors);
  return { ok: Object.keys(errors).length === 0, value: { code, displayName }, errors };
}

/** The user's household membership via the secret key, or null if they belong to none. */
export async function getMembership(db, userId) {
  const { data } = await db.request(
    `household_members?select=household_id,role,display_name&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
  );
  return data?.[0] || null;
}
