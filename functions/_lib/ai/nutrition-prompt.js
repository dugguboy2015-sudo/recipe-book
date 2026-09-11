import { displayQuantity, formatQuantity } from '../../../public/js/shared/units.js';

/** Appendix D.3: nutrition estimate messages for POST /api/recipes/estimate-nutrition. */
export function buildNutritionMessages({ name, serves, ingredientLines }) {
  const system = `You estimate per-serving nutrition for home-cooked vegetarian Indian and British recipes, using standard
UK/IN ingredient values. Units: 1 cup = 240 ml, 1 tbsp = 15 ml, 1 tsp = 5 ml. Return one JSON object
matching the schema. Keep the values consistent (calories ≈ 4×protein + 4×carbs + 9×fat + 2×fibre).
nutrition_basis must say "Per serving (1 of ${serves}). Estimate, not lab-tested."`;

  const user = `${name}\nServes ${serves}\n${ingredientLines.join('\n')}`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/** Formats one B.4 ingredient item as "1½ cups whole wheat flour, sifted" for the user message. */
export function formatIngredientLine(item, ingredientName) {
  const displayed = displayQuantity(item.quantity, item.unit);
  const amount = formatQuantity(displayed);
  const preparation = item.preparation ? `, ${item.preparation}` : '';
  return `${amount ? `${amount} ` : ''}${ingredientName}${preparation}`.trim();
}
