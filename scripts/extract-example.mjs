// Appendix D.2/task 9: picks one real recipe to show the model as a style example, in the D.1
// draft shape (structured ingredients as {name, category, quantity, unit, preparation, optional}
// — not the B.4 {ingredient:{id}} shape recipe_ingredients itself uses). Read-only; no AI calls.
import { writeFileSync } from 'node:fs';
import { loadEnv } from './lib/env.mjs';
import { sql } from './lib/supabase.mjs';

const env = loadEnv({ required: ['SUPABASE_URL', 'SUPABASE_ACCESS_TOKEN', 'SUPABASE_PROJECT_REF'] });

const rows = await sql(env, `
  select r.id, r.name, r.description, r.cuisine, r.origin_note, r.meal_types, r.tags, r.serves, r.spice_level,
         r.prep_time_minutes, r.cook_time_minutes, r.total_time_minutes, r.time_note, r.steps,
         r.is_vegetarian, r.is_egg_free, r.contains_dairy, r.egg_check_notes,
         r.calories_kcal, r.protein_g::float8 as protein_g, r.carbs_g::float8 as carbs_g, r.sugars_g::float8 as sugars_g,
         r.fibre_g::float8 as fibre_g, r.fat_g::float8 as fat_g, r.saturates_g::float8 as saturates_g, r.salt_g::float8 as salt_g,
         r.nutrition_basis, r.lunchbox_notes, r.common_mistakes, r.uk_sourcing_notes, r.storage_notes, r.kid_friendly_notes,
         (select jsonb_agg(jsonb_build_object('group', g.group_name, 'items', g.items) order by g.group_position)
            from (
              select ri.group_position, ri.group_name,
                     jsonb_agg(jsonb_build_object('name', i.display_name, 'category', i.category,
                               'quantity', ri.quantity, 'unit', ri.unit, 'preparation', coalesce(ri.preparation, ''),
                               'optional', ri.is_optional) order by ri.position) as items
                from public.recipe_ingredients ri join public.ingredients i on i.id = ri.ingredient_id
               where ri.recipe_id = r.id
               group by ri.group_position, ri.group_name
            ) g
         ) as ingredients,
         (select count(distinct group_position) from public.recipe_ingredients where recipe_id = r.id) as group_count,
         (select sum(jsonb_array_length(s -> 'steps')) from jsonb_array_elements(r.steps) s) as total_steps,
         (coalesce(r.origin_note, '') <> '')::int + (coalesce(r.egg_check_notes, '') <> '')::int + (coalesce(r.common_mistakes, '') <> '')::int
           + (coalesce(r.uk_sourcing_notes, '') <> '')::int + (coalesce(r.storage_notes, '') <> '')::int + (coalesce(r.kid_friendly_notes, '') <> '')::int
           as notes_filled
    from public.recipes r
   where not r.is_deleted
`, { readOnly: true });

// The spec's own filter (every notes field non-empty, 2+ ingredient groups) turned up exactly one
// recipe, #3 "Baingan Bharta with Bajra Roti" — but its `steps` column is missing the entire
// baingan-bharta stage (4 steps total for a 2-group dish, discovered while building this script;
// flagged separately for a data fix). Shipping it as this feature's style example would teach the
// model to skip most of a recipe's method, so it's excluded by an added plausible-step-count
// filter; relaxed "every notes field" to "at least 5 of 6" to leave a real candidate pool. Recorded
// as a deviation.
const candidates = rows.filter((r) => Number(r.group_count) >= 2 && Number(r.notes_filled) >= 5 && Number(r.total_steps || 0) >= 3 * Number(r.group_count));
if (candidates.length === 0) {
  throw new Error('No candidate recipe has at least 5 of 6 notes fields non-empty, 2+ ingredient groups, and a plausible step count.');
}

// Every one of the 30 live recipes has time_note exactly "Cooking Time:" — a leftover template
// label from however this dataset was first authored, never actually filled in with real content
// (found while building this script; flagged separately as a data-cleanup task). Worth nulling out
// here regardless of which recipe is chosen, so the model isn't taught to write it as an example.
function cleanTimeNote(timeNote) {
  return timeNote && timeNote.trim().toLowerCase() === 'cooking time:' ? null : timeNote;
}

function toDraftShape(row) {
  return {
    request_ok: true,
    refusal_reason: null,
    name: row.name,
    description: row.description,
    cuisine: row.cuisine,
    origin_note: row.origin_note,
    meal_types: row.meal_types,
    tags: row.tags,
    serves: row.serves,
    spice_level: row.spice_level,
    prep_time_minutes: row.prep_time_minutes,
    cook_time_minutes: row.cook_time_minutes,
    total_time_minutes: row.total_time_minutes,
    time_note: cleanTimeNote(row.time_note),
    ingredients: row.ingredients,
    steps: row.steps,
    is_vegetarian: row.is_vegetarian,
    is_egg_free: row.is_egg_free,
    contains_dairy: row.contains_dairy,
    egg_check_notes: row.egg_check_notes,
    calories_kcal: row.calories_kcal,
    protein_g: row.protein_g,
    carbs_g: row.carbs_g,
    sugars_g: row.sugars_g,
    fibre_g: row.fibre_g,
    fat_g: row.fat_g,
    saturates_g: row.saturates_g,
    salt_g: row.salt_g,
    nutrition_basis: row.nutrition_basis,
    lunchbox_notes: row.lunchbox_notes,
    common_mistakes: row.common_mistakes,
    uk_sourcing_notes: row.uk_sourcing_notes,
    storage_notes: row.storage_notes,
    kid_friendly_notes: row.kid_friendly_notes,
  };
}

const withLengths = candidates.map((row) => ({ row, length: JSON.stringify(toDraftShape(row)).length }));
withLengths.sort((a, b) => a.length - b.length);
const medianLength = withLengths[Math.floor(withLengths.length / 2)].length;
withLengths.sort((a, b) => Math.abs(a.length - medianLength) - Math.abs(b.length - medianLength));
const chosen = withLengths[0].row;

const example = toDraftShape(chosen);
writeFileSync('functions/_lib/ai/example.json', `${JSON.stringify(example, null, 2)}\n`);

console.log(`Chose recipe #${chosen.id} "${chosen.name}" (${candidates.length} candidates, serialised length ${withLengths[0].length}, median ${medianLength}).`);
console.log('Wrote functions/_lib/ai/example.json');
