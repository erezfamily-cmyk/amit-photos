# Plan: PayPal D1 migration 0002 on production — 13.10.2026

**Status: PLAN ONLY. Nothing in this document has been run against production.** Production payments stay disabled (`PAYMENTS_ENABLED=false`). Running this plan needs explicit owner approval at execution time.

## 1. Why this exists

The production D1 `amit-photos-db` (`802379c7-97cf-4262-93b8-da81c5c3c07d`) has the migration `0001` shape of the PayPal tables but not `0002`. The merged Orders v2 code (`paypal-orders.js`, identical to what the Sandbox E2E ran) needs the `0002` objects. The gate item "D1 migration verified against the intended production DB" in `docs/paypal-reactivation-gate-2026-10-01.md` is therefore **not met**.

Production state read (schema only, 13.10.2026): `paypal_orders` 0 rows, `paypal_webhook_events` 0 rows, `download_tokens` 8 rows (legacy), no `d1_migrations` table (migrations were applied by hand, not with `wrangler d1 migrations apply`), database ≈ 3.4 MB.

## 2. The exact changes (`migrations/0002_paypal_security_hardening.sql`)

| # | Statement | Effect |
|---|---|---|
| 1 | `ALTER TABLE paypal_orders ADD COLUMN client_idempotency_key TEXT` | nullable, no default; existing rows get NULL |
| 2 | `CREATE UNIQUE INDEX IF NOT EXISTS idx_paypal_orders_client_idempotency ON paypal_orders(client_idempotency_key) WHERE client_idempotency_key IS NOT NULL` | partial unique index; many NULLs allowed |
| 3 | `CREATE TABLE IF NOT EXISTS paypal_rate_limits (rate_key, action, window_start, count, PK(rate_key, action, window_start))` | new table |
| 4 | `CREATE INDEX IF NOT EXISTS idx_paypal_rate_limits_window ON paypal_rate_limits(window_start)` | new index |
| 5 | `ALTER TABLE paypal_webhook_events ADD COLUMN processing_started_at TEXT` | nullable |
| 6 | `ALTER TABLE paypal_webhook_events ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0` | existing rows get 0 |

Properties: purely additive; no data is rewritten or deleted; `download_tokens`, `photos` and every other table are untouched; the currently deployed code does not reference the new objects, so applying it early cannot change production behaviour; statements 1, 5 and 6 are **not re-runnable** (`duplicate column name`), so it must be applied exactly once or completed per section 6.

Known drift, not part of 0002 and not required for it: production `download_tokens.tx` is nullable with a UNIQUE partial index (`idx_download_tokens_tx ... WHERE tx IS NOT NULL`) and `amount` is nullable, while the Sandbox bootstrap has `tx NOT NULL`, `amount NOT NULL DEFAULT 0` and a non-unique index. Production is the stricter/safer shape on the index; mirror it in the Sandbox bootstrap as a separate follow-up.

## 3. Rehearsal and evidence: what was done, and what is NOT yet verified

**Important limit: the only rehearsal performed so far ran in a LOCAL, in-memory SQLite (Node's `node:sqlite`). It was never run against any Cloudflare D1 database, and it does not prove how D1 behaves.** It validates the SQL and the data-safety logic under SQLite semantics only.

- **Local SQLite rehearsal, in CI (done):** `tests/paypal-migration-0002-rehearsal.test.mjs` builds an in-memory SQLite from the production DDL pinned in the test (read from `sqlite_master`), applies the real migration file and checks: exact objects added; existing rows preserved with NULL/0 defaults; unique-index behaviour; resulting PayPal tables identical to the Sandbox bootstrap (the schema the E2E ran on); a second run fails and an explicit SQLite transaction rolls back cleanly; the rollback file restores the pre-0002 shape with data intact. 7/7 pass; a deliberately broken migration makes it fail. The "transaction rolls back cleanly" check describes SQLite, **not** `wrangler d1 execute --file`.
- **Sandbox D1** (`7b027b93-…`) already has the 0002 shape and ran the full Sandbox E2E on it (create, approve, capture, download, retries, webhooks, cleanup). That shows the resulting schema works with the code; it is not a rehearsal of applying 0002 to a pre-0002 D1.
- **NOT verified on D1 (needs remote verification before relying on it):**
  1. whether `npx wrangler d1 execute --remote --file` applies a multi-statement file **atomically** (this plan therefore assumes it may NOT be, see section 6);
  2. what state a mid-file failure leaves behind on D1;
  3. that `ALTER TABLE ... DROP COLUMN` (used by the rollback file) is accepted by D1 for these columns;
  4. Time Travel restore behaviour for this database (timing, effect on other data, whether the restore returns a bookmark that can undo it).
- **Remote verification (not authorized yet; needs approval; creates a new throwaway D1, never production):** build a new D1 from the pinned pre-0002 DDL (use `sqlite_master`, **never** the production `/export` endpoint: an export makes the D1 unavailable to queries while it runs), apply with the exact command in section 5, deliberately test a failing statement to observe atomicity, run the rollback file and the section 7 checks, test a Time Travel restore on that throwaway database, then delete it.

## 4. Backup and recovery preparation (read-only steps before execution)

1. Freeze: no production deploys during the window; confirm `PAYMENTS_ENABLED=false` and `GET /api/payments-status` → `{"enabled":false}`.
2. **Time Travel bookmark:** record the current production bookmark and timestamp (`GET /accounts/<id>/d1/database/<db>/time_travel/bookmark`, or `npx wrangler d1 time-travel info amit-photos-db`; confirm syntax with `--help`). Retrieval was verified read-only on 13.10 for production and Sandbox.
3. **Schema snapshot:** save `SELECT name, type, sql FROM sqlite_master ORDER BY name` for the whole database to the handoff.
4. **Protected backup, only if needed at execution time:** the three PayPal tables are expected to be empty (confirm counts first). Migration 0002 does not touch `download_tokens`, so a backup of it is optional. If one is taken, store it in a protected location (encrypted or access-controlled, per the owner's backup practice); **never print its contents in a terminal log, a PR, a handoff or a chat**, because tokens are bearer download links. Do not use `/export` on production.
5. Record row counts: `paypal_orders`, `paypal_webhook_events`, `download_tokens`, `photos`.
6. Pick a low-traffic window and keep the rollback SQL, this plan and the bookmark open.

## 5. Execution (when approved)

Run from the repository root against the production binding, after confirming the database name/id in the command output:

```
npx wrangler d1 execute amit-photos-db --remote --file migrations/0002_paypal_security_hardening.sql
```

Use `execute --file` (production has no `d1_migrations` table, so `migrations apply` would also try to track `0001` and create the table; adopting that is a separate decision). Apply once. Do not re-run on error: go to section 6.

## 6. Recovery, in order of preference

0. **Assumption:** until the remote verification in section 3 has been done, treat the run as NOT atomic and any recovery step below as untested on D1.
1. **Partial or unclear result:** read `PRAGMA table_info` for the three tables and `sqlite_master` for the two indexes, then run only the missing statements from section 2 (SQLite has no `ADD COLUMN IF NOT EXISTS`, so do not re-run a statement whose object exists).
2. **Forward fix:** the change is additive and harmless to the deployed code, so leaving it applied is safe; fix problems forward.
3. **Rollback SQL** (`staging/rollback-0002-paypal-security-hardening.sql`, outside `migrations/`, rehearsed on local SQLite only, not yet on D1): drops the two indexes, `paypal_rate_limits` and the three columns. Only safe while no PayPal order/webhook data exists after 0002 (it deletes idempotency keys, the lease/attempt columns and the rate-limit table). Needs owner approval.
4. **Time Travel restore** to the saved bookmark/timestamp (`POST .../time_travel/restore`): last resort. It restores the **whole** production database (photos, subscribers, sessions and everything else), losing every write after the bookmark. Needs explicit owner approval and a written decision; confirm during the rehearsal whether the restore returns a bookmark that can undo it.

## 7. Verification after the migration (read-only)

- `PRAGMA table_info` on `paypal_orders` shows `client_idempotency_key TEXT` (nullable); on `paypal_webhook_events` shows `processing_started_at TEXT` and `attempts INTEGER NOT NULL DEFAULT 0`; `paypal_rate_limits` has 4 columns and PK `(rate_key, action, window_start)`.
- `sqlite_master` has `idx_paypal_orders_client_idempotency` (partial UNIQUE) and `idx_paypal_rate_limits_window`; the earlier indexes still exist.
- Row counts equal the section 4 values (PayPal tables 0, `download_tokens` 8, `photos` unchanged).
- The pre-0002 vs post-0002 `sqlite_master` diff contains exactly the six objects/columns in section 2.
- Site checks: `/api/payments-status` → `{"enabled":false}`; `/api/photos` 200; production PayPal routes still fail closed (webhook POST 400 `PAYPAL_WEBHOOK_ID_MISSING`, public create/capture 503, admin 401); no new exceptions in Worker analytics for 30 minutes.
- Record bookmark, before/after schema, counts and results in `handoff.md`.

## 8. What else blocks Live, separated

### Technical blockers (engineering/ops; can be done without a business decision, but only worth finishing once the go decision exists)

1. **This migration** applied to production (sections 4–7), preceded by the remote D1 verification of atomicity, mid-file failure state, `DROP COLUMN` support and Time Travel restore on a throwaway database (section 3), which is still outstanding.
2. **Digital-only flag** `DIGITAL_PAYPAL_ENABLED` (0 occurrences today) so Orders v2 digital endpoints/UI no longer depend on the global `PAYMENTS_ENABLED`, which also opens legacy print/Gelato paths; legacy print handlers stay hard-disabled; tests.
3. **Public digital checkout UI** (none exists): approve/cancel/return flows, errors, accessibility, i18n.
4. **PayPal Live plumbing:** the API base is hard-coded to the Sandbox; needs an explicit environment switch, Live app credentials, a Live webhook and `PAYPAL_WEBHOOK_ID` in production (it has none today); review the legacy production secrets (`PAYPAL_CLIENT_ID/SECRET/PDT_TOKEN/RECEIVER_ID`, Live or Sandbox values unknown).
5. **Webhook check closed:** identify the missing approval event from PayPal's log; run live dedup via PayPal Resend (duplicate → no change).
6. **Remaining tests:** buyer-side decline; public `/api/paypal/*` route test on a Sandbox-only Worker with the flag deliberately on; a fresh E2E on the Worker that will run the final code (the main Sandbox Worker still runs 1.10).
7. **Kill-switch** for the digital flag tested (the Sandbox `PAYMENTS_ENABLED` flip is verified, the digital flag does not exist yet).
8. **Residual risk accepted or fixed:** a transfer that fails mid-stream after the atomic claim still spends the one-time token; monitoring/alerting and a support process for failed captures.

### Business decisions (owner)

1. **Demand gate:** whether to extend or re-run the acquisition experiment; the 12.10 review is no-go (≥20 qualified licensing sessions and ≥3 digital intents or ≥10% are not met).
2. **Whether to sell digital licenses through PayPal at all** versus the other monetization paths being tested.
3. **Commercial terms:** prices and currencies (ILS/USD rule), licence terms, refund/chargeback policy, legal pages, VAT/invoicing, PayPal business account verification and fees.
4. **Canary design:** scope, duration, success and stop criteria, who monitors and how fast.
5. **Timing and approval of the production write:** when the migration is run (it is safe early, but there is no reason to touch production before the go decision) and who signs off.
6. Gelato and print remain out of scope.

## 9. Not done / not authorized

No production write, no migration run, no flag change, no export of production, no change to `prep/...`, no public checkout, no real purchase.
