import { describe, expect, it, vi } from 'vitest';
import { evaluateDraft } from '../../functions/_lib/ai/evaluate-draft.js';

function fakeDb() {
  return {
    request: vi.fn(async (path) => {
      if (path.startsWith('ingredients?')) return { data: [] };
      if (path.startsWith('ingredient_aliases?')) return { data: [] };
      if (path === 'rpc/match_ingredient') return { data: [] };
      throw new Error(`unexpected path: ${path}`);
    }),
  };
}

function baseDraft(overrides = {}) {
  return {
    name: 'Paneer Butter Masala',
    serves: 4,
    is_vegetarian: true,
    is_egg_free: true,
    contains_dairy: true,
    ingredients: [{ group: 'Ingredients', items: [{ name: 'paneer', category: 'dairy', quantity: 1, unit: 'cup', preparation: '', optional: false }] }],
    steps: [{ group: 'Method', steps: ['Cook it.'] }],
    protein_g: 20, calories_kcal: 350, carbs_g: 30, sugars_g: 5, fibre_g: 4, fat_g: 15, saturates_g: 6, salt_g: 1,
    total_time_minutes: 30, prep_time_minutes: 10, cook_time_minutes: 20,
    ...overrides,
  };
}

describe('evaluateDraft — structural hard failures', () => {
  it.each([
    ['missing name', baseDraft({ name: '' }), 'missing name'],
    ['zero ingredients', baseDraft({ ingredients: [] }), 'zero ingredients'],
    ['zero steps', baseDraft({ steps: [{ group: 'Method', steps: [] }] }), 'zero steps'],
    ['missing dietary boolean', baseDraft({ is_vegetarian: undefined }), 'missing a dietary boolean'],
  ])('%s', async (_label, draft, expected) => {
    const result = await evaluateDraft(fakeDb(), draft, {});
    expect(result.hardFailure).toBe(expected);
  });

  it('does not touch the database when there is a structural hard failure', async () => {
    const db = fakeDb();
    await evaluateDraft(db, baseDraft({ name: '' }), {});
    expect(db.request).not.toHaveBeenCalled();
  });
});

describe('evaluateDraft — household hard rule (Appendix I)', () => {
  it('flags is_vegetarian:false as a household issue, not a warning', async () => {
    const result = await evaluateDraft(fakeDb(), baseDraft({ is_vegetarian: false }), {});
    expect(result.hardFailure).toBeNull();
    expect(result.householdIssues.some((i) => i.includes('vegetarian'))).toBe(true);
    expect(result.retryFeedback).toContain('vegetarian');
  });

  it('flags meat evidence in ingredients as a household issue even when is_vegetarian claims true', async () => {
    const draft = baseDraft({ ingredients: [{ group: 'G', items: [{ name: 'chicken breast', category: 'plant_protein', quantity: 1, unit: 'piece', preparation: '', optional: false }] }] });
    const result = await evaluateDraft(fakeDb(), draft, {});
    expect(result.householdIssues.some((i) => i.includes('chicken'))).toBe(true);
  });

  it('a fully vegetarian, egg-free draft has no household issues', async () => {
    const result = await evaluateDraft(fakeDb(), baseDraft(), {});
    expect(result.householdIssues).toEqual([]);
    expect(result.retryFeedback).toBeNull();
  });
});

describe('evaluateDraft — nutrition', () => {
  it('flags a missing nutrition field as a nutrition issue', async () => {
    const result = await evaluateDraft(fakeDb(), baseDraft({ protein_g: null }), {});
    expect(result.nutritionIssues.some((i) => i.includes('protein_g'))).toBe(true);
  });

  it('warns nutrition_inconsistent when calories are off by more than 20% from the J.4 calculation', async () => {
    const result = await evaluateDraft(fakeDb(), baseDraft({ calories_kcal: 2000 }), {});
    expect(result.warnings.some((w) => w.code === 'nutrition_inconsistent' && w.field === 'calories_kcal')).toBe(true);
  });

  it('warns when sugars_g exceeds carbs_g', async () => {
    const result = await evaluateDraft(fakeDb(), baseDraft({ sugars_g: 40, carbs_g: 30 }), {});
    expect(result.warnings.some((w) => w.field === 'sugars_g' && w.code === 'nutrition_inconsistent')).toBe(true);
  });
});

describe('evaluateDraft — constraints, times, name collision', () => {
  it('warns constraint_violation when the caller asked for vegetarian but got a non-vegetarian draft', async () => {
    const result = await evaluateDraft(fakeDb(), baseDraft({ is_vegetarian: false }), { constraints: { vegetarian: true } });
    expect(result.warnings.some((w) => w.code === 'constraint_violation' && w.field === 'is_vegetarian')).toBe(true);
  });

  it('warns times_adjusted when total is less than prep + cook', async () => {
    const result = await evaluateDraft(fakeDb(), baseDraft({ prep_time_minutes: 20, cook_time_minutes: 20, total_time_minutes: 10 }), {});
    expect(result.warnings.some((w) => w.code === 'times_adjusted')).toBe(true);
  });

  it('warns name_exists when findExistingBySlug resolves a match', async () => {
    const findExistingBySlug = vi.fn(async () => ({ id: 7, name: 'Paneer Butter Masala' }));
    const result = await evaluateDraft(fakeDb(), baseDraft(), { findExistingBySlug });
    expect(findExistingBySlug).toHaveBeenCalledWith('paneer-butter-masala');
    expect(result.warnings.some((w) => w.code === 'name_exists')).toBe(true);
  });
});

describe('evaluateDraft — protein goal (J.2/J.3)', () => {
  it('flags a goal issue when the effective goal is protein_smart but the draft misses J.2', async () => {
    const result = await evaluateDraft(fakeDb(), baseDraft({ protein_g: 5 }), { effectiveGoal: 'protein_smart' });
    expect(result.proteinSmart).toBe(false);
    expect(result.goalIssue).toContain('15 g');
  });

  it('does not require protein-smart when the effective goal is balanced', async () => {
    const result = await evaluateDraft(fakeDb(), baseDraft({ protein_g: 5 }), { effectiveGoal: 'balanced' });
    expect(result.goalIssue).toBeNull();
  });

  it('combines a household issue and a goal issue into one retryFeedback message (one message covers both)', async () => {
    const result = await evaluateDraft(fakeDb(), baseDraft({ is_vegetarian: false, protein_g: 5 }), { effectiveGoal: 'protein_smart' });
    expect(result.householdIssues.length).toBeGreaterThan(0);
    expect(result.goalIssue).not.toBeNull();
    expect(result.retryFeedback).toContain('vegetarian');
    expect(result.retryFeedback).toContain('15 g');
  });
});
