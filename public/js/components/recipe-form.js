import { escapeHtml, showSnackbar, setBusy } from '../lib/dom.js';
import { wireDialog } from './dialog.js';
import { createRecipe, updateRecipe, estimateNutrition } from '../lib/api.js';
import { createIngredientEditor } from './ingredient-editor.js';
import { createMethodEditor } from './method-editor.js';
import { fetchAllCuisines, fetchRecipeIngredients, fetchRecipeById } from '../lib/queries.js';
import { getHousehold } from '../lib/household.js';
import { needsHouseholdConfirm } from '../shared/dietary-suggestion.js';
import { MEAL_TYPES, reconcileTimes } from '../shared/recipe-rules.js';
import { draftIngredientsToEditorGroups, groupWarningsByField } from '../shared/draft-adapter.js';

const DIETARY_RADIO_FIELDS = ['is_vegetarian', 'is_egg_free', 'contains_dairy'];
const NUTRITION_FIELDS = ['calories_kcal', 'protein_g', 'carbs_g', 'sugars_g', 'fibre_g', 'fat_g', 'saturates_g', 'salt_g'];
const DIETARY_LABELS = { is_vegetarian: 'Vegetarian', is_egg_free: 'Egg-free', contains_dairy: 'Contains dairy' };

function parseNumberValue(rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === '') return null;
  const value = Number(rawValue);
  return Number.isFinite(value) ? value : null;
}

function clearFieldErrors(form) {
  form.querySelectorAll('.field-error').forEach((node) => {
    node.textContent = '';
  });
  form.querySelectorAll('input, textarea, select').forEach((node) => {
    node.classList.remove('input-error');
  });
}

function setFieldError(form, fieldName, message) {
  const input = form.querySelector(`[name="${fieldName}"]`);
  const error = form.querySelector(`[data-error-for="${fieldName}"]`);
  if (input) input.classList.toggle('input-error', Boolean(message));
  if (error) error.textContent = message || '';
}

function radioValue(form, name) {
  const checked = form.querySelector(`input[name="${name}"]:checked`);
  return checked ? checked.value === 'yes' : null;
}

function setRadioValue(form, name, value) {
  if (value === null || value === undefined) return;
  const input = form.querySelector(`input[name="${name}"][value="${value ? 'yes' : 'no'}"]`);
  if (input) input.checked = true;
}

/**
 * Wires the add/edit recipe modal (task 7.1-7.3). One form serves both: openAdd() resets it,
 * openEdit(id) fetches the recipe + its recipe_ingredients and fills every writable field.
 */
export function createRecipeForm({ client, onSaved }) {
  const modal = document.getElementById('addRecipeModal');
  const form = document.getElementById('addRecipeForm');
  const title = document.getElementById('addRecipeTitle');
  const submitButton = document.getElementById('submitRecipeButton');
  const cancelButton = document.getElementById('cancelAddRecipe');
  const turnstileContainer = document.getElementById('turnstileContainer');
  const mealTypeChips = document.getElementById('mealTypeChips');
  const cuisineSelect = document.getElementById('recipeCuisineSelect');
  const packedLunchSection = document.getElementById('packedLunchSection');
  const dietarySuggestionNotice = document.getElementById('dietarySuggestionNotice');
  const householdConfirmModal = document.getElementById('householdConfirmModal');
  const dialogHandle = modal ? wireDialog(modal, { onClose: resetForm }) : null;
  const householdConfirmHandle = householdConfirmModal ? wireDialog(householdConfirmModal) : null;
  const aiDraftBanner = document.getElementById('aiDraftBanner');
  const aiDraftWarningsList = document.getElementById('aiDraftWarnings');
  const estimateNutritionButton = document.getElementById('estimateNutritionButton');
  const estimateNutritionStatus = document.getElementById('estimateNutritionStatus');

  let mode = 'add'; // 'add' | 'edit' | 'ai-draft'
  let editingRecipeId = null;
  let editingUpdatedAt = null;
  let totalTouchedByUser = false;
  const dietaryManuallySet = new Set();
  let household = null;
  let cuisineOptionsLoaded = false;
  let pendingConfirmSave = null;
  let currentGenerationId = null;
  // createIngredientEditor renders synchronously during construction, which fires onChange before
  // the `const` below could ever be assigned — so applyDietarySuggestion closes over this `let`
  // (already initialized to null) instead of the ingredientEditor binding itself.
  let ingredientEditorRef = null;

  const ingredientEditor = document.getElementById('ingredientEditorContainer')
    ? createIngredientEditor({ client, container: document.getElementById('ingredientEditorContainer'), onChange: () => applyDietarySuggestion() })
    : null;
  ingredientEditorRef = ingredientEditor;
  const methodEditor = document.getElementById('methodEditorContainer')
    ? createMethodEditor({ container: document.getElementById('methodEditorContainer') })
    : null;

  getHousehold().then((data) => { household = data; }).catch(() => {});

  async function ensureCuisineOptions() {
    if (cuisineOptionsLoaded || !cuisineSelect) return;
    const [allCuisines, householdProfile] = await Promise.all([fetchAllCuisines(client), getHousehold().catch(() => null)]);
    const favourites = householdProfile?.favourite_cuisines || [];
    const ordered = [...favourites, ...allCuisines.filter((name) => !favourites.includes(name))];
    cuisineSelect.innerHTML = ordered.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
    cuisineOptionsLoaded = true;
  }

  function renderMealTypeChips(selected = []) {
    if (!mealTypeChips) return;
    mealTypeChips.innerHTML = MEAL_TYPES.map((type) => `
      <label class="checkbox-field">
        <input type="checkbox" name="meal_types" value="${escapeHtml(type)}" ${selected.includes(type) ? 'checked' : ''} />
        <span>${escapeHtml(type)}</span>
      </label>
    `).join('');
    mealTypeChips.querySelectorAll('input[name="meal_types"]').forEach((input) => {
      input.addEventListener('change', updatePackedLunchVisibility);
    });
    updatePackedLunchVisibility();
  }

  function updatePackedLunchVisibility() {
    if (!packedLunchSection || !mealTypeChips) return;
    const isPacked = mealTypeChips.querySelector('input[value="Packed Lunch"]:checked');
    packedLunchSection.hidden = !isPacked;
  }

  function applyDietarySuggestion() {
    // AI drafts show the model's own dietary answers as an "AI suggests" hint instead (10.3) —
    // never the ingredient-derived auto-suggestion Phase 7 built for manual recipes.
    if (mode === 'ai-draft') return;
    if (!ingredientEditorRef || !dietarySuggestionNotice) return;
    const signal = ingredientEditorRef.getDietarySignal();
    if (!signal) {
      dietarySuggestionNotice.hidden = true;
      return;
    }
    dietarySuggestionNotice.hidden = false;
    dietarySuggestionNotice.textContent = `Based on the ingredients: Vegetarian: ${signal.is_vegetarian ? 'Yes' : 'No'}, `
      + `Egg-free: ${signal.is_egg_free ? 'Yes' : 'No'}, Contains dairy: ${signal.contains_dairy ? 'Yes' : 'No'}.`;

    for (const field of DIETARY_RADIO_FIELDS) {
      if (!dietaryManuallySet.has(field)) setRadioValue(form, field, signal[field]);
    }
  }

  function wireDietaryTouchTracking() {
    for (const field of DIETARY_RADIO_FIELDS) {
      form.querySelectorAll(`input[name="${field}"]`).forEach((input) => {
        input.addEventListener('change', () => dietaryManuallySet.add(field));
      });
    }
  }

  function resetForm() {
    if (!form) return;
    form.reset();
    clearFieldErrors(form);
    totalTouchedByUser = false;
    dietaryManuallySet.clear();
    if (dietarySuggestionNotice) dietarySuggestionNotice.hidden = true;
    renderMealTypeChips([]);
    ingredientEditor?.reset();
    methodEditor?.reset();
    mode = 'add';
    editingRecipeId = null;
    editingUpdatedAt = null;
    currentGenerationId = null;
    if (aiDraftBanner) aiDraftBanner.hidden = true;
    if (aiDraftWarningsList) aiDraftWarningsList.innerHTML = '';
    clearAiSuggestsHints();
    if (estimateNutritionStatus) estimateNutritionStatus.textContent = '';
  }

  function clearAiSuggestsHints() {
    for (const field of DIETARY_RADIO_FIELDS) {
      const hint = document.getElementById(`aiSuggests_${field}`);
      if (hint) hint.hidden = true;
    }
  }

  function wireTimeAutoFill() {
    const prepInput = form.querySelector('[name="prep_time_minutes"]');
    const cookInput = form.querySelector('[name="cook_time_minutes"]');
    const totalInput = form.querySelector('[name="total_time_minutes"]');
    if (!prepInput || !cookInput || !totalInput) return;

    totalInput.addEventListener('input', () => { totalTouchedByUser = true; });
    const recompute = () => {
      if (totalTouchedByUser) return;
      const prep = parseNumberValue(prepInput.value);
      const cook = parseNumberValue(cookInput.value);
      if (prep === null && cook === null) return;
      const { total } = reconcileTimes({ prep, cook, total: null });
      if (total !== null) totalInput.value = String(total);
    };
    prepInput.addEventListener('input', recompute);
    cookInput.addEventListener('input', recompute);
  }

  async function openAdd() {
    if (!modal || !form || !title || !submitButton) return;
    resetForm();
    await ensureCuisineOptions();
    title.textContent = 'Add a new recipe';
    submitButton.textContent = 'Save recipe';
    dialogHandle.open();
  }

  async function openEdit(recipeId) {
    if (!modal || !form || !title || !submitButton) return;
    resetForm();
    await ensureCuisineOptions();

    const [recipe, ingredientGroups] = await Promise.all([
      fetchRecipeById(client, recipeId),
      fetchRecipeIngredients(client, recipeId),
    ]);
    if (!recipe) {
      showSnackbar('This recipe was removed.', 'error');
      return;
    }

    mode = 'edit';
    editingRecipeId = recipeId;
    editingUpdatedAt = recipe.updated_at;
    title.textContent = `Edit ${recipe.name}`;
    submitButton.textContent = 'Save changes';

    form.querySelector('[name="name"]').value = recipe.name || '';
    if (cuisineSelect) cuisineSelect.value = recipe.cuisine || '';
    form.querySelector('[name="description"]').value = recipe.description || '';
    form.querySelector('[name="serves"]').value = recipe.serves ?? '';
    form.querySelector('[name="spice_level"]').value = recipe.spice_level ?? '';
    form.querySelector('[name="tags"]').value = (recipe.tags || []).join(', ');
    renderMealTypeChips(recipe.meal_types || []);

    totalTouchedByUser = true; // an existing recipe's total is authoritative until the user clears it
    form.querySelector('[name="prep_time_minutes"]').value = recipe.prep_time_minutes ?? '';
    form.querySelector('[name="cook_time_minutes"]').value = recipe.cook_time_minutes ?? '';
    form.querySelector('[name="total_time_minutes"]').value = recipe.total_time_minutes ?? '';
    form.querySelector('[name="time_note"]').value = recipe.time_note || '';

    ingredientEditor?.setValue(ingredientGroups);
    methodEditor?.setValue(recipe.steps);

    setRadioValue(form, 'is_vegetarian', recipe.is_vegetarian);
    setRadioValue(form, 'is_egg_free', recipe.is_egg_free);
    setRadioValue(form, 'contains_dairy', recipe.contains_dairy);
    // Existing answers count as user-set: the ingredient-derived suggestion shouldn't overwrite them.
    DIETARY_RADIO_FIELDS.forEach((field) => dietaryManuallySet.add(field));

    form.querySelector('[name="calories_kcal"]').value = recipe.calories_kcal ?? '';
    form.querySelector('[name="protein_g"]').value = recipe.protein_g ?? '';
    form.querySelector('[name="carbs_g"]').value = recipe.carbs_g ?? '';
    form.querySelector('[name="sugars_g"]').value = recipe.sugars_g ?? '';
    form.querySelector('[name="fibre_g"]').value = recipe.fibre_g ?? '';
    form.querySelector('[name="fat_g"]').value = recipe.fat_g ?? '';
    form.querySelector('[name="saturates_g"]').value = recipe.saturates_g ?? '';
    form.querySelector('[name="salt_g"]').value = recipe.salt_g ?? '';
    form.querySelector('[name="nutrition_basis"]').value = recipe.nutrition_basis || '';

    form.querySelector('[name="lunchbox_notes"]').value = recipe.lunchbox_notes || '';
    form.querySelector('[name="origin_note"]').value = recipe.origin_note || '';
    form.querySelector('[name="egg_check_notes"]').value = recipe.egg_check_notes || '';
    form.querySelector('[name="common_mistakes"]').value = recipe.common_mistakes || '';
    form.querySelector('[name="uk_sourcing_notes"]').value = recipe.uk_sourcing_notes || '';
    form.querySelector('[name="storage_notes"]').value = recipe.storage_notes || '';
    form.querySelector('[name="kid_friendly_notes"]').value = recipe.kid_friendly_notes || '';

    dialogHandle.open();
  }

  /**
   * Opens the form pre-filled from a POST /api/recipes/generate draft for review (task 10.3).
   * Dietary radios stay unselected — the model's own answers show as an "AI suggests" hint next
   * to each — and the recipe saves with source:'ai' + generationId so it links back to its row.
   */
  async function openDraft(draft, generationId, warnings = [], goalInfo = {}) {
    if (!modal || !form || !title || !submitButton) return;
    resetForm();
    await ensureCuisineOptions();

    mode = 'ai-draft';
    currentGenerationId = generationId;
    title.textContent = `Review: ${draft.name || 'AI draft'}`;
    submitButton.textContent = 'Save recipe';

    form.querySelector('[name="name"]').value = draft.name || '';
    if (cuisineSelect) cuisineSelect.value = draft.cuisine || '';
    form.querySelector('[name="description"]').value = draft.description || '';
    form.querySelector('[name="serves"]').value = draft.serves ?? '';
    form.querySelector('[name="spice_level"]').value = draft.spice_level ?? '';
    form.querySelector('[name="tags"]').value = (draft.tags || []).join(', ');
    renderMealTypeChips(draft.meal_types || []);

    totalTouchedByUser = true; // the draft's own total is authoritative until the user clears it
    form.querySelector('[name="prep_time_minutes"]').value = draft.prep_time_minutes ?? '';
    form.querySelector('[name="cook_time_minutes"]').value = draft.cook_time_minutes ?? '';
    form.querySelector('[name="total_time_minutes"]').value = draft.total_time_minutes ?? '';
    form.querySelector('[name="time_note"]').value = draft.time_note || '';

    ingredientEditor?.setValue(draftIngredientsToEditorGroups(draft.ingredients));
    methodEditor?.setValue(draft.steps);

    showAiSuggestsHint('is_vegetarian', draft.is_vegetarian);
    showAiSuggestsHint('is_egg_free', draft.is_egg_free);
    showAiSuggestsHint('contains_dairy', draft.contains_dairy);

    form.querySelector('[name="calories_kcal"]').value = draft.calories_kcal ?? '';
    form.querySelector('[name="protein_g"]').value = draft.protein_g ?? '';
    form.querySelector('[name="carbs_g"]').value = draft.carbs_g ?? '';
    form.querySelector('[name="sugars_g"]').value = draft.sugars_g ?? '';
    form.querySelector('[name="fibre_g"]').value = draft.fibre_g ?? '';
    form.querySelector('[name="fat_g"]').value = draft.fat_g ?? '';
    form.querySelector('[name="saturates_g"]').value = draft.saturates_g ?? '';
    form.querySelector('[name="salt_g"]').value = draft.salt_g ?? '';
    form.querySelector('[name="nutrition_basis"]').value = draft.nutrition_basis || '';

    form.querySelector('[name="lunchbox_notes"]').value = draft.lunchbox_notes || '';
    form.querySelector('[name="origin_note"]').value = draft.origin_note || '';
    form.querySelector('[name="egg_check_notes"]').value = draft.egg_check_notes || '';
    form.querySelector('[name="common_mistakes"]').value = draft.common_mistakes || '';
    form.querySelector('[name="uk_sourcing_notes"]').value = draft.uk_sourcing_notes || '';
    form.querySelector('[name="storage_notes"]').value = draft.storage_notes || '';
    form.querySelector('[name="kid_friendly_notes"]').value = draft.kid_friendly_notes || '';

    if (aiDraftBanner) {
      aiDraftBanner.hidden = false;
      aiDraftBanner.textContent = goalInfo.goalAdjusted
        ? 'AI draft. Check it before saving, especially the dietary answers. To keep at least 60% of new recipes protein-smart, this one is protein-smart too.'
        : 'AI draft. Check it before saving, especially the dietary answers.';
    }
    renderAiWarnings(warnings);

    dialogHandle.open();
  }

  function showAiSuggestsHint(field, value) {
    const hint = document.getElementById(`aiSuggests_${field}`);
    if (!hint) return;
    hint.hidden = value === null || value === undefined;
    hint.textContent = `AI suggests: ${value ? 'Yes' : 'No'}`;
  }

  function renderAiWarnings(warnings) {
    if (!aiDraftWarningsList) return;
    document.querySelectorAll('.field-error[data-ai-warning]').forEach((el) => {
      el.textContent = '';
      delete el.dataset.aiWarning;
    });
    const byField = groupWarningsByField(warnings);
    const items = [];
    for (const [field, fieldWarnings] of byField.entries()) {
      for (const warning of fieldWarnings) {
        const evidence = warning.evidence?.length ? ` (${warning.evidence.join(', ')})` : '';
        const label = DIETARY_LABELS[field] || field;
        items.push(`<li><strong>${escapeHtml(label)}:</strong> ${escapeHtml(warning.message)}${escapeHtml(evidence)}</li>`);
        const errorSlot = form.querySelector(`[data-error-for="${field}"]`);
        if (errorSlot) {
          errorSlot.textContent = `⚠ ${warning.message}${evidence}`;
          errorSlot.dataset.aiWarning = 'true';
        }
      }
    }
    aiDraftWarningsList.innerHTML = items.length ? `<ul>${items.join('')}</ul>` : '';
  }

  function focusField(fieldName) {
    form.querySelector(`[name="${fieldName}"]`)?.focus();
  }

  function buildRecipeAndIngredients() {
    const formData = new FormData(form);
    const fields = Object.fromEntries(formData.entries());
    const mealTypes = formData.getAll('meal_types');
    const tags = String(fields.tags || '').trim().split(',').map((item) => item.trim()).filter(Boolean);

    const recipe = {
      name: String(fields.name || '').trim(),
      description: String(fields.description || '').trim(),
      cuisine: String(fields.cuisine || '').trim(),
      serves: parseNumberValue(fields.serves),
      spice_level: parseNumberValue(fields.spice_level),
      meal_types: mealTypes,
      tags,
      prep_time_minutes: parseNumberValue(fields.prep_time_minutes),
      cook_time_minutes: parseNumberValue(fields.cook_time_minutes),
      total_time_minutes: parseNumberValue(fields.total_time_minutes),
      time_note: String(fields.time_note || '').trim() || null,
      steps: methodEditor?.getValue() || [],
      is_vegetarian: radioValue(form, 'is_vegetarian'),
      is_egg_free: radioValue(form, 'is_egg_free'),
      contains_dairy: radioValue(form, 'contains_dairy'),
      calories_kcal: parseNumberValue(fields.calories_kcal),
      protein_g: parseNumberValue(fields.protein_g),
      carbs_g: parseNumberValue(fields.carbs_g),
      sugars_g: parseNumberValue(fields.sugars_g),
      fibre_g: parseNumberValue(fields.fibre_g),
      fat_g: parseNumberValue(fields.fat_g),
      saturates_g: parseNumberValue(fields.saturates_g),
      salt_g: parseNumberValue(fields.salt_g),
      nutrition_basis: String(fields.nutrition_basis || '').trim() || null,
      lunchbox_notes: String(fields.lunchbox_notes || '').trim() || null,
      origin_note: String(fields.origin_note || '').trim() || null,
      egg_check_notes: String(fields.egg_check_notes || '').trim() || null,
      common_mistakes: String(fields.common_mistakes || '').trim() || null,
      uk_sourcing_notes: String(fields.uk_sourcing_notes || '').trim() || null,
      storage_notes: String(fields.storage_notes || '').trim() || null,
      kid_friendly_notes: String(fields.kid_friendly_notes || '').trim() || null,
    };

    const ingredients = ingredientEditor?.getValue() || [];
    return { recipe, ingredients };
  }

  function validateRecipeForm() {
    const errors = {};
    const { recipe, ingredients } = buildRecipeAndIngredients();

    if (!recipe.name) errors.name = 'Recipe name is required.';
    if (!recipe.cuisine) errors.cuisine = 'Cuisine is required.';
    if (!recipe.description) errors.description = 'Description is required.';
    if (!recipe.serves || recipe.serves <= 0) errors.serves = 'Serves must be greater than 0.';
    if (!recipe.total_time_minutes || recipe.total_time_minutes <= 0) errors.total_time_minutes = 'Time must be greater than 0 minutes.';
    if (!ingredients.some((g) => g.items.length)) errors.ingredients = 'Add at least one ingredient.';
    if (!recipe.steps.length) errors.steps = 'Add at least one cooking step.';
    if (recipe.is_vegetarian === null) errors.is_vegetarian = 'Please answer Yes or No.';
    if (recipe.is_egg_free === null) errors.is_egg_free = 'Please answer Yes or No.';
    if (recipe.contains_dairy === null) errors.contains_dairy = 'Please answer Yes or No.';
    // Phase 10: full nutrition is required to save, manual and AI recipes alike.
    for (const field of NUTRITION_FIELDS) {
      if (recipe[field] === null) errors[field] = 'Required — use Estimate nutrition or enter a value.';
      else if (recipe[field] < 0) errors[field] = 'Must be 0 or more.';
    }

    return { valid: Object.keys(errors).length === 0, errors, recipe, ingredients };
  }

  async function performSave(recipe, ingredients) {
    setBusy(submitButton, true);
    try {
      const result = mode === 'edit'
        ? await updateRecipe(editingRecipeId, { recipe, ingredients, expectedUpdatedAt: editingUpdatedAt, turnstileContainer })
        : await createRecipe({ recipe, ingredients, turnstileContainer, source: mode === 'ai-draft' ? 'ai' : 'manual', generationId: mode === 'ai-draft' ? currentGenerationId : undefined });

      if (result.ok) {
        showSnackbar(mode === 'edit' ? 'Recipe updated successfully!' : 'Recipe added successfully!', 'success');
        dialogHandle.close();
        await onSaved?.(mode === 'edit', mode === 'ai-draft' ? result.data.recipe : null);
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
        case 'edit_conflict':
          showSnackbar('This recipe changed since you opened it.', 'error', {
            label: 'Load latest',
            duration: 8000,
            onClick: () => openEdit(editingRecipeId),
          });
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

  async function handleSubmit(event) {
    event.preventDefault();
    clearFieldErrors(form);

    const validation = validateRecipeForm();
    if (!validation.valid) {
      Object.entries(validation.errors).forEach(([fieldName, message]) => setFieldError(form, fieldName, message));
      showSnackbar('Please fix the highlighted fields before saving.', 'error');
      form.querySelector('.input-error')?.focus();
      return;
    }

    if (needsHouseholdConfirm(household, validation.recipe)) {
      pendingConfirmSave = () => performSave(validation.recipe, validation.ingredients);
      householdConfirmHandle?.open();
      return;
    }

    await performSave(validation.recipe, validation.ingredients);
  }

  estimateNutritionButton?.addEventListener('click', async () => {
    const name = form.querySelector('[name="name"]').value.trim();
    const serves = parseNumberValue(form.querySelector('[name="serves"]').value) || 1;
    const ingredients = ingredientEditor?.getValue() || [];
    if (!ingredients.some((g) => g.items.length)) {
      showSnackbar('Add at least one ingredient before estimating nutrition.', 'error');
      return;
    }

    setBusy(estimateNutritionButton, true);
    if (estimateNutritionStatus) estimateNutritionStatus.textContent = 'Estimating…';
    try {
      const result = await estimateNutrition({ name: name || 'Recipe', serves, ingredients, turnstileContainer });
      if (!result.ok) {
        if (estimateNutritionStatus) estimateNutritionStatus.textContent = '';
        showSnackbar(result.message || "Couldn't estimate nutrition. Please try again.", 'error');
        return;
      }
      const { nutrition } = result.data;
      for (const field of NUTRITION_FIELDS) {
        const input = form.querySelector(`[name="${field}"]`);
        if (input && nutrition[field] !== null && nutrition[field] !== undefined) input.value = nutrition[field];
      }
      form.querySelector('[name="nutrition_basis"]').value = nutrition.nutrition_basis || '';
      if (estimateNutritionStatus) estimateNutritionStatus.textContent = 'Estimated — check before saving.';
    } finally {
      setBusy(estimateNutritionButton, false);
    }
  });

  document.getElementById('confirmHouseholdConfirm')?.addEventListener('click', () => {
    householdConfirmHandle?.close();
    const save = pendingConfirmSave;
    pendingConfirmSave = null;
    save?.();
  });
  document.getElementById('cancelHouseholdConfirm')?.addEventListener('click', () => {
    pendingConfirmSave = null;
    householdConfirmHandle?.close();
  });

  wireDietaryTouchTracking();
  wireTimeAutoFill();
  cancelButton?.addEventListener('click', () => dialogHandle.close());
  form?.addEventListener('submit', handleSubmit);

  return {
    openAdd,
    openEdit,
    openDraft,
    focusField,
  };
}
