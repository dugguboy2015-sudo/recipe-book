-- One transaction for recipe + structured ingredients + derived flags + dietary check.
-- Called only by Pages Functions with the service role. Errors use PostgREST's PTxxx codes → HTTP xxx.
create or replace function public.save_recipe(
  p_id                  integer,       -- null = create
  p_expected_updated_at timestamptz,   -- required when p_id is not null
  p_recipe              jsonb,         -- whitelisted fields only (Appendix C WRITABLE_FIELDS)
  p_ingredients         jsonb          -- Appendix B.4 shape; null on update = leave ingredients unchanged
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_id integer; v_group jsonb; v_item jsonb; v_ing jsonb;
  v_gpos int := 0; v_pos int; v_ing_id bigint; v_name text;
  d record; v_evidence jsonb;
begin
  if p_id is null then
    insert into public.recipes (
      name, description, cuisine, origin_note, tags, meal_types, serves,
      prep_time_minutes, cook_time_minutes, total_time_minutes, time_note, spice_level, steps,
      calories_kcal, protein_g, carbs_g, sugars_g, fibre_g, fat_g, saturates_g, salt_g,
      nutrition_basis, nutrition_source, egg_check_notes, common_mistakes, uk_sourcing_notes,
      storage_notes, kid_friendly_notes, lunchbox_notes, is_vegetarian, is_egg_free, contains_dairy)
    select r.name, r.description, r.cuisine, r.origin_note, r.tags, r.meal_types, r.serves,
      r.prep_time_minutes, r.cook_time_minutes, r.total_time_minutes, r.time_note, r.spice_level, r.steps,
      r.calories_kcal, r.protein_g, r.carbs_g, r.sugars_g, r.fibre_g, r.fat_g, r.saturates_g, r.salt_g,
      r.nutrition_basis, r.nutrition_source, r.egg_check_notes, r.common_mistakes, r.uk_sourcing_notes,
      r.storage_notes, r.kid_friendly_notes, r.lunchbox_notes, r.is_vegetarian, r.is_egg_free, r.contains_dairy
      from jsonb_populate_record(null::public.recipes, p_recipe) r
    returning id into v_id;
  else
    -- jsonb_populate_record(t, …) keeps the current value for every key not present → true partial update
    update public.recipes t set (
      name, description, cuisine, origin_note, tags, meal_types, serves,
      prep_time_minutes, cook_time_minutes, total_time_minutes, time_note, spice_level, steps,
      calories_kcal, protein_g, carbs_g, sugars_g, fibre_g, fat_g, saturates_g, salt_g,
      nutrition_basis, nutrition_source, egg_check_notes, common_mistakes, uk_sourcing_notes,
      storage_notes, kid_friendly_notes, lunchbox_notes, is_vegetarian, is_egg_free, contains_dairy
    ) = (select r.name, r.description, r.cuisine, r.origin_note, r.tags, r.meal_types, r.serves,
      r.prep_time_minutes, r.cook_time_minutes, r.total_time_minutes, r.time_note, r.spice_level, r.steps,
      r.calories_kcal, r.protein_g, r.carbs_g, r.sugars_g, r.fibre_g, r.fat_g, r.saturates_g, r.salt_g,
      r.nutrition_basis, r.nutrition_source, r.egg_check_notes, r.common_mistakes, r.uk_sourcing_notes,
      r.storage_notes, r.kid_friendly_notes, r.lunchbox_notes, r.is_vegetarian, r.is_egg_free, r.contains_dairy
      from jsonb_populate_record(t, p_recipe) r)
     where t.id = p_id and not t.is_deleted and t.updated_at = p_expected_updated_at
    returning t.id into v_id;

    if v_id is null then
      if exists (select 1 from public.recipes where id = p_id and not is_deleted) then
        raise exception using errcode = 'PT409', message = 'edit_conflict';
      end if;
      raise exception using errcode = 'PT404', message = 'not_found';
    end if;
  end if;

  if p_ingredients is not null then
    delete from public.recipe_ingredients where recipe_id = v_id;
    for v_group in select value from jsonb_array_elements(p_ingredients) loop
      v_gpos := v_gpos + 1; v_pos := 0;
      for v_item in select value from jsonb_array_elements(v_group->'items') loop
        v_pos := v_pos + 1;
        v_ing := v_item->'ingredient';
        if v_ing ? 'id' then
          v_ing_id := (v_ing->>'id')::bigint;
        else
          v_name := lower(btrim(v_ing->>'name'));
          select coalesce((select id from public.ingredients where name = v_name),
                          (select ingredient_id from public.ingredient_aliases where alias = v_name))
            into v_ing_id;
          if v_ing_id is null then
            -- flags must be supplied by the caller (NOT NULL, no defaults)
            insert into public.ingredients (name, display_name, category,
                contains_meat, contains_egg, contains_dairy, contains_nuts, contains_gluten, status)
            values (v_name, coalesce(v_ing->>'display_name', v_ing->>'name'), coalesce(v_ing->>'category', 'other'),
                (v_ing->'flags'->>'contains_meat')::boolean,  (v_ing->'flags'->>'contains_egg')::boolean,
                (v_ing->'flags'->>'contains_dairy')::boolean, (v_ing->'flags'->>'contains_nuts')::boolean,
                (v_ing->'flags'->>'contains_gluten')::boolean, 'unreviewed')
            returning id into v_ing_id;
          end if;
        end if;
        insert into public.recipe_ingredients (recipe_id, group_name, group_position, position, ingredient_id,
            quantity, unit, preparation, is_optional, scales, original_text)
        values (v_id, coalesce(nullif(btrim(v_group->>'group'), ''), 'Ingredients'), v_gpos, v_pos, v_ing_id,
            nullif(v_item->>'quantity', '')::numeric, nullif(v_item->>'unit', ''), nullif(btrim(v_item->>'preparation'), ''),
            coalesce((v_item->>'is_optional')::boolean, false), coalesce((v_item->>'scales')::boolean, true),
            v_item->>'original_text');
      end loop;
    end loop;

    -- keep the legacy jsonb mirror in sync (read by nothing new; kept for backups/rollback)
    update public.recipes set ingredients = coalesce((
      select jsonb_agg(g.obj order by g.gp) from (
        select ri.group_position as gp,
               jsonb_build_object('group', min(ri.group_name), 'items',
                 jsonb_agg(jsonb_build_object('name', i.display_name || coalesce(', ' || ri.preparation, ''),
                                              'amount', ri.quantity, 'unit', coalesce(ri.unit, ''))
                           order by ri.position)) as obj
          from public.recipe_ingredients ri join public.ingredients i on i.id = ri.ingredient_id
         where ri.recipe_id = v_id group by ri.group_position) g), '[]'::jsonb)
     where id = v_id;
  end if;

  perform public.refresh_recipe_derived(v_id);

  select * into d from public.recipe_dietary_derived where recipe_id = v_id;
  if exists (select 1 from public.recipes r where r.id = v_id and (
          (r.is_vegetarian and not d.derived_vegetarian)
       or (r.is_egg_free   and not d.derived_egg_free)
       or (not r.contains_dairy and d.derived_contains_dairy))) then
    select jsonb_build_object(
             'is_vegetarian',  coalesce(jsonb_agg(i.display_name) filter (where i.contains_meat),  '[]'::jsonb),
             'is_egg_free',    coalesce(jsonb_agg(i.display_name) filter (where i.contains_egg),   '[]'::jsonb),
             'contains_dairy', coalesce(jsonb_agg(i.display_name) filter (where i.contains_dairy), '[]'::jsonb))
      into v_evidence
      from public.recipe_ingredients ri join public.ingredients i on i.id = ri.ingredient_id
     where ri.recipe_id = v_id;
    raise exception using errcode = 'PT400', message = 'dietary_mismatch', detail = v_evidence::text;
  end if;

  return (select to_jsonb(r) - 'ingredients' from public.recipes r where r.id = v_id);
end $$;
revoke execute on function public.save_recipe(integer, timestamptz, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.save_recipe(integer, timestamptz, jsonb, jsonb) to service_role;
