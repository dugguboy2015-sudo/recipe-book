-- R-INGREDIENTS / R-SERVINGS: first-class ingredients and units.
create table public.units (
  code             text primary key,
  kind             text not null check (kind in ('volume','weight','count','none')),
  to_base          numeric check (to_base > 0),       -- ml for volume, g for weight
  display_singular text not null,
  display_plural   text not null,
  sort_order       smallint not null default 100,
  check ((kind in ('volume','weight')) = (to_base is not null))
);
insert into public.units (code, kind, to_base, display_singular, display_plural, sort_order) values
  ('cup','volume',240,'cup','cups',1),     ('tbsp','volume',15,'tbsp','tbsp',2),
  ('tsp','volume',5,'tsp','tsp',3),        ('pinch','volume',0.3,'pinch','pinches',4),
  ('piece','count',null,'',''  ,5),        ('clove','count',null,'clove','cloves',6),
  ('inch','count',null,'inch','inches',7), ('sprig','count',null,'sprig','sprigs',8),
  ('handful','count',null,'handful','handfuls',9), ('bunch','count',null,'bunch','bunches',10),
  ('to_taste','none',null,'to taste','to taste',11),
  ('ml','volume',1,'ml','ml',20),          ('l','volume',1000,'litre','litres',21),
  ('g','weight',1,'g','g',22),             ('kg','weight',1000,'kg','kg',23);

create table public.ingredients (
  id              bigint generated always as identity primary key,
  name            text not null unique check (name = lower(btrim(name)) and char_length(name) between 2 and 80),
  display_name    text not null,
  category        text not null check (category in ('grain_whole','grain_refined','pulse_legume','dairy','plant_protein',
                    'vegetable','fruit','nut_seed','spice','herb','oil_fat','sweetener','condiment','other')),
  -- no defaults: every ingredient must state its flags (same principle as DATA-1)
  contains_meat   boolean not null,
  contains_egg    boolean not null,
  contains_dairy  boolean not null,
  contains_nuts   boolean not null,
  contains_gluten boolean not null,
  status          text not null default 'unreviewed' check (status in ('reviewed','unreviewed')),
  created_at      timestamptz not null default now()
);

create table public.ingredient_aliases (
  alias         text primary key check (alias = lower(btrim(alias))),
  ingredient_id bigint not null references public.ingredients(id) on delete cascade
);

create table public.recipe_ingredients (
  id             bigint generated always as identity primary key,
  recipe_id      integer  not null references public.recipes(id) on delete cascade,
  group_name     text     not null check (char_length(group_name) between 1 and 60),
  group_position smallint not null,
  position       smallint not null,
  ingredient_id  bigint   not null references public.ingredients(id),
  quantity       numeric  check (quantity > 0),                -- per recipes.serves
  unit           text     references public.units(code),
  preparation    text     check (char_length(preparation) <= 120),
  is_optional    boolean  not null default false,
  scales         boolean  not null default true,
  original_text  text,
  unique (recipe_id, group_position, position),
  check (quantity is null or unit is not null)
);
create index recipe_ingredients_recipe_idx     on public.recipe_ingredients (recipe_id);
create index recipe_ingredients_ingredient_idx on public.recipe_ingredients (ingredient_id);
create index ingredients_name_trgm_idx         on public.ingredients using gin (name extensions.gin_trgm_ops);
create index ingredient_aliases_trgm_idx       on public.ingredient_aliases using gin (alias extensions.gin_trgm_ops);

alter table public.units              enable row level security;
alter table public.ingredients        enable row level security;
alter table public.ingredient_aliases enable row level security;
alter table public.recipe_ingredients enable row level security;
create policy units_read              on public.units              for select to anon, authenticated using (true);
create policy ingredients_read        on public.ingredients        for select to anon, authenticated using (true);
create policy ingredient_aliases_read on public.ingredient_aliases for select to anon, authenticated using (true);
create policy recipe_ingredients_read on public.recipe_ingredients for select to anon, authenticated
  using (exists (select 1 from public.recipes r where r.id = recipe_id and not r.is_deleted));
-- 008 removed default grants, so reads must be granted explicitly
grant select on public.units, public.ingredients, public.ingredient_aliases, public.recipe_ingredients to anon, authenticated;
