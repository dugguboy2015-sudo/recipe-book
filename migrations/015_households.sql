-- M1a (plan.md): multi-household tenancy foundation. Pure expand — nothing reads these yet.
-- Recipes stay one shared public catalogue (owner decision, 2026-09-18): tenancy scopes household
-- data and recipe *edit rights*, never recipe visibility.

create table public.households (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(btrim(name)) between 1 and 80),
  created_at timestamptz not null default now()
);

-- One household per user for now (unique user_id). An unambiguous "which household am I acting
-- in" is worth more than multi-household membership nobody has asked for; relaxing it later is a
-- constraint drop, not a data migration.
create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id      uuid not null unique references auth.users(id) on delete cascade,
  role         text not null default 'member' check (role in ('owner', 'member')),
  display_name text check (display_name is null or char_length(btrim(display_name)) between 1 and 60),
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);

-- Invite codes are bearer secrets: RLS on with no policy, so no client can read them at all.
-- They are created and redeemed only through a Pages Function using the secret key.
create table public.household_invites (
  code         text primary key check (char_length(code) >= 20),
  household_id uuid not null references public.households(id) on delete cascade,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  used_by      uuid references auth.users(id) on delete set null,
  used_at      timestamptz
);
create index household_invites_household_idx on public.household_invites (household_id);

-- The rules config/household.json holds today, one row per household (M1d moves every consumer
-- over). jsonb keeps the file's existing shape so consumers change minimally; shape validation
-- lives in the shared JS layer, the same pattern recipes use.
create table public.household_settings (
  household_id uuid primary key references public.households(id) on delete cascade,
  settings     jsonb not null check (jsonb_typeof(settings) = 'object'),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id) on delete set null
);

-- Which household contributed a recipe — for edit rights (M1c), not visibility. Nullable for the
-- pre-auth catalogue, which the founding household claims at bootstrap (M1b). Deliberately no
-- user id on recipes: they are publicly readable, so a per-user column would publish auth ids.
-- Per-member attribution goes to the audit log below, which only the secret key can read.
alter table public.recipes
  add column created_by_household uuid references public.households(id) on delete set null;
create index recipes_created_by_household_idx on public.recipes (created_by_household);

alter table public.recipe_audit_log
  add column actor_user_id uuid references auth.users(id) on delete set null;

-- Membership helper. SECURITY DEFINER is a deliberate, documented exception to this schema's
-- security-invoker rule: a policy on household_members that reads household_members through an
-- invoker function recurses. It takes no arguments and only ever returns the *caller's own*
-- household (keyed on auth.uid()), so there is nothing for a caller to escalate to.
create function public.current_household_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select m.household_id from public.household_members m where m.user_id = auth.uid()
$$;
revoke execute on function public.current_household_id() from public, anon;
grant execute on function public.current_household_id() to authenticated, service_role;

alter table public.households         enable row level security;
alter table public.household_members  enable row level security;
alter table public.household_invites  enable row level security;
alter table public.household_settings enable row level security;

create policy households_member_read on public.households
  for select to authenticated using (id = public.current_household_id());
create policy household_members_member_read on public.household_members
  for select to authenticated using (household_id = public.current_household_id());
create policy household_settings_member_read on public.household_settings
  for select to authenticated using (household_id = public.current_household_id());

-- Members may read their own household's rows; nothing else. Every write goes through a Pages
-- Function with the secret key, exactly as recipe writes do. anon gets nothing.
revoke all on public.households, public.household_members, public.household_invites, public.household_settings
  from anon, authenticated;
grant select on public.households, public.household_members, public.household_settings to authenticated;
