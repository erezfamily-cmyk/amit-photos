-- הרץ פעם אחת דרך Cloudflare Dashboard → D1 → amit-photos-db → Console

CREATE TABLE IF NOT EXISTS subscribers (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL DEFAULT '',
  email      TEXT NOT NULL,
  notes      TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
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
