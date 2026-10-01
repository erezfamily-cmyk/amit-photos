-- PayPal Orders API v2 foundation
-- Safe to apply while PAYMENTS_ENABLED=false. This migration does not enable checkout.

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
