import { escapeHtml } from '../shared/recipe-rules.js';

export function normalizeRecipe(recipe) {
  return {
    ...recipe,
    tags: Array.isArray(recipe.tags) ? recipe.tags : [],
    cuisine: recipe.cuisine || 'General',
    serves: recipe.serves || 4,
    totalTime: recipe.total_time_minutes ?? '—',
    is_vegetarian: Boolean(recipe.is_vegetarian),
    is_egg_free: Boolean(recipe.is_egg_free),
    contains_dairy: Boolean(recipe.contains_dairy),
  };
}

function badges(recipe) {
  return `
    ${recipe.is_vegetarian ? '<span class="badge veg">Vegetarian</span>' : ''}
    ${recipe.is_egg_free ? '<span class="badge egg">Egg-free</span>' : ''}
    ${recipe.contains_dairy ? '' : '<span class="badge dairy">Dairy-free</span>'}
  `;
}

function tagList(recipe, limit) {
  return (recipe.tags || []).slice(0, limit).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('');
}

/**
 * @param {object} recipe - normalized recipe (see normalizeRecipe)
 * @param {{ actions?: boolean, showTime?: boolean, tagLimit?: number }} [options]
 */
export function renderRecipeCard(recipe, { actions = false, showTime = false, tagLimit = 3 } = {}) {
  const header = actions
    ? `<div class="recipe-card-header">
        <h3>${escapeHtml(recipe.name)}</h3>
        <div class="recipe-card-actions">
          <button type="button" class="icon-button edit-button" data-action="edit" data-id="${recipe.id}" aria-label="Edit recipe">✎</button>
          <button type="button" class="icon-button delete-button" data-action="delete" data-id="${recipe.id}" aria-label="Delete recipe">🗑</button>
        </div>
      </div>`
    : `<h3>${escapeHtml(recipe.name)}</h3>`;

  const timeMeta = showTime
    ? `<span>•</span><span>${recipe.totalTime !== '—' ? `${recipe.totalTime} min` : 'Time TBD'}</span>`
    : '';

  return `
    <article class="recipe-card" data-id="${recipe.id}">
      ${header}
      <div class="recipe-meta">
        <span>${escapeHtml(recipe.cuisine || 'General')}</span>
        <span>•</span>
        <span>${recipe.serves || 4} serves</span>
        ${timeMeta}
      </div>
      <div class="tag-list">${tagList(recipe, tagLimit)}</div>
      <div class="badge-list">${badges(recipe)}</div>
    </article>
  `;
}
