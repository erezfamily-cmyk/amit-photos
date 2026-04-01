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
