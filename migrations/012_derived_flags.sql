-- J.2 refined-carb rule + nut flag, derived from structured ingredients; lookup helpers and views.
create or replace function public.refresh_recipe_derived(p_recipe_id integer) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  v_serves        numeric;
  v_grain_total   numeric;
  v_grain_refined numeric;
  v_sweet_ml      numeric;
begin
  select serves into v_serves from public.recipes where id = p_recipe_id;
  if v_serves is null then return; end if;

  select coalesce(sum(ri.quantity * u.to_base) filter (where i.category in ('grain_whole','grain_refined') and u.kind = 'volume'), 0),
         coalesce(sum(ri.quantity * u.to_base) filter (where i.category = 'grain_refined' and u.kind = 'volume'), 0),
         coalesce(sum(ri.quantity * u.to_base) filter (where i.category = 'sweetener' and u.kind = 'volume'), 0)
    into v_grain_total, v_grain_refined, v_sweet_ml
    from public.recipe_ingredients ri
    join public.ingredients i on i.id = ri.ingredient_id
    left join public.units u on u.code = ri.unit
   where ri.recipe_id = p_recipe_id;

  update public.recipes r set
    refined_carb_heavy = (v_grain_total > 0 and v_grain_refined >= 0.4 * v_grain_total)
                         or (v_sweet_ml / v_serves > 7.5),          -- 1½ tsp added sweetener per serving
    contains_nuts = exists (select 1 from public.recipe_ingredients ri
                              join public.ingredients i on i.id = ri.ingredient_id
                             where ri.recipe_id = p_recipe_id and i.contains_nuts)
   where r.id = p_recipe_id;
end $$;
revoke execute on function public.refresh_recipe_derived(integer) from public, anon, authenticated;
grant execute on function public.refresh_recipe_derived(integer) to service_role;

select public.refresh_recipe_derived(id) from public.recipes;

create or replace function public.match_ingredient(q text)
returns table (id bigint, name text, score real)
language sql stable security invoker set search_path = '' as $$
  with c as (
    select i.id, i.name, extensions.similarity(i.name, lower(btrim(q))) as s from public.ingredients i
    union all
    select a.ingredient_id, i.name, extensions.similarity(a.alias, lower(btrim(q)))
      from public.ingredient_aliases a join public.ingredients i on i.id = a.ingredient_id
  )
  select c.id, max(c.name), max(c.s)::real as score from c where c.s >= 0.3
   group by c.id order by score desc limit 5;
$$;
revoke execute on function public.match_ingredient(text) from public, anon, authenticated;
grant execute on function public.match_ingredient(text) to service_role;

create view public.recipe_dietary_derived with (security_invoker = true) as
select r.id as recipe_id,
       not coalesce(bool_or(i.contains_meat), false) as derived_vegetarian,
       not coalesce(bool_or(i.contains_egg),  false) as derived_egg_free,
       coalesce(bool_or(i.contains_dairy),  false)   as derived_contains_dairy,
       coalesce(bool_or(i.contains_nuts),   false)   as derived_contains_nuts,
       coalesce(bool_or(i.contains_gluten), false)   as derived_contains_gluten,
       coalesce(bool_and(i.status = 'reviewed'), false) as all_reviewed
  from public.recipes r
  left join public.recipe_ingredients ri on ri.recipe_id = r.id
  left join public.ingredients i on i.id = ri.ingredient_id
 group by r.id;

create view public.planner_candidates with (security_invoker = true) as
select id, name, slug, cuisine, meal_types, serves, total_time_minutes, is_protein_smart, spice_level, contains_nuts
  from public.recipes where not is_deleted order by name limit 500;

create view public.ingredient_usage with (security_invoker = true) as
select i.id, i.name, count(ri.id)::int as uses
  from public.ingredients i left join public.recipe_ingredients ri on ri.ingredient_id = i.id
 group by i.id, i.name;

grant select on public.recipe_dietary_derived, public.planner_candidates, public.ingredient_usage to anon, authenticated;
