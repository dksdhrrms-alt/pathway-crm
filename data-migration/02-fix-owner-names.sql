-- =====================================================================
-- 02-fix-owner-names.sql
-- Re-syncs accounts.owner_name and contacts.owner_name from users.name
-- via owner_id. Idempotent: rows already in sync are skipped via
-- IS DISTINCT FROM. Wrapped in a single transaction.
--
-- Run this in Supabase SQL Editor. Read 01-audit.sql first.
-- BACKUP RECOMMENDED before COMMIT (this overwrites owner_name values).
--
-- Rollback: requires a backup since the previous owner_name is overwritten.
--   Example (if you snapshotted):
--     UPDATE accounts a SET owner_name = b.owner_name
--     FROM accounts_backup_20260526 b WHERE a.id = b.id;
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 2.1 accounts.owner_name <- users.name (by owner_id)
-- ---------------------------------------------------------------------
WITH updated AS (
  UPDATE accounts a
  SET owner_name = u.name
  FROM users u
  WHERE a.owner_id = u.id
    AND a.owner_name IS DISTINCT FROM u.name
  RETURNING a.id
)
SELECT COUNT(*) AS accounts_owner_name_updated FROM updated;

-- ---------------------------------------------------------------------
-- 2.2 contacts.owner_name <- users.name (by owner_id)
-- ---------------------------------------------------------------------
WITH updated AS (
  UPDATE contacts c
  SET owner_name = u.name
  FROM users u
  WHERE c.owner_id = u.id
    AND c.owner_name IS DISTINCT FROM u.name
  RETURNING c.id
)
SELECT COUNT(*) AS contacts_owner_name_updated FROM updated;

-- ---------------------------------------------------------------------
-- 2.3 Post-update verification (should both be 0)
-- ---------------------------------------------------------------------
SELECT COUNT(*) AS remaining_account_mismatches
FROM accounts a LEFT JOIN users u ON u.id = a.owner_id
WHERE a.owner_name IS DISTINCT FROM u.name;

SELECT COUNT(*) AS remaining_contact_mismatches
FROM contacts c LEFT JOIN users u ON u.id = c.owner_id
WHERE c.owner_name IS DISTINCT FROM u.name;

-- NOTE: If remaining_* counts are NOT zero, it means some owner_id values
-- point to users that DO NOT exist in the users table. Inspect:
--
--   SELECT DISTINCT owner_id, owner_name FROM accounts a
--   WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = a.owner_id);
--
-- For those rows you must decide: reassign owner_id to a real user, or
-- NULL out owner_id + owner_name. Do this manually, then re-run 02.

COMMIT;

-- =====================================================================
-- Done. Next: 03-archive-ghost-contacts.sql
-- =====================================================================
