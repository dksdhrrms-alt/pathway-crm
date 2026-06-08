-- ============================================================
-- Last Seen heartbeat (#197)
-- Admin Team Overview wanted a real "user is around" signal — Last
-- Login only fires on the credentials sign-in path and never updates
-- afterward; Last Activity needs an explicit log entry. last_seen_at
-- is poked by every authenticated client every ~60s via /api/me/seen,
-- so it reflects actual presence (browsing, clicking, leaving the tab
-- open).
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

COMMENT ON COLUMN users.last_seen_at IS
  'Most recent client heartbeat. Updated by /api/me/seen (60s ping, tab-visible only).';

-- Sorted lookups in admin (e.g. "who is online right now") are cheap
-- and the column is small; no need to index.
