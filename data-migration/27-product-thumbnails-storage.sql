-- ============================================================
-- Storage bucket for product catalog thumbnails.
--
-- Admins upload preview images through the Admin → Product Library
-- panel; the file goes into this bucket, and the returned public URL
-- gets written into product_library_files.thumbnail_url. External
-- URLs (Pathway Library, etc.) still work, but self-hosted uploads
-- survive re-organization of the library site.
--
-- Mirrors the existing `email-attachments` bucket pattern
-- (app/api/inbound-email/route.ts) — public read, unrestricted write
-- from the anon key. Writes are gated in the UI (admin tab is
-- role-gated), same trust model as other admin-curated tables.
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('product-thumbnails', 'product-thumbnails', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

-- ── Policies ────────────────────────────────────────────────────
-- Public SELECT so any signed-out visitor (or the CRM anon key)
-- can render the image in the <img> tag.
DROP POLICY IF EXISTS product_thumbnails_read ON storage.objects;
CREATE POLICY product_thumbnails_read ON storage.objects
  FOR SELECT USING (bucket_id = 'product-thumbnails');

-- INSERT / UPDATE / DELETE via anon key. Same trust model as
-- product_library_products (see 25-product-catalog.sql) — the admin
-- tab is the only surface that calls these; the CRM keeps admin
-- access gated at the route level.
DROP POLICY IF EXISTS product_thumbnails_write ON storage.objects;
CREATE POLICY product_thumbnails_write ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'product-thumbnails');

DROP POLICY IF EXISTS product_thumbnails_update ON storage.objects;
CREATE POLICY product_thumbnails_update ON storage.objects
  FOR UPDATE USING (bucket_id = 'product-thumbnails')
             WITH CHECK (bucket_id = 'product-thumbnails');

DROP POLICY IF EXISTS product_thumbnails_delete ON storage.objects;
CREATE POLICY product_thumbnails_delete ON storage.objects
  FOR DELETE USING (bucket_id = 'product-thumbnails');
