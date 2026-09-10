-- BUG-1 / BUG-2: small read models so the browser never scans the whole table.
create view public.recipe_stats with (security_invoker = true) as
with live as (select * from public.recipes where not is_deleted),
     top as (select cuisine, count(*)::int n from live group by cuisine order by n desc, cuisine limit 1)
select (select count(*)::int from live)                              as total,
       (select count(*)::int from live where is_vegetarian)          as vegetarian,
       (select count(*)::int from live where is_egg_free)            as egg_free,
       (select count(*)::int from live where not contains_dairy)     as dairy_free,
       (select count(*)::int from live where is_protein_smart)       as protein_smart,
       (select cuisine from top)                                     as top_cuisine,
       (select n from top)                                           as top_cuisine_count;

create view public.cuisine_counts with (security_invoker = true) as
select c.name as cuisine, c.sort_order, count(r.id)::int as recipes
  from public.cuisines c
  left join public.recipes r on r.cuisine = c.name and not r.is_deleted
 group by c.name, c.sort_order;

create view public.tag_counts with (security_invoker = true) as
select t.tag, count(*)::int as recipes
  from public.recipes r, jsonb_array_elements_text(r.tags) as t(tag)
 where not r.is_deleted
 group by t.tag;

grant select on public.recipe_stats, public.cuisine_counts, public.tag_counts to anon, authenticated;
