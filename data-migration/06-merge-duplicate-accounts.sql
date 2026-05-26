-- =====================================================================
-- 06-merge-duplicate-accounts.sql
-- Merges duplicate account-name rows (e.g. "trouw nutrtion canada" x4).
-- !!! REQUIRES MANUAL REVIEW BEFORE MUTATION !!!
-- This file ONLY contains the SELECT queries enabled. The merge UPDATEs
-- are kept COMMENTED OUT as a template - you must paste real IDs and
-- uncomment per duplicate group.
--
-- Run this in Supabase SQL Editor. Read 01-audit.sql first.
-- BACKUP MANDATORY before any uncommented run.
--
-- Strategy:
--   1. Identify duplicate name groups (Step 1)
--   2. For each group, pick the "keeper" - the account with the most
--      related contacts/opportunities/activities (Step 2)
--   3. Reassign all child rows from the dupes to the keeper, then
--      archive the dupe accounts (Step 3 - per-group template)
--
-- Rollback (per group):
--   - Restore child FKs from a snapshot table
--   - UPDATE accounts SET archived_at = NULL WHERE id IN ('<dup_id1>',...)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 6.0 Schema: archived_at on accounts (idempotent)
-- ---------------------------------------------------------------------
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS accounts_active_idx
  ON accounts(id) WHERE archived_at IS NULL;

-- ---------------------------------------------------------------------
-- STEP 1: Identify duplicate name groups
-- ---------------------------------------------------------------------
SELECT LOWER(TRIM(name)) AS normalized_name,
       COUNT(*) AS dup_count,
       array_agg(id ORDER BY created_at NULLS LAST, id) AS account_ids,
       array_agg(name) AS exact_names,
       array_agg(created_at) AS created_ats
FROM accounts
WHERE archived_at IS NULL
GROUP BY LOWER(TRIM(name))
HAVING COUNT(*) > 1
ORDER BY dup_count DESC, normalized_name;

-- ---------------------------------------------------------------------
-- STEP 2: For each duplicate group, count child rows per account so you
--          can choose the keeper. Replace '<normalized_name>' below.
-- ---------------------------------------------------------------------
-- Example for "trouw nutrtion canada":
--
-- SELECT a.id, a.name, a.created_at,
--        (SELECT COUNT(*) FROM contacts      c WHERE c.account_id = a.id) AS contact_cnt,
--        (SELECT COUNT(*) FROM opportunities o WHERE o.account_id = a.id) AS opp_cnt,
--        (SELECT COUNT(*) FROM activities    v WHERE v.account_id = a.id) AS activity_cnt
-- FROM accounts a
-- WHERE LOWER(TRIM(a.name)) = LOWER(TRIM('trouw nutrtion canada'))
--   AND a.archived_at IS NULL
-- ORDER BY contact_cnt DESC, opp_cnt DESC, activity_cnt DESC, a.created_at;

-- ---------------------------------------------------------------------
-- STEP 3: Per-group merge template (COMMENTED - paste real IDs first)
-- ---------------------------------------------------------------------
-- Replace:
--   <keep_id>  = the account_id you decided to keep
--   <dup_ids>  = ARRAY['id_a','id_b',...] of duplicates to merge into keeper
--
-- BEGIN;
--
--   -- 3a. Move contacts
--   UPDATE contacts
--   SET account_id = '<keep_id>'
--   WHERE account_id = ANY(ARRAY[<dup_ids>]);
--
--   -- 3b. Move opportunities
--   UPDATE opportunities
--   SET account_id = '<keep_id>'
--   WHERE account_id = ANY(ARRAY[<dup_ids>]);
--
--   -- 3c. Move activities
--   UPDATE activities
--   SET account_id = '<keep_id>'
--   WHERE account_id = ANY(ARRAY[<dup_ids>]);
--
--   -- 3d. Archive duplicate accounts (soft-delete)
--   UPDATE accounts
--   SET archived_at = NOW()
--   WHERE id = ANY(ARRAY[<dup_ids>])
--     AND archived_at IS NULL;
--
--   -- 3e. Sanity-check no child rows still reference the dupes
--   SELECT 'contacts'      AS t, COUNT(*) FROM contacts      WHERE account_id = ANY(ARRAY[<dup_ids>])
--   UNION ALL
--   SELECT 'opportunities',       COUNT(*) FROM opportunities WHERE account_id = ANY(ARRAY[<dup_ids>])
--   UNION ALL
--   SELECT 'activities',          COUNT(*) FROM activities    WHERE account_id = ANY(ARRAY[<dup_ids>]);
--
-- COMMIT;

-- =====================================================================
-- Known duplicate groups to process (from audit):
--   - "trouw nutrtion canada"   x 4
--   - "seaboard foods"          x 2
--   - "wayne sanderson farms"   x 2
--
-- After resolving all groups, optional follow-up: add a unique index
--   CREATE UNIQUE INDEX accounts_name_unique_idx
--     ON accounts (LOWER(TRIM(name))) WHERE archived_at IS NULL;
-- (NOT executed here - validate name normalization first.)
--
-- Next: 07-dedupe-contact-emails.sql (MANUAL review required)
-- =====================================================================
