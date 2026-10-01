-- Amit Photos PayPal Sandbox staging bootstrap
-- SAFE ONLY FOR A NEW, ISOLATED STAGING D1 DATABASE.
-- NEVER RUN AGAINST amit-photos-db (production).

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  filename TEXT NOT NULL DEFAULT '',
  r2_key TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  thumbnail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  published INTEGER NOT NULL DEFAULT 1,
  price_overrides TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS download_tokens (
  token TEXT PRIMARY KEY,
  photo_ids TEXT NOT NULL,
  size TEXT NOT NULL,
  tx TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  amount REAL NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_download_tokens_tx
  ON download_tokens(tx);

CREATE TABLE IF NOT EXISTS paypal_orders (
  id TEXT PRIMARY KEY,
  paypal_order_id TEXT UNIQUE NOT NULL,
  order_type TEXT NOT NULL,
  photo_id TEXT NOT NULL,
  sku TEXT,
  amount_expected INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'CREATED',
  print_address_json TEXT,
  fulfillment_json TEXT,
  fulfillment_token TEXT UNIQUE,
  paypal_capture_id TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_paypal_orders_status
  ON paypal_orders(status);

CREATE TABLE IF NOT EXISTS paypal_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processed INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE paypal_orders ADD COLUMN client_idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_paypal_orders_client_idempotency
  ON paypal_orders(client_idempotency_key)
  WHERE client_idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS paypal_rate_limits (
  rate_key TEXT NOT NULL,
  action TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (rate_key, action, window_start)
);

CREATE INDEX IF NOT EXISTS idx_paypal_rate_limits_window
  ON paypal_rate_limits(window_start);

ALTER TABLE paypal_webhook_events ADD COLUMN processing_started_at TEXT;
ALTER TABLE paypal_webhook_events ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;

INSERT OR REPLACE INTO settings (key, value)
VALUES ('prices', '{"small":1,"medium":2,"large":3}');

INSERT OR REPLACE INTO photos (
  id, title, category, description, filename, r2_key, url, thumbnail,
  created_at, published, price_overrides
) VALUES (
  'paypal-sandbox-test-photo',
  'PayPal Sandbox Test Photo',
  'Sandbox',
  'Non-production fixture used only for PayPal Sandbox E2E testing.',
  'paypal-sandbox-test.jpg',
  'paypal-sandbox-test.jpg',
  '/photos/paypal-sandbox-test.jpg',
  '/photos/paypal-sandbox-test.jpg',
  datetime('now'),
  1,
  NULL
);
