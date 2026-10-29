# Orphan photo_analyses cleanup — 2026-10-29

39 of 64 rows in `photo_analyses` pointed at photos missing from `photos` (files still in R2).
Visual (dHash) matching against the 2,310 published photos found a match for only 3.

Done on production D1 (`amit-photos-db`):
- Full backup of the 39 rows: table `photo_analyses_orphan_backup_20261029` (restore with `INSERT INTO photo_analyses SELECT * FROM photo_analyses_orphan_backup_20261029 WHERE photo_id = ?`).
- Re-linked `1Tpaw2ooFcWip-poF5_tXOxN1K-PQHpWA` ("זרעים של דנדליון") to photo `b6f3a48e-f597-4428-9153-aaa52e519a5a`.
- Deleted the other 38 orphan rows (including the duplicate dandelion and "קיר האהבה", which was not re-linked: copyright-sensitive street art).
- Result: 26 analyses, 0 orphans.
