import { describe, expect, it } from 'vitest';
import { draftIngredientsToEditorGroups, groupWarningsByField } from '../../public/js/shared/draft-adapter.js';

describe('draftIngredientsToEditorGroups', () => {
  it('maps a resolved (existing) ingredient by id and name', () => {
    const groups = draftIngredientsToEditorGroups([
      { group: 'Ingredients', items: [{ ingredient: { id: 31, name: 'paneer' }, quantity: 1, unit: 'cup', preparation: 'cubed', is_optional: false }] },
    ]);
    expect(groups[0].items[0]).toMatchObject({ ingredientId: 31, ingredientName: 'paneer', quantity: 1, unit: 'cup', preparation: 'cubed', isOptional: false });
  });

  it('maps a new ingredient by name, carrying its flags and category', () => {
    const groups = draftIngredientsToEditorGroups([
      { group: 'Ingredients', items: [{ ingredient: { name: 'kasuri methi', isNew: true, category: 'herb', flags: { contains_meat: false } }, quantity: null, unit: 'to_taste', preparation: null, is_optional: false }] },
    ]);
    expect(groups[0].items[0]).toMatchObject({ ingredientId: null, ingredientName: 'kasuri methi', category: 'herb', ingredientFlags: { contains_meat: false } });
  });

  it('never marks a resolved match as reviewed (AI matches are never pre-trusted)', () => {
    const groups = draftIngredientsToEditorGroups([{ group: 'G', items: [{ ingredient: { id: 1, name: 'rice' }, quantity: 1, unit: 'cup', preparation: '', is_optional: false }] }]);
    expect(groups[0].items[0].ingredientReviewed).toBe(false);
  });

  it('returns an empty array for no ingredients', () => {
    expect(draftIngredientsToEditorGroups([])).toEqual([]);
    expect(draftIngredientsToEditorGroups(undefined)).toEqual([]);
  });
});

describe('groupWarningsByField', () => {
  it('groups warnings by their field, defaulting to "general"', () => {
    const warnings = [
      { field: 'is_egg_free', code: 'dietary_contradiction', message: 'a' },
      { field: 'is_egg_free', code: 'constraint_violation', message: 'b' },
      { code: 'times_adjusted', message: 'c' },
    ];
    const byField = groupWarningsByField(warnings);
    expect(byField.get('is_egg_free')).toHaveLength(2);
    expect(byField.get('general')).toHaveLength(1);
  });

  it('returns an empty map for no warnings', () => {
    expect(groupWarningsByField([]).size).toBe(0);
    expect(groupWarningsByField(undefined).size).toBe(0);
  });
});
