-- Follow-up to 005_audit_and_generations.sql: "generated always as identity" creates a backing
-- sequence, and this Supabase project grants anon/authenticated SELECT/UPDATE/USAGE on every new
-- sequence by default (the same default-grant behaviour that exposed public.recipes pre-Phase-0,
-- just for sequences). Migration 008 revokes this default going forward; this table was created
-- in 005, before that took effect, so its sequence needs revoking explicitly.
-- Found by the A.0 audit extended to relkind='S' (see docs/progress.md Phase 2 deviations).
revoke select, update, usage on sequence public.recipe_audit_log_id_seq from anon, authenticated;
