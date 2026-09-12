// First-visit tips (Appendix L.4): three dismissible hints, remembered in localStorage so each
// only ever shows until the user dismisses it once.

const STORAGE_KEY = 'recipeBook.dismissedTips';

export const TIPS = {
  askRecipe: 'Try "Ask for a recipe" any time you want a fresh idea in seconds.',
  autoFill: 'Use "Auto-fill my week" to fill your whole week in one click, then tweak from there.',
  servings: 'Tap the servings stepper on any recipe to scale every ingredient up or down.',
};

function loadDismissed() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function dismiss(id) {
  try {
    const dismissed = new Set(loadDismissed());
    dismissed.add(id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...dismissed]));
  } catch {
    // best-effort — worst case the tip just reappears next visit
  }
}

/** Renders one dismissible tip into `container`, or nothing if it's already been dismissed. */
export function mountTip(container, id) {
  if (!container || !TIPS[id] || loadDismissed().includes(id)) return;

  container.innerHTML = `
    <div class="tip-banner" role="note">
      <p>${TIPS[id]}</p>
      <button type="button" class="icon-button" aria-label="Dismiss tip">×</button>
    </div>
  `;
  container.querySelector('button')?.addEventListener('click', () => {
    dismiss(id);
    container.innerHTML = '';
  });
}
