// Deterministic SVG art per recipe (Appendix L.4): a hash of the slug picks a rotation and a
// pattern variant; the cuisine tint and the recipe's first letter come from the recipe itself.
// No photos, no external images, no hardcoded colours (everything below is a CSS custom property
// so both themes and the cuisine tints stay token-driven).

function hashString(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function cuisineVars(cuisine) {
  const known = ['South Indian', 'North Indian', 'Maharashtrian', 'Rajasthani', 'Chaat', 'Indo-Chinese', 'Gujarati', 'Fusion'];
  const slug = known.includes(cuisine) ? cuisine.toLowerCase().replace(/\s+/g, '-') : 'other';
  return { bg: `var(--cuisine-${slug}-bg)`, ink: `var(--cuisine-${slug}-ink)` };
}

export function monogramSvg(recipe) {
  const seed = hashString(recipe.slug || recipe.name || '');
  const rotation = seed % 360;
  const variant = seed % 3;
  const { bg, ink } = cuisineVars(recipe.cuisine);
  const letter = String(recipe.name || '?').trim().charAt(0).toUpperCase() || '?';

  const shapes = [
    `<circle cx="60" cy="60" r="34" fill="none" stroke="${ink}" stroke-width="3" opacity="0.35" />`,
    `<rect x="26" y="26" width="68" height="68" rx="16" fill="none" stroke="${ink}" stroke-width="3" opacity="0.35" />`,
    `<path d="M60 20 L96 60 L60 100 L24 60 Z" fill="none" stroke="${ink}" stroke-width="3" opacity="0.35" />`,
  ];

  return `
    <svg viewBox="0 0 120 120" role="img" aria-label="" class="monogram" xmlns="http://www.w3.org/2000/svg">
      <rect width="120" height="120" rx="16" fill="${bg}" />
      <g transform="rotate(${rotation} 60 60)">${shapes[variant]}</g>
      <text x="60" y="72" text-anchor="middle" font-family="Fraunces, serif" font-size="40" font-weight="700" fill="${ink}">${letter}</text>
    </svg>
  `;
}
