-- ============================================================
-- Admin announcements + per-user dismissal tracking
-- Lets Admin/CEO post a banner-style message that pops up the
-- next time any user lands on /. Users can dismiss "for 5 days";
-- the dismissal is stored server-side so it follows the user
-- across PC + mobile rather than only that browser's localStorage.
-- ============================================================

CREATE TABLE IF NOT EXISTS announcements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  body        text NOT NULL,
  severity    text NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  active      boolean NOT NULL DEFAULT true,
  -- Optional hard cutoff. After this timestamp the popup never shows
  -- regardless of `active`. Null = no expiry.
  expires_at  timestamptz,
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_announcements_active
  ON announcements (active, expires_at);

COMMENT ON TABLE announcements IS
  'Admin/CEO-authored popup messages shown on Home. Edit/delete via /admin Announcements tab.';

-- Per-user dismissals. (announcement_id, user_id) is unique — repeat
-- "dismiss for 5 days" updates the same row's dismissed_until.
CREATE TABLE IF NOT EXISTS announcement_dismissals (
  announcement_id  uuid NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id          text NOT NULL,
  dismissed_until  timestamptz NOT NULL,
  dismissed_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_dismissals_user_until
  ON announcement_dismissals (user_id, dismissed_until);

COMMENT ON TABLE announcement_dismissals IS
  'Tracks when each user dismissed an announcement, so the 5-day snooze follows the user across devices.';
