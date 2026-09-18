// Who may change which recipe (M1c). Shared by the Functions, which enforce it, and the browser,
// which only uses it to decide which buttons to show. `viewer` is { householdId, isCurator }.

/**
 * A household edits the recipes it contributed; the curator household may edit any. A recipe no
 * household owns yet (before the founding owner's first sign-in claims the catalogue) is
 * curator-only.
 */
export function canEditRecipe(viewer, recipe) {
  if (!viewer || !recipe) return false;
  if (viewer.isCurator) return true;
  return recipe.created_by_household != null && recipe.created_by_household === viewer.householdId;
}

/** Only the curator approves, and only what is still waiting. */
export function canApproveRecipe(viewer, recipe) {
  return Boolean(viewer?.isCurator && recipe?.catalogue_status === 'pending');
}

/** Curator contributions go straight into the shared catalogue; everyone else's wait for approval. */
export function initialCatalogueStatus(viewer) {
  return viewer.isCurator ? 'public' : 'pending';
}
