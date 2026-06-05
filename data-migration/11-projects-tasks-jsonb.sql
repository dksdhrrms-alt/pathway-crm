-- ============================================================
-- Project Tracker — Checklist (#181)
-- Adds a `tasks` JSONB column to projects so each project can carry
-- an ordered list of sub-steps (Material Prep, Microscopic Test, …)
-- without a separate table. Defaults to empty array so existing rows
-- and inserts that don't include it stay valid.
-- ============================================================

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS tasks jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN projects.tasks IS
  'Ordered checklist of {id,label,done,doneAt} items rendered in ProjectModal and Gantt progress bars.';

-- Optional sanity index for "any project with checklist progress"
-- reporting later. Cheap to create, can be dropped if unused.
CREATE INDEX IF NOT EXISTS idx_projects_tasks_jsonb
  ON projects USING gin (tasks);
