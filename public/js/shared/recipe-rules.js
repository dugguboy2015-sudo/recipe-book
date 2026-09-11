// Pure functions, no DOM and no network. Imported by the browser (/js/shared/recipe-rules.js)
// and by Pages Functions (../../public/js/shared/recipe-rules.js, bundled by wrangler).

export const MEAL_TYPES = ['Breakfast', 'Packed Lunch', 'Lunch', 'Dinner', 'Snacks', 'Dessert'];

export const LIMITS = {
  name: [2, 120], description: 600, note: 1000, timeNote: 200,
  tags: 12, tagLength: 30,
  ingredientGroups: 12, ingredientsTotal: 60, ingredientName: 200,
  stepGroups: 12, stepsTotal: 40, stepLength: 600,
  serves: [1, 50], minutes: [0, 1440], nutritionMax: 5000,
};

export const DIETARY_FIELDS = ['is_vegetarian', 'is_egg_free', 'contains_dairy'];

export const WRITABLE_FIELDS = [
  'name', 'description', 'cuisine', 'origin_note', 'tags', 'meal_types', 'serves',
  'prep_time_minutes', 'cook_time_minutes', 'total_time_minutes', 'time_note',
  'steps', 'spice_level', 'lunchbox_notes', 'nutrition_source',
  'calories_kcal', 'protein_g', 'carbs_g', 'sugars_g', 'fibre_g', 'fat_g', 'saturates_g', 'salt_g', 'nutrition_basis',
  'egg_check_notes', 'common_mistakes', 'uk_sourcing_notes', 'storage_notes', 'kid_friendly_notes',
  ...DIETARY_FIELDS,
];

const NOTE_FIELDS = ['egg_check_notes', 'common_mistakes', 'uk_sourcing_notes', 'storage_notes', 'kid_friendly_notes', 'lunchbox_notes', 'origin_note'];
const MINUTE_FIELDS = ['prep_time_minutes', 'cook_time_minutes', 'total_time_minutes'];
const NUTRITION_FIELDS = ['calories_kcal', 'protein_g', 'carbs_g', 'sugars_g', 'fibre_g', 'fat_g', 'saturates_g', 'salt_g'];

export function slugify(name) {
  return String(name ?? '').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase().replace(/^-+|-+$/g, '');
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const UNICODE_FRACTIONS = { '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75 };

export function parseAmount(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return null;
  if (UNICODE_FRACTIONS[trimmed] !== undefined) return UNICODE_FRACTIONS[trimmed];
  const mixedUnicode = trimmed.match(/^(\d+)\s*([½⅓⅔¼¾])$/);
  if (mixedUnicode) return Number(mixedUnicode[1]) + UNICODE_FRACTIONS[mixedUnicode[2]];
  const mixed = trimmed.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const simple = trimmed.match(/^(\d+)\/(\d+)$/);
  if (simple) return Number(simple[1]) / Number(simple[2]);
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return null;
}

export function formatAmount(n) {
  if (n === null || n === undefined) return '';
  return String(n);
}

function findUnescapedPipe(line) {
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === '|' && line[i - 1] !== '\\') return i;
  }
  return -1;
}

function parseAmountUnit(left) {
  if (!left) return { amount: null, unit: '' };
  const tokens = left.split(/\s+/);
  if (tokens.length >= 2) {
    const twoToken = `${tokens[0]} ${tokens[1]}`;
    if (/^\d+\s+\d+\/\d+$/.test(twoToken)) {
      const amount = parseAmount(twoToken);
      if (amount !== null) return { amount, unit: tokens.slice(2).join(' ') };
    }
  }
  const amount = parseAmount(tokens[0]);
  if (amount !== null) return { amount, unit: tokens.slice(1).join(' ') };
  return { amount: null, unit: left };
}

export function ingredientsToText(groups) {
  const lines = [];
  for (const group of groups || []) {
    if (!Array.isArray(group.items) || group.items.length === 0) continue;
    lines.push(`# ${group.group || 'Ingredients'}`);
    for (const item of group.items) {
      const name = String(item.name || '').replace(/\|/g, '\\|');
      const amount = item.amount ?? null;
      const unit = item.unit || '';
      if (amount === null) {
        lines.push(unit ? `${unit} | ${name}` : name);
      } else {
        const amountUnit = unit ? `${formatAmount(amount)} ${unit}` : formatAmount(amount);
        lines.push(`${amountUnit} | ${name}`);
      }
    }
  }
  return lines.join('\n');
}

export function textToIngredients(text) {
  const groups = [];
  let current = null;
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('# ')) {
      current = { group: line.slice(2).trim(), items: [] };
      groups.push(current);
      continue;
    }
    if (!current) {
      current = { group: 'Ingredients', items: [] };
      groups.push(current);
    }
    const pipeIdx = findUnescapedPipe(line);
    if (pipeIdx === -1) {
      current.items.push({ name: line, unit: '', amount: null });
      continue;
    }
    const left = line.slice(0, pipeIdx).trim();
    const right = line.slice(pipeIdx + 1).trim().replace(/\\\|/g, '|');
    const { amount, unit } = parseAmountUnit(left);
    current.items.push({ name: right, unit, amount });
  }
  return groups.filter((g) => g.items.length > 0);
}

export function stepsToText(groups) {
  const lines = [];
  for (const group of groups || []) {
    if (!Array.isArray(group.steps) || group.steps.length === 0) continue;
    lines.push(`# ${group.group || 'Method'}`);
    for (const step of group.steps) lines.push(String(step));
  }
  return lines.join('\n');
}

export function textToSteps(text) {
  const groups = [];
  let current = null;
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('# ')) {
      current = { group: line.slice(2).trim(), steps: [] };
      groups.push(current);
      continue;
    }
    if (!current) {
      current = { group: 'Method', steps: [] };
      groups.push(current);
    }
    current.steps.push(line);
  }
  return groups.filter((g) => g.steps.length > 0);
}

export function reconcileTimes({ prep, cook, total }) {
  const havePrepOrCook = prep != null || cook != null;
  const sum = (prep ?? 0) + (cook ?? 0);
  if (total == null) {
    return havePrepOrCook ? { prep, cook, total: sum, adjusted: false } : { prep, cook, total, adjusted: false };
  }
  if (havePrepOrCook && total < sum) {
    return { prep, cook, total: sum, adjusted: true };
  }
  return { prep, cook, total, adjusted: false };
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function countIngredientLines(ingredients) {
  if (!Array.isArray(ingredients)) return 0;
  return ingredients.reduce((n, g) => n + (Array.isArray(g?.items) ? g.items.length : 0), 0);
}

export function normalizeRecipeInput(raw, { cuisines = [], mode = 'strict', partial = false } = {}) {
  const input = isPlainObject(raw) ? raw : {};
  const errors = {};
  const warnings = [];
  const value = {};
  const draft = mode === 'draft';

  const present = (field) => Object.prototype.hasOwnProperty.call(input, field);
  const shouldValidate = (field) => (partial ? present(field) : true);

  // Dietary fields: never defaulted, must be real booleans in every mode.
  for (const field of DIETARY_FIELDS) {
    if (!shouldValidate(field)) continue;
    if (!present(field)) {
      errors[field] = `${field} is required.`;
      continue;
    }
    if (typeof input[field] !== 'boolean') {
      errors[field] = `${field} must be true or false.`;
      continue;
    }
    value[field] = input[field];
  }

  if (shouldValidate('name')) {
    if (!present('name')) {
      errors.name = 'name is required.';
    } else {
      const name = String(input.name ?? '').trim();
      const [min, max] = LIMITS.name;
      if (name.length < min || name.length > max) {
        errors.name = `name must be between ${min} and ${max} characters.`;
      } else {
        value.name = name;
      }
    }
  }

  if (shouldValidate('cuisine')) {
    if (!present('cuisine')) {
      errors.cuisine = 'cuisine is required.';
    } else {
      const cuisine = String(input.cuisine ?? '').trim();
      if (cuisines.length > 0 && !cuisines.includes(cuisine)) {
        if (draft) {
          value.cuisine = 'Other';
          warnings.push({ field: 'cuisine', code: 'unknown_cuisine', message: `Unknown cuisine "${cuisine}"; set to Other.` });
        } else {
          errors.cuisine = `cuisine must be one of the known cuisines.`;
        }
      } else {
        value.cuisine = cuisine;
      }
    }
  }

  if (shouldValidate('description')) {
    const description = input.description === '' || input.description == null ? null : String(input.description).trim();
    if (description && description.length > LIMITS.description) {
      if (draft) {
        value.description = description.slice(0, LIMITS.description);
        warnings.push({ field: 'description', code: 'truncated', message: 'description was truncated to the length limit.' });
      } else {
        errors.description = `description must be at most ${LIMITS.description} characters.`;
      }
    } else {
      value.description = description;
    }
  }

  for (const field of NOTE_FIELDS) {
    if (!shouldValidate(field)) continue;
    const text = input[field] === '' || input[field] == null ? null : String(input[field]).trim();
    const limit = field === 'origin_note' || field === 'lunchbox_notes' ? LIMITS.note : LIMITS.note;
    if (text && text.length > limit) {
      if (draft) {
        value[field] = text.slice(0, limit);
        warnings.push({ field, code: 'truncated', message: `${field} was truncated to the length limit.` });
      } else {
        errors[field] = `${field} must be at most ${limit} characters.`;
      }
    } else {
      value[field] = text;
    }
  }

  if (shouldValidate('serves')) {
    const [min, max] = LIMITS.serves;
    const serves = input.serves == null || input.serves === '' ? null : Number(input.serves);
    if (serves === null || !Number.isFinite(serves) || serves < min || serves > max) {
      errors.serves = `serves must be between ${min} and ${max}.`;
    } else {
      value.serves = Math.round(serves);
    }
  }

  for (const field of MINUTE_FIELDS) {
    if (!shouldValidate(field)) continue;
    if (input[field] == null || input[field] === '') {
      value[field] = null;
      continue;
    }
    const [min, max] = LIMITS.minutes;
    const minutes = Number(input[field]);
    if (!Number.isFinite(minutes) || minutes < min || minutes > max) {
      errors[field] = `${field} must be between ${min} and ${max}.`;
    } else {
      value[field] = Math.round(minutes);
    }
  }

  for (const field of NUTRITION_FIELDS) {
    if (!shouldValidate(field)) continue;
    if (input[field] == null || input[field] === '') {
      value[field] = null;
      continue;
    }
    const amount = Number(input[field]);
    if (!Number.isFinite(amount) || amount < 0 || amount > LIMITS.nutritionMax) {
      errors[field] = `${field} must be between 0 and ${LIMITS.nutritionMax}.`;
    } else {
      value[field] = amount;
    }
  }

  if (shouldValidate('nutrition_basis')) {
    value.nutrition_basis = input.nutrition_basis === '' || input.nutrition_basis == null ? null : String(input.nutrition_basis).trim();
  }
  if (shouldValidate('nutrition_source')) {
    value.nutrition_source = input.nutrition_source ?? null;
  }
  if (shouldValidate('time_note')) {
    const timeNote = input.time_note === '' || input.time_note == null ? null : String(input.time_note).trim();
    value.time_note = timeNote && timeNote.length > LIMITS.timeNote ? timeNote.slice(0, LIMITS.timeNote) : timeNote;
  }

  if (shouldValidate('spice_level')) {
    if (input.spice_level == null || input.spice_level === '') {
      value.spice_level = null;
    } else {
      const level = Number(input.spice_level);
      if (!Number.isInteger(level) || level < 1 || level > 5) {
        errors.spice_level = 'spice_level must be an integer from 1 to 5.';
      } else {
        value.spice_level = level;
      }
    }
  }

  if (shouldValidate('tags')) {
    const tags = Array.isArray(input.tags) ? input.tags.map((t) => String(t).trim()).filter(Boolean) : [];
    if (tags.length > LIMITS.tags || tags.some((t) => t.length > LIMITS.tagLength)) {
      if (draft) {
        value.tags = tags.slice(0, LIMITS.tags).map((t) => t.slice(0, LIMITS.tagLength));
        warnings.push({ field: 'tags', code: 'truncated', message: 'tags were truncated to the limit.' });
      } else {
        errors.tags = `tags must be at most ${LIMITS.tags} items of ${LIMITS.tagLength} characters each.`;
      }
    } else {
      value.tags = tags;
    }
  }

  if (shouldValidate('meal_types')) {
    const mealTypes = Array.isArray(input.meal_types) ? input.meal_types.filter((m) => MEAL_TYPES.includes(m)) : [];
    value.meal_types = mealTypes;
  }

  if (shouldValidate('steps')) {
    if (!present('steps')) {
      if (!partial) errors.steps = 'steps is required.';
    } else {
      const steps = Array.isArray(input.steps) ? input.steps : [];
      const totalSteps = steps.reduce((n, g) => n + (Array.isArray(g?.steps) ? g.steps.length : 0), 0);
      if (!partial && mode === 'strict' && totalSteps === 0) {
        errors.steps = 'Add at least one cooking step.';
      } else if (totalSteps > LIMITS.stepsTotal || steps.length > LIMITS.stepGroups) {
        if (draft) {
          warnings.push({ field: 'steps', code: 'truncated', message: 'steps were truncated to the limit.' });
          value.steps = steps.slice(0, LIMITS.stepGroups).map((g) => ({ ...g, steps: (g.steps || []).slice(0, LIMITS.stepsTotal) }));
        } else {
          errors.steps = `steps must be at most ${LIMITS.stepGroups} groups and ${LIMITS.stepsTotal} steps total.`;
        }
      } else {
        value.steps = steps;
      }
    }
  }

  // ingredients aren't a WRITABLE_FIELDS entry (structured ingredients travel separately, Appendix
  // B.4) but the count limit is still enforced here against whatever shape the caller passes in,
  // so the front-end form and drafts get the same limit feedback before the separate B.4 validation.
  if (present('ingredients')) {
    const total = countIngredientLines(input.ingredients);
    const groupCount = Array.isArray(input.ingredients) ? input.ingredients.length : 0;
    if (!partial && mode === 'strict' && total === 0) {
      errors.ingredients = 'Add at least one ingredient.';
    } else if (total > LIMITS.ingredientsTotal || groupCount > LIMITS.ingredientGroups) {
      if (draft) {
        warnings.push({ field: 'ingredients', code: 'truncated', message: 'ingredients were truncated to the limit.' });
      } else {
        errors.ingredients = `ingredients must be at most ${LIMITS.ingredientGroups} groups and ${LIMITS.ingredientsTotal} lines total.`;
      }
    }
  } else if (!partial && mode === 'strict') {
    errors.ingredients = 'Add at least one ingredient.';
  }

  return { ok: Object.keys(errors).length === 0, value, errors, warnings };
}

const DIETARY_KEYWORD_RULES = [
  {
    field: 'is_vegetarian',
    keywords: ['chicken', 'mutton', 'lamb', 'goat', 'beef', 'pork', 'bacon', 'ham', 'sausage', 'salami', 'pepperoni', 'turkey', 'duck', 'keema', 'fish', 'salmon', 'tuna', 'cod', 'basa', 'prawn', 'shrimp', 'crab', 'lobster', 'squid', 'anchovy', 'anchovies', 'gelatine', 'gelatin', 'lard', 'fish sauce', 'oyster sauce', 'chicken stock', 'beef stock'],
    exceptionsBefore: ['vegan', 'vegetarian', 'plant-based', 'meat-free', 'mock', 'mushroom'],
  },
  {
    field: 'is_egg_free',
    keywords: ['egg', 'eggs', 'yolk', 'egg white', 'mayonnaise', 'mayo', 'egg noodles', 'meringue'],
    exceptions: ['eggplant', 'eggless', 'egg-free', 'egg replacer', 'flax egg', 'chia egg', 'vegan mayo', 'vegan mayonnaise', 'eggless mayonnaise'],
  },
  {
    field: 'contains_dairy',
    negate: true, // this rule warns when contains_dairy is claimed FALSE but evidence says otherwise
    keywords: ['milk', 'cream', 'butter', 'ghee', 'paneer', 'curd', 'yoghurt', 'yogurt', 'dahi', 'cheese', 'khoya', 'khoa', 'mawa', 'malai', 'buttermilk', 'chaas', 'lassi', 'condensed milk', 'milk powder', 'whey', 'casein'],
    exceptions: ['coconut milk', 'coconut cream', 'almond milk', 'oat milk', 'soy milk', 'soya milk', 'cashew milk', 'cashew cream', 'rice milk', 'peanut butter', 'cocoa butter', 'nut butter', 'vegan butter', 'vegan cheese', 'plant-based', 'dairy-free'],
  },
];

function flattenIngredientNames(recipe) {
  const names = [];
  const groups = Array.isArray(recipe?.ingredients) ? recipe.ingredients : [];
  for (const group of groups) {
    for (const item of group.items || []) {
      if (item?.name) names.push(String(item.name).toLowerCase());
    }
  }
  return names;
}

export function dietaryWarnings(recipe) {
  const warnings = [];
  const names = flattenIngredientNames(recipe);
  const fullText = names.join(' \n ');

  for (const rule of DIETARY_KEYWORD_RULES) {
    const claimTrue = recipe?.[rule.field] === true;
    const claimFalse = recipe?.[rule.field] === false;
    const relevantClaim = rule.negate ? claimFalse : claimTrue;
    if (!relevantClaim) continue;

    let text = fullText;
    // Longest exception phrase first: "eggless mayonnaise" must be removed whole, or removing just
    // "eggless" would leave "mayonnaise" behind to falsely match the mayonnaise keyword.
    const exceptions = [...(rule.exceptions || [])].sort((a, b) => b.length - a.length);
    for (const exception of exceptions) {
      text = text.replace(new RegExp(exception.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '');
    }
    if (rule.exceptionsBefore) {
      const beforeKeywordPairs = [];
      for (const before of rule.exceptionsBefore) {
        for (const keyword of rule.keywords) beforeKeywordPairs.push(`${before} ${keyword}`);
      }
      beforeKeywordPairs.sort((a, b) => b.length - a.length);
      for (const pair of beforeKeywordPairs) {
        const [before, ...rest] = pair.split(' ');
        const keyword = rest.join(' ');
        text = text.replace(new RegExp(`${before}\\s+${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`, 'gi'), '');
      }
    }

    const evidence = [];
    for (const keyword of rule.keywords) {
      const re = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`, 'i');
      const match = text.match(re);
      if (match) evidence.push(keyword);
    }

    if (evidence.length > 0) {
      warnings.push({
        field: rule.field,
        code: 'dietary_contradiction',
        message: `Marked ${rule.negate ? `contains_dairy: false` : `${rule.field}: true`}, but the ingredients include ${evidence[0]}.`,
        evidence,
      });
    }
  }

  return warnings;
}
