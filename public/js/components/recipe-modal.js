import { escapeHtml } from '../shared/recipe-rules.js';
import { fetchRecipeById } from '../lib/queries.js';
import { wireDialog } from './dialog.js';
import { showSnackbar } from '../lib/dom.js';

const MODAL_HTML = `
  <dialog id="recipeModal" class="recipe-detail">
    <div class="detail-header">
      <h3 id="modalTitle">Recipe</h3>
      <div class="detail-meta" id="modalMeta"></div>
    </div>
    <div class="detail-grid">
      <div class="detail-panel">
        <h4>Ingredients</h4>
        <ul id="modalIngredients"></ul>
      </div>
      <div class="detail-panel">
        <h4>Steps</h4>
        <ol id="modalSteps"></ol>
      </div>
      <div class="detail-panel">
        <h4>Nutrition</h4>
        <p id="modalNutrition"></p>
      </div>
      <div class="detail-panel">
        <h4>Notes</h4>
        <p id="modalNotes"></p>
      </div>
    </div>
    <div class="modal-footer">
      <button type="button" class="primary-button" id="closeModal">Close</button>
    </div>
  </dialog>
`;

let mounted = false;
let dialogHandle = null;

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
}

export async function openRecipeModal(client, id) {
  const data = await fetchRecipeById(client, id);
  if (!data) {
    showSnackbar('This recipe was removed.', 'error');
    return;
  }

  const modal = document.getElementById('recipeModal');
  if (!modal || !dialogHandle) return;

  document.getElementById('modalTitle').textContent = data.name;
  document.getElementById('modalMeta').innerHTML = `
    <span class="tag">${escapeHtml(data.cuisine || 'General')}</span>
    <span class="tag">${data.serves || 4} serves</span>
    <span class="tag">${data.total_time_minutes ? `${data.total_time_minutes} min` : 'Time TBD'}</span>
  `;

  const ingredientList = Array.isArray(data.ingredients) ? data.ingredients : [];
  document.getElementById('modalIngredients').innerHTML = ingredientList.map((group) => {
    const items = Array.isArray(group.items) ? group.items : [];
    return `<li><strong>${escapeHtml(group.group || 'Ingredients')}</strong><ul>${items.map((item) => `<li>${escapeHtml(item.name || '')}</li>`).join('')}</ul></li>`;
  }).join('') || '<li>No ingredients listed.</li>';

  const stepList = Array.isArray(data.steps) ? data.steps : [];
  document.getElementById('modalSteps').innerHTML = stepList.map((block) => {
    const list = Array.isArray(block.steps) ? block.steps : [];
    return `<li><strong>${escapeHtml(block.group || 'Method')}</strong><ol>${list.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol></li>`;
  }).join('') || '<li>No steps listed.</li>';

  document.getElementById('modalNutrition').textContent =
    `Calories: ${data.calories_kcal ?? '—'} kcal | Protein: ${data.protein_g ?? '—'} g | Carbs: ${data.carbs_g ?? '—'} g | Fat: ${data.fat_g ?? '—'} g | Fibre: ${data.fibre_g ?? '—'} g. ${data.nutrition_basis || ''}`;

  const notesList = [
    data.egg_check_notes ? `Egg check: ${data.egg_check_notes}` : '',
    data.common_mistakes ? `Common mistakes: ${data.common_mistakes}` : '',
    data.uk_sourcing_notes ? `UK sourcing: ${data.uk_sourcing_notes}` : '',
    data.storage_notes ? `Storage: ${data.storage_notes}` : '',
    data.kid_friendly_notes ? `Kid-friendly: ${data.kid_friendly_notes}` : '',
  ].filter(Boolean);

  document.getElementById('modalNotes').textContent = notesList.length ? notesList.join(' ') : 'No additional notes.';
  dialogHandle.open();
}

export function closeRecipeModal() {
  dialogHandle?.close();
}
