-- Stop direct anonymous writes. Reads stay public; writes move to Pages Functions (service role).
-- Closes SEC-1 (direct path).
alter table public.recipes enable row level security;

do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'recipes' loop
    execute format('drop policy %I on public.recipes', p.policyname);
  end loop;
end $$;

create policy recipes_public_read on public.recipes
  for select to anon, authenticated
  using (coalesce(is_deleted, false) = false);

revoke insert, update, delete, truncate, references, trigger on public.recipes from anon, authenticated;
grant select on public.recipes to anon, authenticated;
revoke usage, select, update on sequence public.recipes_id_seq from anon, authenticated;
