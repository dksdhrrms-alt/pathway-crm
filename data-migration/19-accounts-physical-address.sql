-- ============================================================
-- Account physical (main) address — formalize the existing
-- state/location columns into a proper 4-field address: Street,
-- City, State, ZIP. Adds physical_street + physical_zip; State and
-- City reuse the existing accounts.state / accounts.location
-- columns so we don't migrate historical data.
--
-- Purpose:
--   - Reps wanted the account's *physical* (operational) address
--     surfaced under the account header, with the same structured
--     fields as Billing / Shipping.
--   - Duplicate detection prefers physical → billing → shipping,
--     so this is the most-accurate signal for "are these the same
--     farm?".
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS physical_street text,
  ADD COLUMN IF NOT EXISTS physical_zip    text;

COMMENT ON COLUMN accounts.physical_street IS 'Street line of the physical/main address (e.g. "123 Main St").';
COMMENT ON COLUMN accounts.physical_zip    IS 'ZIP / postal code of the physical address. text to preserve leading zeros.';
COMMENT ON COLUMN accounts.location        IS 'City portion of the physical address (legacy column, reused).';
COMMENT ON COLUMN accounts.state           IS 'State portion of the physical address (legacy column, reused).';
