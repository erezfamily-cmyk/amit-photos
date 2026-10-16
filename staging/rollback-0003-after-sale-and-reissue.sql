-- Rollback for migrations/0003_after_sale_and_reissue.sql.
-- Lives outside migrations/ on purpose so `migrations apply` never runs it.
-- DESTRUCTIVE: values written after 0003 (after-sale state, audit rows, revoke
-- marks) are lost. Tokens revoked with used = 2 stay unusable (used is kept).
-- Prefer a Time Travel restore if only the schema must go back; see the 0003 plan.

DROP INDEX IF EXISTS idx_paypal_order_actions_order;
DROP TABLE IF EXISTS paypal_order_actions;
DROP INDEX IF EXISTS idx_download_tokens_order_ref;
ALTER TABLE download_tokens DROP COLUMN revoke_reason;
ALTER TABLE download_tokens DROP COLUMN revoked_at;
ALTER TABLE download_tokens DROP COLUMN paypal_order_ref;
ALTER TABLE paypal_orders DROP COLUMN after_sale_updated_at;
ALTER TABLE paypal_orders DROP COLUMN refunded_minor;
ALTER TABLE paypal_orders DROP COLUMN dispute_updated_at;
ALTER TABLE paypal_orders DROP COLUMN dispute_open;
ALTER TABLE paypal_orders DROP COLUMN after_sale_state;
