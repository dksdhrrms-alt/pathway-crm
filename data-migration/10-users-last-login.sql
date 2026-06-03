-- =====================================================================
-- users.last_login_at — add column to track last successful sign-in.
-- Idempotent, safe to re-run.
--
-- Populated by auth.ts authorize() on every successful Credentials login.
-- Surfaced on /admin's per-user table next to "Last Activity" so admins
-- can spot accounts that are inactive vs. accounts whose owner just
-- hasn't logged in recently (different signal).
-- =====================================================================

alter table users
  add column if not exists last_login_at timestamptz;

-- Index for the /admin sort + future "who hasn't logged in for N days" reports.
create index if not exists users_last_login_at_idx on users(last_login_at);
