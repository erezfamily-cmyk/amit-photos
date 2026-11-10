-- Index for category lookups on published photos.
-- Without it, "WHERE published=1 AND category=?" scans the whole photos table
-- (~2,400 rows_read per call), which counts against the D1 free-tier daily cap.
-- Idempotent and additive: safe to run more than once, changes no data.

CREATE INDEX IF NOT EXISTS idx_photos_published_category
  ON photos(published, category);
