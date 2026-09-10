// Canonical ingredient dictionary for the Phase 3 backfill (Appendix A.12/E).
// key = canonical name (lowercase, singular, matches public.ingredients.name).
// Every ingredient states all five flags explicitly (DATA-1 principle: never defaulted).
export const ING = {
  // -- grains --
  'whole wheat flour':      { display_name: 'Whole wheat flour', category: 'grain_whole', meat: false, egg: false, dairy: false, nuts: false, gluten: true, aliases: ['atta', 'chapati flour'] },
  'bajra flour':             { display_name: 'Bajra flour (pearl millet)', category: 'grain_whole', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: ['pearl millet flour'] },
  'rice flour':              { display_name: 'Rice flour', category: 'grain_refined', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: [] },
  'plain flour':             { display_name: 'Plain flour', category: 'grain_refined', meat: false, egg: false, dairy: false, nuts: false, gluten: true, aliases: ['maida', 'all-purpose flour'] },
  'rice':                    { display_name: 'Rice', category: 'grain_refined', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: ['basmati rice', 'idli rice', 'white rice'] },
  'poha':                    { display_name: 'Poha (flattened rice)', category: 'grain_refined', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: ['flattened rice'] },
  'puffed rice':             { display_name: 'Puffed rice', category: 'grain_refined', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: ['murmura', 'kurmura'] },
  'cornflour':               { display_name: 'Cornflour', category: 'other', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: ['corn starch'] },
  'noodles':                 { display_name: 'Noodles (wheat)', category: 'grain_refined', meat: false, egg: false, dairy: false, nuts: false, gluten: true, aliases: ['hakka noodles'] },
  'bread':                   { display_name: 'Bread', category: 'grain_refined', meat: false, egg: false, dairy: false, nuts: false, gluten: true, aliases: [] },
  'tortilla':                { display_name: 'Tortilla / wrap', category: 'grain_refined', meat: false, egg: false, dairy: false, nuts: false, gluten: true, aliases: ['wrap'] },
  'bread roll':              { display_name: 'Bread roll (pav)', category: 'grain_refined', meat: false, egg: false, dairy: false, nuts: false, gluten: true, aliases: ['pav'] },
  'puri':                    { display_name: 'Puri (crisp fried disc)', category: 'grain_refined', meat: false, egg: false, dairy: false, nuts: false, gluten: true, aliases: [] },
  'sev':                     { display_name: 'Sev (gram flour noodles)', category: 'grain_refined', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: [] },

  // -- pulses / legumes --
  'toor dal':                { display_name: 'Toor dal (split pigeon peas)', category: 'pulse_legume', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: ['split pigeon peas'] },
  'chana dal':               { display_name: 'Chana dal (split Bengal gram)', category: 'pulse_legume', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: ['split bengal gram'] },
  'urad dal':                { display_name: 'Urad dal (split black gram)', category: 'pulse_legume', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: ['split black gram'] },
  'gram flour':              { display_name: 'Gram flour (besan)', category: 'pulse_legume', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: ['besan'] },
  'baked beans':             { display_name: 'Tinned baked beans', category: 'pulse_legume', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: [] },

  // -- dairy --
  'ghee':                    { display_name: 'Ghee', category: 'dairy', meat: false, egg: false, dairy: true, nuts: false, gluten: false, aliases: ['clarified butter'] },
  'curd':                    { display_name: 'Curd (yoghurt)', category: 'dairy', meat: false, egg: false, dairy: true, nuts: false, gluten: false, aliases: ['yoghurt', 'yogurt', 'dahi', 'thick yoghurt'] },
  'paneer':                  { display_name: 'Paneer', category: 'dairy', meat: false, egg: false, dairy: true, nuts: false, gluten: false, aliases: [] },
  'butter':                  { display_name: 'Butter', category: 'dairy', meat: false, egg: false, dairy: true, nuts: false, gluten: false, aliases: [] },
  'cheese':                  { display_name: 'Cheese', category: 'dairy', meat: false, egg: false, dairy: true, nuts: false, gluten: false, aliases: ['cheddar'] },
  'milk':                    { display_name: 'Milk', category: 'dairy', meat: false, egg: false, dairy: true, nuts: false, gluten: false, aliases: [] },
  'basundi':                 { display_name: 'Basundi / rabri', category: 'dairy', meat: false, egg: false, dairy: true, nuts: false, gluten: false, aliases: ['rabri'] },

  // -- vegetables (incl. fresh aromatics) --
  'onion':                   { display_name: 'Onion', category: 'vegetable', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: ['red onion'] },
  'spring onion':            { display_name: 'Spring onion', category: 'vegetable', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: [] },
  'potato':                  { display_name: 'Potato', category: 'vegetable', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: [] },
  'tomato':                  { display_name: 'Tomato', category: 'vegetable', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: [] },
  'aubergine':               { display_name: 'Aubergine', category: 'vegetable', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: ['baingan', 'eggplant'] },
  'okra':                    { display_name: 'Okra (bhindi)', category: 'vegetable', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: ['bhindi'] },
  'cabbage':                 { display_name: 'Cabbage', category: 'vegetable', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: [] },
  'carrot':                  { display_name: 'Carrot', category: 'vegetable', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: [] },
  'green beans':             { display_name: 'Green beans', category: 'vegetable', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: ['french beans'] },
  'peas':                    { display_name: 'Peas', category: 'vegetable', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: [] },
  'cauliflower':             { display_name: 'Cauliflower', category: 'vegetable', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: [] },
  'pepper':                  { display_name: 'Pepper (bell)', category: 'vegetable', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: ['capsicum', 'green pepper', 'red pepper'] },
  'green chilli':            { display_name: 'Green chilli', category: 'vegetable', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: [] },
  'ginger':                  { display_name: 'Ginger', category: 'vegetable', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: [] },
  'garlic':                  { display_name: 'Garlic', category: 'vegetable', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: [] },
  'ginger-garlic paste':     { display_name: 'Ginger-garlic paste', category: 'vegetable', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: [] },
  'avocado':                 { display_name: 'Avocado', category: 'fruit', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: [] },
  'sweetcorn':               { display_name: 'Sweetcorn', category: 'vegetable', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: ['corn'] },
  'radish':                  { display_name: 'Radish', category: 'vegetable', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: [] },
  'lettuce':                 { display_name: 'Lettuce', category: 'vegetable', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: [] },
  'coconut':                 { display_name: 'Coconut', category: 'other', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: ['desiccated coconut'] },

  // -- herbs --
  'coriander leaves':        { display_name: 'Fresh coriander leaves', category: 'herb', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: ['cilantro'] },
  'mint leaves':             { display_name: 'Fresh mint leaves', category: 'herb', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: [] },
  'curry leaves':            { display_name: 'Curry leaves', category: 'herb', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: [] },
  'fenugreek leaves':        { display_name: 'Fenugreek leaves (methi)', category: 'herb', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: ['methi leaves', 'kasoori methi'] },

  // -- nuts / seeds --
  'peanuts':                 { display_name: 'Roasted peanuts', category: 'nut_seed', meat: false, egg: false, dairy: false, nuts: true, gluten: false, aliases: ['groundnuts'] },
  'cashews':                 { display_name: 'Cashews', category: 'nut_seed', meat: false, egg: false, dairy: false, nuts: true, gluten: false, aliases: [] },
  'almonds':                 { display_name: 'Almonds', category: 'nut_seed', meat: false, egg: false, dairy: false, nuts: true, gluten: false, aliases: [] },
  'pistachios':              { display_name: 'Pistachios', category: 'nut_seed', meat: false, egg: false, dairy: false, nuts: true, gluten: false, aliases: [] },
  'sesame seeds':            { display_name: 'Sesame seeds', category: 'nut_seed', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: [] },
  'poppy seeds':             { display_name: 'Poppy seeds', category: 'nut_seed', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: ['khuskhus'] },

  // -- spices --
  'mustard seeds':           { display_name: 'Mustard seeds', category: 'spice', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: [] },
  'cumin seeds':             { display_name: 'Cumin seeds', category: 'spice', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: [] },
  'roasted cumin powder':    { display_name: 'Roasted cumin powder', category: 'spice', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: [] },
  'coriander seeds':         { display_name: 'Coriander seeds', category: 'spice', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: [] },
  'coriander powder':        { display_name: 'Coriander powder', category: 'spice', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: [] },
  'fenugreek seeds':         { display_name: 'Fenugreek seeds (methi)', category: 'spice', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: ['methi seeds'] },
  'carom seeds':             { display_name: 'Carom seeds (ajwain)', category: 'spice', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: ['ajwain'] },
  'black peppercorns':       { display_name: 'Black peppercorns', category: 'spice', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: [] },
  'black pepper powder':     { display_name: 'Black pepper powder', category: 'spice', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: [] },
  'cloves':                  { display_name: 'Cloves', category: 'spice', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: [] },
  'cinnamon stick':          { display_name: 'Cinnamon stick', category: 'spice', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: [] },
  'bay leaf':                { display_name: 'Bay leaf', category: 'spice', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: [] },
  'cardamom powder':         { display_name: 'Cardamom powder', category: 'spice', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: [] },
  'turmeric powder':         { display_name: 'Turmeric powder', category: 'spice', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: [] },
  'red chilli powder':       { display_name: 'Red chilli powder', category: 'spice', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: [] },
  'kashmiri red chilli powder': { display_name: 'Kashmiri red chilli powder', category: 'spice', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: [] },
  'dried red chilli':        { display_name: 'Dried red chilli', category: 'spice', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: ['dried kashmiri red chilli'] },
  'garam masala':            { display_name: 'Garam masala', category: 'spice', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: [] },
  'chaat masala':            { display_name: 'Chaat masala', category: 'spice', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: [] },
  'malvani masala':          { display_name: 'Malvani masala', category: 'spice', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: [] },
  'asafoetida':              { display_name: 'Asafoetida (hing)', category: 'spice', meat: false, egg: false, dairy: false, nuts: false, gluten: true, aliases: ['hing'] },
  'nutmeg powder':           { display_name: 'Nutmeg powder', category: 'spice', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: [] },
  'saffron':                 { display_name: 'Saffron', category: 'spice', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: [] },
  'dried mango powder':      { display_name: 'Dried mango powder (amchur)', category: 'spice', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: ['amchur'] },

  // -- oils / fats --
  'oil':                     { display_name: 'Cooking oil', category: 'oil_fat', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: ['vegetable oil', 'sunflower oil', 'mustard oil', 'coconut oil'] },

  // -- sweeteners --
  'sugar':                   { display_name: 'Sugar', category: 'sweetener', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: [] },
  'jaggery':                 { display_name: 'Jaggery', category: 'sweetener', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: [] },

  // -- condiments / other --
  'tamarind pulp':           { display_name: 'Tamarind pulp', category: 'condiment', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: ['tamarind concentrate'] },
  'lemon juice':             { display_name: 'Lemon juice', category: 'condiment', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: [] },
  'soy sauce':               { display_name: 'Soy sauce', category: 'condiment', meat: false, egg: false, dairy: false, nuts: false, gluten: true, aliases: [] },
  'vinegar':                 { display_name: 'Vinegar', category: 'condiment', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: [] },
  'tomato ketchup':          { display_name: 'Tomato ketchup', category: 'condiment', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: ['ketchup'] },
  'red chilli sauce':        { display_name: 'Red chilli sauce', category: 'condiment', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: ['sriracha'] },
  'pickle':                  { display_name: 'Pickle (achaar)', category: 'condiment', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: ['achaar'] },
  'mint-coriander chutney':  { display_name: 'Mint-coriander chutney', category: 'condiment', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: [] },
  'dry garlic chutney':      { display_name: 'Dry garlic chutney', category: 'condiment', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: [] },
  'eggless mayonnaise':      { display_name: 'Eggless mayonnaise-style dressing', category: 'condiment', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: ['vegan mayo'] },
  'baking soda':             { display_name: 'Baking soda', category: 'other', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: [] },
  'salt':                    { display_name: 'Salt', category: 'other', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: [] },
  'water':                   { display_name: 'Water', category: 'other', meat: false, egg: false, dairy: false, nuts: false, gluten: false, aliases: [] },
};

export function flags(key) {
  const i = ING[key];
  if (!i) throw new Error(`Unknown ingredient key: ${key}`);
  return { contains_meat: i.meat, contains_egg: i.egg, contains_dairy: i.dairy, contains_nuts: i.nuts, contains_gluten: i.gluten };
}
