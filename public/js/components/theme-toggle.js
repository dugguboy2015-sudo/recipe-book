// Wires a theme-toggle button to the pre-paint logic in js/theme.js (loaded separately, in <head>,
// so the choice applies before first paint). This module only handles the button after the DOM is
// ready — cycling the stored choice and keeping the icon/label in sync, including when the OS theme
// changes while the user is following it.
const DARK_QUERY = window.matchMedia('(prefers-color-scheme: dark)');

function isEffectivelyDark(explicit) {
  return explicit === 'dark' || (explicit === null && DARK_QUERY.matches);
}

function labelFor(explicit) {
  if (explicit === 'light') return 'Theme: Light';
  if (explicit === 'dark') return 'Theme: Dark';
  return 'Theme: System';
}

export function wireThemeToggle(button) {
  if (!button || !window.RecipeBookTheme) return;

  function render() {
    const explicit = window.RecipeBookTheme.get();
    button.textContent = isEffectivelyDark(explicit) ? '🌙' : '☀️';
    const label = `${labelFor(explicit)} — click to change`;
    button.setAttribute('data-tooltip', label);
    button.setAttribute('aria-label', label);
  }

  button.addEventListener('click', () => {
    window.RecipeBookTheme.cycle();
    render();
  });

  // Only matters while following the OS (explicit choice already pins the icon either way).
  DARK_QUERY.addEventListener('change', () => {
    if (window.RecipeBookTheme.get() === null) render();
  });

  render();
}
