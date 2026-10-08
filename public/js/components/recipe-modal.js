import { escapeHtml } from '../shared/html.js';
import { fetchRecipeById, fetchRecipeIngredients, fetchRecipeBySlug } from '../lib/queries.js';
import { RECIPE_PARAMS, recipeSearchParams, parseRecipeParams } from '../lib/url-state.js';
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
import { wireOverflowMenu } from './overflow-menu.js';
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
  <dialog id="recipeModal" class="recipe-detail recipe-sheet">
    <header class="detail-header">
      <div class="detail-header-bar">
        <h3 id="modalTitle" tabindex="-1" autofocus>Recipe</h3>
        <div class="detail-header-controls">
          <div class="overflow-menu">
            <button type="button" class="icon-button" id="modalMoreActions" aria-haspopup="true" aria-expanded="false" aria-label="More actions" data-tooltip="More actions"><svg class="icon" aria-hidden="true"><use href="#i-more"></use></svg></button>
            <div class="overflow-menu-list" id="modalMoreMenu" role="menu" hidden>
              <button type="button" role="menuitem" id="modalShareRecipe">Share</button>
              <button type="button" role="menuitem" id="modalPrintRecipe">Print</button>
              <button type="button" role="menuitem" id="modalApproveRecipe" hidden>Approve for the catalogue</button>
              <button type="button" role="menuitem" id="modalEditRecipe" hidden>Edit</button>
              <button type="button" role="menuitem" class="is-danger" id="modalDeleteRecipe" hidden>Delete</button>
            </div>
          </div>
          <button type="button" class="icon-button" id="closeModal" aria-label="Close recipe" data-tooltip="Close"><svg class="icon" aria-hidden="true"><use href="#i-close"></use></svg></button>
        </div>
      </div>
      <div class="recipe-hero">
        <div class="recipe-hero-art" id="modalArt" aria-hidden="true"></div>
        <div class="recipe-hero-meta" id="modalHeroMeta"></div>
      </div>
    </header>

    <div class="detail-body">
      <p class="scaled-notice" id="modalScaledNotice" hidden></p>

      <div class="detail-meta">
        <div class="servings-stepper">
          <button type="button" id="modalServingsMinus" aria-label="Fewer servings"><svg class="icon" aria-hidden="true"><use href="#i-minus"></use></svg></button>
          <output id="modalServingsValue">4</output>
          <button type="button" id="modalServingsPlus" aria-label="More servings"><svg class="icon" aria-hidden="true"><use href="#i-plus"></use></svg></button>
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
        <details class="detail-panel detail-collapsible" id="modalNutritionPanel" open>
          <summary><span class="detail-panel-title">Nutrition</span> <span class="hint">(per serving, estimate)</span></summary>
          <table class="nutrition-panel">
            <caption>Per serving. The last column compares each amount with an average adult’s recommended daily intake. Children and teenagers need different amounts, so read it as a rough guide.</caption>
            <thead><tr><th>Nutrient</th><th>Amount</th><th>Share of an adult’s day</th></tr></thead>
            <tbody id="modalNutrition"></tbody>
          </table>
        </details>
        <details class="detail-panel detail-collapsible" id="modalNotesPanel" open>
          <summary><span class="detail-panel-title">Notes</span></summary>
          <div id="modalNotes"></div>
        </details>
      </div>
    </div>

    <div class="detail-action-bar">
      <div class="detail-plan-row">
        <label class="sr-only" for="modalPlannerDay">Day</label>
        <select id="modalPlannerDay"></select>
        <label class="sr-only" for="modalPlannerSlot">Meal</label>
        <select id="modalPlannerSlot"></select>
      </div>
      <div class="detail-do-row">
        <button type="button" class="ghost-button" id="modalAddToPlanner">Add to plan</button>
        <button type="button" class="primary-button" id="modalCookMode">Cook mode</button>
      </div>
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
  const stages = [];
  if (recipe.prep_time_minutes) stages.push(`prep ${recipe.prep_time_minutes} min`);
  if (recipe.cook_time_minutes) stages.push(`cook ${recipe.cook_time_minutes} min`);
  const total = `Total ${recipe.total_time_minutes ? `${recipe.total_time_minutes} min` : 'TBD'}`;
  const node = document.getElementById('modalTimeBreakdown');
  node.textContent = stages.length ? `${total} · ${stages.join(', ')}` : total;

  // On 9 of these recipes the total is larger than prep + cook, which reads like an arithmetic
  // mistake but isn't: it's hands-off time — soaking, marinating, resting, proving. Name it, rather
  // than "fixing" the numbers into something that would under-state how long the dish really takes.
  const waiting = handsOffMinutes(recipe);
  const note = [
    waiting ? `${waiting} min of that is hands-off: soaking, marinating, resting or proving.` : '',
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
      ? '-'
      : trafficLight
        ? `<span class="ri-bar"><span class="ri-bar-fill ${trafficLight} ${nearestWidthClass(percent)}"></span></span>`
        : `${Math.round(percent)}%`;
    return `<tr><td>${label}</td><td>${value ?? '-'}${value !== null && value !== undefined ? ` ${unit}` : ''}</td><td>${percentCell}</td></tr>`;
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

/** Below this width the detail fills the screen and its secondary panels start collapsed. */
const PHONE = '(max-width: 767px)';

/**
 * P3: Nutrition and Notes are collapsed on a phone, where they sat between the reader and nothing.
 * This is behaviour rather than layout, so it branches on matchMedia rather than in CSS — a
 * <details> element's open state cannot be set from a stylesheet.
 */
function applyPanelDefaults() {
  const collapsed = window.matchMedia(PHONE).matches;
  for (const id of ['modalNutritionPanel', 'modalNotesPanel']) {
    const panel = document.getElementById(id);
    if (panel) panel.open = !collapsed;
  }
}

/**
 * A collapsed <details> prints as a heading with nothing under it, so a recipe printed from a
 * phone would lose its nutrition and notes entirely. Open everything for the print, then put it
 * back. (The print stylesheet has broken once before — M3 — so this is deliberate, not incidental.)
 */
function keepPrintWhole() {
  let reopened = [];
  window.addEventListener('beforeprint', () => {
    reopened = ['modalNutritionPanel', 'modalNotesPanel']
      .map((id) => document.getElementById(id))
      .filter((panel) => panel && !panel.open);
    for (const panel of reopened) panel.open = true;
  });
  window.addEventListener('afterprint', () => {
    for (const panel of reopened) panel.open = false;
    reopened = [];
  });
}

/* ---------- P2: the open recipe is a place you can go back from ----------
   Opening a recipe used to change nothing about the URL, so on a phone the Back gesture — the
   most-used control there is — left the page entirely instead of closing the recipe. A recipe now
   pushes a history entry; Back pops it and closes the detail; Forward reopens it; a reload or a
   shared link lands on the same recipe at the same servings.

   The flags keep the two directions from fighting: closing the detail ourselves unwinds the entry
   we pushed, and that unwind must not be mistaken for the visitor pressing Back. */
// Assigned when the modal mounts; the close handler above closes over it, so it is declared
// here rather than beside its assignment (same reason as ingredientEditorRef in recipe-form.js).
let setMoreMenuOpen = null;
let pushedHistoryEntry = false;
let closingFromPopstate = false;
let unwindingHistory = false;

function urlWith(params) {
  const query = params.toString();
  return window.location.pathname + (query ? '?' + query : '');
}

/** Keeps whatever the page itself owns (the recipes page's filters) out of harm's way. */
function preserveNonRecipeParams(params) {
  const current = new URLSearchParams(window.location.search);
  for (const [key, value] of current) {
    if (!RECIPE_PARAMS.includes(key) && !params.has(key)) params.set(key, value);
  }
  return params;
}

/** Puts this recipe in the address bar. Called as the detail opens. */
function pushRecipeUrl(slug, serves) {
  if (!slug) return;
  const params = preserveNonRecipeParams(recipeSearchParams(slug, serves));
  const alreadyThere = parseRecipeParams(new URLSearchParams(window.location.search)).slug === slug;
  if (alreadyThere) {
    // Arrived by deep link, refresh or Forward — that entry exists already, don't stack another.
    window.history.replaceState({ recipeSlug: slug }, '', urlWith(params));
    pushedHistoryEntry = false;
    return;
  }
  window.history.pushState({ recipeSlug: slug }, '', urlWith(params));
  pushedHistoryEntry = true;
}

/** Scaling the servings edits the current entry rather than adding one per tap. */
function replaceServingsInUrl(serves) {
  const params = new URLSearchParams(window.location.search);
  if (!params.get('recipe')) return;
  if (serves) params.set('serves', String(serves));
  else params.delete('serves');
  window.history.replaceState(window.history.state, '', urlWith(params));
}

/** Takes the recipe out of the address bar when the detail closes. */
function dropRecipeFromUrl() {
  if (pushedHistoryEntry) {
    pushedHistoryEntry = false;
    unwindingHistory = true;
    window.history.back();
    return;
  }
  // Nothing of ours to unwind (a deep link, or a refresh landed here) — edit the entry instead, so
  // Back still goes where the visitor came from rather than reopening what they just closed.
  const params = new URLSearchParams(window.location.search);
  for (const key of RECIPE_PARAMS) params.delete(key);
  window.history.replaceState(null, '', urlWith(params));
}

/**
 * Opens whatever recipe the URL names, if any. Every page that mounts the modal calls this, so a
 * shared link works from the dashboard and the planner too, not only from the recipes page.
 * @returns {Promise<boolean>} whether a recipe was opened
 */
export async function openRecipeFromUrl(client, options = {}) {
  const { slug, serves } = parseRecipeParams(new URLSearchParams(window.location.search));
  if (!slug) return false;
  const recipe = await fetchRecipeBySlug(client, slug);
  if (!recipe) {
    showSnackbar('This recipe was removed.', 'error');
    dropRecipeFromUrl();
    return false;
  }
  await openRecipeModal(client, recipe.id, { ...options, serves: serves || undefined });
  return true;
}

/** Wires Back and Forward once per page. */
function wireHistory(client, options) {
  window.addEventListener('popstate', async () => {
    if (unwindingHistory) {
      // This popstate is the one dropRecipeFromUrl() asked for, not the visitor going back.
      unwindingHistory = false;
      return;
    }
    const { slug } = parseRecipeParams(new URLSearchParams(window.location.search));
    const dialog = document.getElementById('recipeModal');
    if (!slug) {
      if (dialog?.open) {
        closingFromPopstate = true;
        dialogHandle?.close();
      }
      return;
    }
    if (current?.recipe?.slug === slug && dialog?.open) return;
    await openRecipeFromUrl(client, options);
  });
}

export function mountRecipeModal(client = null, options = {}) {
  if (mounted || document.getElementById('recipeModal')) {
    mounted = true;
    return;
  }
  document.body.insertAdjacentHTML('beforeend', MODAL_HTML);
  mounted = true;

  const dialog = document.getElementById('recipeModal');
  dialogHandle = wireDialog(dialog, {
    onClose: () => {
      // Fires for every route out: the Close button, Escape, a backdrop click, or Back.
      setMoreMenuOpen?.(false);
      if (closingFromPopstate) closingFromPopstate = false;
      else dropRecipeFromUrl();
    },
  });
  if (client) wireHistory(client, options);
  setMoreMenuOpen = wireOverflowMenu({
    button: document.getElementById('modalMoreActions'),
    menu: document.getElementById('modalMoreMenu'),
    within: dialog,
  });
  keepPrintWhole();
  document.getElementById('closeModal')?.addEventListener('click', () => dialogHandle.close());
  renderPlannerPickers();
  mountTip(document.getElementById('servingsTip'), 'servings');

  document.getElementById('modalServingsMinus')?.addEventListener('click', () => {
    if (!current || current.targetServings <= 1) return;
    current.targetServings -= 1;
    renderServings(current.targetServings);
    replaceServingsInUrl(current.targetServings);
  });
  document.getElementById('modalServingsPlus')?.addEventListener('click', () => {
    if (!current) return;
    current.targetServings += 1;
    renderServings(current.targetServings);
    replaceServingsInUrl(current.targetServings);
  });
  document.getElementById('modalFamilyServingsChip')?.addEventListener('click', () => {
    if (!current || !household) return;
    current.targetServings = household.default_servings || current.recipe.serves || 4;
    renderServings(current.targetServings);
    replaceServingsInUrl(current.targetServings);
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
      navigator.share({ title: current.recipe.name, text: `${current.recipe.name}, from our recipe book`, url }).catch(() => {});
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      showSnackbar('Link copied. Paste it to share this recipe.', 'success');
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

  applyPanelDefaults();
  pushRecipeUrl(recipe.slug, serves && serves > 0 ? serves : null);
  dialogHandle.open();
}

export function closeRecipeModal() {
  dialogHandle?.close();
}
