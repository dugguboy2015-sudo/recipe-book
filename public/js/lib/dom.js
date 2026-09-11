export { escapeHtml } from '../shared/recipe-rules.js';

export function $(selector, root = document) {
  return root.querySelector(selector);
}

export function $$(selector, root = document) {
  return [...root.querySelectorAll(selector)];
}

let snackbarTimeoutId;

/**
 * @param {string} message
 * @param {'success'|'error'} [type]
 * @param {{ label: string, onClick: () => void, duration?: number }} [action] - e.g. an Undo button
 */
export function showSnackbar(message, type = 'success', action) {
  const snackbar = document.getElementById('snackbar');
  if (!snackbar) return;
  snackbar.textContent = message;
  snackbar.className = `snackbar show ${type}`;

  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toast-action';
    button.textContent = action.label;
    button.addEventListener('click', () => {
      clearTimeout(snackbarTimeoutId);
      snackbar.classList.remove('show');
      action.onClick();
    });
    snackbar.appendChild(button);
  }

  clearTimeout(snackbarTimeoutId);
  snackbarTimeoutId = setTimeout(() => {
    snackbar.classList.remove('show');
  }, action?.duration ?? 3000);
}

export function setBusy(element, busy) {
  if (!element) return;
  element.disabled = Boolean(busy);
  element.classList.toggle('is-busy', Boolean(busy));
}

/** @returns {(...args: any[]) => void} `fn`, delayed by `wait`ms and restarted on every call (BUG-8's 8.6/8.3). */
export function debounce(fn, wait) {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), wait);
  };
}
