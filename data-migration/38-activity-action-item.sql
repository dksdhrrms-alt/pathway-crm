-- ============================================================
-- "Action Item" on an Activity log — automatically becomes a Task.
--
-- Sales reps asked for a single-save flow: when they log what they
-- just did (Activity) they often already know the follow-up for next
-- week. Instead of leaving the modal, navigating to Tasks, and
-- creating a new one, they tick an inline "Add this as a follow-up
-- task" checkbox and type the next step. On save the Activity row is
-- created as usual AND a Task row is created too, linked back via
-- `tasks.source_activity_id` so UI can show "↳ from activity" and
-- the Director Weekly Report can mark these rows for the Next Week
-- column.
--
-- Columns added here:
--   activities.action_item    text — optional reference copy of the
--                             next step as typed in the modal. Not
--                             used by the Weekly Report (which pulls
--                             from `tasks`), just preserved on the
--                             originating activity so an operator can
--                             see what Task text was auto-created
--                             from this log — handy for audits and
--                             if the Task later gets edited.
--   tasks.source_activity_id  uuid FK — nullable. When set, this
--                             task was spawned from an Activity's
--                             action-item field. ON DELETE SET NULL
--                             so deleting the originating activity
--                             doesn't nuke the task the rep still
--                             needs to do.
-- ============================================================

ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS action_item text;

COMMENT ON COLUMN activities.action_item IS
  'Reference copy of the action-item text typed on the Log Activity modal. The real follow-up lives in tasks (source_activity_id -> this activity).';

-- NOTE: `activities.id` is `text` (not uuid) in this schema, so the FK
-- column must match — Postgres refuses a cross-type FK with
-- "incompatible types: uuid and text". Keeping both sides as text
-- keeps generateId() (random base36 string, from lib/data.ts) working
-- as-is on the client without a round-trip to Supabase for a uuid.
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS source_activity_id text
    REFERENCES activities (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_source_activity
  ON tasks (source_activity_id);

COMMENT ON COLUMN tasks.source_activity_id IS
  'Nullable FK. When set, the task was auto-created from an Activity log''s action-item field. UI shows a 🔗 chip and the Weekly Report marks the task line with "↳".';
