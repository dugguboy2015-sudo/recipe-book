// Wires a native <dialog> for open/close with focus restored to whatever opened it.
// showModal()/close() already give us focus-trapping and Escape-to-close for free; we only need
// to add backdrop-click-to-close and remember what to focus afterwards.
export function wireDialog(dialog, { onClose } = {}) {
  let lastFocused = null;

  function open() {
    lastFocused = document.activeElement;
    dialog.showModal();
  }

  function close() {
    if (dialog.open) dialog.close();
  }

  // A real click on the ::backdrop is dispatched with the dialog itself as event.target (the
  // backdrop isn't a hit-testable descendant node). Checking clientX/clientY against the dialog's
  // bounding box instead was tried and reverted: a keyboard-activated click (Enter/Space on any
  // button or checkbox inside the dialog) synthesizes a MouseEvent with clientX/clientY both 0,
  // which that coordinate check misread as "outside the dialog" and closed it on every keypress.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });

  dialog.addEventListener('close', () => {
    onClose?.();
    if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
  });

  return { open, close };
}
