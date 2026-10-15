-- ============================================================
-- Weekly Momentum Score — per-user "how much did I move the needle
-- this week" rollup.
--
-- One row per (user, ISO-week starting Monday). `breakdown` keeps the
-- per-category counts (calls/meetings/tasks/trials/wins) that fed into
-- the score so UIs can show "Calls 10 · Meetings 3 · Tasks 7" without
-- re-running the full aggregation client-side.
--
-- The row is written/overwritten by the daily cron
-- (/api/cron/weekly-momentum), which recomputes BOTH the current week
-- and the previous week each night — current for continuous update,
-- previous because late-logged activities (e.g. "Oh, I logged Friday's
-- meeting on Monday") shouldn't miss the prior week's bucket.
--
-- RLS is wide-open (authenticated read) because the leaderboard is
-- company-wide per Dave's spec. Writes go through the service role
-- in the cron.
-- ============================================================

CREATE TABLE IF NOT EXISTS user_weekly_momentum (
  user_id text NOT NULL,
  week_start date NOT NULL,         -- Monday of the ISO week (local Central time)
  score integer NOT NULL DEFAULT 0,
  breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_user_weekly_momentum_week
  ON user_weekly_momentum (week_start DESC, score DESC);

COMMENT ON TABLE user_weekly_momentum IS
  'Weekly activity score per user. Powers the Dashboard MomentumCard and the company-wide leaderboard. Rebuilt nightly by /api/cron/weekly-momentum.';
COMMENT ON COLUMN user_weekly_momentum.breakdown IS
  'JSONB breakdown of what fed the score: { activities: {call: N, meeting: N, email: N, note: N, starred: N}, tasksCompleted: N, oppsWon: N, trialUpdates: N }';

ALTER TABLE user_weekly_momentum ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_weekly_momentum_read ON user_weekly_momentum;
CREATE POLICY user_weekly_momentum_read ON user_weekly_momentum
  FOR SELECT TO authenticated USING (true);
-- Writes: only service role (cron), which bypasses RLS automatically.
