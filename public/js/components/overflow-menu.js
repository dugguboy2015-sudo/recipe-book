// The actions that are real but rare, tucked behind one button so the daily ones can be the ones
// you see. Used by the recipe detail (share, print, edit, delete) and the planner (export, import,
// reset this week).
//
// Deliberately not a <dialog>: these menus sit inside other surfaces — one of them inside a modal
// dialog already — and a nested modal would trap focus in the wrong place and swallow the Escape
// that should close the menu alone.

/**
 * @param {{button: HTMLElement|null, menu: HTMLElement|null, within?: HTMLElement|Document}} options
 *   `within` is the surface the menu lives in; a click anywhere else in it closes the menu.
 * @returns {(open: boolean) => void} a setter, so the owner can close it on its own events
 */
export function wireOverflowMenu({ button, menu, within = document }) {
  if (!button || !menu) return () => {};

  const setOpen = (open) => {
    menu.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  };

  button.addEventListener('click', (event) => {
    event.stopPropagation();
    setOpen(menu.hidden);
  });

  // Choosing anything closes it, and so does clicking away.
  menu.addEventListener('click', () => setOpen(false));
  within.addEventListener('click', () => setOpen(false));

  // Capture, so Escape closes the menu before the dialog it may be sitting inside reads the same
  // key as "close the whole thing".
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !menu.hidden) {
      event.stopPropagation();
      setOpen(false);
      button.focus();
    }
  }, true);

  return setOpen;
}
