-- PayPal after-sale handling and download re-issue (migration 0003)
-- Additive only. Apply AFTER 0001 and 0002. Does not enable payments.
-- Rollback: staging/rollback-0003-after-sale-and-reissue.sql (destroys values written after 0003).

-- after_sale_state: NONE | REVIEW_REQUIRED | REFUNDED | REVERSED | REVOKED_MANUAL.
-- Existing rows default to NONE, so already-completed orders keep working unchanged.
ALTER TABLE paypal_orders ADD COLUMN after_sale_state TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE paypal_orders ADD COLUMN dispute_open INTEGER NOT NULL DEFAULT 0;
ALTER TABLE paypal_orders ADD COLUMN dispute_updated_at TEXT;
ALTER TABLE paypal_orders ADD COLUMN refunded_minor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE paypal_orders ADD COLUMN after_sale_updated_at TEXT;

-- Re-issued links carry their order and can be revoked with an audit trail.
-- Revoking sets used = 2 (the download claim only accepts used = 0), so it works
-- even for code that does not know the new columns.
ALTER TABLE download_tokens ADD COLUMN paypal_order_ref TEXT;
ALTER TABLE download_tokens ADD COLUMN revoked_at INTEGER;
ALTER TABLE download_tokens ADD COLUMN revoke_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_download_tokens_order_ref
  ON download_tokens(paypal_order_ref)
  WHERE paypal_order_ref IS NOT NULL;

-- Audit trail and dedup for admin actions and after-sale webhook events.
-- (order_ref, action, request_id) is unique: a repeated request id or event id
-- can never act twice. new_token is the same bearer value that already lives in
-- download_tokens; it is never returned by the audit read route or logged.
CREATE TABLE IF NOT EXISTS paypal_order_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_ref TEXT NOT NULL,
  paypal_order_id TEXT NOT NULL,
  action TEXT NOT NULL,
  request_id TEXT NOT NULL,
  status TEXT NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT,
  new_token TEXT,
  amount_minor INTEGER,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (order_ref, action, request_id)
);

CREATE INDEX IF NOT EXISTS idx_paypal_order_actions_order
  ON paypal_order_actions(order_ref, action, status);
