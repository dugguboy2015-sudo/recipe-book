// Injects public/icons/sprite.svg once per page so markup can reference its symbols with
// <svg class="icon"><use href="#i-heart"/></svg>.
//
// The sprite is fetched and inlined rather than referenced externally (<use href="sprite.svg#id">)
// because an external reference does not inherit currentColor consistently across browsers, and
// this app themes every icon from the token layer. Inlining once costs one cached 9KB request and
// makes every icon a plain colour inherit.
//
// Deliberately not awaited by anything: icons are decoration over text that is already there, so a
// slow sprite must never hold up a render.

let injected = null;

export function mountIcons() {
  if (injected) return injected;
  injected = fetch('/icons/sprite.svg')
    .then((response) => (response.ok ? response.text() : Promise.reject(new Error(`sprite: HTTP ${response.status}`))))
    .then((markup) => {
      const holder = document.createElement('div');
      holder.innerHTML = markup;
      const sprite = holder.querySelector('svg');
      if (sprite) document.body.prepend(sprite);
    })
    .catch((error) => {
      // Every icon in this app sits beside a text label or carries an aria-label, so a missing
      // sprite degrades to empty space rather than losing meaning.
      console.warn('Icons unavailable.', error);
    });
  return injected;
}

/**
 * Markup for one icon. `name` is a sprite id without the `i-` prefix.
 * Decorative by default; pass a label when the icon is the only thing conveying meaning.
 */
export function icon(name, { label = '', className = '' } = {}) {
  const classes = ['icon', className].filter(Boolean).join(' ');
  const a11y = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"';
  return `<svg class="${classes}" ${a11y}><use href="#i-${name}"></use></svg>`;
}
