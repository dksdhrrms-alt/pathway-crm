-- Adds preview thumbnails to catalog files so the product page can
-- render the PPT-style layout the sales team asked for (each Sales
-- Tools card shows a preview image above the filename link).
--
-- Thumbnail URL is optional — files without one just render the
-- filename link like before.

ALTER TABLE product_library_files
  ADD COLUMN IF NOT EXISTS thumbnail_url text;

COMMENT ON COLUMN product_library_files.thumbnail_url IS
  'Optional preview image URL shown above the filename on the catalog page. Any public image URL works (Pathway Library, Supabase Storage, direct link).';
