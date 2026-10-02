import { describe, expect, it } from 'vitest';
import {
  filtersToSearchParams, searchParamsToFilters,
  recipeSearchParams, parseRecipeParams, preserveRecipeParams,
  plannerSearchParams, parsePlannerParams,
} from '../../public/js/lib/url-state.js';

function defaultFilters() {
  return {
    search: '', cuisine: '', tags: [], mealTypes: [],
    dairyFree: false, proteinSmart: false, nutFree: false, spiceMax: null, pendingOnly: false,
  };
}

describe('filtersToSearchParams', () => {
  it('omits every key for default (empty) filters and page 1', () => {
    expect(filtersToSearchParams(defaultFilters(), 1).toString()).toBe('');
  });

  it('round-trips a fully populated filter set', () => {
    const filters = {
      search: 'poha', cuisine: 'Maharashtrian', tags: ['Snack', 'Quick'], mealTypes: ['Breakfast', 'Packed Lunch'],
      dairyFree: true, proteinSmart: true, nutFree: true, spiceMax: 3, pendingOnly: true,
    };
    const params = filtersToSearchParams(filters, 2);
    expect(searchParamsToFilters(params)).toEqual(filters);
  });

  it('omits page when it is 1', () => {
    expect(filtersToSearchParams(defaultFilters(), 1).has('page')).toBe(false);
  });
});

describe('searchParamsToFilters', () => {
  it('defaults to page 1 and empty filters with no params', () => {
    const params = new URLSearchParams('');
    expect(searchParamsToFilters(params)).toEqual(defaultFilters());
  });

  // P4 replaced paging with "Show more", so a page number in the URL describes nothing a reload
  // could restore: ?page=3 would have shown recipes 25-31 alone, with no way back to the first 24.
  it('no longer writes a page number', () => {
    const params = filtersToSearchParams({ search: 'dal', tags: [], mealTypes: [] });
    expect(params.has('page')).toBe(false);
  });

  it('ignores a page number left over in an old link', () => {
    expect(searchParamsToFilters(new URLSearchParams('q=dal&page=3')))
      .toEqual({ ...defaultFilters(), search: 'dal' });
  });
});

describe('recipe params (P2)', () => {
  it('round-trips a slug and the servings being viewed', () => {
    const params = recipeSearchParams('aloo-paratha', 6);
    expect(params.toString()).toBe('recipe=aloo-paratha&serves=6');
    expect(parseRecipeParams(params)).toEqual({ slug: 'aloo-paratha', serves: 6 });
  });

  it('leaves servings out when they are the recipe default', () => {
    expect(recipeSearchParams('basundi', null).toString()).toBe('recipe=basundi');
    expect(parseRecipeParams(new URLSearchParams('recipe=basundi'))).toEqual({ slug: 'basundi', serves: null });
  });

  it('ignores nonsense servings rather than trusting the URL', () => {
    expect(parseRecipeParams(new URLSearchParams('recipe=x&serves=0')).serves).toBeNull();
    expect(parseRecipeParams(new URLSearchParams('recipe=x&serves=-3')).serves).toBeNull();
    expect(parseRecipeParams(new URLSearchParams('recipe=x&serves=lots')).serves).toBeNull();
  });

  it('reports no recipe when the URL names none', () => {
    expect(parseRecipeParams(new URLSearchParams('q=paneer'))).toEqual({ slug: null, serves: null });
  });

  // The bug this exists to prevent: the filters are rebuilt from scratch on every change, which
  // used to wipe ?recipe= off the address bar the moment the page loaded.
  it('carries the open recipe through a filter rebuild', () => {
    const rebuilt = filtersToSearchParams({ search: 'paneer', tags: [] }, 1);
    const merged = preserveRecipeParams(rebuilt, new URLSearchParams('recipe=chilli-paneer&serves=6&q=stale'));
    expect(merged.get('recipe')).toBe('chilli-paneer');
    expect(merged.get('serves')).toBe('6');
    expect(merged.get('q')).toBe('paneer');
  });

  it('adds nothing when no recipe is open', () => {
    const merged = preserveRecipeParams(filtersToSearchParams({ search: 'dal', tags: [] }, 1), new URLSearchParams(''));
    expect(merged.has('recipe')).toBe(false);
    expect(merged.toString()).toBe('q=dal');
  });
});

describe('planner params (P2)', () => {
  it('names the view and the date', () => {
    expect(plannerSearchParams('month', '2026-10-02').toString()).toBe('view=month&date=2026-10-02');
  });

  it('leaves the default view out of the URL', () => {
    expect(plannerSearchParams('week', '2026-10-02').toString()).toBe('date=2026-10-02');
  });

  it('round-trips', () => {
    expect(parsePlannerParams(new URLSearchParams('view=day&date=2026-10-02')))
      .toEqual({ viewMode: 'day', selectedDate: '2026-10-02' });
  });

  it('refuses a view or date the app does not understand', () => {
    expect(parsePlannerParams(new URLSearchParams('view=year&date=tomorrow')))
      .toEqual({ viewMode: null, selectedDate: null });
    // Shape alone is not enough: month 13 would reach parseLocalDate and become an Invalid Date.
    expect(parsePlannerParams(new URLSearchParams('date=2026-13-45')).selectedDate).toBeNull();
    expect(parsePlannerParams(new URLSearchParams('date=2026-02-30')).selectedDate).toBeNull();
  });
});
