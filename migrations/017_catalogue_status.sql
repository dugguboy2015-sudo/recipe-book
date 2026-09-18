-- M1c (plan.md): "private until approved". A recipe from a household that isn't the curator starts
-- 'pending' — visible only to that household (and to the curator, who reviews it) — until the
-- curator approves it into the shared catalogue. Expand-only: the default keeps every existing
-- row, and every insert the currently-live code makes, 'public'.

alter table public.recipes
  add column catalogue_status text not null default 'public'
  check (catalogue_status in ('public', 'pending'));

-- Per-household AI quota (decision 5) and per-member write rate limits count by these.
alter table public.recipe_generations
  add column household_id uuid references public.households(id) on delete set null,
  add column user_id uuid references auth.users(id) on delete set null;
create index recipe_generations_household_time_idx on public.recipe_generations (household_id, created_at desc);
create index recipe_audit_actor_time_idx on public.recipe_audit_log (actor_user_id, created_at desc);
create index recipes_pending_idx on public.recipes (catalogue_status) where catalogue_status = 'pending';

-- Invoker, not definer: it reads households through the member-read policy, which already limits
-- it to the caller's own household.
create function public.current_household_is_curator() returns boolean
language sql stable security invoker set search_path = '' as $$
  select coalesce((select h.is_curator from public.households h where h.id = public.current_household_id()), false);
$$;
revoke execute on function public.current_household_is_curator() from public, anon;
grant execute on function public.current_household_is_curator() to authenticated, service_role;

-- Split the one anon+authenticated read policy (000_lockdown) so anon never evaluates the
-- household functions it can't execute. Every read view is security_invoker and
-- recipe_ingredients' policy reads recipes, so all of them inherit this without changes.
drop policy recipes_public_read on public.recipes;

create policy recipes_public_read on public.recipes
  for select to anon
  using (not is_deleted and catalogue_status = 'public');

create policy recipes_member_read on public.recipes
  for select to authenticated
  using (
    not is_deleted and (
      catalogue_status = 'public'
      or created_by_household = public.current_household_id()
      or public.current_household_is_curator()
    )
  );

-- save_recipe's column list is a whitelist of user-editable fields, deliberately excluding who
-- owns a recipe and whether it's public. This wrapper stamps both on create, inside the same
-- transaction, so a recipe is never briefly public before its status is set.
create function public.save_household_recipe(
  p_id integer, p_expected_updated_at timestamptz, p_recipe jsonb, p_ingredients jsonb,
  p_household_id uuid, p_catalogue_status text
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare v_saved jsonb;
begin
  v_saved := public.save_recipe(p_id, p_expected_updated_at, p_recipe, p_ingredients);
  if p_id is null then
    update public.recipes
       set created_by_household = p_household_id, catalogue_status = p_catalogue_status
     where id = (v_saved->>'id')::integer;
    v_saved := v_saved || jsonb_build_object('created_by_household', p_household_id, 'catalogue_status', p_catalogue_status);
  end if;
  return v_saved;
end $$;
revoke execute on function public.save_household_recipe(integer, timestamptz, jsonb, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.save_household_recipe(integer, timestamptz, jsonb, jsonb, uuid, text) to service_role;
