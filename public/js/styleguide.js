import { showSnackbar } from './lib/dom.js';
import { wireDialog } from './components/dialog.js';
import { renderRecipeCard, normalizeRecipe } from './components/recipe-card.js';
import { wireThemeToggle } from './components/theme-toggle.js';
import { dishArtSvg } from './components/dish-art.js';
import { DISH_TYPES } from './shared/dish-type.js';

// Same shared toggle the app itself uses (js/theme.js applies the stored choice pre-paint).
wireThemeToggle(document.getElementById('themeToggle'));

// RecipeCard demo data
const sampleRecipes = [
  { id: 1, slug: 'kanda-poha', name: 'Kanda Poha', cuisine: 'Maharashtrian', serves: 4, total_time_minutes: 25, spice_level: 3, protein_g: 8, tags: ['Breakfast', 'Snack'], meal_types: ['Breakfast', 'Packed Lunch'], is_vegetarian: true, is_egg_free: true, contains_dairy: false, is_protein_smart: false, contains_nuts: true },
  { id: 2, slug: 'paneer-tikka-wrap', name: 'Paneer Tikka Wrap', cuisine: 'Fusion', serves: 4, total_time_minutes: 40, spice_level: 4, protein_g: 17, tags: ['Lunch', 'Dinner'], meal_types: ['Lunch', 'Dinner'], is_vegetarian: true, is_egg_free: true, contains_dairy: true, is_protein_smart: false, contains_nuts: false },
];
document.getElementById('recipeCardDemo').innerHTML = sampleRecipes
  .map((r) => renderRecipeCard(normalizeRecipe(r), { actions: true, showTime: true, tagLimit: 4 }))
  .join('');

// Dish illustrations: one of each, plus the monogram fallback.
const artCuisines = ['South Indian', 'North Indian', 'Maharashtrian', 'Rajasthani', 'Chaat', 'Indo-Chinese', 'Gujarati', 'Fusion'];
document.getElementById('dishArtDemo').innerHTML = [...DISH_TYPES.map((type, i) => ({ name: type.keywords[0], cuisine: artCuisines[i % artCuisines.length], label: type.id })), { name: 'Something new', cuisine: 'Other', label: 'monogram' }]
  .map((sample) => `<figure class="sg-dish-art"><div class="recipe-card-art">${dishArtSvg({ ...sample, slug: sample.label })}</div><figcaption>${sample.label}</figcaption></figure>`)
  .join('');

// ServingsStepper demo
let servings = 4;
const stepperValue = document.getElementById('stepperValue');
document.getElementById('stepperMinus').addEventListener('click', () => {
  servings = Math.max(1, servings - 1);
  stepperValue.textContent = servings;
});
document.getElementById('stepperPlus').addEventListener('click', () => {
  servings += 1;
  stepperValue.textContent = servings;
});

// Dialog demo
const sgDialog = wireDialog(document.getElementById('sgDialog'));
document.getElementById('openSgDialog').addEventListener('click', () => sgDialog.open());
document.getElementById('closeSgDialog').addEventListener('click', () => sgDialog.close());

// Toast demo
document.getElementById('showSgToastSuccess').addEventListener('click', () => showSnackbar('Recipe saved successfully!', 'success'));
document.getElementById('showSgToastError').addEventListener('click', () => showSnackbar('Something went wrong.', 'error'));

// Tabs demo
const tab1 = document.getElementById('sgTab1');
const tab2 = document.getElementById('sgTab2');
function selectTab(selected, other) {
  selected.setAttribute('aria-selected', 'true');
  other.setAttribute('aria-selected', 'false');
}
tab1.addEventListener('click', () => selectTab(tab1, tab2));
tab2.addEventListener('click', () => selectTab(tab2, tab1));
