-- ============================================================
-- Project Tracker — Sub-bars / Phases (#183)
-- Adds a `sub_bars` JSONB column to projects so each project can carry
-- timeline-bound sub-phases (Material Prep Jun 1-7, Test Jun 8-15…).
-- Each item: { id, label, startDate, endDate, done? }.
-- Rendered as thin ~6px bars under the parent bar in the Gantt.
-- ============================================================

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS sub_bars jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN projects.sub_bars IS
  'Lightweight timeline phases rendered as thin bars below the parent in the Gantt. {id,label,startDate,endDate,done?}';
