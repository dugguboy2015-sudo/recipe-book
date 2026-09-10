-- R-HEALTH: household nutrition and spice data (Appendix I, J).
alter table public.recipes
  add column sugars_g           numeric  check (sugars_g >= 0),
  add column saturates_g        numeric  check (saturates_g >= 0),
  add column salt_g             numeric  check (salt_g >= 0),
  add column spice_level        smallint check (spice_level between 1 and 5),
  add column lunchbox_notes     text,
  add column nutrition_source   text     check (nutrition_source in ('manual','ai_estimate','backfill_estimate')),
  add column refined_carb_heavy boolean,          -- set by refresh_recipe_derived (A.13); null = unknown
  add column contains_nuts      boolean;          -- set by refresh_recipe_derived (A.13)

-- J.2. Null inputs → false, so a recipe is only protein-smart when every number is known.
alter table public.recipes add column is_protein_smart boolean generated always as (
  coalesce(
        protein_g >= 15
    and calories_kcal > 0
    and protein_g * 4 >= 0.20 * calories_kcal
    and sugars_g <= 8
    and refined_carb_heavy = false,
  false)
) stored;

create index recipes_protein_smart_idx on public.recipes (is_protein_smart) where not is_deleted;
