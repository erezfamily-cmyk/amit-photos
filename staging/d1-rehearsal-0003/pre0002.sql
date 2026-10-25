CREATE TABLE download_tokens ( token TEXT PRIMARY KEY, photo_ids TEXT NOT NULL, size TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL , tx TEXT, amount REAL DEFAULT 0);
CREATE UNIQUE INDEX idx_download_tokens_tx ON download_tokens(tx) WHERE tx IS NOT NULL;
CREATE TABLE paypal_orders ( id TEXT PRIMARY KEY, paypal_order_id TEXT UNIQUE NOT NULL, order_type TEXT NOT NULL, photo_id TEXT NOT NULL, sku TEXT, amount_expected INTEGER NOT NULL, currency TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'CREATED', print_address_json TEXT, fulfillment_json TEXT, fulfillment_token TEXT UNIQUE, paypal_capture_id TEXT, created_at TEXT NOT NULL, completed_at TEXT );
CREATE INDEX idx_paypal_orders_status ON paypal_orders(status);
CREATE TABLE paypal_webhook_events ( event_id TEXT PRIMARY KEY, event_type TEXT NOT NULL, received_at TEXT NOT NULL, processed INTEGER NOT NULL DEFAULT 0 );
CREATE TABLE photos (id TEXT PRIMARY KEY, title TEXT, r2_key TEXT);
