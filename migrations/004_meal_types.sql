-- DATA-7 (expand): meal types become a column. Tags are left untouched until 008.
alter table public.recipes add column meal_types text[] not null default '{}'
  constraint recipes_meal_types_valid
  check (meal_types <@ array['Breakfast','Packed Lunch','Lunch','Dinner','Snacks','Dessert']::text[]);

update public.recipes r set meal_types = coalesce((
  select array_agg(distinct m order by m)
    from (select case t when 'Snack' then 'Snacks' when 'Packed Lunch Friendly' then 'Packed Lunch' else t end as m
            from jsonb_array_elements_text(r.tags) as t
           where t in ('Breakfast','Lunch','Dinner','Snack','Snacks','Dessert','Packed Lunch Friendly')) s
), '{}');

create index recipes_meal_types_gin on public.recipes using gin (meal_types);
