-- =====================================================================
-- 05-dedupe-activities.sql
-- Archives duplicate activities. Two activities are "duplicate" when
-- they share the same: subject, date, contact_id, account_id.
-- The OLDEST row (by created_at, then id) is kept; the rest are archived.
-- Already-archived rows are excluded from the dedupe pool.
-- Idempotent.
--
-- Run this in Supabase SQL Editor. Run 04-cleanup-orphan-activities.sql
-- first (it creates the archived_at column on activities).
-- BACKUP RECOMMENDED.
--
-- Rollback:
--   UPDATE activities SET archived_at = NULL
--   WHERE archived_at >= '<migration_run_timestamp>';
-- =====================================================================

-- ---------------------------------------------------------------------
-- 5.1 Sanity: archived_at must exist (created by 04). Add if missing.
-- ---------------------------------------------------------------------
ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------
-- 5.2 Pre-flight: show duplicate groups
-- ---------------------------------------------------------------------
SELECT subject, date,
       COALESCE(contact_id, '') AS contact_id,
       COALESCE(account_id, '') AS account_id,
       COUNT(*) AS dup_count
FROM activities
WHERE archived_at IS NULL
GROUP BY subject, date, COALESCE(contact_id, ''), COALESCE(account_id, '')
HAVING COUNT(*) > 1
ORDER BY dup_count DESC, subject
LIMIT 30;

SELECT COALESCE(SUM(cnt - 1), 0) AS expected_to_archive
FROM (
  SELECT COUNT(*) AS cnt
  FROM activities
  WHERE archived_at IS NULL
  GROUP BY subject, date, COALESCE(contact_id, ''), COALESCE(account_id, '')
  HAVING COUNT(*) > 1
) g;

-- ---------------------------------------------------------------------
-- 5.3 Dedupe: keep oldest, archive the rest
-- ---------------------------------------------------------------------
BEGIN;

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY subject, date,
                        COALESCE(contact_id, ''),
                        COALESCE(account_id, '')
           ORDER BY created_at NULLS LAST, id
         ) AS rn
  FROM activities
  WHERE archived_at IS NULL
),
archived AS (
  UPDATE activities a
  SET archived_at = NOW()
  FROM ranked r
  WHERE a.id = r.id
    AND r.rn > 1
  RETURNING a.id
)
SELECT COUNT(*) AS activities_deduped FROM archived;

-- ---------------------------------------------------------------------
-- 5.4 Post-dedupe verification (should be 0)
-- ---------------------------------------------------------------------
SELECT COUNT(*) AS remaining_duplicate_groups
FROM (
  SELECT 1
  FROM activities
  WHERE archived_at IS NULL
  GROUP BY subject, date, COALESCE(contact_id, ''), COALESCE(account_id, '')
  HAVING COUNT(*) > 1
) g;

COMMIT;

-- =====================================================================
-- Done. Next: 06-merge-duplicate-accounts.sql (MANUAL review required)
-- =====================================================================
