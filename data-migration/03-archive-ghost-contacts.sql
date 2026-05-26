-- =====================================================================
-- 03-archive-ghost-contacts.sql
-- Archives "ghost" contacts: rows with NO email AND NO account_id.
-- Uses SOFT-DELETE via archived_at TIMESTAMPTZ (no DELETE).
-- Idempotent: already-archived rows are skipped.
--
-- Run this in Supabase SQL Editor. Read 01-audit.sql first.
-- BACKUP RECOMMENDED.
--
-- IMPORTANT (app-side follow-up, NOT done here):
--   After this script runs, the application's contact queries must add
--   WHERE archived_at IS NULL. Otherwise archived ghosts will still
--   appear in the UI.
--
-- Rollback:
--   UPDATE contacts SET archived_at = NULL
--   WHERE archived_at >= '<migration_run_timestamp>'
--     AND (email IS NULL OR email = '')
--     AND (account_id IS NULL OR account_id = '');
-- =====================================================================

-- ---------------------------------------------------------------------
-- 3.1 Schema: add archived_at column + partial index (one-time, idempotent)
-- ---------------------------------------------------------------------
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS contacts_active_idx
  ON contacts(id) WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS contacts_archived_at_idx
  ON contacts(archived_at);

-- ---------------------------------------------------------------------
-- 3.2 Pre-flight count (for the run log)
-- ---------------------------------------------------------------------
SELECT COUNT(*) AS ghost_contacts_to_archive
FROM contacts
WHERE (email IS NULL OR email = '')
  AND (account_id IS NULL OR account_id = '')
  AND archived_at IS NULL;

-- ---------------------------------------------------------------------
-- 3.3 Archive ghosts
-- ---------------------------------------------------------------------
BEGIN;

WITH archived AS (
  UPDATE contacts
  SET archived_at = NOW()
  WHERE (email IS NULL OR email = '')
    AND (account_id IS NULL OR account_id = '')
    AND archived_at IS NULL
  RETURNING id, owner_name
)
SELECT COUNT(*) AS newly_archived_total,
       COUNT(*) FILTER (WHERE owner_name IS NOT NULL) AS with_owner,
       COUNT(*) FILTER (WHERE owner_name IS NULL)     AS without_owner
FROM archived;

-- ---------------------------------------------------------------------
-- 3.4 Post-archive verification (should be 0)
-- ---------------------------------------------------------------------
SELECT COUNT(*) AS remaining_unarchived_ghosts
FROM contacts
WHERE (email IS NULL OR email = '')
  AND (account_id IS NULL OR account_id = '')
  AND archived_at IS NULL;

SELECT COUNT(*) AS total_archived_contacts_now
FROM contacts
WHERE archived_at IS NOT NULL;

COMMIT;

-- =====================================================================
-- Done. Next: 04-cleanup-orphan-activities.sql
-- =====================================================================
