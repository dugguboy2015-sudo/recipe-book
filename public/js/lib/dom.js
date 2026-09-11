export { escapeHtml } from '../shared/recipe-rules.js';

export function $(selector, root = document) {
  return root.querySelector(selector);
}

export function $$(selector, root = document) {
  return [...root.querySelectorAll(selector)];
}

let snackbarTimeoutId;

export function showSnackbar(message, type = 'success') {
  const snackbar = document.getElementById('snackbar');
  if (!snackbar) return;
  snackbar.textContent = message;
  snackbar.className = `snackbar show ${type}`;
  clearTimeout(snackbarTimeoutId);
  snackbarTimeoutId = setTimeout(() => {
    snackbar.classList.remove('show');
  }, 3000);
}

export function setBusy(element, busy) {
  if (!element) return;
  element.disabled = Boolean(busy);
  element.classList.toggle('is-busy', Boolean(busy));
}
