import { getSession } from './auth.js';

// M1c: every write and every AI call is made as a signed-in household member. Without a session
// the request isn't sent at all — the account dialog opens instead, explaining why.
const SIGN_IN_MESSAGES = {
  sign_in_required: 'Sign in to do that.',
  no_household: 'Set up or join a household first.',
};

function promptForAccount(reason) {
  import('../components/account.js').then((m) => m.promptAccount(reason)).catch((err) => console.error(err));
}

async function authHeaders() {
  const session = await getSession();
  return session ? { Authorization: `Bearer ${session.access_token}` } : null;
}

async function callApi(path, { method, body, signal, reason }) {
  const auth = await authHeaders();
  if (!auth) {
    promptForAccount(reason);
    return { ok: false, status: 401, code: 'sign_in_required', message: SIGN_IN_MESSAGES.sign_in_required };
  }

  let response;
  try {
    response = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') return { ok: false, status: 0, code: 'aborted', message: 'Cancelled.' };
    console.error(err);
    return { ok: false, status: 0, code: 'network_error', message: "Couldn't save. Your changes are still in the form. Try again." };
  }

  let data;
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (response.ok) return { ok: true, data };
  if (data.code in SIGN_IN_MESSAGES) promptForAccount(reason);

  return {
    ok: false,
    status: response.status,
    code: data.code || 'internal_error',
    message: data.message || "Couldn't save. Your changes are still in the form. Try again.",
    errors: data.errors,
    retryAfter: response.headers.get('Retry-After'),
    current: data.current,
    existing: data.existing,
    matches: data.matches,
    scope: data.scope,
    resetsAt: data.resetsAt,
  };
}

export function createRecipe({ recipe, ingredients, source, generationId }) {
  return callApi('/api/recipes', { method: 'POST', body: { recipe, ingredients, source, generationId }, reason: 'to add recipes' });
}

export function updateRecipe(id, { recipe, ingredients, expectedUpdatedAt }) {
  return callApi(`/api/recipes/${id}`, { method: 'PATCH', body: { recipe, ingredients, expectedUpdatedAt }, reason: 'to edit recipes' });
}

export function deleteRecipe(id) {
  return callApi(`/api/recipes/${id}`, { method: 'DELETE', body: {}, reason: 'to delete recipes' });
}

export function restoreRecipe(id) {
  return callApi(`/api/recipes/${id}/restore`, { method: 'POST', body: {}, reason: 'to restore recipes' });
}

export function approveRecipe(id) {
  return callApi(`/api/recipes/${id}/approve`, { method: 'POST', body: {}, reason: 'to approve recipes' });
}

export function generateRecipe({ prompt, constraints, goal, mealType, force, signal }) {
  return callApi('/api/recipes/generate', { method: 'POST', body: { prompt, constraints, goal, mealType, force }, signal, reason: 'to ask for AI recipes' });
}

export function estimateNutrition({ name, serves, ingredients }) {
  return callApi('/api/recipes/estimate-nutrition', { method: 'POST', body: { name, serves, ingredients }, reason: 'to estimate nutrition' });
}

export async function fetchGenerationQuota() {
  try {
    const response = await fetch('/api/recipes/generate/quota', { headers: (await authHeaders()) || {} });
    const data = await response.json();
    if (!response.ok) return { ok: false, code: data.code, message: data.message };
    return { ok: true, data };
  } catch (err) {
    console.error(err);
    return { ok: false, code: 'network_error', message: 'Could not check the generation quota.' };
  }
}
