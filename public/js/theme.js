// Applies any stored theme choice before first paint. Loaded as a classic, non-module,
// non-deferred <script> in <head> — a module script is deferred until after parsing and would
// paint the system theme first, causing a flash of the wrong theme when a user has explicitly
// chosen the other one. Keep this file tiny; it's the one deliberate exception to "load on demand"
// in this app, because its whole job is to run before anything else does.
//
// Three states, matching tokens.css: no data-theme attribute = follow the OS
// (@media prefers-color-scheme), 'light'/'dark' = an explicit choice that wins either way.
(function () {
  var KEY = 'recipeBook.theme';
  var root = document.documentElement;

  function readStored() {
    try {
      var value = localStorage.getItem(KEY);
      return value === 'light' || value === 'dark' ? value : null;
    } catch {
      return null;
    }
  }

  function apply(theme) {
    if (theme) root.setAttribute('data-theme', theme);
    else root.removeAttribute('data-theme');
  }

  apply(readStored());

  window.RecipeBookTheme = {
    get: readStored,
    set: function (theme) {
      apply(theme);
      try {
        if (theme) localStorage.setItem(KEY, theme);
        else localStorage.removeItem(KEY);
      } catch {
        /* best-effort; theme still applies for this page view */
      }
    },
    cycle: function () {
      var order = [null, 'light', 'dark'];
      var next = order[(order.indexOf(readStored()) + 1) % order.length];
      window.RecipeBookTheme.set(next);
      return next;
    },
  };
})();
