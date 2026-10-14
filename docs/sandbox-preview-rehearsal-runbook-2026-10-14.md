# Preview rehearsal: checkout switch and recover-fulfillment (owner-run steps; prepared 14.10.2026)

**Status: PREPARED, NOT RUN.** Approved by the owner on 14.10.2026: one controlled `recover-fulfillment` rehearsal and a `switch` check on the **Preview only**. Not approved: production, Live, merge, deploy, a canary. Everything below happens on the Sandbox Worker `amit-photos-paypal-sandbox`, Preview `feature/digital-checkout-preparation-2026-10-13`, Sandbox D1 `amit-photos-paypal-sandbox-db` (`7b027b93-…`).

**Why the owner has to type the commands:** both routes are admin-authenticated and the Preview admin password is in the owner's password manager (the entry created on 13.10). It is never given to chat or to me. I did not use any other stored credential.

## 1. Pre-flight facts (read-only, checked by me on 14.10.2026 ~19:30 UTC)
| Check | Result |
|---|---|
| Preview runs the tested code | latest deployment `be409eef-836d-4f36-87f2-911e981d8835`, commit tag `3655d64` (the #155 code head), source = wrangler preview upload |
| Both payment flags | `PAYMENTS_ENABLED = "false"`, `DIGITAL_PAYPAL_ENABLED = "false"` (plain-text variables of that deployment) |
| Cannot reach PayPal Live | `PAYPAL_ENVIRONMENT = "sandbox"` and `PAYPAL_CREDENTIALS_ENVIRONMENT = "sandbox"`; the API base is derived from that setting (`api-m.sandbox.paypal.com`) and the Worker refuses Live when the credential declaration is not `live`; the only PayPal secrets present are the four Sandbox-app ones (names: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `ADMIN_PASSWORD`). Tests: `paypal-environment-separation`. Even a wrongly pasted Live credential would be sent to the Sandbox host and rejected. |
| Mail is off | no `RESEND_API_KEY`, no `DOWNLOAD_EMAIL_ENABLED`, no `DOWNLOAD_EMAIL_OVERRIDE_TO`, no `PAYMENT_ALERT*` on the Preview; the only secrets/variables are those listed. Completion therefore sends nothing. |
| Database | binding `DB` = the Sandbox D1 (`7b027b93-…`), not production |
| Public behaviour now | `GET /api/ping` 200 `{"ok":true}`; `GET /api/payments-status` `{"enabled":false,"digitalEnabled":false}`; public create-order and capture-order 503 `PAYMENTS_TEMPORARILY_DISABLED`; `recover-fulfillment` without credentials 401 |
| Switch row | none (absent = blocked) |
| Sandbox D1 | 20 orders, 2 refunded, none with an open dispute; clean candidate order below |

## 2. Part A: switch (no PayPal event, no order, no mail)
Run in your own PowerShell (`pwsh -File staging/sandbox-window/window-tools.ps1`; the password prompt is hidden; English keyboard layout). Use any fresh keys (8-64 letters/digits/`-`/`_`).
1. `switch` → expect `valid = false`, `effectiveMode = "blocked"`.
2. `switch open KEY-A1 <ISO UTC time 30 minutes from now, e.g. 2026-10-14T21:00:00Z> 1 paypal-sandbox-test-photo` → `ok`, `state open`, `effectiveMode open`.
3. In a browser or `curl`: `GET <Preview>/api/payments-status` → still `digitalEnabled:false` and a public create-order still 503 (the flags override the switch: **this is the proof that opening the switch does not open payments**).
4. `switch open KEY-A1 …` again with the same key → `replayed`. `switch closed KEY-A2` → `effectiveMode closed`; `switch frozen KEY-A3` → frozen; `switch` after each shows the state.
5. Leave it on **`frozen`**. (An absent row is also blocked; I remove it from the Sandbox D1 at the end only if you prefer that.)

## 3. Part B: recover-fulfillment on a real Sandbox order held in FULFILLING
### 3.1 Why no new purchase, and the controlled way to create the stuck state
A new Sandbox purchase would need the flags set to `true` on the Preview and a Sandbox buyer to log in to PayPal; I have no buyer credentials and the owner's flag change would be one more state to undo. The Sandbox D1 already holds real, completed Sandbox orders whose captures exist at PayPal. The rehearsal needs exactly what an interrupted completion leaves behind: **capture id and fulfilment token recorded, status `FULFILLING`, no download link.**
Method (no application code change; Sandbox D1 only; one order; reversible), implemented in `staging/sandbox-window/stuck-fixture.mjs` and tested in `tests/sandbox-stuck-fixture.test.mjs`:
- target database id **and** name must be the Sandbox's (production id/name refused);
- the order must be a clean COMPLETED digital Sandbox order: no refund, no dispute, no after-sale state, no audit rows, exactly one token and it is the original;
- two statements, each guarded by its own `WHERE`: `UPDATE paypal_orders SET status='FULFILLING', fulfillment_json=NULL, completed_at=NULL WHERE paypal_order_id=? AND status='COMPLETED' AND … AND after_sale_state='NONE' AND dispute_open=0 AND refunded_minor=0` and `DELETE FROM download_tokens WHERE token=? AND tx=? AND paypal_order_ref IS NULL`;
- the deleted token row (a Sandbox bearer value) is kept only in a local snapshot file (`%TEMP%\stuck-fixture-<order>.json`), never printed; `restore` puts everything back exactly if the rehearsal is abandoned;
- a read-only `plan` mode shows the eligibility and the statements before anything is applied.
Proposed order: **`97A89187R7121682U`** (Sandbox, created 13.10 17:31 UTC, completed, one used token, no refund/dispute/re-issue/audit rows; chosen over `5UX28549FW6152740`, which has re-issue tokens and audit rows and would be refused).
**Approval needed before I run `create`:** this is a write to the Sandbox D1, a different method from the purchase you approved. Say "go" (or name another order) and I run `plan`, then `create --yes-sandbox`, then tell you when to start.

### 3.2 Owner steps after "created"
In the same helper session:
1. `support 97A89187R7121682U` → status `FULFILLING`.
2. `recover 97A89187R7121682U KEY-B1` → expect `HTTP 200`, `ok = true`, `status = "COMPLETED"`, `replayed = false`. (The route asks PayPal Sandbox for the order, checks order id, custom id, our recorded capture id, amount and currency, and finishes through the shared completion path. Mail is off.)
3. `support 97A89187R7121682U` → status `COMPLETED`, actions list shows `RECOVER_FULFILLMENT / DONE`.
4. `recover 97A89187R7121682U KEY-B1` → `replayed = true`. `recover 97A89187R7121682U KEY-B2` → `alreadyCompleted = true`, status `COMPLETED`.
5. Optional negative: `recover` for an order that is not stuck (any COMPLETED one) → `alreadyCompleted`; for a CREATED order → `ORDER_NOT_ELIGIBLE`.
What I verify afterwards (read-only on the Sandbox D1): exactly one token for the capture (the stored one, unused), order `COMPLETED`, one audit row with no link or token text, no `LINK_EMAIL` row created, no new webhook events.

## 4. Cleanup and final verification (after both parts)
1. Switch: ends `frozen` (or the row removed).
2. Payment flags: re-read the Preview deployment through the Cloudflare API: both `"false"`, no mail variables, no new secrets.
3. Public: `/api/payments-status` `{"enabled":false,"digitalEnabled":false}`; create-order and capture-order 503; `recover-fulfillment` unauthenticated 401.
4. Fixture: delete the local snapshot file; the recovered order stays COMPLETED (functionally equal to before; its token row is recreated with a fresh 24 h expiry).
5. Record results in HANDOFF; nothing is left on production, and no PayPal Live object exists.

## 5. If something fails
- `recover` returns `PAYMENT_NOT_VERIFIED` or `PAYPAL_LOOKUP_FAILED`: do not retry blindly; send me the code (it contains no data). This is the very result the rehearsal exists to find (the real PayPal payload differs from the fake).
- Interrupted: the same key resumes; another key is held off for 10 minutes.
- Abandon: `node staging/sandbox-window/stuck-fixture.mjs restore 97A89187R7121682U --yes-sandbox`.
