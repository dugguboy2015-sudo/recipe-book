// escapeHtml and MEAL_TYPES, split out of recipe-rules.js: nearly every page/component needs one
// or both of these, but recipe-rules.js also carries the full Appendix C/J recipe-validation
// logic (normalizeRecipeInput and friends, ~300 lines) that only the add/edit form needs. With no
// bundler/tree-shaking (native ES modules only, per CLAUDE.md), importing even one named export
// costs the whole file over the network — see shared/planner-constants.js for the same reasoning.
// recipe-rules.js and lib/dom.js both re-export these so existing imports keep working unchanged.

export const MEAL_TYPES = ['Breakfast', 'Packed Lunch', 'Lunch', 'Dinner', 'Snacks', 'Dessert'];

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
