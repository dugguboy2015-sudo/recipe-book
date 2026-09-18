-- M1b (plan.md): household creation and invite redemption, each as one transaction, plus the
-- curator flag behind "private until approved" (M1c). Service-role-only, like save_recipe.

-- The founding household curates the shared catalogue: its recipes go public on save, and (M1c)
-- it approves other households' contributions into the catalogue. Only a Function can set this.
alter table public.households add column is_curator boolean not null default false;

-- One transaction, so a household whose owner can't be added (household_members.user_id is
-- unique — the user already belongs to one) is never left behind half-created.
create function public.create_household(
  p_user_id uuid, p_name text, p_display_name text, p_settings jsonb, p_founding boolean
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.households (name, is_curator)
    values (btrim(p_name), p_founding) returning id into v_id;
  insert into public.household_members (household_id, user_id, role, display_name)
    values (v_id, p_user_id, 'owner', nullif(btrim(p_display_name), ''));
  insert into public.household_settings (household_id, settings, updated_by)
    values (v_id, p_settings, p_user_id);
  -- The founding household claims the pre-auth catalogue, so it keeps edit rights over it.
  if p_founding then
    update public.recipes set created_by_household = v_id where created_by_household is null;
  end if;
  return v_id;
end $$;

-- Row-locked, so two people racing to redeem the same single-use code can't both succeed.
create function public.redeem_household_invite(
  p_user_id uuid, p_code text, p_display_name text
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare v_household uuid;
begin
  select i.household_id into v_household
    from public.household_invites i
   where i.code = p_code and i.used_at is null and i.expires_at > now()
   for update;
  if v_household is null then
    raise exception 'invite_invalid' using errcode = 'PT404';
  end if;
  insert into public.household_members (household_id, user_id, role, display_name)
    values (v_household, p_user_id, 'member', nullif(btrim(p_display_name), ''));
  update public.household_invites set used_by = p_user_id, used_at = now() where code = p_code;
  return v_household;
end $$;

revoke execute on function public.create_household(uuid, text, text, jsonb, boolean) from public, anon, authenticated;
revoke execute on function public.redeem_household_invite(uuid, text, text) from public, anon, authenticated;
grant execute on function public.create_household(uuid, text, text, jsonb, boolean) to service_role;
grant execute on function public.redeem_household_invite(uuid, text, text) to service_role;
