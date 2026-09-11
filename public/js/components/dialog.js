// Wires a native <dialog> for open/close with focus restored to whatever opened it.
// showModal()/close() already give us focus-trapping and Escape-to-close for free; we only need
// to add backdrop-click-to-close (the ::backdrop pseudo-element isn't a real node to listen on,
// so a click is "on the backdrop" when it lands outside the dialog's own box) and remember what
// to focus afterwards.
export function wireDialog(dialog, { onClose } = {}) {
  let lastFocused = null;

  function open() {
    lastFocused = document.activeElement;
    dialog.showModal();
  }

  function close() {
    if (dialog.open) dialog.close();
  }

  dialog.addEventListener('click', (event) => {
    const rect = dialog.getBoundingClientRect();
    const insideDialog =
      event.clientX >= rect.left && event.clientX <= rect.right &&
      event.clientY >= rect.top && event.clientY <= rect.bottom;
    if (!insideDialog) close();
  });

  dialog.addEventListener('close', () => {
    onClose?.();
    if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
  });

  return { open, close };
}
