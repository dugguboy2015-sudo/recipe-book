-- DATA-4 duplicates; fuzzy lookup for the AI pre-check and search.
create extension if not exists pg_trgm with schema extensions;

alter table public.recipes add column slug text
  generated always as (trim(both '-' from lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g')))) stored;

create unique index recipes_slug_active_uidx on public.recipes (slug) where not is_deleted;
create index recipes_name_trgm_idx on public.recipes using gin (name extensions.gin_trgm_ops);

-- Symmetric word similarity: catches both "kanda poha" -> "Kanda Poha (Maharashtrian Style)"
-- and "a lighter pav bhaji for a weeknight" -> "Pav Bhaji".
create or replace function public.similar_recipes(q text, lim int default 3)
returns table (id int, name text, score real)
language sql stable security invoker set search_path = '' as $$
  select r.id, r.name,
         greatest(extensions.word_similarity(q, r.name), extensions.word_similarity(r.name, q)) as score
    from public.recipes r
   where not r.is_deleted
     and greatest(extensions.word_similarity(q, r.name), extensions.word_similarity(r.name, q)) >= 0.4
   order by score desc
   limit least(greatest(lim, 1), 10);
$$;
revoke execute on function public.similar_recipes(text, int) from public, anon, authenticated;
grant execute on function public.similar_recipes(text, int) to service_role;
