-- 021: remove a household that no longer has anyone in it.
--
-- Background. Production carried two households both named "The Babre's": the real one (2026-09-18,
-- curator, every recipe) and a second created on 2026-09-24 by a different email address — the
-- sign-in confusion that P7 fixed. The owner deleted that second account on 2026-10-08.
--
-- Deleting the auth user cascaded its household_members row away, but not the household itself, so
-- what is left is unreachable: every RLS policy here grants access through membership, and there is
-- no member. The row, its settings and one planned week would sit there forever.
--
-- The delete is written as a condition rather than an id so it can only ever remove a household
-- that is genuinely abandoned. If the state is not what this migration expects, it removes nothing
-- rather than removing the wrong thing.
--
--   * no members          -- nobody can reach it
--   * no recipes          -- recipes.created_by_household is ON DELETE NO ACTION and would block
--                            this anyway; stated explicitly so the intent is not merely implied
--   * not the curator     -- the founding household is never a candidate, whatever else is true
--
-- Everything else belonging to it (household_settings, plan_weeks, plan_prefs, shopping_lists,
-- household_invites) is ON DELETE CASCADE and goes with it. Verified before writing this: the
-- candidate holds 1 settings row and 1 plan_week, and zero recipes, generations and invites.

delete from public.households h
where h.is_curator = false
  and not exists (select 1 from public.household_members m where m.household_id = h.id)
  and not exists (select 1 from public.recipes r where r.created_by_household = h.id)
  and not exists (select 1 from public.recipe_generations g where g.household_id = h.id);
