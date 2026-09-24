import { wireThemeToggle } from './components/theme-toggle.js';

const pageType = document.body.dataset.page || 'dashboard';

const pageModules = {
  dashboard: () => import('./pages/dashboard.js').then((m) => m.initDashboardPage()),
  recipes: () => import('./pages/recipes.js').then((m) => m.initRecipesPage()),
  planner: () => import('./pages/planner.js').then((m) => m.initPlannerPage()),
  shopping: () => import('./pages/shopping.js').then((m) => m.initShoppingPage()),
};

async function initApp() {
  wireThemeToggle(document.getElementById('themeToggleButton'));

  if (!window.supabase) {
    console.error('Supabase client is not available.');
    return;
  }
  // Not awaited: the account control must never hold up the page itself.
  import('./components/account.js')
    .then((m) => m.mountAccount(document.getElementById('accountSlot')))
    .catch((error) => console.error(error));
  const init = pageModules[pageType];
  if (!init) return;
  await init();
}

// M4: the service worker makes the app open on patchy kitchen wifi and lets it live on a home
// screen. Registered after load so it never competes with the first render, and only where the
// page is served over https (it is a no-op on file:// and unsupported browsers).
function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || window.location.protocol !== 'https:') return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => console.warn('Offline support unavailable:', error));
  });
}
registerServiceWorker();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => initApp());
} else {
  initApp();
}
