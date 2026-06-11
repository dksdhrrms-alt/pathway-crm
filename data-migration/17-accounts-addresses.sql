-- ============================================================
-- Account billing + shipping addresses
-- Reps wanted to capture two distinct addresses per account: where
-- the paperwork goes (billing) and where samples/orders physically
-- ship to (shipping). For Pathway's customer base these are often
-- different — billing the corporate HQ, shipping to a feed mill /
-- farm.
--
-- All fields are text and optional; the account-detail page only
-- renders the block when at least one field is populated.
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS billing_street  text,
  ADD COLUMN IF NOT EXISTS billing_city    text,
  ADD COLUMN IF NOT EXISTS billing_state   text,
  ADD COLUMN IF NOT EXISTS billing_zip     text,
  ADD COLUMN IF NOT EXISTS shipping_street text,
  ADD COLUMN IF NOT EXISTS shipping_city   text,
  ADD COLUMN IF NOT EXISTS shipping_state  text,
  ADD COLUMN IF NOT EXISTS shipping_zip    text;

COMMENT ON COLUMN accounts.billing_street  IS 'Billing street line — where invoices are mailed.';
COMMENT ON COLUMN accounts.shipping_street IS 'Shipping street line — where samples / orders are delivered. May differ from billing.';
