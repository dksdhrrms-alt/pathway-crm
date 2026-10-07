-- Storage bucket for Product catalog file uploads (hybrid with the
-- existing Pathway Library URL path). Admins can either paste a
-- library URL OR upload the file directly to Supabase so sales reps
-- get a one-click direct download without needing Library login.
--
-- Mirrors product-thumbnails and activity-attachments buckets.

INSERT INTO storage.buckets (id, name, public)
VALUES ('product-files', 'product-files', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

DROP POLICY IF EXISTS product_files_read ON storage.objects;
CREATE POLICY product_files_read ON storage.objects
  FOR SELECT USING (bucket_id = 'product-files');

DROP POLICY IF EXISTS product_files_write ON storage.objects;
CREATE POLICY product_files_write ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'product-files');

DROP POLICY IF EXISTS product_files_update ON storage.objects;
CREATE POLICY product_files_update ON storage.objects
  FOR UPDATE USING (bucket_id = 'product-files')
             WITH CHECK (bucket_id = 'product-files');

DROP POLICY IF EXISTS product_files_delete ON storage.objects;
CREATE POLICY product_files_delete ON storage.objects
  FOR DELETE USING (bucket_id = 'product-files');
