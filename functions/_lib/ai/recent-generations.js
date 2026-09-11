/**
 * The pool used for J.3's effective-goal computation and the quota endpoint's `proteinSmartShare`:
 * the last 20 saved AI recipes' protein_smart flags, or every generated draft's when fewer than 5
 * have been saved (shared by generate.js and generate/quota.js so both read the same pool).
 */
export async function fetchRecentProteinSmartRecords(db) {
  const { data: saved } = await db.request('recipe_generations?select=protein_smart&kind=eq.recipe&outcome=eq.saved&protein_smart=not.is.null&order=created_at.desc&limit=20');
  const savedRecords = saved || [];
  if (savedRecords.length >= 5) return savedRecords;
  const { data: allGenerated } = await db.request('recipe_generations?select=protein_smart&kind=eq.recipe&protein_smart=not.is.null&order=created_at.desc&limit=20');
  return allGenerated || [];
}
