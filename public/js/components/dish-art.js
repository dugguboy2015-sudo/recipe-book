import { dishTypeFor } from '../shared/dish-type.js';
import { monogramSvg } from './monogram.js';

// M3 (decision 3): curated illustrations instead of an initial letter, drawn here rather than
// stored — flat line art on the recipe's cuisine tint, so there are no image files to host, no
// upload flow, nothing to resize, and both themes stay correct because every colour is a token.
// A dish the keyword list doesn't recognise keeps the monogram, which still looks deliberate.

function cuisineVars(cuisine) {
  const known = ['South Indian', 'North Indian', 'Maharashtrian', 'Rajasthani', 'Chaat', 'Indo-Chinese', 'Gujarati', 'Fusion'];
  const slug = known.includes(cuisine) ? cuisine.toLowerCase().replace(/\s+/g, '-') : 'other';
  return { bg: `var(--cuisine-${slug}-bg)`, ink: `var(--cuisine-${slug}-ink)` };
}

// Each drawing is built from the same primitives at the same weight, so the set reads as one hand:
// a 2.5px stroke, round caps, and fills only ever at low opacity.
const ART = {
  curry: (ink) => `
    <path d="M26 62 h68 a34 34 0 0 1 -68 0 z" fill="${ink}" fill-opacity="0.18" stroke="${ink}" stroke-width="2.5" stroke-linejoin="round" />
    <path d="M20 62 h80" stroke="${ink}" stroke-width="2.5" stroke-linecap="round" />
    <circle cx="52" cy="74" r="4" fill="${ink}" fill-opacity="0.5" />
    <circle cx="68" cy="80" r="3" fill="${ink}" fill-opacity="0.35" />
    <path d="M48 44 q4 -8 0 -14 M60 40 q4 -9 0 -16 M72 44 q4 -8 0 -14" fill="none" stroke="${ink}" stroke-width="2.5" stroke-linecap="round" opacity="0.6" />`,
  rice: (ink) => `
    <ellipse cx="60" cy="78" rx="38" ry="12" fill="none" stroke="${ink}" stroke-width="2.5" />
    <path d="M28 76 q32 -34 64 0" fill="${ink}" fill-opacity="0.18" stroke="${ink}" stroke-width="2.5" stroke-linejoin="round" />
    <path d="M46 62 l4 -5 M60 54 l4 -5 M74 62 l4 -5" stroke="${ink}" stroke-width="2.5" stroke-linecap="round" opacity="0.7" />`,
  flatbread: (ink) => `
    <circle cx="60" cy="62" r="32" fill="${ink}" fill-opacity="0.18" stroke="${ink}" stroke-width="2.5" />
    <circle cx="60" cy="62" r="22" fill="none" stroke="${ink}" stroke-width="2.5" opacity="0.45" />
    <circle cx="50" cy="52" r="3" fill="${ink}" fill-opacity="0.5" />
    <circle cx="70" cy="68" r="4" fill="${ink}" fill-opacity="0.4" />
    <circle cx="62" cy="48" r="2.5" fill="${ink}" fill-opacity="0.45" />`,
  dosa: (ink) => `
    <path d="M24 82 q36 -52 72 0 z" fill="${ink}" fill-opacity="0.18" stroke="${ink}" stroke-width="2.5" stroke-linejoin="round" />
    <path d="M40 78 q20 -26 40 0" fill="none" stroke="${ink}" stroke-width="2.5" opacity="0.5" />
    <circle cx="60" cy="72" r="5" fill="${ink}" fill-opacity="0.45" />`,
  chaat: (ink) => `
    <path d="M22 66 h76 a38 38 0 0 1 -76 0 z" fill="none" stroke="${ink}" stroke-width="2.5" stroke-linejoin="round" />
    <path d="M34 60 l10 -10 l10 10 l10 -12 l10 12 l10 -8" fill="none" stroke="${ink}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
    <circle cx="46" cy="76" r="4" fill="${ink}" fill-opacity="0.45" />
    <circle cx="62" cy="80" r="3.5" fill="${ink}" fill-opacity="0.35" />
    <circle cx="76" cy="74" r="3" fill="${ink}" fill-opacity="0.4" />`,
  sandwich: (ink) => `
    <path d="M28 46 h64 v10 h-64 z" fill="${ink}" fill-opacity="0.2" stroke="${ink}" stroke-width="2.5" stroke-linejoin="round" />
    <path d="M28 56 q32 12 64 0" fill="none" stroke="${ink}" stroke-width="2.5" opacity="0.55" />
    <path d="M28 64 h64 v12 a6 6 0 0 1 -6 6 h-52 a6 6 0 0 1 -6 -6 z" fill="${ink}" fill-opacity="0.18" stroke="${ink}" stroke-width="2.5" stroke-linejoin="round" />`,
  wrap: (ink) => `
    <path d="M44 24 h20 a10 10 0 0 1 10 10 v52 a10 10 0 0 1 -10 10 h-20 a10 10 0 0 1 -10 -10 v-52 a10 10 0 0 1 10 -10 z" fill="${ink}" fill-opacity="0.18" stroke="${ink}" stroke-width="2.5" />
    <path d="M34 44 q20 8 40 0 M34 62 q20 8 40 0 M34 80 q20 8 40 0" fill="none" stroke="${ink}" stroke-width="2.5" opacity="0.5" />`,
  noodles: (ink) => `
    <path d="M26 64 h68 a34 34 0 0 1 -68 0 z" fill="none" stroke="${ink}" stroke-width="2.5" stroke-linejoin="round" />
    <path d="M38 62 q8 -22 22 -10 q14 12 22 -6" fill="none" stroke="${ink}" stroke-width="2.5" stroke-linecap="round" />
    <path d="M42 70 q10 -16 20 -6 q12 10 18 -4" fill="none" stroke="${ink}" stroke-width="2.5" stroke-linecap="round" opacity="0.6" />
    <path d="M78 30 l10 22" stroke="${ink}" stroke-width="2.5" stroke-linecap="round" opacity="0.7" />`,
  sweet: (ink) => `
    <path d="M60 28 l26 22 v34 a6 6 0 0 1 -6 6 h-40 a6 6 0 0 1 -6 -6 v-34 z" fill="${ink}" fill-opacity="0.18" stroke="${ink}" stroke-width="2.5" stroke-linejoin="round" />
    <path d="M34 50 h52" stroke="${ink}" stroke-width="2.5" opacity="0.5" />
    <circle cx="60" cy="24" r="4" fill="${ink}" fill-opacity="0.6" />
    <path d="M48 66 q12 10 24 0" fill="none" stroke="${ink}" stroke-width="2.5" stroke-linecap="round" opacity="0.55" />`,
  'fried-snack': (ink) => `
    <path d="M60 30 l30 52 h-60 z" fill="${ink}" fill-opacity="0.18" stroke="${ink}" stroke-width="2.5" stroke-linejoin="round" />
    <path d="M46 62 h28" stroke="${ink}" stroke-width="2.5" opacity="0.5" />
    <circle cx="60" cy="50" r="3.5" fill="${ink}" fill-opacity="0.5" />
    <path d="M24 92 h72" stroke="${ink}" stroke-width="2.5" stroke-linecap="round" opacity="0.45" />`,
  drink: (ink) => `
    <path d="M42 34 h36 l-5 54 a8 8 0 0 1 -8 7 h-10 a8 8 0 0 1 -8 -7 z" fill="${ink}" fill-opacity="0.18" stroke="${ink}" stroke-width="2.5" stroke-linejoin="round" />
    <path d="M44 52 h32" stroke="${ink}" stroke-width="2.5" opacity="0.5" />
    <path d="M66 30 l8 -12" stroke="${ink}" stroke-width="2.5" stroke-linecap="round" opacity="0.7" />`,
  salad: (ink) => `
    <path d="M24 60 h72 a36 36 0 0 1 -72 0 z" fill="none" stroke="${ink}" stroke-width="2.5" stroke-linejoin="round" />
    <circle cx="46" cy="50" r="9" fill="${ink}" fill-opacity="0.22" stroke="${ink}" stroke-width="2.5" />
    <circle cx="68" cy="46" r="7" fill="${ink}" fill-opacity="0.16" stroke="${ink}" stroke-width="2.5" />
    <path d="M56 58 q10 -16 24 -8" fill="none" stroke="${ink}" stroke-width="2.5" stroke-linecap="round" opacity="0.6" />`,
};

/**
 * The illustration for a recipe: its dish type drawn on its cuisine tint, or the monogram when the
 * dish isn't one we draw yet. Decorative — every caller already marks the wrapper aria-hidden.
 */
export function dishArtSvg(recipe) {
  const type = dishTypeFor(recipe);
  const draw = type && ART[type];
  if (!draw) return monogramSvg(recipe);
  const { bg, ink } = cuisineVars(recipe.cuisine);
  return `
    <svg viewBox="0 0 120 120" role="img" aria-label="" class="dish-art" data-dish-type="${type}" xmlns="http://www.w3.org/2000/svg">
      <rect width="120" height="120" rx="16" fill="${bg}" />
      ${draw(ink)}
    </svg>`;
}

export { dishTypeFor };
