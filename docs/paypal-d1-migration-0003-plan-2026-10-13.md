# Migration 0003 — after-sale handling and download re-issue: plan and D1 rehearsal (13.10.2026)

Status: **prepared, NOT applied anywhere.** No D1 was created or touched. Production, the Sandbox D1 and `prep/...` are unchanged. Both payment flags are `false`. Any run below needs the owner's explicit approval first (a throwaway D1 for the rehearsal; the Sandbox D1 for the Preview; production only at the release gate).

## 1. What the migration adds (`migrations/0003_after_sale_and_reissue.sql`)

Additive only, applied after 0001 and 0002.

| Object | Purpose |
|---|---|
| `paypal_orders.after_sale_state` (`NONE` default) | `NONE`, `REVIEW_REQUIRED`, `REFUNDED`, `REVERSED`, `REVOKED_MANUAL`. Moves forward only |
| `paypal_orders.dispute_open`, `dispute_updated_at` | open dispute flag and the timestamp of the last dispute event applied (late older events cannot reopen) |
| `paypal_orders.refunded_minor`, `after_sale_updated_at` | sum of completed refunds recorded from events (cache of the audit rows); last change |
| `download_tokens.paypal_order_ref`, `revoked_at`, `revoke_reason` | ties re-issued links to the order; revocation audit |
| index `idx_download_tokens_order_ref` (partial) | find an order's links |
| table `paypal_order_actions` + index | audit and dedup of admin actions and after-sale events; `UNIQUE(order_ref, action, request_id)` |

Notes that shaped the design:

- Production has a **unique** index on `download_tokens(tx)`. A re-issued link therefore carries its own `tx` (`<capture id>:R<action id>`) and is tied to the order through `paypal_order_ref`; the original link keeps `tx = capture id`.
- Revoking a link sets `used = 2`. The download claim only accepts `used = 0`, so revocation is atomic with the existing claim and works even for code that does not know the new columns.
- Code reads the new order columns defensively (`after_sale_state` missing = `NONE`), so new code does not break before 0003 is applied. The refund and re-issue paths themselves need 0003 and fail with a server error (webhook: retried by PayPal) until it is applied.
- Order of release (unchanged principle): migrations first (0002, then 0003), then the code, flags stay `false` until a separate approval.

## 2. Evidence already available

- Local SQLite test `tests/paypal-migration-0003-rehearsal.test.mjs` (6 tests, CI): exact objects added to a production-shaped schema (pre-0002 DDL + real 0002), existing rows kept with clean defaults, audit uniqueness, `tx` stays unique for re-issued links, a second run fails with `duplicate column name`, a failed run inside an explicit transaction leaves nothing, the rollback restores the shape and keeps rows. **This is SQLite only; it says nothing about D1 itself.**
- Behaviour tests on the migrated schema: `tests/paypal-after-sale.test.mjs` (20 tests).
- From the 0002 rehearsal on a real throwaway D1 (see `docs/paypal-d1-migration-0002-plan-2026-10-13.md` §3): a SQL error mid-file left nothing behind; re-run fails on `duplicate column name`; rollback with `DROP COLUMN` works but destroys later values; Time Travel restore takes about 2 s, loses every later write, and returns a `previous_bookmark` for undo. These were observed for 0002 and are expected, not proven, for 0003.

## 3. Rehearsal plan on an isolated throwaway D1 (to run only after approval)

Preconditions: owner approves creating one temporary D1 and deleting it afterwards. The database id is compared in code against production `802379c7-97cf-4262-93b8-da81c5c3c07d` and Sandbox `7b027b93-c548-4ceb-bbe9-42c45264fc23` before every call; never use `/export`.

1. Create `amit-migration-0003-rehearsal-<date>`. Build the pre-0002 production DDL from the pinned definition (as in the 0002 rehearsal), apply the real `0002`, and insert synthetic rows: orders in `COMPLETED`, `CREATED`, `FULFILLING`; tokens (unused, used); events. Record counts and a checksum of every row.
2. **Failure in the middle:** run a copy of `0003` with an invalid statement after statement 4. Expect: error and nothing left behind (verify schema, counts, checksum). Also try one failure *after* the last `ALTER` (e.g. in the `CREATE TABLE`) to see whether D1 keeps the earlier `ALTER`s.
3. **Clean run:** `npx wrangler@4.149.0 d1 execute <db> --remote --yes --file migrations/0003_after_sale_and_reissue.sql`. Record duration, objects, unchanged counts/checksum, defaults on old rows.
4. **Re-run:** expect `duplicate column name`; DB unchanged.
5. **Behaviour on D1:** with the synthetic data, run the real queries used by the code: the atomic `INSERT … SELECT … WHERE` slot claim (limit of 2, in-progress rule), the monotonic `UPDATE … WHERE rank < ?`, and the revoke `UPDATE`; confirm D1 accepts them, `meta.changes` is right, and a duplicate `(order_ref, action, request_id)` raises the unique error. This is the part SQLite cannot prove for D1.
6. **Rollback:** run `staging/rollback-0003-after-sale-and-reissue.sql` on a copy that has post-0003 values; expect `DROP COLUMN` accepted and the new values gone (destructive by design).
7. **Time Travel:** take a bookmark after step 5, write a marker row, restore, confirm schema + step-5 data return and the marker is lost, then undo with `previous_bookmark`. Note the retention period shown by the API.
8. Delete the throwaway D1 and confirm the account lists only the Sandbox and production databases. Write results into this document.

Not covered even after this: network loss during upload, a large database, concurrent live traffic, behaviour with real payments present.

## 4. Release gate for production (separate approvals)

1. Owner approves merging PR #155. 2. Owner approves a production backup (existing procedure, age key from the password manager) and applying 0002 then 0003 to **production** D1 with the rehearsed command. 3. Deploy code. 4. Verify with flags still `false` (create 503, webhook behaviour, `PRAGMA table_info`). 5. Only then discuss flags. Rollback uses the rollback files; after real orders exist prefer a reconciliation with PayPal over Time Travel.

## 5. Sandbox verification still needed before any release

- Apply 0003 to the **Sandbox D1** (needs approval), then in a Sandbox window: refund a sandbox capture from the PayPal sandbox dashboard (full and partial) and observe `PAYMENT.CAPTURE.REFUNDED`; check the real payload shape (the `up` link to the capture, `supplementary_data`, status), reversal and dispute events if the sandbox can simulate them; add the new event types to the isolated Sandbox webhook app. The code reads the capture id from the refund's `up` link and falls back to the resource id for reversals; both are **unverified against real PayPal payloads**.
- Re-issue against a real Sandbox order: issue, download once, confirm the previous link says "revoked" and the third request is refused.
- The live HEAD check on a real unused token (from the previous list).
