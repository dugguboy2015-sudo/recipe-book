// Recipe id 2 ("Aloo Paratha Roll with Ketchup") lost both its ingredients AND its method to the
// known edit-flattening bug (BUG-5/BUG-10, confirmed in §1.4) before this project started: the
// stored data is literally "asDfasdf" / "asdfasdf". There is nothing left to recover it from, so
// it is skipped rather than fabricated wholesale — flagged in docs/progress.md for the owner to
// re-enter by hand. This is the one live recipe without recipe_ingredients rows after this phase.
export const SKIP_RECIPES = [2];

// Ids 4, 12 and 27 lost some or all of their stored ingredients to the same bug, but their method
// text is intact and specific enough to reconstruct a reasonable ingredient list with judgment-based
// quantities (flagged as reconstructed, not recovered, in docs/progress.md).
export const RECONSTRUCTED_GROUPS = {
  4: { // Basundi — ingredients was []; steps: simmer milk, add sugar, saffron milk, cardamom, nuts.
    mode: 'replace',
    groups: [
      { group: 'For the basundi', items: [
        { name: 'full-fat milk', unit: 'cup', amount: 4 },
        { name: 'sugar', unit: 'tbsp', amount: 4 },
        { name: 'saffron strands, soaked in 1 tbsp warm milk', unit: 'tsp', amount: 0.25 },
        { name: 'cardamom powder', unit: 'tsp', amount: 0.25 },
        { name: 'chopped pistachios', unit: 'tbsp', amount: 1 },
        { name: 'chopped almonds', unit: 'tbsp', amount: 1 },
        { name: 'chopped cashews, optional', unit: 'tbsp', amount: 1 },
      ] },
    ],
  },
  12: { // Kothimbir Vadi — only the tempering group survived; the batter is described in full in
        // the method (coriander, gram flour, rice flour, ginger-garlic, chillies, spices, sugar, lemon).
    mode: 'prepend',
    groups: [
      { group: 'For the batter', items: [
        { name: 'fresh coriander leaves, finely chopped', unit: 'cup', amount: 1 },
        { name: 'gram flour (besan)', unit: 'cup', amount: 1 },
        { name: 'rice flour', unit: 'tbsp', amount: 2 },
        { name: 'ginger-garlic paste', unit: 'tsp', amount: 1 },
        { name: 'chillies, finely chopped', unit: 'green', amount: 2 },
        { name: 'turmeric powder', unit: 'tsp', amount: 0.25 },
        { name: 'red chilli powder', unit: 'tsp', amount: 0.5 },
        { name: 'carom seeds (ajwain)', unit: 'tsp', amount: 0.25 },
        { name: 'sugar', unit: 'tsp', amount: 1 },
        { name: 'lemon juice', unit: 'tsp', amount: 1 },
        { name: 'Salt, to taste', unit: '', amount: null },
        { name: 'Water, as needed to make a thick, spoonable batter', unit: '', amount: null },
      ] },
    ],
  },
  27: { // Shrikhand — ingredients was []; steps: strain yoghurt, sugar, saffron milk, cardamom, nuts.
    mode: 'replace',
    groups: [
      { group: 'For the shrikhand', items: [
        { name: 'thick yoghurt (curd), to strain into hung curd', unit: 'cup', amount: 2 },
        { name: 'sugar', unit: 'cup', amount: 0.25 },
        { name: 'saffron strands, soaked in 1 tbsp warm milk', unit: 'tsp', amount: 0.25 },
        { name: 'cardamom powder', unit: 'tsp', amount: 0.25 },
        { name: 'chopped pistachios', unit: 'tbsp', amount: 1 },
        { name: 'chopped almonds', unit: 'tbsp', amount: 1 },
      ] },
    ],
  },
};

// Per-recipe, per-flat-index overrides for lines the auto-matcher (name/alias substring match,
// tbsp/tsp/cup-only unit conversion) can't resolve correctly on its own: headers, descriptor-as-unit
// source data ("medium", "green", "dried", ...), OCR-dropped range digits ("–8 puri" with the real
// count in the amount field), and ingredient-name collisions (a line mentioning two dictionary
// ingredients, e.g. "ghee or oil", where the auto-matcher would otherwise guess). For an "X or Y"
// alternative, the ingredient named first is used as canonical, with the alternative kept in `prep`.
// Filled in against the build script's "no match" / "AMBIGUOUS" error list, then spot-checked
// against migrations/data/ingredients_backfill.json.
export const OVERRIDES = {
  1: {
    4: { ing: 'potato', qty: 4, unit: 'piece', prep: 'medium, boiled, peeled, and mashed' },
    6: { ing: 'green chilli', qty: 1, unit: 'piece', prep: 'finely chopped' },
    8: { ing: 'cumin seeds' },
    12: { ing: 'dried mango powder' },
    14: { ing: 'ghee' },
    15: { header: 'To serve' },
    17: { ing: 'pickle' },
  },
  3: {
    0: { ing: 'aubergine', qty: 2, unit: 'piece', prep: 'large' },
    3: { ing: 'onion', qty: 1, unit: 'piece', prep: 'medium, finely chopped' },
    5: { ing: 'green chilli', qty: 2, unit: 'piece', prep: 'finely chopped' },
    6: { ing: 'tomato', qty: 2, unit: 'piece', prep: 'medium, finely chopped' },
  },
  4: {
    2: { ing: 'saffron' },
  },
  5: {
    1: { ing: 'sev' },
    2: { ing: 'puri', qty: 6, unit: 'piece', prep: 'small round crisp, check label, see egg-check note, crushed roughly' },
    3: { ing: 'onion', qty: 1, unit: 'piece', prep: 'small, finely chopped' },
    4: { ing: 'tomato', qty: 1, unit: 'piece', prep: 'medium, finely chopped' },
    5: { ing: 'potato', qty: 1, unit: 'piece', prep: 'small, boiled and diced' },
    16: { ing: 'green chilli', qty: 1, unit: 'piece' },
    19: { ing: 'water', qty: 2, unit: 'tbsp', prep: 'for blending', scales: false },
    20: { header: 'To finish' },
  },
  6: {
    0: { ing: 'okra', qty: 20, unit: 'piece', prep: 'medium, washed, thoroughly dried, trimmed and sliced' },
    3: { ing: 'onion', qty: 1, unit: 'piece', prep: 'medium, finely chopped' },
    4: { ing: 'tomato', qty: 2, unit: 'piece', prep: 'medium, finely chopped' },
  },
  7: {
    8: { ing: 'green chilli', qty: 1, unit: 'piece' },
    11: { ing: 'water', qty: 2, unit: 'tbsp', prep: 'for blending', scales: false },
    12: { header: 'To finish' },
  },
  8: {
    4: { ing: 'ghee' },
    7: { ing: 'garlic', qty: 2, unit: 'clove', prep: 'finely chopped' },
    8: { ing: 'dried red chilli', qty: 1, unit: 'piece', prep: 'or 1 chopped green chilli' },
    10: { ing: 'onion', qty: 1, unit: 'piece', prep: 'small, finely chopped' },
    11: { ing: 'tomato', qty: 1, unit: 'piece', prep: 'medium, finely chopped' },
    16: { ing: 'ghee' },
    17: { ing: 'cumin seeds', qty: 0.5, unit: 'tsp' },
    18: { ing: 'bay leaf', qty: 1, unit: 'piece' },
    19: { ing: 'cinnamon stick', qty: 1, unit: 'inch', prep: 'and 2-3 cloves, optional whole spices', optional: true },
    21: { ing: 'water' },
  },
  9: {
    6: { ing: 'water', qty: 2, unit: 'tbsp', prep: 'as needed to make a thick coating batter', scales: false },
    11: { ing: 'green chilli', qty: 2, unit: 'piece', prep: 'slit' },
    12: { ing: 'onion', qty: 1, unit: 'piece', prep: 'medium, cut into chunky petals' },
    13: { ing: 'pepper', qty: 1, unit: 'piece', prep: 'green, medium, cut into chunky squares' },
    20: { ing: 'cornflour' },
    21: { ing: 'spring onion', qty: 2, unit: 'piece', prep: 'sliced, green and white parts separated, for garnish and cooking' },
    25: { ing: 'carrot', prep: 'finely chopped mixed vegetables — carrot, French beans, sweetcorn, diced small' },
    27: { ing: 'spring onion', qty: 2, unit: 'piece', prep: 'sliced, white and green parts separated' },
    31: { ing: 'salt' },
  },
  10: {
    1: { ing: 'ghee' },
    3: { ing: 'water', prep: 'a few ice cubes, kept in the mixing bowl while beating the batter', scales: false },
    8: { ing: 'basundi' },
    12: { ing: 'ghee' },
  },
  11: {
    5: { ing: 'curry leaves', qty: 10, unit: 'piece' },
    6: { ing: 'green chilli', qty: 2, unit: 'piece', prep: 'slit or finely chopped' },
    8: { header: 'Main ingredients' },
    9: { ing: 'onion', qty: 1, unit: 'piece', prep: 'medium, finely chopped' },
    10: { ing: 'potato', qty: 1, unit: 'piece', prep: 'medium, finely diced, optional but common in home-style versions', optional: true },
    14: { header: 'To finish' },
  },
  12: {
    4: { ing: 'green chilli', qty: 2, unit: 'piece', prep: 'finely chopped' },
    15: { ing: 'curry leaves', qty: 8, unit: 'piece' },
  },
  13: {
    7: { ing: 'curry leaves', qty: 10, unit: 'piece' },
    8: { ing: 'dried red chilli', qty: 2, unit: 'piece', prep: 'broken, or 2 green chillies, slit' },
    11: { header: 'Main seasoning' },
  },
  14: {
    2: { ing: 'curry leaves', qty: 8, unit: 'piece' },
    3: { ing: 'onion', qty: 1, unit: 'piece', prep: 'medium, finely chopped' },
    5: { ing: 'malvani masala', qty: 2, unit: 'tbsp', prep: 'shop-bought paste or powder' },
    7: { ing: 'coconut' },
    8: { ing: 'tomato', qty: 2, unit: 'piece', prep: 'medium, chopped' },
    9: { ing: 'potato', qty: 1, unit: 'piece', prep: 'medium, cubed' },
    10: { ing: 'aubergine', qty: 1, unit: 'piece', prep: 'small, cubed' },
    11: { ing: 'green beans', qty: 8, unit: 'piece', prep: 'cut into pieces' },
    14: { ing: 'jaggery', optional: true },
  },
  15: {
    0: { ing: 'oil' },
    4: { ing: 'curry leaves', qty: 8, unit: 'piece', optional: true, prep: 'adds authentic flavour' },
    5: { ing: 'green chilli', qty: 1, unit: 'piece', prep: 'finely chopped' },
    6: { ing: 'avocado', qty: 2, unit: 'piece', prep: 'ripe, medium' },
    7: { ing: 'tomato', qty: 1, unit: 'piece', prep: 'small, finely chopped, deseeded if you prefer less liquid' },
    15: { header: 'To serve' },
    16: { ing: 'bread', qty: 8, unit: 'piece', prep: 'slice, sourdough or granary work well' },
    17: { ing: 'onion', optional: true, prep: 'a few thin slices, or radish, for garnish' },
  },
  16: {
    2: { ing: 'onion', qty: 1, unit: 'piece', prep: 'small, finely chopped' },
    4: { ing: 'tomato', qty: 1, unit: 'piece', prep: 'small, finely chopped' },
    9: { ing: 'salt' },
    11: { ing: 'bread', qty: 8, unit: 'piece', prep: 'slice, check label, see egg-check note' },
    12: { ing: 'butter' },
  },
  17: {
    5: { ing: 'green chilli', qty: 1, unit: 'piece', prep: 'finely chopped', optional: true },
    10: { ing: 'bread', qty: 8, unit: 'piece', prep: 'slice, check label, see egg-check note' },
  },
  18: {
    4: { ing: 'fenugreek seeds', qty: 0.5, unit: 'tsp' },
    7: { ing: 'oil' },
    8: { ing: 'potato', qty: 4, unit: 'piece', prep: 'medium, boiled and peeled' },
    15: { ing: 'curry leaves', qty: 8, unit: 'piece' },
    16: { ing: 'green chilli', qty: 2, unit: 'piece', prep: 'slit or chopped' },
    17: { ing: 'onion', qty: 1, unit: 'piece', prep: 'medium, thinly sliced' },
  },
  19: {
    0: { ing: 'potato', qty: 4, unit: 'piece', prep: 'medium, starchy like Maris Piper, peeled and coarsely grated' },
    1: { ing: 'onion', qty: 1, unit: 'piece', prep: 'small, finely chopped' },
    2: { ing: 'green chilli', qty: 1, unit: 'piece', prep: 'finely chopped' },
    10: { ing: 'gram flour', prep: 'or cornflour, as a binder' },
  },
  20: {
    2: { ing: 'fenugreek leaves' },
    6: { ing: 'green chilli', qty: 1, unit: 'piece', prep: 'finely chopped' },
  },
  21: {
    0: { ing: 'coconut' },
  },
  22: {
    11: { header: 'Vegetables for grilling' },
    12: { ing: 'onion', qty: 1, unit: 'piece', prep: 'medium, cut into chunky petals' },
    13: { ing: 'pepper', qty: 1, unit: 'piece', prep: 'red or green, medium, cut into chunky squares' },
    21: { ing: 'tortilla', qty: 4, unit: 'piece', prep: 'check label, see egg-check note' },
    22: { ing: 'oil' },
    23: { ing: 'cabbage', prep: 'shredded, or lettuce' },
    24: { ing: 'onion', qty: 1, unit: 'piece', prep: 'small, thinly sliced, for filling, separate from grilling onion' },
    25: { ing: 'tomato', qty: 1, unit: 'piece', prep: 'small, thinly sliced or deseeded and chopped' },
  },
  23: {
    11: { header: 'Vegetables for grilling' },
    12: { ing: 'onion', qty: 1, unit: 'piece', prep: 'medium, cut into chunky petals' },
    13: { ing: 'pepper', qty: 1, unit: 'piece', prep: 'medium, cut into chunky squares' },
    19: { ing: 'ghee' },
    27: { ing: 'cabbage', prep: 'shredded, or lettuce' },
    28: { ing: 'onion', qty: 1, unit: 'piece', prep: 'small, thinly sliced' },
  },
  24: {
    6: { ing: 'plain flour', prep: 'or a mix of plain flour and whole wheat flour' },
  },
  25: {
    0: { ing: 'noodles' },
    1: { ing: 'oil' },
    2: { ing: 'dried red chilli', qty: 10, unit: 'piece', prep: 'soaked in hot water for 20 minutes' },
    11: { ing: 'water', qty: 2, unit: 'tbsp', prep: 'as needed to blend', scales: false },
    15: { ing: 'onion', qty: 1, unit: 'piece', prep: 'medium, thinly sliced' },
    16: { ing: 'pepper', qty: 1, unit: 'piece', prep: 'any colour, medium, thinly sliced' },
    22: { ing: 'salt' },
  },
  26: {
    8: { ing: 'green chilli', qty: 1, unit: 'piece' },
    11: { ing: 'water', qty: 2, unit: 'tbsp', prep: 'for blending', scales: false },
    12: { header: 'To finish' },
  },
  27: {
    2: { ing: 'saffron' },
  },
  28: {
    0: { ing: 'potato', qty: 4, unit: 'piece', prep: 'medium, boiled and mashed' },
    5: { ing: 'curry leaves', qty: 8, unit: 'piece' },
    7: { ing: 'green chilli', qty: 2, unit: 'piece', prep: 'finely chopped' },
    19: { ing: 'bread roll', qty: 4, unit: 'piece', prep: 'check label, see egg-check note' },
    20: { ing: 'mint-coriander chutney' },
    21: { ing: 'dry garlic chutney' },
  },
  29: {
    6: { ing: 'green chilli', qty: 1, unit: 'piece', prep: 'finely chopped' },
    9: { ing: 'salt', prep: 'and black pepper, to taste' },
    10: { ing: 'water', qty: 2, unit: 'tbsp', prep: 'only if needed to bind, add gradually', optional: true, scales: false },
    15: { ing: 'green chilli', qty: 2, unit: 'piece', prep: 'slit' },
    16: { ing: 'onion', qty: 1, unit: 'piece', prep: 'small, cut into chunky petals' },
    17: { ing: 'pepper', qty: 1, unit: 'piece', prep: 'small, cut into chunky squares' },
    24: { ing: 'cornflour' },
    26: { ing: 'spring onion', qty: 2, unit: 'piece', prep: 'sliced, green part, for garnish' },
    30: { ing: 'carrot', prep: 'finely chopped mixed vegetables — carrot, French beans, sweetcorn, diced small' },
    32: { ing: 'spring onion', qty: 2, unit: 'piece', prep: 'sliced, white and green parts separated' },
    36: { ing: 'salt' },
  },
  30: {
    0: { ing: 'dried red chilli', qty: 6, unit: 'piece', prep: 'kashmiri, for colour, soaked in hot water for 15 minutes' },
    1: { ing: 'dried red chilli', qty: 2, unit: 'piece', prep: 'regular, for heat, soaked alongside' },
    5: { ing: 'black peppercorns', qty: 4, unit: 'piece' },
    6: { ing: 'cloves', qty: 2, unit: 'clove' },
    7: { ing: 'cinnamon stick', qty: 1, unit: 'inch' },
    8: { ing: 'water', qty: 2, unit: 'tbsp', prep: 'for grinding', scales: false },
    11: { ing: 'onion', qty: 1, unit: 'piece', prep: 'medium, finely chopped' },
    13: { ing: 'tomato', qty: 2, unit: 'piece', prep: 'medium, chopped' },
    15: { ing: 'potato', qty: 1, unit: 'piece', prep: 'medium, cubed' },
    16: { ing: 'carrot', qty: 1, unit: 'piece', prep: 'medium, sliced' },
    17: { ing: 'green beans', qty: 8, unit: 'piece', prep: 'cut into pieces' },
  },
};
