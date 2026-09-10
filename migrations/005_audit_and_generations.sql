create table public.recipe_audit_log (
  id            bigint generated always as identity primary key,
  recipe_id     integer references public.recipes(id) on delete set null,
  action        text not null check (action in ('create','update','delete','restore')),
  source        text not null default 'manual' check (source in ('manual','ai')),
  actor_ip_hash text not null,
  before        jsonb,
  after         jsonb,
  created_at    timestamptz not null default now()
);
create index recipe_audit_ip_time_idx     on public.recipe_audit_log (actor_ip_hash, created_at desc);
create index recipe_audit_recipe_time_idx on public.recipe_audit_log (recipe_id, created_at desc);
alter table public.recipe_audit_log enable row level security;
revoke all on public.recipe_audit_log from anon, authenticated;

create table public.recipe_generations (
  id              uuid primary key default gen_random_uuid(),
  prompt          text not null check (char_length(prompt) between 3 and 400),
  constraints     jsonb not null default '{}',
  provider        text not null check (provider in ('workers-ai','gemini')),
  model           text not null,
  kind            text not null default 'recipe' check (kind in ('recipe','nutrition')),
  goal            text check (goal in ('auto','protein_smart','balanced')),
  effective_goal  text check (effective_goal in ('protein_smart','balanced')),
  protein_smart   boolean,
  outcome         text not null check (outcome in ('generated','saved','invalid','refused','error')),
  draft           jsonb,
  warnings        jsonb not null default '[]',
  error           text,
  input_tokens    integer,
  output_tokens   integer,
  est_neurons     integer,
  latency_ms      integer,
  ip_hash         text not null,
  saved_recipe_id integer references public.recipes(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index recipe_generations_time_idx    on public.recipe_generations (created_at desc);
create index recipe_generations_ip_time_idx on public.recipe_generations (ip_hash, created_at desc);
alter table public.recipe_generations enable row level security;
revoke all on public.recipe_generations from anon, authenticated;
