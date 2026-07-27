-- Daily brief email opt-in flag. Admins turn it on per user (Admin →
-- Users column "Daily Brief"), and each user can also toggle their
-- own in Profile → Notifications. The /api/cron/daily-brief route
-- only emails users where daily_email = true AND status = 'active'.
--
-- Mirrors the BioMatrix CRM setup (that project's `supabase/
-- add-daily-email.sql`) so the two apps behave the same way.

ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_email boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN users.daily_email IS
  'When true, the weekday morning cron (/api/cron/daily-brief) emails this user a personalized brief of their open tasks. Toggle from Profile → Notifications or Admin → Users → Daily Brief column.';
