import { escapeHtml } from '../shared/html.js';
import { debounce } from '../lib/dom.js';
import { searchIngredients } from '../lib/queries.js';

// M5: "what's in the fridge". Pick a few ingredients you already have; the page shows the recipes
// closest to cookable. The ranking itself is in shared/fridge-search.js — this is only the picker.

/**
 * @param {{ container: HTMLElement, client: object, onSearch: (ids: number[]) => void, onClear: () => void }} options
 */
export function createFridgeSearch({ container, client, onSearch, onClear }) {
  const chosen = new Map(); // id -> display name

  function render() {
    container.innerHTML = `
      <details class="fridge-search panel" ${chosen.size ? 'open' : ''}>
        <summary>What's in the fridge?</summary>
        <p class="hint">Pick what you already have and we'll show what you can nearly cook. Store-cupboard spices and oil are assumed.</p>
        <div class="fridge-picker">
          <label class="sr-only" for="fridgeInput">Add an ingredient you have</label>
          <input type="text" id="fridgeInput" class="search-box" placeholder="e.g. paneer, spinach, rice" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="fridgeSuggestions" />
          <ul class="fridge-suggestions" id="fridgeSuggestions" role="listbox" hidden></ul>
        </div>
        <div class="chip-group" id="fridgeChosen">${[...chosen.entries()].map(([id, name]) => `
          <span class="chip removable">${escapeHtml(name)}<button type="button" class="chip-remove" data-remove-have="${id}" aria-label="Remove ${escapeHtml(name)}">×</button></span>`).join('')}</div>
        <div class="form-actions form-actions-start">
          <button type="button" class="primary-button" id="fridgeSearchButton"${chosen.size ? '' : ' disabled'}>Show what I can cook</button>
          ${chosen.size ? '<button type="button" class="ghost-button" id="fridgeClear">Clear</button>' : ''}
        </div>
      </details>`;
    wire();
  }

  function wire() {
    const input = container.querySelector('#fridgeInput');
    const list = container.querySelector('#fridgeSuggestions');

    const suggest = debounce(async () => {
      const results = await searchIngredients(client, input.value, 6);
      const unchosen = results.filter((ingredient) => !chosen.has(ingredient.id));
      list.innerHTML = unchosen.map((ingredient) => `
        <li role="option"><button type="button" data-add-have="${ingredient.id}" data-name="${escapeHtml(ingredient.display_name || ingredient.name)}">${escapeHtml(ingredient.display_name || ingredient.name)}</button></li>`).join('');
      list.hidden = unchosen.length === 0;
      input.setAttribute('aria-expanded', String(!list.hidden));
      list.querySelectorAll('[data-add-have]').forEach((button) => {
        button.addEventListener('click', () => {
          chosen.set(Number(button.dataset.addHave), button.dataset.name);
          render();
          container.querySelector('#fridgeInput')?.focus();
        });
      });
    }, 250);

    input?.addEventListener('input', suggest);
    container.querySelectorAll('[data-remove-have]').forEach((button) => {
      button.addEventListener('click', () => {
        chosen.delete(Number(button.dataset.removeHave));
        render();
      });
    });
    container.querySelector('#fridgeSearchButton')?.addEventListener('click', () => onSearch([...chosen.keys()]));
    container.querySelector('#fridgeClear')?.addEventListener('click', () => {
      chosen.clear();
      render();
      onClear();
    });
  }

  render();
  return {
    /** The names behind the chosen ids, for the results heading. */
    chosenNames: () => [...chosen.values()],
    count: () => chosen.size,
  };
}
