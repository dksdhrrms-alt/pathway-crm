-- ============================================================
-- Activities.is_important — per-activity "star" flag
--
-- The Weekly Report used to blast every activity's full description
-- into the docx which quickly bloated to 15+ pages. Reps now mark
-- specific activities as important; the report renders those
-- verbatim (meta line + full description), and folds the rest to a
-- single-line meta bullet so the leadership view stays scannable.
-- ============================================================

ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS is_important boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN activities.is_important IS
  'When true, the Weekly Report includes the full description verbatim. Default false — the report shows only the meta bullet for the activity.';

-- Optional index so the Weekly Report route can quickly split rows
-- into important vs. rest during summary generation. Small table
-- doesn't strictly need it, but it costs nothing.
CREATE INDEX IF NOT EXISTS idx_activities_is_important
  ON activities (is_important) WHERE is_important = true;
