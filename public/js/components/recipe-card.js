import { escapeHtml } from '../shared/html.js';
import { monogramSvg } from './monogram.js';

export function normalizeRecipe(recipe) {
  return {
    ...recipe,
    tags: Array.isArray(recipe.tags) ? recipe.tags : [],
    mealTypes: Array.isArray(recipe.meal_types) ? recipe.meal_types : [],
    cuisine: recipe.cuisine || 'General',
    serves: recipe.serves || 4,
    totalTime: recipe.total_time_minutes ?? '—',
    is_vegetarian: Boolean(recipe.is_vegetarian),
    is_egg_free: Boolean(recipe.is_egg_free),
    contains_dairy: Boolean(recipe.contains_dairy),
  };
}

export function dietaryBadges(recipe) {
  return `
    ${recipe.is_vegetarian ? '<span class="badge veg">Vegetarian</span>' : ''}
    ${recipe.is_egg_free ? '<span class="badge egg">Egg-free</span>' : ''}
    ${recipe.contains_dairy ? '' : '<span class="badge dairy">Dairy-free</span>'}
    ${recipe.is_protein_smart ? '<span class="badge protein-smart">Protein-smart</span>' : ''}
    ${recipe.mealTypes?.includes('Packed Lunch') ? '<span class="badge packed-lunch">Packed lunch</span>' : ''}
    ${recipe.contains_nuts === false ? '<span class="badge nut-free">Nut-free</span>' : ''}
  `;
}

function tagList(recipe, limit) {
  return (recipe.tags || []).slice(0, limit).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('');
}

export function spiceMeter(level) {
  if (!level) return '';
  const chillies = Array.from({ length: 5 }, (_, i) => `<span class="chilli${i < level ? ' lit' : ''}" aria-hidden="true">🌶</span>`).join('');
  return `<span class="spice-meter" role="img" aria-label="Spice ${level} of 5">${chillies}</span>`;
}

/**
 * @param {object} recipe - normalized recipe (see normalizeRecipe)
 * @param {{ actions?: boolean, showTime?: boolean, tagLimit?: number }} [options]
 */
export function renderRecipeCard(recipe, { actions = false, showTime = false, tagLimit = 3 } = {}) {
  const actionButtons = actions
    ? `<div class="recipe-card-actions">
        <button type="button" class="icon-button edit-button" data-action="edit" data-id="${recipe.id}" aria-label="Edit recipe">✎</button>
        <button type="button" class="icon-button delete-button" data-action="delete" data-id="${recipe.id}" aria-label="Delete recipe">🗑</button>
      </div>`
    : '';

  const timeMeta = showTime
    ? `<span>•</span><span>${recipe.totalTime !== '—' ? `${recipe.totalTime} min` : 'Time TBD'}</span>`
    : '';

  return `
    <article class="recipe-card" data-id="${recipe.id}">
      <div class="recipe-card-header">
        <div class="recipe-card-art" aria-hidden="true">${monogramSvg(recipe)}</div>
        <div class="recipe-card-title-wrap">
          <span class="cuisine-band" data-cuisine="${escapeHtml(recipe.cuisine)}">${escapeHtml(recipe.cuisine)}</span>
          <h3><button type="button" class="recipe-card-title-button">${escapeHtml(recipe.name)}</button></h3>
        </div>
        ${actionButtons}
      </div>
      <div class="recipe-meta">
        <span>${recipe.serves || 4} serves</span>
        ${timeMeta}
        ${spiceMeter(recipe.spice_level)}
      </div>
      <div class="tag-list">${tagList(recipe, tagLimit)}</div>
      <div class="badge-list">${dietaryBadges(recipe)}</div>
      ${recipe.protein_g ? `<div class="recipe-card-protein">${recipe.protein_g}g protein per serving</div>` : ''}
    </article>
  `;
}
