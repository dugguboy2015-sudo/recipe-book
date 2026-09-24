// M3: which illustration a recipe gets. Pure and separate from the drawing itself so the matching
// can be unit-tested and reused (the art lives in components/dish-art.js).
//
// Matching is deliberately keyword-based on the recipe's own name, then its meal types: this
// catalogue names dishes plainly ("Dal Fry with Jeera Rice", "Masala Dosa"), and a keyword list is
// something the family can extend without touching the drawings.

/** Ordered: the first match wins, so more specific dishes come before general ones. */
export const DISH_TYPES = [
  { id: 'chaat', keywords: ['bhel', 'sev puri', 'dahi puri', 'pani puri', 'chaat', 'vada pav', 'pav bhaji'] },
  { id: 'dosa', keywords: ['dosa', 'uttapam', 'chilla', 'appam', 'crepe', 'pancake'] },
  { id: 'wrap', keywords: ['wrap', 'roll', 'kathi', 'burrito'] },
  { id: 'sandwich', keywords: ['sandwich', 'toast', 'burger', 'bun'] },
  { id: 'noodles', keywords: ['noodle', 'pasta', 'spaghetti', 'hakka', 'chow mein', 'ramen'] },
  { id: 'sweet', keywords: ['halwa', 'kheer', 'basundi', 'shrikhand', 'modak', 'ghevar', 'ladoo', 'laddu', 'barfi', 'poli', 'cake', 'pudding', 'ice cream'] },
  { id: 'fried-snack', keywords: ['vadi', 'vada', 'pakora', 'bhaji', 'samosa', 'cutlet', 'hash brown', 'fritter', 'tikki'] },
  { id: 'flatbread', keywords: ['roti', 'paratha', 'phulka', 'thepla', 'bhakri', 'naan', 'chapati', 'puri', 'thalipeeth'] },
  { id: 'rice', keywords: ['rice', 'poha', 'pulao', 'biryani', 'khichdi', 'upma', 'chitranna'] },
  { id: 'curry', keywords: ['curry', 'dal', 'sabzi', 'masala', 'bharta', 'kolhapuri', 'gravy', 'korma', 'rasam', 'sambar', 'soup', 'stew', 'manchurian', 'paneer', 'chana', 'rajma'] },
  { id: 'drink', keywords: ['lassi', 'chai', 'smoothie', 'juice', 'sherbet', 'thandai', 'coffee'] },
  { id: 'salad', keywords: ['salad', 'kachumber', 'raita', 'slaw'] },
];

const DISH_TYPE_IDS = new Set(DISH_TYPES.map((type) => type.id));

/**
 * The illustration id for a recipe, or null when nothing fits (the monogram still covers those).
 * A dish named after its main and its side ("Dal Fry with Jeera Rice") takes the main, because
 * the list is ordered by how much a word tells you about the dish.
 */
export function dishTypeFor(recipe) {
  const name = String(recipe?.name || '').toLowerCase();
  const mainCourse = name.split(/\bwith\b|,/)[0];
  for (const source of [mainCourse, name]) {
    for (const type of DISH_TYPES) {
      if (type.keywords.some((keyword) => source.includes(keyword))) return type.id;
    }
  }
  const mealTypes = Array.isArray(recipe?.meal_types) ? recipe.meal_types : recipe?.mealTypes || [];
  if (mealTypes.includes('Dessert')) return 'sweet';
  return null;
}

export function isDishType(id) {
  return DISH_TYPE_IDS.has(id);
}
