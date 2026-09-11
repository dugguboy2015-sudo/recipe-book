const pageType = document.body.dataset.page || 'dashboard';

const pageModules = {
  dashboard: () => import('./pages/dashboard.js').then((m) => m.initDashboardPage()),
  recipes: () => import('./pages/recipes.js').then((m) => m.initRecipesPage()),
  planner: () => import('./pages/planner.js').then((m) => m.initPlannerPage()),
};

async function initApp() {
  if (!window.supabase) {
    console.error('Supabase client is not available.');
    return;
  }
  const init = pageModules[pageType];
  if (!init) return;
  await init();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => initApp());
} else {
  initApp();
}
