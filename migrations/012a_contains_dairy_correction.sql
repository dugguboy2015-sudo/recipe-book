-- Closes the contains_dairy part of the finding recorded in improvement_plan.md §1.4: every one of
-- the 30 live recipes was marked contains_dairy=true by the column's old default, which the Phase 3
-- structured-ingredient backfill now shows is wrong for 14 of them (e.g. Lemon Rice, Schezwan
-- Noodles). Corrected here from public.recipe_dietary_derived (built in 012 from the ingredient
-- flags authored in 010). is_vegetarian and is_egg_free had zero mismatches (see docs/progress.md),
-- so this migration only ever touches contains_dairy, and only where the derived value disagrees.
update public.recipes r
   set contains_dairy = d.derived_contains_dairy
  from public.recipe_dietary_derived d
 where d.recipe_id = r.id
   and not r.is_deleted
   and r.contains_dairy is distinct from d.derived_contains_dairy;
