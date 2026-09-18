-- M1d (plan.md): diet per household. The planner filters its candidates by the household's diet,
-- which needs each recipe's dietary flags on the bounded planner_candidates view (012). Columns are
-- only appended, so `create or replace` keeps the view's grants and every existing reader works.
create or replace view public.planner_candidates with (security_invoker = true) as
select id, name, slug, cuisine, meal_types, serves, total_time_minutes, is_protein_smart, spice_level, contains_nuts,
       is_vegetarian, is_egg_free
  from public.recipes where not is_deleted order by name limit 500;
