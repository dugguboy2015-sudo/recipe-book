// The quota window is UTC calendar days (Appendix, task 9.4: "count recipe_generations rows since
// 00:00 UTC today"), shared between generate.js and its quota.js sibling.
export function todayStartUtcIso(now = new Date()) {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

export function nextMidnightUtcIso(now = new Date()) {
  const d = new Date(now);
  d.setUTCHours(24, 0, 0, 0);
  return d.toISOString();
}
