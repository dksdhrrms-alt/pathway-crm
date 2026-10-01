-- Tasks.is_important — mirror of activities.is_important (added in
-- data-migration/21-activity-important-flag.sql). Reps star a task
-- when the subject or notes are worth surfacing to leadership in the
-- Weekly Report. Starred tasks render with the full subject AND the
-- description; unstarred ones get a one-line meta bullet.

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS is_important boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN tasks.is_important IS
  'When true, the Weekly Report includes the full description verbatim. Default false — the report shows a one-line meta bullet for the task.';

CREATE INDEX IF NOT EXISTS idx_tasks_is_important
  ON tasks (is_important) WHERE is_important = true;
