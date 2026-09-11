import { showSnackbar, setBusy } from '../lib/dom.js';
import { wireDialog } from './dialog.js';
import { createRecipe } from '../lib/api.js';

function parseNumberValue(rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === '') return null;
  const value = Number(rawValue);
  return Number.isFinite(value) ? value : null;
}

function clearFieldErrors(form) {
  form.querySelectorAll('.field-error').forEach((node) => {
    node.textContent = '';
  });
  form.querySelectorAll('input, textarea').forEach((node) => {
    node.classList.remove('input-error');
  });
}

function setFieldError(form, fieldName, message) {
  const input = form.querySelector(`[name="${fieldName}"]`);
  const error = form.querySelector(`[data-error-for="${fieldName}"]`);
  if (input) input.classList.toggle('input-error', Boolean(message));
  if (error) error.textContent = message || '';
}

function buildRecipeAndIngredients(form) {
  const formData = new FormData(form);
  const fields = Object.fromEntries(formData.entries());

  // Phase 6: name-only ingredient rows (no quantity/unit UI yet — the structured editor is
  // Phase 7). Each line becomes a B.4 ingredient item with a fresh-ingredient name; the write API
  // derives dietary flags for it server-side from Appendix E keywords.
  const ingredientNames = String(fields.ingredients || '').trim()
    .split(/\n+/).map((item) => item.trim()).filter(Boolean);
  const stepItems = String(fields.steps || '').trim()
    .split(/\n+/).map((item) => item.trim()).filter(Boolean);
  const tags = String(fields.tags || '').trim()
    .split(',').map((item) => item.trim()).filter(Boolean);

  const recipe = {
    name: String(fields.name || '').trim(),
    description: String(fields.description || '').trim(),
    cuisine: String(fields.cuisine || '').trim(),
    serves: parseNumberValue(fields.serves),
    total_time_minutes: parseNumberValue(fields.total_time_minutes),
    tags,
    steps: stepItems.length ? [{ group: 'Method', steps: stepItems }] : [],
    is_vegetarian: Boolean(fields.is_vegetarian),
    is_egg_free: Boolean(fields.is_egg_free),
    contains_dairy: Boolean(fields.contains_dairy),
    calories_kcal: parseNumberValue(fields.calories_kcal),
    protein_g: parseNumberValue(fields.protein_g),
    carbs_g: parseNumberValue(fields.carbs_g),
    fat_g: parseNumberValue(fields.fat_g),
    fibre_g: parseNumberValue(fields.fibre_g),
  };

  const ingredients = ingredientNames.length
    ? [{ group: 'Ingredients', items: ingredientNames.map((name) => ({ ingredient: { name }, quantity: null, unit: null })) }]
    : [];

  return { recipe, ingredients, ingredientLineCount: ingredientNames.length };
}

function validateRecipeForm(form) {
  const errors = {};
  const { recipe, ingredients, ingredientLineCount } = buildRecipeAndIngredients(form);

  if (!recipe.name) errors.name = 'Recipe name is required.';
  if (!recipe.cuisine) errors.cuisine = 'Cuisine is required.';
  if (!recipe.description) errors.description = 'Description is required.';
  if (!recipe.serves || recipe.serves <= 0) errors.serves = 'Serves must be greater than 0.';
  if (!recipe.total_time_minutes || recipe.total_time_minutes <= 0) errors.total_time_minutes = 'Time must be greater than 0 minutes.';
  if (!ingredientLineCount) errors.ingredients = 'Add at least one ingredient.';
  if (!recipe.steps.length) errors.steps = 'Add at least one cooking step.';
  if (recipe.calories_kcal !== null && recipe.calories_kcal < 0) errors.calories_kcal = 'Calories must be 0 or more.';
  if (recipe.protein_g !== null && recipe.protein_g < 0) errors.protein_g = 'Protein must be 0 or more.';
  if (recipe.carbs_g !== null && recipe.carbs_g < 0) errors.carbs_g = 'Carbs must be 0 or more.';
  if (recipe.fat_g !== null && recipe.fat_g < 0) errors.fat_g = 'Fat must be 0 or more.';
  if (recipe.fibre_g !== null && recipe.fibre_g < 0) errors.fibre_g = 'Fibre must be 0 or more.';

  return { valid: Object.keys(errors).length === 0, errors, recipe, ingredients };
}

/**
 * Wires the add-recipe modal once. Phase 6: only create goes through the write API; edit is
 * disabled until the structured ingredient editor ships in Phase 7 (task 6, acceptance).
 */
export function createRecipeForm({ onSaved }) {
  const modal = document.getElementById('addRecipeModal');
  const form = document.getElementById('addRecipeForm');
  const title = document.getElementById('addRecipeTitle');
  const submitButton = document.getElementById('submitRecipeButton');
  const cancelButton = document.getElementById('cancelAddRecipe');
  const turnstileContainer = document.getElementById('turnstileContainer');
  const dialogHandle = modal ? wireDialog(modal, { onClose: resetForm }) : null;

  function resetForm() {
    if (form) {
      form.reset();
      clearFieldErrors(form);
    }
  }

  function openAdd() {
    if (!modal || !form || !title || !submitButton) return;
    title.textContent = 'Add a new recipe';
    submitButton.textContent = 'Save recipe';
    form.reset();
    clearFieldErrors(form);
    dialogHandle.open();
  }

  function focusField(fieldName) {
    form.querySelector(`[name="${fieldName}"]`)?.focus();
  }

  async function handleSubmit(event) {
    event.preventDefault();
    clearFieldErrors(form);

    const validation = validateRecipeForm(form);
    if (!validation.valid) {
      Object.entries(validation.errors).forEach(([fieldName, message]) => setFieldError(form, fieldName, message));
      showSnackbar('Please fix the highlighted fields before saving.', 'error');
      form.querySelector('.input-error')?.focus();
      return;
    }

    setBusy(submitButton, true);
    try {
      const result = await createRecipe({
        recipe: validation.recipe,
        ingredients: validation.ingredients,
        turnstileContainer,
        source: 'manual',
      });

      if (result.ok) {
        showSnackbar('Recipe added successfully!', 'success');
        dialogHandle.close();
        await onSaved?.();
        return;
      }

      switch (result.code) {
        case 'validation_failed':
          Object.entries(result.errors || {}).forEach(([fieldName, message]) => setFieldError(form, fieldName, message));
          showSnackbar('Please fix the highlighted fields before saving.', 'error');
          form.querySelector('.input-error')?.focus();
          break;
        case 'verification_failed':
          showSnackbar("We couldn't confirm you're not a bot. Try saving again.", 'error');
          break;
        case 'duplicate_recipe':
          showSnackbar(`You already have ${result.existing?.name || 'a recipe with this name'}.`, 'error');
          break;
        case 'rate_limited': {
          const minutes = Math.max(1, Math.ceil(Number(result.retryAfter || 3600) / 60));
          showSnackbar(`Too many changes from your network. Try again in ${minutes} minutes.`, 'error');
          break;
        }
        default:
          showSnackbar(result.message || "Couldn't save. Your changes are still in the form. Try again.", 'error');
      }
    } finally {
      setBusy(submitButton, false);
    }
  }

  cancelButton?.addEventListener('click', () => dialogHandle.close());
  form?.addEventListener('submit', handleSubmit);

  return {
    openAdd,
    focusField,
  };
}
