-- ROLLBACK for migrations/0002_paypal_security_hardening.sql
-- DO NOT RUN without explicit owner approval. This file is NOT a migration:
-- it lives outside migrations/ so `wrangler d1 migrations apply` never picks it up.
--
-- It is only safe while no PayPal order or webhook data has been written after
-- 0002 (it deletes the idempotency keys, the rate-limit table and the webhook
-- lease/attempt columns). Once real payments have been processed, prefer a
-- forward fix. See docs/paypal-d1-migration-0002-plan-2026-10-13.md.
--
-- Order matters: an indexed column cannot be dropped, so the index goes first.

DROP INDEX IF EXISTS idx_paypal_orders_client_idempotency;
DROP INDEX IF EXISTS idx_paypal_rate_limits_window;
DROP TABLE IF EXISTS paypal_rate_limits;

ALTER TABLE paypal_orders DROP COLUMN client_idempotency_key;
ALTER TABLE paypal_webhook_events DROP COLUMN processing_started_at;
ALTER TABLE paypal_webhook_events DROP COLUMN attempts;
