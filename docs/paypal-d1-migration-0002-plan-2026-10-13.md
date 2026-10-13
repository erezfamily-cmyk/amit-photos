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

## 3. Rehearsal and evidence: what was done and what it proves

**Status (updated 13.10.2026, late):** the migration was rehearsed twice: locally on SQLite (CI test) and, since the owner authorized a throwaway database, on a **real, isolated Cloudflare D1** with the exact release command. Results are in the subsection "Remote rehearsal on a throwaway D1" below. The earlier statement that nothing had been verified on D1 is superseded. Production was never touched.

- **Local SQLite rehearsal, in CI (done):** `tests/paypal-migration-0002-rehearsal.test.mjs` builds an in-memory SQLite from the production DDL pinned in the test (read from `sqlite_master`), applies the real migration file and checks: exact objects added; existing rows preserved with NULL/0 defaults; unique-index behaviour; resulting PayPal tables identical to the Sandbox bootstrap (the schema the E2E ran on); a second run fails and an explicit SQLite transaction rolls back cleanly; the rollback file restores the pre-0002 shape with data intact. 7/7 pass; a deliberately broken migration makes it fail. The "transaction rolls back cleanly" check describes SQLite, **not** `wrangler d1 execute --file`.
- **Sandbox D1** (`7b027b93-…`) already has the 0002 shape and ran the full Sandbox E2E on it (create, approve, capture, download, retries, webhooks, cleanup). That shows the resulting schema works with the code; it is not a rehearsal of applying 0002 to a pre-0002 D1.
### Remote rehearsal on a throwaway D1 (13.10.2026, 17:57–18:02Z; owner-approved; production untouched)

Setup: a new D1 `amit-migration-0002-rehearsal-20261013` (`b19d29c1-766d-4d83-bf88-c7712ca57c16`, different from production `802379c7-…` and Sandbox `7b027b93-…`, checked in code before every call) built from the pinned production pre-0002 DDL (taken from `sqlite_master`, never from `/export`) with synthetic rows only (3 orders in COMPLETED / CREATED / FULFILLING, 3 webhook events, 2 download tokens). Commands: the exact release form `npx wrangler@4.149.0 d1 execute <db> --remote --yes --file <file>` with a temporary config that listed only the throwaway database. Verified by reading schema, counts and a checksum of all rows. The database was deleted afterwards and no longer exists (the account lists only the Sandbox and production databases).

| Step | Result |
|---|---|
| Failure in the middle of the file (a deliberately invalid statement placed after statements 1–4) | The command failed with `no such table …` and printed that the DB returns to its original state. **Verified: statements 1–4 (the new column, both indexes and the new table) were NOT left behind; schema, counts and the checksum were identical to the start.** On D1 this file behaved atomically in this run |
| Clean run of the real `0002` | succeeded in about 5 s end to end (SQL time about 4 ms, 8 rows written); the six new objects exist; counts and checksum unchanged; existing orders got a NULL idempotency key, events got `attempts=0` and no lease |
| Re-run of the same file on the migrated DB | fails with `duplicate column name: client_idempotency_key`; the DB is unchanged |
| Rollback file (`staging/rollback-0002-…sql`) on the migrated DB | accepted by D1 including `DROP COLUMN`; schema returned exactly to the pre-0002 shape; data checksum identical |
| Rollback after live-style writes into the new columns | succeeds but **destroys** the post-migration values: the idempotency keys and the `attempts`/lease values are gone and reading `client_idempotency_key` fails with `no such column`; the orders themselves remain |
| Time Travel restore to a bookmark taken after those writes | `POST …/time_travel/restore?bookmark=…` returned in about 1.9 s; the post-0002 schema **and** the keys/attempts came back. A row written after that bookmark (a marker order) was **discarded**: a restore replaces the WHOLE database and loses every later write |
| Undo of the restore | the response contained `previous_bookmark`; restoring to it (about 1.7 s) brought back the pre-restore state, including the marker row. So a restore is reversible while that bookmark is kept |

Limits of these results: one run, a small synthetic data set and a SQL-error failure; they do not show behaviour for network loss or timeout during the upload, a very large database, concurrent production traffic, or the Time Travel retention period. A wrangler warning states the target D1 is unavailable to queries while the file runs, which is negligible for 8 statements here but is a production consideration. After real payments exist, restoring an older bookmark loses newer orders and tokens and needs a reconciliation with PayPal first.

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

0. **Rehearsed on a real D1 (13.10.2026, section 3):** the file applied atomically in the one failure tested (a mid-file SQL error left nothing behind), and the rollback file, a Time Travel restore and its undo all worked on a throwaway D1. Keep the section 7 checks after every run anyway: failure modes that were not tested (network loss or timeout during the upload, large data, concurrent traffic) mean a partial state cannot be ruled out in production.
1. **Partial or unclear result:** read `PRAGMA table_info` for the three tables and `sqlite_master` for the two indexes, then run only the missing statements from section 2 (SQLite has no `ADD COLUMN IF NOT EXISTS`, so do not re-run a statement whose object exists).
2. **Forward fix:** the change is additive and harmless to the deployed code, so leaving it applied is safe; fix problems forward.
3. **Rollback SQL** (`staging/rollback-0002-paypal-security-hardening.sql`, outside `migrations/`, rehearsed on local SQLite and on a throwaway D1: it works there, including `DROP COLUMN`): drops the two indexes, `paypal_rate_limits` and the three columns. Only safe while no PayPal order/webhook data exists after 0002 (it deletes idempotency keys, the lease/attempt columns and the rate-limit table). Needs owner approval. Rehearsed result: it destroys idempotency keys, lease and attempt values written after the migration (reading the dropped column fails with `no such column`); the orders themselves stay.
4. **Time Travel restore** to the saved bookmark/timestamp (`POST .../time_travel/restore`): last resort. It restores the **whole** production database (photos, subscribers, sessions and everything else), losing every write after the bookmark. Needs explicit owner approval and a written decision; rehearsed on a throwaway D1: it restores schema and data in about 2 s, discards every later write, and returns a `previous_bookmark` that can undo the restore (verified); keep that bookmark.

## 7. Verification after the migration (read-only)

- `PRAGMA table_info` on `paypal_orders` shows `client_idempotency_key TEXT` (nullable); on `paypal_webhook_events` shows `processing_started_at TEXT` and `attempts INTEGER NOT NULL DEFAULT 0`; `paypal_rate_limits` has 4 columns and PK `(rate_key, action, window_start)`.
- `sqlite_master` has `idx_paypal_orders_client_idempotency` (partial UNIQUE) and `idx_paypal_rate_limits_window`; the earlier indexes still exist.
- Row counts equal the section 4 values (PayPal tables 0, `download_tokens` 8, `photos` unchanged).
- The pre-0002 vs post-0002 `sqlite_master` diff contains exactly the six objects/columns in section 2.
- Site checks: `/api/payments-status` → `{"enabled":false}`; `/api/photos` 200; production PayPal routes still fail closed (webhook POST 400 `PAYPAL_WEBHOOK_ID_MISSING`, public create/capture 503, admin 401); no new exceptions in Worker analytics for 30 minutes.
- Record bookmark, before/after schema, counts and results in `handoff.md`.

## 8. What else blocks Live, separated

### Technical blockers (engineering/ops; can be done without a business decision, but only worth finishing once the go decision exists)

1. **This migration** applied to production (sections 4–7). The remote D1 rehearsal is done (section 3); the production run itself still needs the owner's approval, a quiet window and the section 4 preparation.
2. **Digital-only flag** `DIGITAL_PAYPAL_ENABLED`: implemented and tested in PR #155 (draft, not merged): public Orders v2 create/capture require BOTH `PAYMENTS_ENABLED` and `DIGITAL_PAYPAL_ENABLED` to be exactly `"true"`; legacy print handlers stay hard-disabled. Still needs the merge decision and a production release.
3. **Public digital checkout UI**: implemented in PR #155 (not merged): bilingual `/checkout/` page with quote, consent, approval, cancel, decline and return flows, mobile checks, language kept across the PayPal round trip. Commercial terms and final copy are still open.
4. **PayPal Live plumbing:** the API base is hard-coded to the Sandbox; needs an explicit environment switch, Live app credentials, a Live webhook and `PAYPAL_WEBHOOK_ID` in production (it has none today); review the legacy production secrets (`PAYPAL_CLIENT_ID/SECRET/PDT_TOKEN/RECEIVER_ID`, Live or Sandbox values unknown).
5. **Webhook check:** live verification, processing and dedup (PayPal Resend answered duplicate, no new rows) were done on the Preview on 13.10. The historical missing `CHECKOUT.ORDER.APPROVED` event of 12.10 (order `8S923706NG623915A`) stays open and needs PayPal's event log.
6. **Remaining tests:** buyer-side decline (provider-side, not run; code path covered only by source and mocked-browser tests). Done on the Preview with both flags on: public create/capture, one-time download, cancel, retries, lost response, price and consent guards, English and Hebrew, phone. The main Sandbox Worker still runs the 1.10 code.
7. **Kill-switch:** verified on the Preview for all three closed flag combinations on 13.10 (`true,false`, `false,true`, `false,false`: create, capture and quote closed). A production kill-switch procedure is still to be written into the release runbook.
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
