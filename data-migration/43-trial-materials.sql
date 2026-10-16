-- ============================================================
-- Trial Materials — per-trial file attachments with team-based
-- access control.
--
-- Driven by Edwin's request (and Jake's suggestion) on 2026-10-16:
--   "Add the ability to upload trial materials and documents to
--    each trial record ... access to those files would be limited
--    to directors and the employees leading the respective trials."
--
-- Design — AFTER product-review discussion with Dave on 2026-10-16:
--
--   * Access is granted at the USER level, not per-trial. An Admin
--     ticks which of {monogastrics, ruminants, latam} a user can
--     see files for, and that unlocks files on every trial whose
--     animal_group falls in that bucket. Rationale: trial-level
--     ACLs become unmaintainable at scale, and the real-world
--     mental model is "Jake works on monogastric trials" rather
--     than "Jake works on these 7 specific trials".
--
--   * Buckets map to animal_group values as follows:
--       monogastrics  → ('Poultry','Swine','Poultry/Swine')
--       ruminants     → ('Ruminants')
--       latam         → ('LATAM')
--
--   * Admin / CEO / COO / administrative_manager always have access
--     (checked in the app, not here — this table just lists the
--     per-user grants for non-admin users).
--
--   * Directors see all trials in their own team (that already
--     exists via users.team / users.role; nothing to add here).
--
-- Files are kept in the `trial-files` Supabase Storage bucket.
--
-- Versioning: re-uploading a file with the same label on the same
-- trial creates a new `trial_files` row with parent_file_id set to
-- the previous version and version = prev.version + 1. The UI
-- shows only the latest by default, with a "previous versions"
-- toggle to expand the chain.
-- ============================================================

-- ---------- user-level trial access --------------------------
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS trial_access_teams text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN users.trial_access_teams IS
  'Subset of {monogastrics,ruminants,latam} this user may view trial files for. Admin/CEO/COO/administrative_manager and the team''s Director bypass this check in the app layer.';

-- ---------- trial_files --------------------------------------
CREATE TABLE IF NOT EXISTS trial_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trial_id uuid NOT NULL REFERENCES trials (id) ON DELETE CASCADE,

  -- Version chain. parent_file_id = null means this is v1. When a
  -- user re-uploads with the same label, the app creates a new row
  -- pointing at the current head and bumps version. Deleting a
  -- parent cascades to its children — losing v1 drops the whole
  -- history (deliberate; keeps the chain consistent).
  parent_file_id uuid REFERENCES trial_files (id) ON DELETE CASCADE,
  version int NOT NULL DEFAULT 1 CHECK (version >= 1),

  -- Human label shown in the UI. Same label on the same trial is
  -- how the app detects "this is a new version of X" at upload time.
  label text NOT NULL,

  -- Full Supabase Storage public URL (same pattern as
  -- product-files / activity-attachments).
  url text NOT NULL,
  storage_path text,          -- path within the bucket, for deletes
  file_size bigint,
  mime_type text,

  uploaded_by text,           -- user id string, matches other tables
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trial_files_trial     ON trial_files (trial_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_trial_files_parent    ON trial_files (parent_file_id);
CREATE INDEX IF NOT EXISTS idx_trial_files_trial_lbl ON trial_files (trial_id, label);

ALTER TABLE trial_files ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trial_files_all ON trial_files;
CREATE POLICY trial_files_all ON trial_files FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE trial_files IS
  'Per-trial file attachments. Access is enforced in the app layer against users.trial_access_teams (plus admin / director role bypasses). Versioning is implicit via (trial_id, label): latest version is the row whose id is not referenced by any other row''s parent_file_id.';

-- ---------- Supabase Storage bucket --------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('trial-files', 'trial-files', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

DROP POLICY IF EXISTS trial_files_bucket_read   ON storage.objects;
CREATE POLICY trial_files_bucket_read   ON storage.objects
  FOR SELECT USING (bucket_id = 'trial-files');

DROP POLICY IF EXISTS trial_files_bucket_write  ON storage.objects;
CREATE POLICY trial_files_bucket_write  ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'trial-files');

DROP POLICY IF EXISTS trial_files_bucket_update ON storage.objects;
CREATE POLICY trial_files_bucket_update ON storage.objects
  FOR UPDATE USING (bucket_id = 'trial-files')
             WITH CHECK (bucket_id = 'trial-files');

DROP POLICY IF EXISTS trial_files_bucket_delete ON storage.objects;
CREATE POLICY trial_files_bucket_delete ON storage.objects
  FOR DELETE USING (bucket_id = 'trial-files');

-- ---------- weekly trial report recipient list ---------------
-- Cron (/api/cron/trial-weekly-report, Thursdays 12 PM) emails the
-- generated .docx to the addresses stored here. Managed from the
-- Admin page. Kept as its own tiny table rather than a users-row
-- flag because recipients may include non-CRM email addresses
-- (e.g. an external advisor).
CREATE TABLE IF NOT EXISTS trial_report_recipients (
  email text PRIMARY KEY,
  label text,                           -- "Edwin Lee", "Jake Lee", …
  teams text[] NOT NULL DEFAULT '{monogastrics,ruminants,latam}',
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN trial_report_recipients.teams IS
  'Which team sections to include in this recipient''s copy. Default = all three. Lets us send a Monogastric-only copy to one person and a full report to another.';

ALTER TABLE trial_report_recipients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trial_report_recipients_all ON trial_report_recipients;
CREATE POLICY trial_report_recipients_all
  ON trial_report_recipients FOR ALL
  USING (true) WITH CHECK (true);
