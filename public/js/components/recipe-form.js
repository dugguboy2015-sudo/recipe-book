import { showSnackbar } from '../lib/dom.js';
import { wireDialog } from './dialog.js';

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

function buildRecipePayload(form) {
  const formData = new FormData(form);
  const fields = Object.fromEntries(formData.entries());

  const ingredientItems = String(fields.ingredients || '').trim()
    .split(/\n+/).map((item) => item.trim()).filter(Boolean).map((item) => ({ name: item }));
  const stepItems = String(fields.steps || '').trim()
    .split(/\n+/).map((item) => item.trim()).filter(Boolean);
  const tags = String(fields.tags || '').trim()
    .split(',').map((item) => item.trim()).filter(Boolean);

  return {
    name: String(fields.name || '').trim(),
    description: String(fields.description || '').trim(),
    cuisine: String(fields.cuisine || '').trim(),
    serves: parseNumberValue(fields.serves),
    total_time_minutes: parseNumberValue(fields.total_time_minutes),
    tags,
    ingredients: ingredientItems.length ? [{ group: 'Ingredients', items: ingredientItems }] : [],
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
}

function validateRecipeForm(form) {
  const errors = {};
  const values = buildRecipePayload(form);

  if (!values.name) errors.name = 'Recipe name is required.';
  if (!values.cuisine) errors.cuisine = 'Cuisine is required.';
  if (!values.description) errors.description = 'Description is required.';
  if (!values.serves || values.serves <= 0) errors.serves = 'Serves must be greater than 0.';
  if (!values.total_time_minutes || values.total_time_minutes <= 0) errors.total_time_minutes = 'Time must be greater than 0 minutes.';
  if (!values.ingredients.length) errors.ingredients = 'Add at least one ingredient.';
  if (!values.steps.length) errors.steps = 'Add at least one cooking step.';
  if (values.calories_kcal !== null && values.calories_kcal < 0) errors.calories_kcal = 'Calories must be 0 or more.';
  if (values.protein_g !== null && values.protein_g < 0) errors.protein_g = 'Protein must be 0 or more.';
  if (values.carbs_g !== null && values.carbs_g < 0) errors.carbs_g = 'Carbs must be 0 or more.';
  if (values.fat_g !== null && values.fat_g < 0) errors.fat_g = 'Fat must be 0 or more.';
  if (values.fibre_g !== null && values.fibre_g < 0) errors.fibre_g = 'Fibre must be 0 or more.';

  return { valid: Object.keys(errors).length === 0, errors, values };
}

function fillRecipeForm(form, recipe) {
  const ingredientLines = [];
  if (Array.isArray(recipe.ingredients)) {
    recipe.ingredients.forEach((group) => {
      if (Array.isArray(group.items)) {
        group.items.forEach((item) => ingredientLines.push(item.name || item));
      }
    });
  }

  const stepLines = [];
  if (Array.isArray(recipe.steps)) {
    recipe.steps.forEach((group) => {
      if (Array.isArray(group.steps)) {
        group.steps.forEach((step) => stepLines.push(step));
      }
    });
  }

  form.elements.name.value = recipe.name || '';
  form.elements.cuisine.value = recipe.cuisine || '';
  form.elements.description.value = recipe.description || '';
  form.elements.serves.value = recipe.serves || '';
  form.elements.total_time_minutes.value = recipe.total_time_minutes || '';
  form.elements.tags.value = Array.isArray(recipe.tags) ? recipe.tags.join(', ') : '';
  form.elements.ingredients.value = ingredientLines.join('\n');
  form.elements.steps.value = stepLines.join('\n');
  form.elements.is_vegetarian.checked = Boolean(recipe.is_vegetarian);
  form.elements.is_egg_free.checked = Boolean(recipe.is_egg_free);
  form.elements.contains_dairy.checked = Boolean(recipe.contains_dairy);
  form.elements.calories_kcal.value = recipe.calories_kcal ?? '';
  form.elements.protein_g.value = recipe.protein_g ?? '';
  form.elements.carbs_g.value = recipe.carbs_g ?? '';
  form.elements.fat_g.value = recipe.fat_g ?? '';
  form.elements.fibre_g.value = recipe.fibre_g ?? '';
}

/**
 * Wires the add/edit recipe modal once. Writes still go straight to Supabase with the
 * publishable key here, same as before Phase 4 — Phase 6 replaces this with the write API;
 * until then, saving fails with a permission error (expected, per the Phase 0 lockdown).
 */
export function createRecipeForm({ client, onSaved }) {
  const state = { mode: 'add', currentRecipeId: null };

  const modal = document.getElementById('addRecipeModal');
  const form = document.getElementById('addRecipeForm');
  const title = document.getElementById('addRecipeTitle');
  const submitButton = document.getElementById('submitRecipeButton');
  const cancelButton = document.getElementById('cancelAddRecipe');
  const dialogHandle = modal ? wireDialog(modal, { onClose: resetForm }) : null;

  function resetForm() {
    if (form) {
      form.reset();
      clearFieldErrors(form);
    }
    state.mode = 'add';
    state.currentRecipeId = null;
  }

  function open(mode, recipe) {
    if (!modal || !form || !title || !submitButton) return;
    state.mode = mode;
    state.currentRecipeId = recipe ? Number(recipe.id) : null;
    title.textContent = mode === 'edit' ? 'Edit recipe' : 'Add a new recipe';
    submitButton.textContent = mode === 'edit' ? 'Update recipe' : 'Save recipe';

    form.reset();
    clearFieldErrors(form);
    if (mode === 'edit' && recipe) fillRecipeForm(form, recipe);

    dialogHandle.open();
  }

  function close() {
    dialogHandle?.close();
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

    try {
      if (state.mode === 'edit' && state.currentRecipeId) {
        const { error } = await client.from('recipes').update(validation.values).eq('id', state.currentRecipeId).select().single();
        if (error) throw error;
        showSnackbar('Recipe updated successfully!', 'success');
      } else {
        const { error } = await client.from('recipes').insert([validation.values]).select().single();
        if (error) throw error;
        showSnackbar('Recipe added successfully!', 'success');
      }
      close();
      await onSaved?.();
    } catch (error) {
      console.error(error);
      showSnackbar(error.message || 'Unable to save recipe. Please try again.', 'error');
    }
  }

  cancelButton?.addEventListener('click', close);
  form?.addEventListener('submit', handleSubmit);

  return {
    openAdd: () => open('add', null),
    openEdit: (recipe) => open('edit', recipe),
  };
}
