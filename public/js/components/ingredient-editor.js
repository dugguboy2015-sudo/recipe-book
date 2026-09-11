import { escapeHtml, parseAmount, formatAmount, textToIngredients, deriveIngredientFlags } from '../shared/recipe-rules.js';
import { recipeIngredientsToPayload } from '../shared/ingredient-payload.js';
import { aggregateIngredientDietarySignal } from '../shared/dietary-suggestion.js';
import { searchIngredients } from '../lib/queries.js';

const UNIT_OPTIONS = [
  ['cup', 'cup'], ['tbsp', 'tbsp'], ['tsp', 'tsp'],
  ['piece', 'piece'], ['pinch', 'pinch'], ['clove', 'clove'], ['to_taste', 'to taste'],
  ['inch', 'inch'], ['sprig', 'sprig'], ['handful', 'handful'], ['bunch', 'bunch'],
  ['g', 'g'], ['kg', 'kg'], ['ml', 'ml'], ['l', 'litre'],
];

let rowSeq = 0;
let groupSeq = 0;

function newRow(overrides = {}) {
  return {
    key: `row-${rowSeq++}`,
    ingredientId: null,
    ingredientName: '',
    ingredientFlags: null,
    ingredientReviewed: false,
    quantity: null,
    unit: 'tbsp',
    preparation: '',
    isOptional: false,
    scales: true,
    ...overrides,
  };
}

function newGroup(name = 'Ingredients', rows = [newRow()]) {
  return { key: `group-${groupSeq++}`, name, rows };
}

function unitOptionsHtml(selected) {
  return UNIT_OPTIONS.map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`).join('');
}

function rowHtml(row) {
  return `
    <div class="ingredient-row" data-row-key="${row.key}">
      <div class="combobox ingredient-combobox">
        <input type="text" class="ingredient-search" role="combobox" aria-expanded="false" aria-autocomplete="list"
          placeholder="Search ingredient…" value="${escapeHtml(row.ingredientName)}" autocomplete="off" />
        <ul class="combobox-listbox" role="listbox" hidden></ul>
      </div>
      <input type="text" class="ingredient-quantity" placeholder="1½" value="${row.quantity !== null ? escapeHtml(formatAmount(row.quantity)) : ''}" aria-label="Quantity" />
      <select class="ingredient-unit" aria-label="Unit">${unitOptionsHtml(row.unit)}</select>
      <input type="text" class="ingredient-preparation" placeholder="preparation, e.g. finely chopped" value="${escapeHtml(row.preparation)}" aria-label="Preparation" />
      <label class="checkbox-field"><input type="checkbox" class="ingredient-optional" ${row.isOptional ? 'checked' : ''} /> Optional</label>
      <label class="checkbox-field"><input type="checkbox" class="ingredient-no-scale" ${!row.scales ? 'checked' : ''} /> Doesn't scale</label>
      <button type="button" class="icon-button remove-row" aria-label="Remove ingredient">✕</button>
    </div>
  `;
}

function groupHtml(group, index, total) {
  return `
    <div class="ingredient-group" data-group-key="${group.key}">
      <div class="ingredient-group-header">
        <input type="text" class="group-name-input field" value="${escapeHtml(group.name)}" aria-label="Group name" />
        <div class="ingredient-group-actions">
          <button type="button" class="icon-button move-group-up" ${index === 0 ? 'disabled' : ''} aria-label="Move group up">↑</button>
          <button type="button" class="icon-button move-group-down" ${index === total - 1 ? 'disabled' : ''} aria-label="Move group down">↓</button>
          <button type="button" class="icon-button remove-group" aria-label="Remove group">✕</button>
        </div>
      </div>
      <div class="ingredient-rows">${group.rows.map(rowHtml).join('')}</div>
      <button type="button" class="ghost-button add-row">+ Add ingredient</button>
    </div>
  `;
}

/**
 * Mounts the structured ingredient editor (task 7.1) into `container`.
 * @param {{ client: object, container: HTMLElement }} options
 */
export function createIngredientEditor({ client, container, onChange }) {
  let groups = [newGroup()];
  const searchResultsByRow = new Map();

  function render() {
    container.innerHTML = `
      <div class="ingredient-groups">${groups.map((g, i) => groupHtml(g, i, groups.length)).join('')}</div>
      <div class="ingredient-editor-actions">
        <button type="button" class="ghost-button add-group">+ Add group</button>
        <button type="button" class="ghost-button paste-list-button">Paste a list</button>
      </div>
      <div class="paste-list-panel" hidden>
        <label class="field"><span>Paste ingredients (one per line, "amount unit | name")</span>
          <textarea class="paste-list-textarea" rows="6"></textarea>
        </label>
        <div class="form-actions">
          <button type="button" class="ghost-button cancel-paste">Cancel</button>
          <button type="button" class="primary-button apply-paste">Add parsed rows</button>
        </div>
      </div>
    `;
    wireEvents();
    onChange?.();
  }

  function findGroup(key) {
    return groups.find((g) => g.key === key);
  }
  function findRow(groupKey, rowKey) {
    const group = findGroup(groupKey);
    return group?.rows.find((r) => r.key === rowKey);
  }

  function closeAllListboxes() {
    container.querySelectorAll('.combobox-listbox').forEach((el) => { el.hidden = true; });
  }

  async function handleComboboxInput(input) {
    const term = input.value;
    const listbox = input.parentElement.querySelector('.combobox-listbox');
    const rowEl = input.closest('.ingredient-row');
    const groupKey = rowEl.closest('.ingredient-group').dataset.groupKey;
    const row = findRow(groupKey, rowEl.dataset.rowKey);
    row.ingredientId = null;
    row.ingredientName = term;

    if (term.trim().length < 2) {
      listbox.hidden = true;
      return;
    }
    const matches = await searchIngredients(client, term);
    searchResultsByRow.set(row.key, matches);
    const options = matches.map((m) => `<li class="combobox-option" role="option" data-id="${m.id}" data-name="${escapeHtml(m.display_name || m.name)}">${escapeHtml(m.display_name || m.name)}</li>`).join('');
    const addNewOption = `<li class="combobox-option combobox-add-new" role="option" data-new="true">Add "${escapeHtml(term)}" as a new ingredient</li>`;
    listbox.innerHTML = options + addNewOption;
    listbox.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  function wireEvents() {
    container.querySelector('.add-group')?.addEventListener('click', () => {
      groups.push(newGroup());
      render();
    });

    container.querySelector('.paste-list-button')?.addEventListener('click', () => {
      container.querySelector('.paste-list-panel').hidden = false;
    });
    container.querySelector('.cancel-paste')?.addEventListener('click', () => {
      container.querySelector('.paste-list-panel').hidden = true;
    });
    container.querySelector('.apply-paste')?.addEventListener('click', async () => {
      const text = container.querySelector('.paste-list-textarea').value;
      const parsedGroups = textToIngredients(text);
      if (parsedGroups.length === 0) return;

      groups = await Promise.all(parsedGroups.map(async (g) => newGroup(g.group, await Promise.all(g.items.map(async (item) => {
        const name = item.name.trim();
        const matches = name.length >= 2 ? await searchIngredients(client, name) : [];
        const exact = matches.find((m) => (m.display_name || m.name).toLowerCase() === name.toLowerCase());
        return newRow({
          ingredientId: exact?.id ?? null,
          ingredientName: exact ? (exact.display_name || exact.name) : name,
          ingredientFlags: exact
            ? { contains_meat: exact.contains_meat, contains_egg: exact.contains_egg, contains_dairy: exact.contains_dairy, contains_nuts: exact.contains_nuts, contains_gluten: exact.contains_gluten }
            : deriveIngredientFlags(name),
          ingredientReviewed: exact?.status === 'reviewed',
          quantity: item.amount,
          unit: UNIT_OPTIONS.some(([v]) => v === item.unit) ? item.unit : 'tbsp',
        });
      })))));
      render();
    });

    container.querySelectorAll('.ingredient-group').forEach((groupEl) => {
      const groupKey = groupEl.dataset.groupKey;
      const group = findGroup(groupKey);

      groupEl.querySelector('.group-name-input').addEventListener('input', (e) => { group.name = e.target.value; });
      groupEl.querySelector('.move-group-up')?.addEventListener('click', () => {
        const i = groups.findIndex((g) => g.key === groupKey);
        if (i > 0) { [groups[i - 1], groups[i]] = [groups[i], groups[i - 1]]; render(); }
      });
      groupEl.querySelector('.move-group-down')?.addEventListener('click', () => {
        const i = groups.findIndex((g) => g.key === groupKey);
        if (i < groups.length - 1) { [groups[i + 1], groups[i]] = [groups[i], groups[i + 1]]; render(); }
      });
      groupEl.querySelector('.remove-group')?.addEventListener('click', () => {
        groups = groups.filter((g) => g.key !== groupKey);
        if (groups.length === 0) groups = [newGroup()];
        render();
      });
      groupEl.querySelector('.add-row').addEventListener('click', () => {
        group.rows.push(newRow());
        render();
      });

      groupEl.querySelectorAll('.ingredient-row').forEach((rowEl) => {
        const rowKey = rowEl.dataset.rowKey;
        const row = findRow(groupKey, rowKey);

        const searchInput = rowEl.querySelector('.ingredient-search');
        searchInput.addEventListener('input', () => handleComboboxInput(searchInput));
        searchInput.addEventListener('blur', () => setTimeout(() => { searchInput.parentElement.querySelector('.combobox-listbox').hidden = true; }, 150));
        rowEl.querySelector('.combobox-listbox').addEventListener('mousedown', (e) => {
          const option = e.target.closest('.combobox-option');
          if (!option) return;
          e.preventDefault();
          if (option.dataset.new) {
            const name = searchInput.value.trim();
            row.ingredientId = null;
            row.ingredientName = name;
            row.ingredientFlags = deriveIngredientFlags(name);
            row.ingredientReviewed = false;
          } else {
            const id = Number(option.dataset.id);
            const match = (searchResultsByRow.get(row.key) || []).find((m) => m.id === id);
            row.ingredientId = id;
            row.ingredientName = option.dataset.name;
            row.ingredientFlags = match
              ? { contains_meat: match.contains_meat, contains_egg: match.contains_egg, contains_dairy: match.contains_dairy, contains_nuts: match.contains_nuts, contains_gluten: match.contains_gluten }
              : null;
            row.ingredientReviewed = match?.status === 'reviewed';
          }
          searchInput.value = row.ingredientName;
          closeAllListboxes();
          onChange?.();
        });

        rowEl.querySelector('.ingredient-quantity').addEventListener('input', (e) => { row.quantity = parseAmount(e.target.value); });
        rowEl.querySelector('.ingredient-unit').addEventListener('change', (e) => { row.unit = e.target.value; });
        rowEl.querySelector('.ingredient-preparation').addEventListener('input', (e) => { row.preparation = e.target.value; });
        rowEl.querySelector('.ingredient-optional').addEventListener('change', (e) => { row.isOptional = e.target.checked; });
        rowEl.querySelector('.ingredient-no-scale').addEventListener('change', (e) => { row.scales = !e.target.checked; });
        rowEl.querySelector('.remove-row').addEventListener('click', () => {
          group.rows = group.rows.filter((r) => r.key !== rowKey);
          if (group.rows.length === 0) group.rows.push(newRow());
          render();
        });
      });
    });
  }

  /** @returns {Array} the B.4 `ingredients` array */
  function getValue() {
    return recipeIngredientsToPayload(groups.map((g) => ({ group: g.name, items: g.rows })));
  }

  /** Populates the editor from `fetchRecipeIngredients`'s groups (queries.js), for opening Edit. */
  function setValue(recipeIngredientGroups) {
    if (!recipeIngredientGroups || recipeIngredientGroups.length === 0) {
      groups = [newGroup()];
    } else {
      groups = recipeIngredientGroups.map((g) => newGroup(g.group, g.items.map((item) => newRow({
        ingredientId: item.ingredientId ?? null,
        ingredientName: item.ingredientName ?? '',
        ingredientFlags: item.ingredientFlags ?? null,
        ingredientReviewed: Boolean(item.ingredientReviewed),
        quantity: item.quantity ?? null,
        unit: item.unit ?? 'tbsp',
        preparation: item.preparation ?? '',
        isOptional: Boolean(item.isOptional),
        scales: item.scales !== false,
      }))));
    }
    render();
  }

  function reset() {
    groups = [newGroup()];
    render();
  }

  /**
   * Aggregate dietary flags across every named row (task 7.3's "Based on the ingredients: …"
   * auto-suggestion), or null when any row is unnamed, unresolved, or points at an unreviewed
   * ingredient — the household confirm should never fire off a guess.
   */
  function getDietarySignal() {
    return aggregateIngredientDietarySignal(groups.flatMap((g) => g.rows));
  }

  render();
  return { getValue, setValue, reset, getDietarySignal };
}
