-- ============================================================
-- Seed Ruminant / LATAM / Common R&D trial data from the
-- R&D Weekly Report (10.15.2026).
--
-- Prior to this, trials.animal_group only allowed the five
-- values Poultry / Swine / Poultry/Swine / Ruminants / LATAM.
-- Common R&D projects (Saponix, GroMega, BP-Lysine, Healthy Dog,
-- CastaFiber, Endo-Power, …) didn't fit any of those, so we add
-- a sixth value — Common — and this migration repopulates
-- the CHECK constraint, then inserts:
--
--   · 7 completed Ruminant trials (finished_at = 2026-10-14)
--   · 6 ongoing Ruminant trials + their week-ending 2026-10-14
--     trial_updates
--   · 2 ongoing LATAM trials + updates
--   · 1 completed + 6 ongoing Common R&D trials + updates
--
-- Idempotent: every insert uses ON CONFLICT DO NOTHING keyed on
-- (name, animal_group), and every trial_update is guarded by
-- the (trial_id, week_ending) unique index via upsert pattern.
-- Running this migration twice is a no-op.
-- ============================================================

-- ---------- Widen the CHECK constraint ----------------------
ALTER TABLE trials DROP CONSTRAINT IF EXISTS trials_animal_group_check;
ALTER TABLE trials ADD CONSTRAINT trials_animal_group_check
  CHECK (animal_group IN ('Poultry','Swine','Poultry/Swine','Ruminants','LATAM','Common'));

-- A (name, animal_group) unique key makes the inserts below
-- idempotent without needing explicit ids. Safe to add here —
-- there are no production trials with duplicated names today.
CREATE UNIQUE INDEX IF NOT EXISTS trials_name_group_uq
  ON trials (lower(name), animal_group);

-- Reporting week for all updates below. Oct 15 2026 is a
-- Thursday; the Wednesday of that week (our week_ending) is
-- Oct 14, 2026.
-- (Postgres doesn't let us use psql variables inside DO blocks,
--  so the literal date is inlined on each row.)

-- ---------- RUMINANT ─ completed ---------------------------
-- These rows get finished_at populated so they are hidden from
-- the public Weekly Report but preserved in Weekly History.
INSERT INTO trials (name, animal_group, phase, finished_at)
VALUES
  ('Jo-Eng Dairy Field Trial (Lipidol Protect)',                 'Ruminants', 'Dairy', '2026-10-14'::timestamptz),
  ('Alta Sierra Dairy Field Trial (Lipidol Protect)',            'Ruminants', 'Dairy', '2026-10-14'::timestamptz),
  ('Tierra Buena / Milk Maid Dairy Field Trial (Lipidol Protect)','Ruminants','Dairy', '2026-10-14'::timestamptz),
  ('Jonas Martin Dairy (Lipidol Protect)',                       'Ruminants', 'Dairy', '2026-10-14'::timestamptz),
  ('Bateman''s Dairy (Lipidol Protect)',                         'Ruminants', 'Dairy', '2026-10-14'::timestamptz),
  ('Sahrside Dairy / Big Gain (Lipidol Protect)',                'Ruminants', 'Dairy', '2026-10-14'::timestamptz),
  ('MSU Dairy Trial (Lipidol Protect)',                          'Ruminants', 'Dairy', '2026-10-14'::timestamptz)
ON CONFLICT (lower(name), animal_group) DO NOTHING;

-- ---------- RUMINANT ─ ongoing ------------------------------
INSERT INTO trials (name, animal_group, phase)
VALUES
  ('Pleasant View Dairy Field Trial (Lipidol Protect)',  'Ruminants', 'Dairy'),
  ('Meadow Wood Dairy Field Trial (Lipidol Protect)',    'Ruminants', 'Dairy'),
  ('PHD R&D Dairy Trial (Lipidol Protect)',              'Ruminants', 'Dairy'),
  ('Bettencourt Dairy Trial (Lipidol Protect)',          'Ruminants', 'Dairy'),
  ('TTU Beef Cattle Trial (Lipidol B)',                  'Ruminants', 'Beef'),
  ('Benton Group Dairy Field Trial (Lipidol Protect)',   'Ruminants', 'Dairy')
ON CONFLICT (lower(name), animal_group) DO NOTHING;

-- Weekly updates (week_ending = 2026-10-14) for the ongoing rows.
INSERT INTO trial_updates (trial_id, week_ending, stage, health, what_happened, next_step, due_date)
SELECT t.id, '2026-10-14'::date, u.stage::text, u.health::text, u.what_happened, u.next_step, u.due_date::date
FROM (VALUES
  ('Pleasant View Dairy Field Trial (Lipidol Protect)', 'Ruminants',
   'Analysis / Reporting', 'Green',
   'Data analysis in progress by Davy.',
   'Continue data analysis.',
   NULL),
  ('Meadow Wood Dairy Field Trial (Lipidol Protect)', 'Ruminants',
   'Analysis / Reporting', 'Green',
   'Data analysis in progress by Davy.',
   'Continue data analysis.',
   NULL),
  ('PHD R&D Dairy Trial (Lipidol Protect)', 'Ruminants',
   'Analysis / Reporting', 'Amber',
   'Discussed with Ph.D. R&D statistician.',
   'Request Final report v.2.',
   NULL),
  ('Bettencourt Dairy Trial (Lipidol Protect)', 'Ruminants',
   'Analysis / Reporting', 'Green',
   'Received final report from Davy.',
   'Make technical and marketing materials with trial data.',
   NULL),
  ('TTU Beef Cattle Trial (Lipidol B)', 'Ruminants',
   'Protocol / Pre-start', 'Green',
   'Review a draft of contract. Scheduled to start in December.',
   'Prepare Lipidol B and Protect samples.',
   '2026-12-01'),
  ('Benton Group Dairy Field Trial (Lipidol Protect)', 'Ruminants',
   'Active Trial', 'Green',
   'Trial started on Sept 15th.',
   'Trial will end on Dec 15th.',
   '2026-12-15')
) AS u(name, animal_group, stage, health, what_happened, next_step, due_date)
JOIN trials t ON lower(t.name) = lower(u.name) AND t.animal_group = u.animal_group
ON CONFLICT (trial_id, week_ending) DO UPDATE SET
  stage = EXCLUDED.stage, health = EXCLUDED.health,
  what_happened = EXCLUDED.what_happened, next_step = EXCLUDED.next_step,
  due_date = EXCLUDED.due_date, updated_at = now();

-- ---------- LATAM ─ ongoing ---------------------------------
INSERT INTO trials (name, animal_group, phase)
VALUES
  ('UGA Broiler Trial (ProBe-Bac)',       'LATAM', 'Monogastric (LATAM)'),
  ('Kalmbach Broiler Trial (ProBe-Bac)',  'LATAM', 'Monogastric (LATAM)')
ON CONFLICT (lower(name), animal_group) DO NOTHING;

INSERT INTO trial_updates (trial_id, week_ending, stage, health, what_happened, next_step, due_date)
SELECT t.id, '2026-10-14'::date, u.stage::text, u.health::text, u.what_happened, u.next_step, u.due_date::date
FROM (VALUES
  ('UGA Broiler Trial (ProBe-Bac)', 'LATAM',
   'Analysis / Reporting', 'Green',
   'Draft of news completed and review in progress. Requested Pathway Korea team for Technical bulletin.',
   'Marketing materials update.',
   NULL),
  ('Kalmbach Broiler Trial (ProBe-Bac)', 'LATAM',
   'Analysis / Reporting', 'Green',
   'Trial finished on Sept 8th.',
   'Request data and final report.',
   NULL)
) AS u(name, animal_group, stage, health, what_happened, next_step, due_date)
JOIN trials t ON lower(t.name) = lower(u.name) AND t.animal_group = u.animal_group
ON CONFLICT (trial_id, week_ending) DO UPDATE SET
  stage = EXCLUDED.stage, health = EXCLUDED.health,
  what_happened = EXCLUDED.what_happened, next_step = EXCLUDED.next_step,
  due_date = EXCLUDED.due_date, updated_at = now();

-- ---------- COMMON ─ completed ------------------------------
INSERT INTO trials (name, animal_group, phase, finished_at)
VALUES
  ('Endo-Power Protect (Coated EPG)', 'Common', 'Completed', '2026-10-14'::timestamptz)
ON CONFLICT (lower(name), animal_group) DO NOTHING;

-- ---------- COMMON ─ ongoing R&D projects -------------------
INSERT INTO trials (name, animal_group, phase)
VALUES
  ('Saponix Trio Project (Poultry Gut Health)', 'Common', 'Stage 5'),
  ('Saponix EZ Project (Layer Liver Health)',   'Common', 'Stage 5'),
  ('BP-Lysine Project (Coated Lysine)',         'Common', 'Stage 3'),
  ('GroMega + Project (GroMega + Lipidol Prime)','Common','Stage 3'),
  ('Healthy Dog Project (L-Carnitine)',         'Common', 'Stage 1'),
  ('CastaFiber Project (Ellagicel + NuFex)',    'Common', 'Stage 3')
ON CONFLICT (lower(name), animal_group) DO NOTHING;

INSERT INTO trial_updates (trial_id, week_ending, stage, health, what_happened, next_step, due_date)
SELECT t.id, '2026-10-14'::date, u.stage::text, u.health::text, u.what_happened, u.next_step, u.due_date::date
FROM (VALUES
  ('Saponix Trio Project (Poultry Gut Health)', 'Common',
   'Analysis / Reporting', 'Green',
   'Trial finished on Sept 8th.',
   'Request data and final report.',
   NULL),
  ('Saponix EZ Project (Layer Liver Health)', 'Common',
   'On Hold', 'Amber',
   'On hold until receiving the liver score results from Andrew. Asked Andrew for additional statistical analysis on liver score data.',
   'Continue on hold until liver score results arrive.',
   NULL),
  ('BP-Lysine Project (Coated Lysine)', 'Common',
   'Active Trial', 'Green',
   'Sourcing tannin liquid (condensed tannin) products for coating lysine (Tru Herb LLC; sample from India, lead time 4-5 weeks).',
   'Contact tannin suppliers and check availability.',
   NULL),
  ('GroMega + Project (GroMega + Lipidol Prime)', 'Common',
   'Active Trial', 'Green',
   'Formulation revision in progress.',
   'Continue formulation revision.',
   NULL),
  ('Healthy Dog Project (L-Carnitine)', 'Common',
   'Protocol / Pre-start', 'Green',
   'Carnitine sample procurement is on-going.',
   'Continue sample procurement.',
   NULL),
  ('CastaFiber Project (Ellagicel + NuFex)', 'Common',
   'On Hold', 'Amber',
   'On hold until other pipelines are ready to go.',
   'Continue on hold until other pipelines are ready.',
   NULL)
) AS u(name, animal_group, stage, health, what_happened, next_step, due_date)
JOIN trials t ON lower(t.name) = lower(u.name) AND t.animal_group = u.animal_group
ON CONFLICT (trial_id, week_ending) DO UPDATE SET
  stage = EXCLUDED.stage, health = EXCLUDED.health,
  what_happened = EXCLUDED.what_happened, next_step = EXCLUDED.next_step,
  due_date = EXCLUDED.due_date, updated_at = now();
