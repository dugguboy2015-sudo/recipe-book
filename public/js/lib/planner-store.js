// The weekly planner's storage (localStorage; no accounts, so it's per-browser — Appendix K).
// Shared between planner.js and the recipe detail view's "Add to planner" action (task 7.4) so
// both write the exact same shape.

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const MEAL_SLOTS = ['Breakfast', 'Lunch', 'Dinner', 'Snacks', 'Dessert', 'Other'];

const PLANNER_KEY = 'recipeBookPlanner';

export function defaultPlanner() {
  return Object.fromEntries(DAYS.map((day) => [day, []]));
}

export function loadPlanner() {
  try {
    const saved = JSON.parse(localStorage.getItem(PLANNER_KEY) || 'null');
    if (!saved) return defaultPlanner();
    const normalized = defaultPlanner();
    Object.keys(normalized).forEach((day) => {
      normalized[day] = Array.isArray(saved[day]) ? saved[day] : [];
    });
    return normalized;
  } catch {
    return defaultPlanner();
  }
}

export function persistPlanner(planner) {
  localStorage.setItem(PLANNER_KEY, JSON.stringify(planner));
}

/** @param {{id: number, name: string}} recipe */
export function assignRecipeToDay(planner, day, slot, recipe, servings) {
  if (!day || !slot || !recipe) return planner;
  const current = Array.isArray(planner[day]) ? planner[day] : [];
  const updated = current.filter((item) => !(item.id === recipe.id && (item.slot || 'Dinner') === slot));
  updated.push({ id: recipe.id, name: recipe.name, slot, servings: servings ?? null });
  planner[day] = updated;
  return planner;
}
