import { escapeHtml } from '../shared/html.js';
import { fetchRecipeById, fetchRecipeIngredients } from '../lib/queries.js';
import { normalizeRecipe, dietaryBadges, spiceMeter, setBadgeDiet } from './recipe-card.js';
import { dishArtSvg } from './dish-art.js';
import { wireDialog } from './dialog.js';
import { showSnackbar } from '../lib/dom.js';
import { scaleQuantity, displayQuantity, formatQuantity } from '../shared/units.js';
import { formatIngredientsHtml } from '../shared/cook-mode-format.js';
import { mountTip } from './tips.js';
import { percentRI, trafficLightClass, nearestWidthClass } from '../shared/nutrition-ri.js';
import { getHousehold } from '../lib/household.js';
import { enabledSlots, dietRecipeFilter } from '../shared/household-settings.js';
import { supabase } from '../lib/supabase-client.js';
import { getReadyAccount } from './account.js';
import { addRemoteEntry, applyRemotePrefEvent } from '../lib/planner-remote.js';
import { openCookMode } from './cook-mode.js';
import { handsOffMinutes } from '../shared/recipe-rules.js';
import {
  DAYS, loadPlanState, persistStore, addEntryToWeek, applyPrefEvent, persistPrefs, mondayOf,
} from '../lib/planner-store.js';

const NUTRITION_ROWS = [
  ['calories_kcal', 'Calories', 'kcal'],
  ['protein_g', 'Protein', 'g'],
  ['carbs_g', 'Carbs', 'g'],
  ['sugars_g', 'Sugars', 'g'],
  ['fibre_g', 'Fibre', 'g'],
  ['fat_g', 'Fat', 'g'],
  ['saturates_g', 'Saturates', 'g'],
  ['salt_g', 'Salt', 'g'],
];

const MODAL_HTML = `
  <dialog id="recipeModal" class="recipe-detail">
    <div class="detail-header">
      <div class="recipe-hero">
        <div class="recipe-hero-art" id="modalArt" aria-hidden="true"></div>
        <div>
          <h3 id="modalTitle">Recipe</h3>
          <div class="recipe-hero-meta" id="modalHeroMeta"></div>
        </div>
      </div>
    </div>

    <p class="scaled-notice" id="modalScaledNotice" hidden></p>

    <div class="detail-meta">
      <div class="servings-stepper">
        <button type="button" id="modalServingsMinus" aria-label="Fewer servings">−</button>
        <output id="modalServingsValue">4</output>
        <button type="button" id="modalServingsPlus" aria-label="More servings">+</button>
      </div>
      <button type="button" class="chip" id="modalFamilyServingsChip"></button>
    </div>
    <div id="servingsTip"></div>

    <div class="time-breakdown" id="modalTimeBreakdown"></div>
    <p class="hint time-note" id="modalTimeNote" hidden></p>

    <div class="detail-grid">
      <div class="detail-panel">
        <h4>Ingredients</h4>
        <ul id="modalIngredients"></ul>
      </div>
      <div class="detail-panel">
        <h4>Method</h4>
        <ol id="modalSteps"></ol>
      </div>
      <div class="detail-panel">
        <h4>Nutrition <span class="hint">(per serving, estimate)</span></h4>
        <table class="nutrition-panel">
          <caption>Per serving. The last column compares each amount with an average adult’s recommended daily intake — children and teenagers need different amounts, so read it as a rough guide.</caption>
          <thead><tr><th>Nutrient</th><th>Amount</th><th>Share of an adult’s day</th></tr></thead>
          <tbody id="modalNutrition"></tbody>
        </table>
      </div>
      <div class="detail-panel">
        <h4>Notes</h4>
        <div id="modalNotes"></div>
      </div>
    </div>

    <div class="detail-actions">
      <label>
        Day
        <select id="modalPlannerDay"></select>
      </label>
      <label>
        Slot
        <select id="modalPlannerSlot"></select>
      </label>
      <button type="button" class="ghost-button" id="modalAddToPlanner">Add to planner</button>
      <button type="button" class="ghost-button" id="modalCookMode">Cook mode</button>
      <button type="button" class="ghost-button" id="modalShareRecipe">Share</button>
      <button type="button" class="ghost-button" id="modalPrintRecipe">Print</button>
      <button type="button" class="primary-button" id="modalApproveRecipe" hidden>Approve for the catalogue</button>
      <button type="button" class="ghost-button" id="modalEditRecipe" hidden>Edit</button>
      <button type="button" class="danger-button" id="modalDeleteRecipe" hidden>Delete</button>
    </div>

    <div class="modal-footer">
      <button type="button" class="primary-button" id="closeModal">Close</button>
    </div>
  </dialog>
`;

let mounted = false;
let dialogHandle = null;
let household = null;

/** Current recipe shown, so the servings stepper can re-render ingredients without refetching. */
let current = null;

function ingredientLineText(item, targetServings, fromServes) {
  const scaled = scaleQuantity(item.quantity, fromServes, targetServings, item.scales);
  const displayed = displayQuantity(scaled, item.unit);
  const amount = formatQuantity(displayed);
  const preparation = item.preparation ? `, ${item.preparation}` : '';
  const optional = item.isOptional ? ' (optional)' : '';
  return `${amount ? `${amount} ` : ''}${item.ingredientName}${preparation}${optional}`;
}

function renderIngredients(targetServings) {
  const list = document.getElementById('modalIngredients');
  const { recipe, ingredientGroups } = current;
  if (!ingredientGroups.length) {
    list.innerHTML = '<li>No ingredients listed.</li>';
    return;
  }
  list.innerHTML = ingredientGroups.map((group) => `
    <li><strong>${escapeHtml(group.group)}</strong><ul>${group.items.map((item) => `<li>${escapeHtml(ingredientLineText(item, targetServings, recipe.serves || 4))}</li>`).join('')}</ul></li>
  `).join('');

  const notice = document.getElementById('modalScaledNotice');
  const scaledFromDefault = targetServings !== (recipe.serves || 4);
  notice.hidden = !scaledFromDefault;
  if (scaledFromDefault) {
    notice.textContent = `Scaled from ${recipe.serves || 4} servings. Cooking times may need adjusting for bigger batches.`;
  }
}

function ingredientsAsPlainHtml(targetServings) {
  const { recipe, ingredientGroups } = current;
  return formatIngredientsHtml(ingredientGroups, targetServings, recipe.serves || 4);
}

function renderServings(targetServings) {
  document.getElementById('modalServingsValue').textContent = String(targetServings);
  renderIngredients(targetServings);
}

function renderTimeBreakdown(recipe) {
  const parts = [];
  if (recipe.prep_time_minutes) parts.push(`Prep ${recipe.prep_time_minutes} min`);
  if (recipe.cook_time_minutes) parts.push(`Cook ${recipe.cook_time_minutes} min`);
  parts.push(`Total ${recipe.total_time_minutes ? `${recipe.total_time_minutes} min` : 'TBD'}`);
  const node = document.getElementById('modalTimeBreakdown');
  node.textContent = parts.join(' · ');

  // On 9 of these recipes the total is larger than prep + cook, which reads like an arithmetic
  // mistake but isn't: it's hands-off time — soaking, marinating, resting, proving. Name it, rather
  // than "fixing" the numbers into something that would under-state how long the dish really takes.
  const waiting = handsOffMinutes(recipe);
  const note = [
    waiting ? `${waiting} min of that is hands-off — soaking, marinating, resting or proving.` : '',
    recipe.time_note ? String(recipe.time_note).trim() : '',
  ].filter(Boolean).join(' ');
  const noteNode = document.getElementById('modalTimeNote');
  if (noteNode) {
    noteNode.textContent = note;
    noteNode.hidden = !note;
  }
}

function renderNutrition(recipe) {
  const body = document.getElementById('modalNutrition');
  body.innerHTML = NUTRITION_ROWS.map(([field, label, unit]) => {
    const value = recipe[field];
    const percent = percentRI(field, value);
    const trafficLight = trafficLightClass(field, percent);
    const percentCell = percent === null
      ? '—'
      : trafficLight
        ? `<span class="ri-bar"><span class="ri-bar-fill ${trafficLight} ${nearestWidthClass(percent)}"></span></span>`
        : `${Math.round(percent)}%`;
    return `<tr><td>${label}</td><td>${value ?? '—'}${value !== null && value !== undefined ? ` ${unit}` : ''}</td><td>${percentCell}</td></tr>`;
  }).join('');
}

function renderNotes(recipe) {
  const notes = [
    recipe.lunchbox_notes ? ['Lunchbox', recipe.lunchbox_notes] : null,
    recipe.origin_note ? ['Origin', recipe.origin_note] : null,
    recipe.egg_check_notes ? ['Egg check', recipe.egg_check_notes] : null,
    recipe.common_mistakes ? ['Common mistakes', recipe.common_mistakes] : null,
    recipe.uk_sourcing_notes ? ['UK sourcing', recipe.uk_sourcing_notes] : null,
    recipe.storage_notes ? ['Storage', recipe.storage_notes] : null,
    recipe.kid_friendly_notes ? ['Kid-friendly', recipe.kid_friendly_notes] : null,
  ].filter(Boolean);

  const notesBox = document.getElementById('modalNotes');
  notesBox.innerHTML = notes.length
    ? notes.map(([label, text]) => `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(text)}</p>`).join('')
    : '<p>No additional notes.</p>';
}

function renderPlannerPickers() {
  document.getElementById('modalPlannerDay').innerHTML = DAYS.map((day) => `<option value="${day}">${day}</option>`).join('');
  // Only the meals this household plans (M1e); re-rendered once the household profile arrives.
  document.getElementById('modalPlannerSlot').innerHTML = enabledSlots(household).map((slot) => `<option value="${slot}">${slot}</option>`).join('');
}

export function mountRecipeModal() {
  if (mounted || document.getElementById('recipeModal')) {
    mounted = true;
    return;
  }
  document.body.insertAdjacentHTML('beforeend', MODAL_HTML);
  mounted = true;

  const dialog = document.getElementById('recipeModal');
  dialogHandle = wireDialog(dialog);
  document.getElementById('closeModal')?.addEventListener('click', () => dialogHandle.close());
  renderPlannerPickers();
  mountTip(document.getElementById('servingsTip'), 'servings');

  document.getElementById('modalServingsMinus')?.addEventListener('click', () => {
    if (!current || current.targetServings <= 1) return;
    current.targetServings -= 1;
    renderServings(current.targetServings);
  });
  document.getElementById('modalServingsPlus')?.addEventListener('click', () => {
    if (!current) return;
    current.targetServings += 1;
    renderServings(current.targetServings);
  });
  document.getElementById('modalFamilyServingsChip')?.addEventListener('click', () => {
    if (!current || !household) return;
    current.targetServings = household.default_servings || current.recipe.serves || 4;
    renderServings(current.targetServings);
  });

  document.getElementById('modalAddToPlanner')?.addEventListener('click', async () => {
    if (!current) return;
    const day = document.getElementById('modalPlannerDay').value;
    const slot = document.getElementById('modalPlannerSlot').value;
    const { store, prefs } = loadPlanState();
    const weekOf = mondayOf(); // this quick picker is day-of-week only (no week navigation), so it always targets the current week
    const recipeId = current.recipe.id;
    const servings = current.targetServings;
    persistStore(addEntryToWeek(store, weekOf, day, slot, recipeId, servings, 'manual'));
    persistPrefs(applyPrefEvent(prefs, recipeId, 'manual', weekOf));
    showSnackbar(`Added to ${day} ${slot}.`, 'success');

    // M1e: a signed-in member is planning for their household, not just this browser.
    const account = await getReadyAccount().catch(() => null);
    if (!account?.household) return;
    const [remote] = await Promise.all([
      addRemoteEntry(supabase, { householdId: account.household.id, userId: account.session.user.id, weekOf, day, slot, recipeId, servings }),
      applyRemotePrefEvent(supabase, { householdId: account.household.id, userId: account.session.user.id, recipeId, event: 'manual', weekOf }),
    ]);
    if (!remote) showSnackbar("Couldn't save that to your household's plan. It's still saved in this browser.", 'error');
  });

  // M3: a recipe you can hand to someone, or stick on the counter. The link is the deep link the
  // recipes page already understands (?recipe=<slug>), with the servings you are looking at.
  function shareUrlForCurrent() {
    const url = new URL('recipes.html', window.location.href);
    url.searchParams.set('recipe', current.recipe.slug);
    if (current.targetServings) url.searchParams.set('serves', String(current.targetServings));
    return url.toString();
  }

  document.getElementById('modalShareRecipe')?.addEventListener('click', async () => {
    if (!current) return;
    const url = shareUrlForCurrent();
    if (typeof navigator.share === 'function') {
      navigator.share({ title: current.recipe.name, text: `${current.recipe.name} — from our recipe book`, url }).catch(() => {});
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      showSnackbar('Link copied — paste it to share this recipe.', 'success');
    } catch {
      showSnackbar("Couldn't copy the link. You can copy it from the address bar after opening the recipe.", 'error');
    }
  });

  document.getElementById('modalPrintRecipe')?.addEventListener('click', () => window.print());

  document.getElementById('modalCookMode')?.addEventListener('click', () => {
    if (!current) return;
    openCookMode({
      recipeName: current.recipe.name,
      stepGroups: Array.isArray(current.recipe.steps) ? current.recipe.steps : [],
      ingredientsHtml: ingredientsAsPlainHtml(current.targetServings),
    });
  });

  getHousehold().then((data) => {
    household = data;
    setBadgeDiet(dietRecipeFilter(data));
    renderPlannerPickers();
  }).catch(() => {});
}

/**
 * @param {object} client - the Supabase client
 * @param {number} id
 * @param {{ serves?: number, onEdit?: (id: number) => void, onDelete?: (id: number) => void,
 *   onApprove?: (id: number) => void, canEdit?: (recipe: object) => boolean, canApprove?: (recipe: object) => boolean }} [options]
 *   canEdit/canApprove decide per recipe whether onEdit/onDelete and onApprove are offered.
 */
export async function openRecipeModal(client, id, { serves, onEdit, onDelete, onApprove, canEdit = () => true, canApprove = () => false } = {}) {
  const [recipe, ingredientGroups] = await Promise.all([
    fetchRecipeById(client, id),
    fetchRecipeIngredients(client, id),
  ]);
  if (!recipe) {
    showSnackbar('This recipe was removed.', 'error');
    return;
  }

  const modal = document.getElementById('recipeModal');
  if (!modal || !dialogHandle) return;

  current = { recipe, ingredientGroups, targetServings: serves && serves > 0 ? serves : (recipe.serves || 4) };

  const normalized = normalizeRecipe(recipe);
  document.getElementById('modalArt').innerHTML = dishArtSvg(normalized);
  document.getElementById('modalTitle').textContent = recipe.name;
  document.getElementById('modalHeroMeta').innerHTML = `
    <span class="tag">${escapeHtml(recipe.cuisine || 'General')}</span>
    ${spiceMeter(recipe.spice_level, { showUnknown: true })}
    <div class="badge-list">${dietaryBadges(normalized)}</div>
  `;

  const familyChip = document.getElementById('modalFamilyServingsChip');
  const defaultServings = household?.default_servings || recipe.serves || 4;
  familyChip.textContent = `Our family (${defaultServings})`;

  renderServings(current.targetServings);
  renderTimeBreakdown(recipe);

  const stepList = Array.isArray(recipe.steps) ? recipe.steps : [];
  document.getElementById('modalSteps').innerHTML = stepList.map((block) => {
    const steps = Array.isArray(block.steps) ? block.steps : [];
    return `<li><strong>${escapeHtml(block.group || 'Method')}</strong><ol>${steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol></li>`;
  }).join('') || '<li>No steps listed.</li>';

  renderNutrition(recipe);
  renderNotes(recipe);

  const editButton = document.getElementById('modalEditRecipe');
  const deleteButton = document.getElementById('modalDeleteRecipe');
  const editable = canEdit(recipe);
  editButton.hidden = !onEdit || !editable;
  editButton.onclick = onEdit ? () => { dialogHandle.close(); onEdit(recipe.id); } : null;
  deleteButton.hidden = !onDelete || !editable;
  deleteButton.onclick = onDelete ? () => { dialogHandle.close(); onDelete(recipe.id); } : null;
  const approveButton = document.getElementById('modalApproveRecipe');
  approveButton.hidden = !onApprove || !canApprove(recipe);
  approveButton.onclick = onApprove ? () => { dialogHandle.close(); onApprove(recipe.id); } : null;

  dialogHandle.open();
}

export function closeRecipeModal() {
  dialogHandle?.close();
}
