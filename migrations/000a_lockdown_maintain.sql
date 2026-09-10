-- Follow-up to 000_lockdown.sql: that file's revoke list predates PostgreSQL 15's
-- MAINTAIN privilege (VACUUM/ANALYZE/CLUSTER/REINDEX), so anon/authenticated kept it.
-- Found by the corrected A.0 audit (see docs/progress.md, Phase 0 deviations).
revoke maintain on public.recipes from anon, authenticated;
