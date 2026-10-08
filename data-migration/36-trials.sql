-- ============================================================
-- Trial Tracker — mirrors the marketing team's
-- monogastric-trials.vercel.app workspace, now living inside the CRM.
--
-- Two tables:
--   trials         — one row per ongoing/finished trial. Holds the
--                    name, animal group (Poultry/Swine/mixed/
--                    Ruminants/LATAM), phase (Broiler/Layer/Turkey/
--                    Nursery/…), and a `finished_at` flag for the
--                    "Finish trial" button.
--   trial_updates  — one row per weekly update per trial. Carries the
--                    week-ending date, due date, stage, health badge
--                    (Green/Amber/Red), owner, free-text "what
--                    happened" + "next step". UNIQUE (trial_id,
--                    week_ending) so re-saving the same reporting
--                    week replaces instead of duplicates.
--
-- Access: no RLS gating by role — every authenticated CRM user can
-- read/write, matching the external tracker's "all pathway-
-- intermediates.com colleagues" model. The RLS policy only exists so
-- Supabase lets anon-key traffic through.
--
-- This migration also DROPs the legacy `projects` table along with
-- its Gantt JSONB columns, because the Project Tracker is being
-- removed in the same change (see app/projects/page.tsx deletion).
-- ============================================================

-- ---------- trials -------------------------------------------
CREATE TABLE IF NOT EXISTS trials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  -- Animal group. 'Poultry/Swine' is a legit value (mixed trials
  -- shared across both groups). Ruminants + LATAM added so the
  -- Trial Tracker can feed all three Weekly Report sections.
  animal_group text NOT NULL
    CHECK (animal_group IN ('Poultry','Swine','Poultry/Swine','Ruminants','LATAM')),
  -- Free-form phase string, validated by the UI not the DB. Typical
  -- values today: Broiler / Layer / Turkey / Other Poultry / Nursery /
  -- Grower / Finisher / Wean-to-Finish / Gestation / Lactation /
  -- Other Swine / Mixed Poultry/Swine / Dairy / Beef / Calf / …
  phase text NOT NULL,
  -- Set when "Finish trial" is clicked; null = ongoing. Finished
  -- trials are hidden from the public Weekly Report but stay in
  -- Weekly History.
  finished_at timestamptz,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trials_animal_group ON trials (animal_group);
CREATE INDEX IF NOT EXISTS idx_trials_finished_at  ON trials (finished_at);

ALTER TABLE trials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trials_all ON trials;
CREATE POLICY trials_all ON trials FOR ALL USING (true) WITH CHECK (true);

-- ---------- trial_updates ------------------------------------
CREATE TABLE IF NOT EXISTS trial_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trial_id uuid NOT NULL REFERENCES trials (id) ON DELETE CASCADE,
  -- Date the reporting week ends (Wednesday by convention — matches
  -- the external tracker). Weekly Report filters on this field.
  week_ending date NOT NULL,
  due_date date,
  stage text NOT NULL
    CHECK (stage IN ('Protocol / Pre-start','Active Trial','Analysis / Reporting','On Hold','Complete')),
  health text NOT NULL
    CHECK (health IN ('Green','Amber','Red')),
  owner text,
  what_happened text,
  next_step text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- One update per trial per reporting week. Re-saving the same
  -- week overwrites (handled by upsert in lib/trials.ts).
  UNIQUE (trial_id, week_ending)
);

CREATE INDEX IF NOT EXISTS idx_trial_updates_week ON trial_updates (week_ending);
CREATE INDEX IF NOT EXISTS idx_trial_updates_trial ON trial_updates (trial_id, week_ending DESC);

ALTER TABLE trial_updates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trial_updates_all ON trial_updates;
CREATE POLICY trial_updates_all ON trial_updates FOR ALL USING (true) WITH CHECK (true);

-- ---------- Drop legacy projects table (Gantt tracker) -------
-- Previously the sidebar had a "Project Tracker" that stored
-- Marketing project rows with JSONB `tasks` / `sub_bars`. That
-- surface is being replaced wholesale by the Trial Tracker above.
-- Drop CASCADE so any dependent view/trigger goes with it.
DROP TABLE IF EXISTS projects CASCADE;
