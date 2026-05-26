-- =====================================================================
-- 01-audit.sql
-- READ-ONLY diagnostic queries. No data is modified.
-- Run this in Supabase SQL Editor BEFORE any other migration script.
-- Review the counts and samples; share with team before running 02+.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ISSUE 1: accounts.owner_name out of sync with users.name (P0, ~79)
-- ---------------------------------------------------------------------
SELECT 'ISSUE 1: account owner_name mismatch' AS check_name;

SELECT COUNT(*) AS account_ownername_mismatches
FROM accounts a
LEFT JOIN users u ON u.id = a.owner_id
WHERE a.owner_name IS DISTINCT FROM u.name;

-- Sample (first 20)
SELECT a.id, a.name AS account_name, a.owner_id,
       a.owner_name AS stale_name,
       u.name       AS actual_name
FROM accounts a
LEFT JOIN users u ON u.id = a.owner_id
WHERE a.owner_name IS DISTINCT FROM u.name
ORDER BY a.name
LIMIT 20;

-- Breakdown by stale_name (which old owners dominate?)
SELECT a.owner_name AS stale_name, COUNT(*) AS cnt
FROM accounts a
LEFT JOIN users u ON u.id = a.owner_id
WHERE a.owner_name IS DISTINCT FROM u.name
GROUP BY a.owner_name
ORDER BY cnt DESC;

-- ---------------------------------------------------------------------
-- ISSUE 2: contacts.owner_name out of sync (P0, ~34)
-- ---------------------------------------------------------------------
SELECT 'ISSUE 2: contact owner_name mismatch' AS check_name;

SELECT COUNT(*) AS contact_ownername_mismatches
FROM contacts c
LEFT JOIN users u ON u.id = c.owner_id
WHERE c.owner_name IS DISTINCT FROM u.name;

SELECT c.id, c.name AS contact_name, c.owner_id,
       c.owner_name AS stale_name,
       u.name       AS actual_name
FROM contacts c
LEFT JOIN users u ON u.id = c.owner_id
WHERE c.owner_name IS DISTINCT FROM u.name
ORDER BY c.name
LIMIT 20;

-- ---------------------------------------------------------------------
-- ISSUE 3: Ghost contacts (no email AND no account_id) (P0, ~323)
-- ---------------------------------------------------------------------
SELECT 'ISSUE 3: ghost contacts' AS check_name;

SELECT COUNT(*) AS ghost_contacts
FROM contacts
WHERE (email IS NULL OR email = '')
  AND (account_id IS NULL OR account_id = '');

-- Breakdown by owner
SELECT COALESCE(owner_name, '(no owner)') AS owner,
       COUNT(*) AS ghost_count
FROM contacts
WHERE (email IS NULL OR email = '')
  AND (account_id IS NULL OR account_id = '')
GROUP BY owner_name
ORDER BY ghost_count DESC;

-- Sample
SELECT id, name, owner_name, created_at
FROM contacts
WHERE (email IS NULL OR email = '')
  AND (account_id IS NULL OR account_id = '')
ORDER BY created_at NULLS LAST
LIMIT 20;

-- ---------------------------------------------------------------------
-- ISSUE 4: Orphan activities (P0, ~65)
--   4a: 45 with no contact AND no account (excluding [SYSTEM] subjects)
--   4b: 20 with contact_id pointing to non-existent contact
-- ---------------------------------------------------------------------
SELECT 'ISSUE 4a: activities with no contact AND no account' AS check_name;

SELECT COUNT(*) AS unattached_activities
FROM activities
WHERE (contact_id IS NULL OR contact_id = '')
  AND (account_id IS NULL OR account_id = '')
  AND COALESCE(subject, '') NOT LIKE '[SYSTEM]%';

SELECT id, subject, date, owner_name, type
FROM activities
WHERE (contact_id IS NULL OR contact_id = '')
  AND (account_id IS NULL OR account_id = '')
  AND COALESCE(subject, '') NOT LIKE '[SYSTEM]%'
ORDER BY date DESC NULLS LAST
LIMIT 20;

SELECT 'ISSUE 4b: activities with broken contact_id' AS check_name;

SELECT COUNT(*) AS broken_contact_refs
FROM activities a
WHERE a.contact_id IS NOT NULL
  AND a.contact_id <> ''
  AND NOT EXISTS (SELECT 1 FROM contacts c WHERE c.id = a.contact_id);

SELECT a.id, a.subject, a.contact_id, a.account_id, a.date
FROM activities a
WHERE a.contact_id IS NOT NULL
  AND a.contact_id <> ''
  AND NOT EXISTS (SELECT 1 FROM contacts c WHERE c.id = a.contact_id)
ORDER BY a.date DESC NULLS LAST
LIMIT 20;

-- ---------------------------------------------------------------------
-- ISSUE 5: Duplicate activities (P1, ~13)
-- Same subject + date + contact_id (+ account_id)
-- ---------------------------------------------------------------------
SELECT 'ISSUE 5: duplicate activities' AS check_name;

WITH dups AS (
  SELECT subject, date,
         COALESCE(contact_id, '') AS cid,
         COALESCE(account_id, '') AS aid,
         COUNT(*) AS cnt,
         array_agg(id ORDER BY created_at NULLS LAST, id) AS activity_ids
  FROM activities
  GROUP BY subject, date, COALESCE(contact_id, ''), COALESCE(account_id, '')
  HAVING COUNT(*) > 1
)
SELECT subject, date, cid AS contact_id, aid AS account_id, cnt, activity_ids
FROM dups
ORDER BY cnt DESC, subject
LIMIT 30;

SELECT COUNT(*) AS duplicate_activity_groups,
       SUM(cnt - 1) AS extra_rows_to_archive
FROM (
  SELECT COUNT(*) AS cnt
  FROM activities
  GROUP BY subject, date, COALESCE(contact_id, ''), COALESCE(account_id, '')
  HAVING COUNT(*) > 1
) g;

-- ---------------------------------------------------------------------
-- ISSUE 6: Duplicate account names (P1)
-- ---------------------------------------------------------------------
SELECT 'ISSUE 6: duplicate account names' AS check_name;

SELECT LOWER(TRIM(name)) AS normalized_name,
       COUNT(*) AS cnt,
       array_agg(id ORDER BY created_at NULLS LAST, id) AS account_ids,
       array_agg(name) AS exact_names
FROM accounts
GROUP BY LOWER(TRIM(name))
HAVING COUNT(*) > 1
ORDER BY cnt DESC, normalized_name;

-- ---------------------------------------------------------------------
-- ISSUE 7: Duplicate contact emails (P1)
-- ---------------------------------------------------------------------
SELECT 'ISSUE 7: duplicate contact emails' AS check_name;

SELECT LOWER(TRIM(email)) AS normalized_email,
       COUNT(*) AS cnt,
       array_agg(id ORDER BY created_at NULLS LAST, id) AS contact_ids,
       array_agg(name) AS names
FROM contacts
WHERE email IS NOT NULL AND email <> ''
GROUP BY LOWER(TRIM(email))
HAVING COUNT(*) > 1
ORDER BY cnt DESC, normalized_email;

-- =====================================================================
-- End of audit. No mutations performed.
-- Next: review counts, then run 02-fix-owner-names.sql
-- =====================================================================
