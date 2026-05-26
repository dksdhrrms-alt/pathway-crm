-- =====================================================================
-- 04-cleanup-orphan-activities.sql
-- Two cleanups for activities:
--   (a) contact_id points to a non-existent contact -> set contact_id NULL
--       (preserve the activity if it still has a valid account_id)
--   (b) activities with neither contact NOR account (and not [SYSTEM]
--       logs) -> archive via archived_at
-- Idempotent.
--
-- Run this in Supabase SQL Editor. Read 01-audit.sql first.
-- BACKUP RECOMMENDED.
--
-- Rollback:
--   (a) cannot be auto-restored (broken FK is gone). Use a snapshot.
--   (b) UPDATE activities SET archived_at = NULL
--       WHERE archived_at >= '<migration_run_timestamp>';
-- =====================================================================

-- ---------------------------------------------------------------------
-- 4.1 Schema: archived_at column + partial index (one-time, idempotent)
-- ---------------------------------------------------------------------
ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS activities_active_idx
  ON activities(id) WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS activities_archived_at_idx
  ON activities(archived_at);

-- ---------------------------------------------------------------------
-- 4.2 Pre-flight counts
-- ---------------------------------------------------------------------
SELECT COUNT(*) AS broken_contact_refs_before
FROM activities a
WHERE a.contact_id IS NOT NULL
  AND a.contact_id <> ''
  AND NOT EXISTS (SELECT 1 FROM contacts c WHERE c.id = a.contact_id);

SELECT COUNT(*) AS unattached_non_system_before
FROM activities
WHERE (contact_id IS NULL OR contact_id = '')
  AND (account_id IS NULL OR account_id = '')
  AND COALESCE(subject, '') NOT LIKE '[SYSTEM]%'
  AND archived_at IS NULL;

-- ---------------------------------------------------------------------
-- 4.3 Fix broken contact_id references -> NULL
-- ---------------------------------------------------------------------
BEGIN;

WITH fixed AS (
  UPDATE activities a
  SET contact_id = NULL
  WHERE a.contact_id IS NOT NULL
    AND a.contact_id <> ''
    AND NOT EXISTS (SELECT 1 FROM contacts c WHERE c.id = a.contact_id)
  RETURNING a.id, a.account_id
)
SELECT COUNT(*) AS contact_refs_nulled,
       COUNT(*) FILTER (WHERE account_id IS NOT NULL AND account_id <> '') AS still_has_account,
       COUNT(*) FILTER (WHERE account_id IS NULL OR account_id = '')       AS now_fully_orphan
FROM fixed;

COMMIT;

-- ---------------------------------------------------------------------
-- 4.4 Archive fully-orphan activities (no contact AND no account)
-- Excludes system-generated logs (subject starts with [SYSTEM])
-- ---------------------------------------------------------------------
BEGIN;

WITH archived AS (
  UPDATE activities
  SET archived_at = NOW()
  WHERE (contact_id IS NULL OR contact_id = '')
    AND (account_id IS NULL OR account_id = '')
    AND COALESCE(subject, '') NOT LIKE '[SYSTEM]%'
    AND archived_at IS NULL
  RETURNING id
)
SELECT COUNT(*) AS unattached_archived FROM archived;

-- ---------------------------------------------------------------------
-- 4.5 Post-cleanup verification
-- ---------------------------------------------------------------------
SELECT COUNT(*) AS broken_contact_refs_after
FROM activities a
WHERE a.contact_id IS NOT NULL
  AND a.contact_id <> ''
  AND NOT EXISTS (SELECT 1 FROM contacts c WHERE c.id = a.contact_id);

SELECT COUNT(*) AS unattached_non_system_after
FROM activities
WHERE (contact_id IS NULL OR contact_id = '')
  AND (account_id IS NULL OR account_id = '')
  AND COALESCE(subject, '') NOT LIKE '[SYSTEM]%'
  AND archived_at IS NULL;

COMMIT;

-- =====================================================================
-- Done. Next: 05-dedupe-activities.sql
-- =====================================================================
