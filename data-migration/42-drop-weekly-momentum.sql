-- ============================================================
-- Rollback for data-migration/40-weekly-momentum.sql.
--
-- The Momentum feature was removed from the CRM UI on 2026-10-15.
-- The `user_weekly_momentum` table is no longer written to or read
-- from anywhere in the app. Running this script drops the dead table.
--
-- Safe to run multiple times (`IF EXISTS` guard). Safe to skip
-- entirely if you'd rather keep the historical rows for later
-- analysis — the table just sits there costing nothing.
-- ============================================================

DROP TABLE IF EXISTS user_weekly_momentum CASCADE;
