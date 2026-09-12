import { escapeHtml } from '../shared/html.js';

let activeWakeLock = null;

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) activeWakeLock = await navigator.wakeLock.request('screen');
  } catch (err) {
    // Unsupported or refused (e.g. tab not visible) — cook mode still works, just without it.
    console.error('Wake lock unavailable, continuing without it:', err);
  }
}

async function releaseWakeLock() {
  try {
    await activeWakeLock?.release();
  } catch {
    // already released
  }
  activeWakeLock = null;
}

/**
 * Full-screen cook mode (task 7.5): one step at a time, ingredients for the chosen servings in a
 * side panel, keyboard operable, and the screen kept awake where supported.
 * @param {{ recipeName: string, stepGroups: Array<{group: string, steps: string[]}>, ingredientsHtml: string }} options
 */
export function openCookMode({ recipeName, stepGroups, ingredientsHtml }) {
  const flatSteps = (stepGroups || []).flatMap((g) => g.steps.map((text) => ({ group: g.group, text })));
  if (flatSteps.length === 0) return;

  let index = 0;
  const overlay = document.createElement('div');
  overlay.className = 'cook-mode';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', `Cook mode: ${recipeName}`);
  document.body.appendChild(overlay);

  function render() {
    const step = flatSteps[index];
    overlay.innerHTML = `
      <div class="cook-mode-header">
        <strong>${escapeHtml(recipeName)}</strong>
        <button type="button" class="icon-button" id="cookModeClose" aria-label="Close cook mode">✕</button>
      </div>
      <div class="cook-mode-body">
        <div class="cook-mode-step">
          <div class="cook-mode-step-number">Step ${index + 1} of ${flatSteps.length} — ${escapeHtml(step.group)}</div>
          <div class="cook-mode-step-text">${escapeHtml(step.text)}</div>
        </div>
        <div class="cook-mode-ingredients">
          <h4>Ingredients</h4>
          ${ingredientsHtml}
        </div>
      </div>
      <div class="cook-mode-footer">
        <button type="button" class="ghost-button" id="cookModePrev" ${index === 0 ? 'disabled' : ''}>Previous</button>
        <button type="button" class="primary-button" id="cookModeNext">${index === flatSteps.length - 1 ? 'Done' : 'Next'}</button>
      </div>
    `;
    overlay.querySelector('#cookModeClose').addEventListener('click', close);
    overlay.querySelector('#cookModePrev').addEventListener('click', goPrev);
    overlay.querySelector('#cookModeNext').addEventListener('click', goNext);
    overlay.querySelector('#cookModeNext').focus();
  }

  function goPrev() {
    if (index > 0) { index -= 1; render(); }
  }

  function goNext() {
    if (index < flatSteps.length - 1) { index += 1; render(); } else close();
  }

  function onKeydown(event) {
    if (event.key === 'Escape') close();
    else if (event.key === 'ArrowRight') goNext();
    else if (event.key === 'ArrowLeft') goPrev();
  }

  function close() {
    document.removeEventListener('keydown', onKeydown);
    releaseWakeLock();
    overlay.remove();
  }

  document.addEventListener('keydown', onKeydown);
  requestWakeLock();
  render();
}
