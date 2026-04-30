-- הרץ פעם אחת דרך Cloudflare Dashboard → D1 → amit-photos-db → Console
-- (אם הטבלאות subscribers ו-customers כבר קיימות, הרץ רק את CREATE TABLE photos)
-- הוסף גם את sessions ו-login_attempts אם עדיין לא קיימות

CREATE TABLE IF NOT EXISTS subscribers (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL DEFAULT '',
  email      TEXT NOT NULL,
  notes      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS photos (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL DEFAULT '',
  category    TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  filename    TEXT NOT NULL DEFAULT '',
  r2_key      TEXT NOT NULL DEFAULT '',
  url         TEXT NOT NULL DEFAULT '',
  thumbnail   TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL DEFAULT '',
  phone      TEXT NOT NULL DEFAULT '',
  date       TEXT NOT NULL DEFAULT '',
  type       TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'ממתין',
  subject    TEXT NOT NULL DEFAULT '',
  notes      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS login_attempts (
  ip           TEXT PRIMARY KEY,
  count        INTEGER NOT NULL DEFAULT 0,
  last_attempt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reset_tokens (
  token      TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL
);

-- שדות שנוספו ב-ALTER TABLE לאחר יצירת הטבלה הראשונית:
-- ALTER TABLE photos ADD COLUMN published INTEGER DEFAULT 1;
-- ALTER TABLE photos ADD COLUMN price_overrides TEXT DEFAULT NULL;
-- ALTER TABLE photos ADD COLUMN is_week_photo INTEGER DEFAULT 0;
-- ALTER TABLE photos ADD COLUMN week_photo_discount REAL DEFAULT 0;
-- ALTER TABLE photos ADD COLUMN week_photo_caption TEXT DEFAULT '';
-- ALTER TABLE photos ADD COLUMN week_photo_caption_en TEXT DEFAULT '';
-- ALTER TABLE photos ADD COLUMN width INTEGER DEFAULT 0;
-- ALTER TABLE photos ADD COLUMN height INTEGER DEFAULT 0;
-- ALTER TABLE photos ADD COLUMN added_at TEXT DEFAULT NULL;
-- ALTER TABLE photos ADD COLUMN is_new INTEGER DEFAULT 0;
-- ALTER TABLE photos ADD COLUMN quiz_eligible INTEGER DEFAULT 0;
-- ALTER TABLE photos ADD COLUMN quiz_description TEXT DEFAULT '';
