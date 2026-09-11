import { describe, expect, it } from 'vitest';
import { filtersToSearchParams, searchParamsToFilters, searchParamsToPage } from '../../public/js/lib/url-state.js';

function defaultFilters() {
  return {
    search: '', cuisine: '', tags: [], mealTypes: [],
    vegetarian: false, eggFree: false, dairyFree: false, proteinSmart: false, nutFree: false, spiceMax: null,
  };
}

describe('filtersToSearchParams', () => {
  it('omits every key for default (empty) filters and page 1', () => {
    expect(filtersToSearchParams(defaultFilters(), 1).toString()).toBe('');
  });

  it('round-trips a fully populated filter set', () => {
    const filters = {
      search: 'poha', cuisine: 'Maharashtrian', tags: ['Snack', 'Quick'], mealTypes: ['Breakfast', 'Packed Lunch'],
      vegetarian: true, eggFree: true, dairyFree: true, proteinSmart: true, nutFree: true, spiceMax: 3,
    };
    const params = filtersToSearchParams(filters, 2);
    expect(searchParamsToFilters(params)).toEqual(filters);
    expect(searchParamsToPage(params)).toBe(2);
  });

  it('omits page when it is 1', () => {
    expect(filtersToSearchParams(defaultFilters(), 1).has('page')).toBe(false);
  });
});

describe('searchParamsToFilters / searchParamsToPage', () => {
  it('defaults to page 1 and empty filters with no params', () => {
    const params = new URLSearchParams('');
    expect(searchParamsToFilters(params)).toEqual(defaultFilters());
    expect(searchParamsToPage(params)).toBe(1);
  });

  it('ignores a non-numeric or zero/negative page', () => {
    expect(searchParamsToPage(new URLSearchParams('page=abc'))).toBe(1);
    expect(searchParamsToPage(new URLSearchParams('page=0'))).toBe(1);
    expect(searchParamsToPage(new URLSearchParams('page=-3'))).toBe(1);
  });
});
