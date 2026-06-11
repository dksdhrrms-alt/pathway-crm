-- ============================================================
-- Contact physical address (street / city / zip)
-- Reps asked to capture the contact's mailing address so the
-- Contacts list can be filtered/exported by location. State was
-- already on the row; this adds the three missing pieces.
--
-- ZIP is text (not int) so leading zeros are preserved — Boston's
-- 02134 should not become 2134.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS street text,
  ADD COLUMN IF NOT EXISTS city   text,
  ADD COLUMN IF NOT EXISTS zip    text;

COMMENT ON COLUMN contacts.street IS 'Street line of the physical address (e.g. "123 Main St").';
COMMENT ON COLUMN contacts.city   IS 'City portion of the physical address.';
COMMENT ON COLUMN contacts.zip    IS 'US ZIP / postal code, stored as text to preserve leading zeros.';
