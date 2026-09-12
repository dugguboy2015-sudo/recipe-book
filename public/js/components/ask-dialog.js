import { wireDialog } from './dialog.js';

const DRAFT_KEY = 'recipeBook.pendingDraft';
const PLANNER_SLOT_KEY = 'recipeBook.pendingPlannerSlot';

/** @param {{day: string, slot: string}} intent */
export function storePendingPlannerSlot(intent) {
  try {
    sessionStorage.setItem(PLANNER_SLOT_KEY, JSON.stringify(intent));
  } catch (err) {
    console.error('Could not remember the planner slot for after saving:', err);
  }
}

/** Reads and clears the pending planner-slot intent (task 10.5), or null if there is none. */
export function takePendingPlannerSlot() {
  try {
    const raw = sessionStorage.getItem(PLANNER_SLOT_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(PLANNER_SLOT_KEY);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function storePendingDraft(draft, generationId, warnings, goalInfo) {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ draft, generationId, warnings, goalInfo }));
  } catch (err) {
    console.error('Could not store the AI draft for review on the next page:', err);
  }
}

/** Reads and clears the pending draft (task 10.5's cross-page handoff), or null if there is none. */
export function takePendingDraft() {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(DRAFT_KEY);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const DIALOG_HTML = `
  <dialog id="askRecipeDialog" class="recipe-detail add-recipe-panel" aria-labelledby="askRecipeTitle">
    <div class="detail-header"><h3 id="askRecipeTitle">Ask for a recipe</h3></div>
    <div id="askRecipeFlowContainer"></div>
    <div class="modal-footer">
      <button type="button" class="ghost-button" id="closeAskRecipeDialog">Close</button>
    </div>
  </dialog>
`;

let dialogHandle = null;

async function openAskDialog(options = {}) {
  // Opens immediately for instant feedback; generate-flow.js (~10KB, only needed once this
  // dialog is actually used) loads on demand instead of costing every page that mounts this
  // dialog (task 12.7's per-page performance budget).
  dialogHandle?.open();
  const container = document.getElementById('askRecipeFlowContainer');
  if (container) {
    const { createGenerateFlow } = await import('./generate-flow.js');
    createGenerateFlow({
      container,
      ...options,
      onDraftReady: (draft, generationId, warnings, goalInfo) => {
        storePendingDraft(draft, generationId, warnings, goalInfo);
        dialogHandle?.close();
        window.location.href = 'recipes.html?review=1';
      },
    });
    document.getElementById('generatePrompt')?.focus();
  }
}

/**
 * Mounts the "Ask for a recipe" dialog once per page (task 10.5) and wires every
 * `[data-open-ask-dialog]` header button to open it. Returns `{ open }` so a caller (e.g. the
 * planner's "Suggest something new") can open it pre-filled with a specific prompt/mealType.
 */
export function mountAskDialog() {
  if (!document.getElementById('askRecipeDialog')) {
    document.body.insertAdjacentHTML('beforeend', DIALOG_HTML);
    dialogHandle = wireDialog(document.getElementById('askRecipeDialog'));
    document.getElementById('closeAskRecipeDialog')?.addEventListener('click', () => dialogHandle.close());
    document.querySelectorAll('[data-open-ask-dialog]').forEach((button) => {
      button.addEventListener('click', () => openAskDialog());
    });
  }
  return { open: openAskDialog };
}
