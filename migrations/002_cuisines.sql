-- DATA-3: controlled cuisine vocabulary. Mapping decisions are in Appendix F.
create table public.cuisines (
  name       text primary key check (char_length(name) between 2 and 40),
  sort_order smallint not null default 100
);
alter table public.cuisines enable row level security;
create policy cuisines_public_read on public.cuisines for select to anon, authenticated using (true);
revoke insert, update, delete, truncate, references, trigger, maintain on public.cuisines from anon, authenticated;
grant select on public.cuisines to anon, authenticated;

insert into public.cuisines (name, sort_order) values
  ('South Indian',10), ('North Indian',20), ('Maharashtrian',30), ('Rajasthani',40), ('Chaat',50),
  ('Indo-Chinese',60), ('Gujarati',70), ('Punjabi',80), ('Bengali',90), ('Goan',100), ('Fusion',110),
  ('British',200), ('Continental',210), ('Italian',220), ('Mexican',230), ('Thai',240), ('Other',999);

-- Row fixes. Each is guarded by name, so a changed row is skipped rather than mis-mapped;
-- the guard block below then fails the migration if anything is left unmapped.
update public.recipes set cuisine = 'North Indian'
 where id = 1 and name ilike 'Aloo Paratha with Curd%';
update public.recipes set cuisine = 'North Indian',
       origin_note = case when coalesce(origin_note,'') = '' then 'Fusion take on a North Indian classic.'
                          else origin_note end
 where id = 2 and name ilike 'Aloo Paratha Roll%';
update public.recipes set cuisine = 'Rajasthani',
       origin_note = case when coalesce(origin_note,'') = '' then 'Rajasthani dish, popular across North India.'
                          else origin_note end
 where id = 3 and name ilike 'Baingan Bharta%';
update public.recipes set cuisine = 'Chaat',
       origin_note = case when coalesce(origin_note,'') = '' then 'Mumbai-style street chaat.' else origin_note end
 where cuisine = 'Maharashtrian/Mumbai Street';
update public.recipes set cuisine = 'Maharashtrian' where id = 11 and name ilike 'Kanda Poha%';
update public.recipes set cuisine = 'Fusion'        where id = 15 and name ilike 'Masala Avocado Toast%';
update public.recipes set cuisine = 'South Indian'  where id = 18 and name ilike 'Masala Dosa%';
update public.recipes set cuisine = 'Fusion'        where id = 19 and name ilike 'Masala Hash Browns%';
-- junk rows (already soft-deleted): neutral cuisine, junk tags removed
update public.recipes set cuisine = 'Other', tags = '[]'::jsonb where id in (38, 39) and is_deleted;

do $$
declare leftovers text;
begin
  select string_agg(distinct coalesce(cuisine, '<null>'), ', ') into leftovers
    from public.recipes
   where cuisine is null or cuisine not in (select name from public.cuisines);
  if leftovers is not null then
    raise exception 'Unmapped cuisine values remain: %', leftovers;
  end if;
end $$;

alter table public.recipes alter column cuisine set not null;
alter table public.recipes add constraint recipes_cuisine_fk
  foreign key (cuisine) references public.cuisines(name) on update cascade;
