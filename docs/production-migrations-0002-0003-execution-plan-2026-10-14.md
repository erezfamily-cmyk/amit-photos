# Execution plan: production migrations 0002 and 0003 (prepared 14.10.2026)

**Status: PLAN ONLY.** Nothing here was run. No resource was created (no database, no bookmark, no export), no migration was executed, no production read was made for this document. Payment flags stay `false`. Every step marked **[APPROVAL]** needs the owner's explicit go at execution time, and the whole plan is void if the facts in section 1 changed (re-read them first).

Supporting evidence already in the repository: `docs/paypal-d1-migration-0002-plan-2026-10-13.md` (+ section 3, remote rehearsal), `docs/paypal-d1-migration-0003-plan-2026-10-13.md` (+ section 6, 33/33 behaviour checks on a real throwaway D1), `staging/d1-rehearsal-0003/` (harness), `tests/paypal-migration-000{2,3}-rehearsal.test.mjs`. Migration 0003 was also applied once to the **Sandbox** D1 (not production).

## 1. Facts this plan depends on (re-verify read-only on the day)
- Production D1: name `amit-photos-db`, id `802379c7-97cf-4262-93b8-da81c5c3c07d`. Sandbox D1 (`amit-photos-paypal-sandbox-db`, `7b027b93-c548-4ceb-bbe9-42c45264fc23`) must never be the target. As read on 13.10: `paypal_orders` 0 rows, `paypal_webhook_events` 0 rows, `download_tokens` 8 legacy rows, no `d1_migrations` table (migrations were applied by hand with `execute --file`), about 3.4 MB. **These numbers are 1 day old: re-read them.**
- The migration files and their rollback files are bound by checksum. Execute only files whose SHA-256 equals:

| File | SHA-256 |
|---|---|
| `migrations/0002_paypal_security_hardening.sql` | `f0d99d379be565cc659bec0b8dc75406b81343df69a7f5007a5afa8436c32054` |
| `migrations/0003_after_sale_and_reissue.sql` | `a3e317e528711fb2cedeb73c95feeeaf65ce5e042b17ecb576525f9c816e3a68` |
| `staging/rollback-0002-paypal-security-hardening.sql` | `7d7f5ce0d286b9724cede69bdf058e015eb9fb480db29944198421b822c67253` |
| `staging/rollback-0003-after-sale-and-reissue.sql` | `f3779e3bf71424f6a832b7ae32a5785e28b184314f4d9fd3324f1befe3c691d2` |

  (computed on the #155 branch, 14.10.2026; if a file is edited later the table and the rehearsal must be redone.)
- Both migrations are additive. 0002: 3 ALTER ADD COLUMN, 1 partial unique index, 1 table, 1 index. 0003: 8 ALTER ADD COLUMN (5 on `paypal_orders`, 3 on `download_tokens`), 1 partial index, 1 table + 1 index. ALTER ADD COLUMN statements are **not re-runnable** (`duplicate column name`) and that error is the safety net against a blind second run.
- The code currently in production does not reference the new objects, so applying the migrations first cannot change its behaviour. The #155 code does reference them (see section 8: what happens if the order is reversed).
- Wrangler is pinned: `npx wrangler@4.149.0`. A wrangler warning says the target database is unavailable to queries while a file executes (seconds at most for these files).

## 2. Order and why
1. Preparation and go/no-go (section 3), backup (4), dress rehearsal on an isolated temporary database (5).
2. Migration 0002, then verification V2 (6). **Stop and evaluate before continuing.**
3. Migration 0003, then verification V3 (7).
4. Observation period, record in HANDOFF (9).
5. Only afterwards, as a separate approval: merge of #155 (deploys the code; flags stay `false`). Not part of this plan.

0003 requires 0002 (same tables); the code requires both; neither is needed by the code currently deployed. There is no benefit in running 0003 first or skipping the pause between them.

## 3. Pre-checks (read-only; any "no" stops the plan)
| # | Check | How |
|---|---|---|
| P1 | Owner's explicit go for this window, for 0002 and separately for 0003 **[APPROVAL]** | message |
| P2 | #155 head is the tested one: CI green on the head code commit; migration/rollback checksums equal the table above | `gh pr checks 155`; `sha256sum` |
| P3 | Target identity: `npx wrangler@4.149.0 d1 info amit-photos-db` prints id `802379c7-…` and the name; the id is also compared in a script against the Sandbox id before every command | read-only |
| P4 | Schema equals the pinned pre-0002 production shape: dump `SELECT name, type, sql FROM sqlite_master ORDER BY name` and compare with the DDL pinned in `tests/paypal-migration-0002-rehearsal.test.mjs`. **Any drift stops the plan** (re-plan, re-rehearse) | `d1 execute --command` (SELECT) |
| P5 | Row counts and a data checksum of the three PayPal tables, `download_tokens`, `photos` (expect PayPal tables 0). **Non-zero PayPal rows means real orders exist: stop, different plan** | SELECT |
| P6 | Payments closed: `GET /api/payments-status` is `{"enabled":false,...}`; `PAYMENTS_ENABLED="false"` in the active deployment | curl, read-only |
| P7 | Window: avoid Worker cron minutes (`0 */2 * * *` = even hours :00), `scan-dimensions` 03:00 UTC, `update-photos` 06:00 UTC (it also has a push trigger), `health-check` 07:00 UTC; bots push data commits to `main` at random times (harmless: deployments do not touch the schema). Suggested: odd hour, minutes :20-:50, low traffic | calendar |
| P8 | Tools: wrangler 4.149.0 available, local auth token present, a terminal that keeps all output local (nothing printed to chat that contains row data) | local |
| P9 | The rollback files and this plan are open; the Time Travel bookmark of section 4 is recorded **before** the first write | see 4 |

## 4. Backup **[APPROVAL for any step that creates data]**
1. **Time Travel bookmark and timestamp** (primary, free, whole-database): `npx wrangler@4.149.0 d1 time-travel info amit-photos-db` (confirm syntax with `--help`); record bookmark + UTC time in the operator's notes and later in HANDOFF. Retrieval was verified read-only on 13.10. Retention period: record what the command reports.
2. **Schema snapshot** (P4 output) saved locally.
3. **Counts + checksum** (P5 output) saved locally.
4. **Full data export: owner decision.** `amit-photos-db` holds more than PayPal tables (subscribers' e-mails, sessions, analytics, `download_tokens` = bearer links). An export is personal data and bearer values: if the owner wants one in addition to Time Travel, it must be taken with the owner's existing backup practice (encrypted at rest, access-controlled), never printed to a terminal log, PR, HANDOFF or chat. The earlier plan said "do not use `/export` on production" for the convenience of the log; with Time Travel available, the export is optional. I did not find a backup job for `amit-photos-db` in this repository (`.github/workflows` has none); the owner knows whether another procedure exists. **Decision needed.**
5. Because the PayPal tables are expected to be empty and 0002/0003 are additive, losing the optional export costs little; the bookmark is the real safety net.

## 5. Dress rehearsal on an isolated temporary database **[APPROVAL: creates and deletes one cloud resource]**
Purpose: prove, on the day, that the exact checksum-bound files apply to a database shaped like production, and that the recovery tools work, without touching production.
1. Create `amit-migration-rehearsal-<date>` (new name, never reuse). Compare its id in code against production and Sandbox ids before every call (harness `staging/d1-rehearsal-0003/d1lib.mjs` already refuses both ids).
2. Build the pre-0002 shape **from the P4 production schema dump** (schema text only, no production data), then load **synthetic** rows with the same counts as production (tokens 8, PayPal tables 0) plus a few synthetic orders in `COMPLETED` / `CREATED` / `FULFILLING`. *Optional upgrade, owner decision:* restoring a real export of production into the temporary DB gives the highest fidelity but puts personal data and bearer tokens in a second place; not recommended unless P4 shows drift that synthetic data cannot represent.
3. Run the exact commands of sections 6 and 7 on it (`d1 execute --remote --file`, same wrangler version), verify with V2/V3, record duration.
4. Failure drill (as in the 13.10 rehearsal): a copy of the file with a runtime error in the middle must leave nothing behind; a second run of the real file must fail with `duplicate column name` and change nothing.
5. Recovery drill: run the rollback files on the migrated copy (expect success with `DROP COLUMN`), then a Time Travel restore to a bookmark taken before, then undo it with the returned `previous_bookmark`.
6. Behaviour smoke with the harness `behaviour.mjs` (real handlers against the temporary D1, PayPal stubbed with fake ids). Needs the #155 code checked out at the tested commit.
7. Delete the temporary database; confirm `d1 list` shows only production and Sandbox. Write the results into the 0002/0003 plan documents.
Pass criteria: identical to the 13.10 results (atomic mid-file failure, clean run, re-run refused, rollback and restore work). If anything differs, **stop**: the production run is not done until the difference is understood.
Why repeat it if it was done on 13.10: the evidence is bound to older files, older production facts and one run; the dress rehearsal costs minutes and ties the evidence to today's checksums and schema. It may be skipped only if P2 and P4 show the files and the schema are unchanged **and** the owner accepts the 13.10 evidence in writing.

## 6. Migration 0002 on production **[APPROVAL]**
```
npx wrangler@4.149.0 d1 execute amit-photos-db --remote --file migrations/0002_paypal_security_hardening.sql
```
(no `--yes`: read the printed database name/id at the confirmation prompt, answer `y` only if it is `amit-photos-db` / `802379c7-…`). Run once. On any error or interruption **do not re-run**: go to section 10.

**V2 (read-only, all must hold):**
- `PRAGMA table_info(paypal_orders)` has `client_idempotency_key TEXT` (nullable); `PRAGMA table_info(paypal_webhook_events)` has `processing_started_at TEXT` and `attempts INTEGER NOT NULL DEFAULT 0`; `paypal_rate_limits` has 4 columns, primary key `(rate_key, action, window_start)`.
- `sqlite_master` has `idx_paypal_orders_client_idempotency` (partial UNIQUE) and `idx_paypal_rate_limits_window`; pre-existing indexes (including `idx_download_tokens_tx`) still exist.
- Counts and checksum equal the P5 values; the schema diff against P4 is exactly the six objects.
- Site: `/api/payments-status` still `{"enabled":false,...}`, `/api/photos` 200, home page 200, no new Worker exceptions for 15 minutes.
- **Gate to continue:** all V2 hold and the owner says go for 0003.

## 7. Migration 0003 on production **[APPROVAL, separate from 0002]**
```
npx wrangler@4.149.0 d1 execute amit-photos-db --remote --file migrations/0003_after_sale_and_reissue.sql
```
Same prompt rule, same "run once" rule. Before running: re-take a Time Travel bookmark (the one from section 4 is before 0002).

**V3 (read-only):**
- `paypal_orders` has `after_sale_state TEXT NOT NULL DEFAULT 'NONE'`, `dispute_open INTEGER NOT NULL DEFAULT 0`, `dispute_updated_at`, `refunded_minor INTEGER NOT NULL DEFAULT 0`, `after_sale_updated_at`; `download_tokens` has `paypal_order_ref`, `revoked_at`, `revoke_reason`.
- `idx_download_tokens_order_ref` (partial) and `idx_paypal_order_actions_order` exist; table `paypal_order_actions` has the 12 columns and `UNIQUE (order_ref, action, request_id)`; `idx_download_tokens_tx` is still `UNIQUE ... WHERE tx IS NOT NULL`.
- Existing `download_tokens` rows are unchanged (8 rows, same checksum of the pre-existing columns; the three new columns NULL).
- Counts equal P5; schema diff against the post-0002 snapshot is exactly the 0003 objects.
- Site checks as in V2.
- Compare to the Sandbox D1 schema (which ran the whole E2E on the 0003 shape): same PayPal tables/columns.

## 8. If the order is ever reversed (code before migrations)
Deploying #155 before 0002/0003 does not break the public site (flags `false`), but: health reports `SCHEMA_BEHIND` (one alert mail a day once #157 is live), `POST /api/admin/paypal/switch` would write the setting and then fail on its audit insert (0003 table missing), admin actions/recovery fail with server errors, and the after-sale/dispute block is inactive. Therefore migrations come first and the post-deploy check "health `schemaProblems` is empty" is mandatory.

## 9. After both migrations
- Observe 30 minutes (Worker errors, `/api/photos`, home page). Record in HANDOFF: bookmarks, before/after schema, counts, durations, who approved.
- Production remains with payments off and unchanged code. The merge of #155 is a separate **[APPROVAL]**; its post-deploy read-only checks: `payments-status` closed, create/capture 503, webhook fails closed, `GET /api/ping` 200, admin `health` healthy with empty `schemaProblems`, `GET /api/admin/paypal/switch` reports "no valid switch" (blocked), both crons unchanged.

## 10. Failure handling (decision tree)
| Situation | Do | Don't |
|---|---|---|
| Command refused before any change (auth, identity, syntax) | Verify schema and counts equal P4/P5, fix the cause, retry | Retry blindly without verifying |
| Command errored mid-way or the connection dropped (unknown state) | Read `PRAGMA table_info` for the tables and `sqlite_master` for the indexes; compare with section 6/7 lists. Nothing applied → retry. Everything applied → treat as success and run V. Partial → run **only** the missing statements one by one (SQLite has no `ADD COLUMN IF NOT EXISTS`) | Re-run the whole file (it fails on the first existing column, which is safe but confusing) |
| Applied, verification mismatch only in expectations (e.g. a count differs) | Stop, investigate; the change is additive and harmless to the deployed code, so fix forward | Roll back reflexively |
| Applied, but the site misbehaves (should not happen: nothing reads the new objects) | Check Worker logs; rollback SQL is allowed only while the PayPal tables are empty (P5/V show 0 rows) **[APPROVAL]** | Roll back after real orders exist |
| Schema is wrong and cannot be fixed forward | Time Travel restore to the section 4 (or section 7) bookmark **[APPROVAL, written]**: it replaces the WHOLE database and discards every write since the bookmark (subscribers, sessions, analytics, tokens); keep the returned `previous_bookmark` to undo the restore | Restore without noting the `previous_bookmark`, or restore casually on a busy day |
| After code is deployed and real orders exist | Never roll back columns: roll back the **code** first; reconcile with PayPal before any restore; rollback files drop columns the new code needs | Run the rollback SQL with the new code live |
Escalation: the operator stops at the first unexpected output, writes down the exact message (no data), and asks the owner. There is no deadline pressure: production runs unchanged without the migrations.

## 11. What this plan does not cover
Deploying the code, the 15-minute cron, alerts, Live credentials, the canary, legal pages. Network loss during upload, very large databases and live concurrent traffic remain untested (the database is small and payments are off, which bounds the risk).
