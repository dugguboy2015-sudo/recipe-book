-- M1e (plan.md): the weekly planner moves from one browser's localStorage into the database, so a
-- household's plan follows them between devices and members. One row per household per week, with
-- the week's entries kept in the same jsonb shape the browser store already uses
-- (public/js/lib/planner-store.js) — the reducers are unchanged, only where they are saved.
--
-- Deliberate exception to "every write goes through a Pages Function": members write their own
-- household's plan rows directly, under RLS. That rule exists because recipes are shared, public
-- data; a meal plan is private household state, the tenant boundary here is exactly
-- current_household_id(), and routing every shuffle and servings tweak through a Function would add
-- a round trip to an interaction that should feel instant. Recipes, ingredients and the audit log
-- keep their Function-only write path.

create table public.plan_weeks (
  household_id uuid not null references public.households(id) on delete cascade,
  week_of      date not null,
  days         jsonb not null default '{}'::jsonb check (jsonb_typeof(days) = 'object'),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id) on delete set null,
  primary key (household_id, week_of)
);

create table public.plan_prefs (
  household_id uuid primary key references public.households(id) on delete cascade,
  prefs        jsonb not null default '{}'::jsonb check (jsonb_typeof(prefs) = 'object'),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id) on delete set null
);

alter table public.plan_weeks enable row level security;
alter table public.plan_prefs enable row level security;

-- Members read and write their own household's plan, and nobody else's. `with check` on insert and
-- update is what stops a member writing a row into another household.
create policy plan_weeks_member_read   on public.plan_weeks for select to authenticated using (household_id = public.current_household_id());
create policy plan_weeks_member_write  on public.plan_weeks for insert to authenticated with check (household_id = public.current_household_id());
create policy plan_weeks_member_update on public.plan_weeks for update to authenticated
  using (household_id = public.current_household_id()) with check (household_id = public.current_household_id());
create policy plan_weeks_member_delete on public.plan_weeks for delete to authenticated using (household_id = public.current_household_id());

create policy plan_prefs_member_read   on public.plan_prefs for select to authenticated using (household_id = public.current_household_id());
create policy plan_prefs_member_write  on public.plan_prefs for insert to authenticated with check (household_id = public.current_household_id());
create policy plan_prefs_member_update on public.plan_prefs for update to authenticated
  using (household_id = public.current_household_id()) with check (household_id = public.current_household_id());

-- 008 removed default privileges, so grants are explicit. anon gets nothing at all.
revoke all on public.plan_weeks, public.plan_prefs from anon, authenticated;
grant select, insert, update, delete on public.plan_weeks to authenticated;
grant select, insert, update on public.plan_prefs to authenticated;
