import { describe, expect, it } from 'vitest';
import { canApproveRecipe } from '../../public/js/shared/permissions.js';

// canEditRecipe and initialCatalogueStatus are covered through the Functions that enforce them
// (tests/functions/m1c-permissions.test.js); this is the one rule only the browser uses.
describe('canApproveRecipe', () => {
  const curator = { householdId: 'a', isCurator: true };
  const member = { householdId: 'b', isCurator: false };

  it('offers approval only to the curator, only for pending recipes', () => {
    expect(canApproveRecipe(curator, { catalogue_status: 'pending' })).toBe(true);
    expect(canApproveRecipe(curator, { catalogue_status: 'public' })).toBe(false);
    expect(canApproveRecipe(member, { catalogue_status: 'pending' })).toBe(false);
    expect(canApproveRecipe(null, { catalogue_status: 'pending' })).toBe(false);
  });
});
