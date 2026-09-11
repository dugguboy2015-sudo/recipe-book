import { getToken } from './turnstile.js';

async function callApi(path, { method, body, turnstileContainer }) {
  let turnstileToken;
  try {
    turnstileToken = await getToken(turnstileContainer);
  } catch (err) {
    return { ok: false, status: 0, code: 'verification_failed', message: err.message || "We couldn't confirm you're not a bot. Try saving again." };
  }

  let response;
  try {
    response = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, turnstileToken }),
    });
  } catch (err) {
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

  return {
    ok: false,
    status: response.status,
    code: data.code || 'internal_error',
    message: data.message || "Couldn't save. Your changes are still in the form. Try again.",
    errors: data.errors,
    retryAfter: response.headers.get('Retry-After'),
    current: data.current,
    existing: data.existing,
  };
}

export function createRecipe({ recipe, ingredients, turnstileContainer, source, generationId }) {
  return callApi('/api/recipes', { method: 'POST', body: { recipe, ingredients, source, generationId }, turnstileContainer });
}

export function updateRecipe(id, { recipe, ingredients, expectedUpdatedAt, turnstileContainer }) {
  return callApi(`/api/recipes/${id}`, { method: 'PATCH', body: { recipe, ingredients, expectedUpdatedAt }, turnstileContainer });
}

export function deleteRecipe(id, { turnstileContainer }) {
  return callApi(`/api/recipes/${id}`, { method: 'DELETE', body: {}, turnstileContainer });
}

export function restoreRecipe(id, { turnstileContainer }) {
  return callApi(`/api/recipes/${id}/restore`, { method: 'POST', body: {}, turnstileContainer });
}
