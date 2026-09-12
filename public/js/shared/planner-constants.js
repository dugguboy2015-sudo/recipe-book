// The planner's shared vocabulary (days, slots, a couple of tuning constants) — split out of
// planner-engine.js so a module that only needs "what are the days/slots" (lib/planner-store.js,
// shared/plan-summary.js) doesn't have to pull in the whole scoring/fill algorithm just to get
// them. There's no bundler/tree-shaking here (native ES modules only, per CLAUDE.md), so every
// import costs its whole file over the network — this keeps that cost proportional to what's
// actually used (task 12.7's per-page performance budget).

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
export const WEEKEND_DAYS = ['Saturday', 'Sunday'];
export const SLOTS = ['Breakfast', 'Packed Lunch', 'Lunch', 'Dinner', 'Snacks', 'Dessert'];
export const PROTEIN_SMART_SLOTS = ['Packed Lunch', 'Lunch', 'Dinner'];
export const NOT_AGAIN_EXCLUSION_WEEKS = 8;
export const HISTORY_WEEKS_KEPT = 12;
