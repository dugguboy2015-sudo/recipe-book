-- DATA-1 dietary defaults, DATA-2 nullable is_deleted, DATA-5 updated_at, DATA-6 timing.

-- DATA-2
update public.recipes set is_deleted = false where is_deleted is null;
alter table public.recipes alter column is_deleted set default false;
alter table public.recipes alter column is_deleted set not null;
update public.recipes set deleted_at = coalesce(deleted_at, updated_at) where is_deleted and deleted_at is null;
update public.recipes set deleted_at = null where not is_deleted and deleted_at is not null;
alter table public.recipes add constraint recipes_deleted_at_consistent
  check ((is_deleted and deleted_at is not null) or (not is_deleted and deleted_at is null));

-- DATA-1: a missing dietary value must fail, never resolve to "safe"
alter table public.recipes alter column is_egg_free    drop default;
alter table public.recipes alter column is_vegetarian  drop default;
alter table public.recipes alter column contains_dairy drop default;

-- DATA-6 (fixes id 18: 20 + 30 with total 30)
update public.recipes
   set total_time_minutes = coalesce(prep_time_minutes,0) + coalesce(cook_time_minutes,0)
 where total_time_minutes < coalesce(prep_time_minutes,0) + coalesce(cook_time_minutes,0);
alter table public.recipes add constraint recipes_times_nonneg check (
  coalesce(prep_time_minutes,0) >= 0 and coalesce(cook_time_minutes,0) >= 0 and coalesce(total_time_minutes,0) >= 0);
alter table public.recipes add constraint recipes_total_covers_parts check (
  total_time_minutes is null
  or total_time_minutes >= coalesce(prep_time_minutes,0) + coalesce(cook_time_minutes,0));

-- general sanity
-- Junk soft-deleted test row (id 39, "Hdjd") has serves=7022; same treatment as its cuisine/tags
-- fix in 002_cuisines.sql. Reset to the household default before the range check is added.
update public.recipes set serves = 4 where id = 39 and is_deleted and serves > 50;
alter table public.recipes add constraint recipes_serves_range check (serves between 1 and 50);
alter table public.recipes add constraint recipes_name_len check (char_length(btrim(name)) between 2 and 120);
alter table public.recipes add constraint recipes_nutrition_nonneg check (
  coalesce(calories_kcal,0) >= 0 and coalesce(protein_g,0) >= 0 and coalesce(carbs_g,0) >= 0
  and coalesce(fat_g,0) >= 0 and coalesce(fibre_g,0) >= 0);
alter table public.recipes add constraint recipes_json_shapes check (
  jsonb_typeof(tags) = 'array' and jsonb_typeof(ingredients) = 'array' and jsonb_typeof(steps) = 'array');

-- DATA-5
create or replace function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
create trigger recipes_set_updated_at before update on public.recipes
  for each row execute function public.set_updated_at();
