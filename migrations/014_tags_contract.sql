-- DATA-7 (contract): meal types now live in meal_types; remove them from free-text tags.
-- Applied after Phase 7 (recipe form, detail view) is live in production per the spec's
-- sequencing, since the UI must read meal_types (not tags) for meal-type filtering before this
-- runs. Appendix A.10.
update public.recipes r set tags = coalesce((
  select jsonb_agg(t.v order by t.i)
    from jsonb_array_elements_text(r.tags) with ordinality as t(v, i)
   where t.v not in ('Breakfast','Lunch','Dinner','Snack','Snacks','Dessert','Packed Lunch','Packed Lunch Friendly')
), '[]'::jsonb);
