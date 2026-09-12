import { describe, expect, it } from 'vitest';
import { formatIngredientsHtml } from '../../public/js/shared/cook-mode-format.js';

describe('formatIngredientsHtml', () => {
  it('scales quantities and escapes ingredient names', () => {
    const groups = [
      {
        group: 'For the dough',
        items: [
          { ingredientName: 'Whole wheat flour', quantity: 1.5, unit: 'cup', preparation: '', isOptional: false, scales: true },
          { ingredientName: '<Salt>', quantity: null, unit: 'to_taste', preparation: 'fine', isOptional: true, scales: true },
        ],
      },
    ];
    const html = formatIngredientsHtml(groups, 8, 4);
    expect(html).toContain('For the dough');
    expect(html).toContain('3 cups Whole wheat flour'); // 1.5 cup at 4 servings -> 3 cups at 8
    expect(html).toContain('&lt;Salt&gt;, fine (optional)');
  });

  it('returns an empty string for no groups', () => {
    expect(formatIngredientsHtml([], 4, 4)).toBe('');
  });
});
