// Appendix D.1. `cuisine.enum`/`unit.enum`/`category.enum` are filled at request time from the
// database so the model can't invent a value normalizeRecipeInput would then have to reject.

export function buildRecipeDraftSchema({ cuisines, units, categories }) {
  return {
    type: 'object',
    properties: {
      request_ok: { type: 'boolean' },
      refusal_reason: { type: ['string', 'null'] },
      name: { type: 'string' },
      description: { type: 'string' },
      cuisine: { type: 'string', enum: cuisines },
      origin_note: { type: ['string', 'null'] },
      meal_types: { type: 'array', items: { type: 'string', enum: ['Breakfast', 'Packed Lunch', 'Lunch', 'Dinner', 'Snacks', 'Dessert'] } },
      tags: { type: 'array', items: { type: 'string' } },
      serves: { type: 'integer' },
      spice_level: { type: 'integer' },
      prep_time_minutes: { type: 'integer' },
      cook_time_minutes: { type: 'integer' },
      total_time_minutes: { type: 'integer' },
      time_note: { type: ['string', 'null'] },
      ingredients: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            group: { type: 'string' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  category: { type: 'string', enum: categories },
                  quantity: { type: ['number', 'null'] },
                  unit: { type: 'string', enum: units },
                  preparation: { type: 'string' },
                  optional: { type: 'boolean' },
                },
                required: ['name', 'category', 'quantity', 'unit', 'preparation', 'optional'],
              },
            },
          },
          required: ['group', 'items'],
        },
      },
      steps: {
        type: 'array',
        items: {
          type: 'object',
          properties: { group: { type: 'string' }, steps: { type: 'array', items: { type: 'string' } } },
          required: ['group', 'steps'],
        },
      },
      is_vegetarian: { type: 'boolean' },
      is_egg_free: { type: 'boolean' },
      contains_dairy: { type: 'boolean' },
      egg_check_notes: { type: 'string' },
      calories_kcal: { type: 'integer' },
      protein_g: { type: 'number' },
      carbs_g: { type: 'number' },
      sugars_g: { type: 'number' },
      fibre_g: { type: 'number' },
      fat_g: { type: 'number' },
      saturates_g: { type: 'number' },
      salt_g: { type: 'number' },
      nutrition_basis: { type: 'string' },
      lunchbox_notes: { type: ['string', 'null'] },
      common_mistakes: { type: ['string', 'null'] },
      uk_sourcing_notes: { type: ['string', 'null'] },
      storage_notes: { type: ['string', 'null'] },
      kid_friendly_notes: { type: ['string', 'null'] },
    },
    required: [
      'request_ok', 'refusal_reason', 'name', 'description', 'cuisine', 'meal_types', 'tags', 'serves', 'spice_level',
      'prep_time_minutes', 'cook_time_minutes', 'total_time_minutes', 'ingredients', 'steps',
      'is_vegetarian', 'is_egg_free', 'contains_dairy', 'egg_check_notes',
      'calories_kcal', 'protein_g', 'carbs_g', 'sugars_g', 'fibre_g', 'fat_g', 'saturates_g', 'salt_g', 'nutrition_basis',
    ],
  };
}

/** The eight J.1 nutrition numbers plus nutrition_basis, for estimate-nutrition (D.3). */
export function buildNutritionSchema() {
  return {
    type: 'object',
    properties: {
      calories_kcal: { type: 'integer' },
      protein_g: { type: 'number' },
      carbs_g: { type: 'number' },
      sugars_g: { type: 'number' },
      fibre_g: { type: 'number' },
      fat_g: { type: 'number' },
      saturates_g: { type: 'number' },
      salt_g: { type: 'number' },
      nutrition_basis: { type: 'string' },
    },
    required: ['calories_kcal', 'protein_g', 'carbs_g', 'sugars_g', 'fibre_g', 'fat_g', 'saturates_g', 'salt_g', 'nutrition_basis'],
  };
}

/**
 * Gemini's `responseSchema` doesn't support `additionalProperties` or a `type` array for
 * nullability — it wants `{type: X, nullable: true}` instead of `type: [X, 'null']` (D.2/generateDraft).
 */
export function toGeminiSchema(schema) {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (schema === null || typeof schema !== 'object') return schema;

  const { type } = schema;
  const converted = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'additionalProperties' || key === 'type') continue;
    converted[key] = toGeminiSchema(value);
  }

  if (Array.isArray(type)) {
    const nonNull = type.find((t) => t !== 'null');
    converted.type = nonNull;
    if (type.includes('null')) converted.nullable = true;
  } else if (type !== undefined) {
    converted.type = type;
  }

  return converted;
}
