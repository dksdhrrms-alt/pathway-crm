-- =====================================================================
-- 07-dedupe-contact-emails.sql
-- Dedupes contacts that share an email address (case-insensitive).
-- !!! REQUIRES MANUAL REVIEW BEFORE MUTATION !!!
-- Like 06, the merge logic is COMMENTED OUT as a per-group template.
--
-- Run this in Supabase SQL Editor. Read 01-audit.sql first.
-- 03-archive-ghost-contacts.sql must have created the archived_at column.
-- BACKUP MANDATORY before any uncommented run.
--
-- Strategy:
--   1. Identify dup-email groups (Step 1)
--   2. For each group, the keeper is the contact with the most activities
--      (or the oldest if tied) (Step 2)
--   3. Reassign activities from losers to keeper, archive losers (Step 3)
--
-- Rollback:
--   UPDATE contacts SET archived_at = NULL WHERE id = ANY(ARRAY[<loser_ids>]);
--   - Activity ownership cannot be auto-restored; use a snapshot.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 7.0 Sanity: contacts.archived_at exists (created by 03)
-- ---------------------------------------------------------------------
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------
-- STEP 1: Identify duplicate emails (active contacts only)
-- ---------------------------------------------------------------------
SELECT LOWER(TRIM(email)) AS normalized_email,
       COUNT(*) AS dup_count,
       array_agg(id ORDER BY created_at NULLS LAST, id) AS contact_ids,
       array_agg(name) AS names,
       array_agg(account_id) AS account_ids
FROM contacts
WHERE email IS NOT NULL
  AND email <> ''
  AND archived_at IS NULL
GROUP BY LOWER(TRIM(email))
HAVING COUNT(*) > 1
ORDER BY dup_count DESC, normalized_email;

-- ---------------------------------------------------------------------
-- STEP 2: For one specific email, see per-contact activity counts so
--          you can pick the keeper. Replace '<email>' below.
-- ---------------------------------------------------------------------
-- Example for eric.stejskal@trouwnutrition.com:
--
-- SELECT c.id, c.name, c.account_id, c.owner_name, c.created_at,
--        (SELECT COUNT(*) FROM activities a WHERE a.contact_id = c.id) AS activity_cnt
-- FROM contacts c
-- WHERE LOWER(TRIM(c.email)) = LOWER(TRIM('eric.stejskal@trouwnutrition.com'))
--   AND c.archived_at IS NULL
-- ORDER BY activity_cnt DESC, c.created_at;

-- ---------------------------------------------------------------------
-- STEP 3: Per-group merge template (COMMENTED - paste real IDs first)
-- ---------------------------------------------------------------------
-- Replace:
--   <keep_id>   = contact_id to keep
--   <loser_ids> = ARRAY['id_a',...] of duplicates to archive
--
-- BEGIN;
--
--   -- 3a. Re-point activities from losers to keeper
--   UPDATE activities
--   SET contact_id = '<keep_id>'
--   WHERE contact_id = ANY(ARRAY[<loser_ids>]);
--
--   -- 3b. (Optional) re-point opportunities if your schema links them by contact
--   -- UPDATE opportunities
--   -- SET contact_id = '<keep_id>'
--   -- WHERE contact_id = ANY(ARRAY[<loser_ids>]);
--
--   -- 3c. Archive losers
--   UPDATE contacts
--   SET archived_at = NOW()
--   WHERE id = ANY(ARRAY[<loser_ids>])
--     AND archived_at IS NULL;
--
--   -- 3d. Sanity check
--   SELECT 'activities_still_on_losers' AS t,
--          COUNT(*) FROM activities WHERE contact_id = ANY(ARRAY[<loser_ids>]);
--
-- COMMIT;

-- =====================================================================
-- Known duplicate emails to process (from audit, partial):
--   - eric.stejskal@trouwnutrition.com x 2
-- Plus any others surfaced by STEP 1.
--
-- After resolving, optional follow-up:
--   CREATE UNIQUE INDEX contacts_email_unique_idx
--     ON contacts (LOWER(TRIM(email)))
--     WHERE archived_at IS NULL AND email IS NOT NULL AND email <> '';
-- (NOT executed here - validate first.)
--
-- Next: 08-add-indexes-and-rls-notes.md
-- =====================================================================
