-- PayPal Orders API v2 hardening
-- Not required until the new Orders v2 backend is deployed.
-- Does not enable payments.

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


-- Webhook processing lease: processed 0=pending, 1=done, 2=processing.
ALTER TABLE paypal_webhook_events ADD COLUMN processing_started_at TEXT;
ALTER TABLE paypal_webhook_events ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
