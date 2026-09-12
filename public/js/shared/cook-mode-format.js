// Formats a fetched recipe's ingredient groups as the plain HTML cook mode expects, scaled to a
// target serving count. Pulled out of recipe-modal.js so the dashboard's "Cook" shortcut (task
// 12.1) can build the same markup without opening the full recipe modal first.

import { escapeHtml } from '../shared/recipe-rules.js';
import { scaleQuantity, displayQuantity, formatQuantity } from './units.js';

function ingredientLineText(item, targetServings, fromServes) {
  const scaled = scaleQuantity(item.quantity, fromServes, targetServings, item.scales);
  const displayed = displayQuantity(scaled, item.unit);
  const amount = formatQuantity(displayed);
  const preparation = item.preparation ? `, ${item.preparation}` : '';
  const optional = item.isOptional ? ' (optional)' : '';
  return `${amount ? `${amount} ` : ''}${item.ingredientName}${preparation}${optional}`;
}

export function formatIngredientsHtml(ingredientGroups, targetServings, fromServes) {
  return ingredientGroups.map((group) => `
    <strong>${escapeHtml(group.group)}</strong>
    <ul>${group.items.map((item) => `<li>${escapeHtml(ingredientLineText(item, targetServings, fromServes))}</li>`).join('')}</ul>
  `).join('');
}
