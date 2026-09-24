-- M2 (plan.md): the shopping list's own state — which items are ticked off and any items someone
-- added by hand — for one household and one week. The list itself is derived from the plan and the
-- recipes, so nothing about it is stored; only what a person did to it.
--
-- Same shape and reasoning as plan_weeks (migration 019): members write their own household's row
-- directly under RLS, because ticking an item in a shop should be instant and the tenant boundary
-- is exactly current_household_id().

create table public.shopping_lists (
  household_id uuid not null references public.households(id) on delete cascade,
  week_of      date not null,
  state        jsonb not null default '{}'::jsonb check (jsonb_typeof(state) = 'object'),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id) on delete set null,
  primary key (household_id, week_of)
);

alter table public.shopping_lists enable row level security;

create policy shopping_lists_member_read   on public.shopping_lists for select to authenticated using (household_id = public.current_household_id());
create policy shopping_lists_member_write  on public.shopping_lists for insert to authenticated with check (household_id = public.current_household_id());
create policy shopping_lists_member_update on public.shopping_lists for update to authenticated
  using (household_id = public.current_household_id()) with check (household_id = public.current_household_id());
create policy shopping_lists_member_delete on public.shopping_lists for delete to authenticated using (household_id = public.current_household_id());

revoke all on public.shopping_lists from anon, authenticated;
grant select, insert, update, delete on public.shopping_lists to authenticated;
