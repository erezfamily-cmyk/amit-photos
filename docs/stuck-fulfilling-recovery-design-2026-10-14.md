# Design for review: recovering a paid order stuck in `FULFILLING` (14.10.2026)

Status: **approved by the owner on 14.10.2026 and implemented in the #155 branch only** (`handlePayPalRecoverFulfillment`, tests in `tests/paypal-recover-fulfillment.test.mjs`). Decisions 2-4 below were answered: build it (yes), no manual capture id (yes), mark the legacy advice obsolete and fix the alert text (done). Not deployed, not run against real PayPal; no event and no mail were sent. Payment flags stay `false`.

## 1. What exists today (verified in the code, not assumed)
- An order enters `FULFILLING` at the moment a capture id is recorded (`UPDATE paypal_orders SET status='FULFILLING', paypal_capture_id=?, fulfillment_token=?`, guarded by `status NOT IN ('FULFILLING','COMPLETED')`). The fulfilment token is created once, with the capture id, and never regenerated.
- `finalizeDigitalPayPalOrder` completes the order: it re-checks that no refund/reversal landed, inserts the download token with `INSERT OR IGNORE` (the token is the stored `fulfillment_token`, so running it twice cannot mint a second one), confirms the token row exists, re-checks the after-sale state, sets `COMPLETED` only `WHERE status='FULFILLING'`, and only the request that actually flipped the status sends the e-mail.
- Three existing paths already call it with **no new capture**: the buyer's own capture retry (`FULFILLING` + capture id + token: "resume locally without charging again"), the `PAYMENT.CAPTURE.COMPLETED` webhook, and the capture-recovery for `ORDER_ALREADY_CAPTURED`.
- The webhook path verifies server-side before anything is minted: it asks PayPal for the order and requires `order.id == paypal_order_id`, order status `COMPLETED`, `custom_id == our order id`, a capture with the **same capture id** in status `COMPLETED`, and the same currency and amount as expected. A mismatch is a 409 and nothing is minted. Refunded/reversed orders are ignored before PayPal is even asked. The switch (`closed`/`frozen`) does not block it: paid orders are always delivered.
- Monitoring flags the order as `STUCK_FULFILLING` after two hours.

## 2. The contradictions found, and how each is settled
| # | Where | What it says | Problem | Settlement |
|---|---|---|---|---|
| 1 | Runbook, `STUCK_FULFILLING` row | Use **Resend** of the `PAYMENT.CAPTURE.COMPLETED` event from the PayPal dashboard; no tool exists if there is no event | Correct and safe, but depends on an event still being resendable | Keep as **step 1**; the new admin action (below) is the fallback when no event can be resent |
| 2 | `docs/paypal-flow.md` "create a token manually in D1" (`tx='MANUAL_<id>'`) | Insert a row into `download_tokens` by hand | Belongs to the **removed legacy flow** (`/api/verify-payment` now returns 410). For an Orders v2 order it: leaves the order `FULFILLING` (the alert never clears, and a later webhook mints a **second** link: double delivery); the row has no `paypal_order_ref` and its `tx` is not the capture id, so `revokeUnusedTokens` (matches `paypal_order_ref` or `tx`) **cannot revoke it on a refund**; nothing is audited; PayPal is never asked | **Forbidden** for Orders v2. Add a warning to that section; the runbook states the rule |
| 3 | Alert text `STUCK_FULFILLING` | "run re-issue after verification" | `reissue` requires `status == COMPLETED` and answers `ORDER_NOT_ELIGIBLE` for `FULFILLING` | Change the alert text to point to the runbook step (resend event, else the new action). Text change only |
| 4 | Emergency procedure | Direct D1 statements | Limited to the `digital_checkout_switch` settings row (a documented emergency, and the tool now covers the normal case through the admin route) | No change; direct D1 edits of `paypal_orders` / `download_tokens` are not part of any procedure |

**Rule:** no manual D1 edits of orders or tokens. Recovery is (1) resend the event, else (2) the admin action below. Both end in the same code path, `finalizeDigitalPayPalOrder`.

## 3. Proposed admin action: `POST /api/admin/paypal/recover-fulfillment`
Auth: the existing admin check. Input: `paypalOrderId`, `reason` (required, 150 chars), `Idempotency-Key` header (8-64 chars, as the other admin actions). Available in every environment, **including while the checkout is `closed` or `frozen` and while the payment flags are `false`** (delivery of an already paid order is never blocked).

Steps, in order; any failure stops and returns a bare reason code:
1. **Idempotency / audit first.** Insert an action row (`order_ref`, action `RECOVER_FULFILLMENT`, `request_id` = key, actor `admin`, reason, status `STARTED`). Same key again returns the stored result with `replayed:true` and does nothing else. A different key while another `STARTED` row for the same order is younger than 10 minutes returns 409 `RECOVERY_IN_PROGRESS` (prevents two admins or a double click running in parallel; same window rule as re-issue).
2. **Eligibility from our database.** Order exists; digital; status exactly `FULFILLING` (a `COMPLETED` order returns `ALREADY_COMPLETED`, nothing else is done); a capture id **and** a fulfilment token are recorded; not refunded/reversed/revoked (`ORDER_REFUNDED` 409); no open dispute (`AFTER_SALE_OPEN` 409, same as re-issue).
3. **Payment verified server-side, by asking PayPal, never from the request.** `GET /v2/checkout/orders/<id>` (read-only) on the environment's own API base, then the **same checks as the webhook**: order id, order `COMPLETED`, `custom_id == order.id`, the capture with **our recorded capture id** is `COMPLETED`, currency and amount equal to what we expected. Any mismatch or lookup failure: stop, `PAYMENT_NOT_VERIFIED` (409) or `PAYPAL_LOOKUP_FAILED` (502); the action row is closed as failed; nothing is minted.
4. **Deliver through the existing function.** Call `finalizeDigitalPayPalOrder` with the loaded order. It reuses the stored token (no second link), re-checks refunds before and after minting, completes the order with the guarded `UPDATE`, and sends the e-mail only if this call flipped the status (the e-mail has its own stable idempotency key per order and link).
5. **Close the audit row** as `DONE` (or `FAILED` with a reason code) with a timestamp. The response is `{ok, status:'COMPLETED', replayed, emailed}`; it never contains the download link, the capture id, the payer's address or PayPal's raw response. The link reaches the buyer by e-mail, or by the existing `reissue` / `resend-link-email` after completion.

### What it can never do
- **No second charge:** the handler never calls the capture endpoint, `getPayPalAccessToken` is used only for the read-only GET, and a test fails the build if the handler contains `/capture` or a POST to PayPal. It does not create orders.
- **No double delivery:** one fixed token per order (`INSERT OR IGNORE`), status flip guarded by `WHERE status='FULFILLING'`, e-mail only from the flipping call, action row de-duplicates the admin call, and a late webhook or a buyer retry afterwards finds `COMPLETED` and does nothing.
- **No delivery for money that is not there:** step 3 must pass against PayPal itself; the database alone is never trusted.
- **No silent action:** every call leaves an audit row (who/when/why/outcome, no secrets); it is visible in `GET /api/admin/paypal/order` like the other actions.

### Two cases deliberately **not** covered (and why)
- `FULFILLING` **without** a recorded capture id or token (an inconsistent row): the action refuses (`STATE_INCOMPLETE`). Those are completed by the webhook claim path or need a human reading PayPal's dashboard first; adopting a capture id from a request would defeat server-side verification. Open question for the owner below.
- Orders the buyer paid but that never reached `FULFILLING` (still `CREATED`/`APPROVED` locally because both the capture response and the webhook were lost): out of scope here; the webhook resend handles them (its claim path adopts the capture after the same verification).

## 4. Tests that implementation would add (real SQLite, fake PayPal; mutation-checked)
Happy path completes and mails once; replay with the same key does nothing; second key after completion returns `ALREADY_COMPLETED`; concurrent double call mints one token and sends one mail; PayPal says amount/currency/custom_id/capture id differs, order not `COMPLETED`, or lookup fails: nothing minted, order stays `FULFILLING`; refunded or disputed order refused; works with the checkout `frozen` and flags `false`; no `/capture` call and no POST to PayPal in any scenario (fake counts requests); no link/capture id/secret in any response; audit row written for success and for every refusal; unauthenticated 401; late webhook after recovery does not mint again; refund right after recovery revokes the token (proves the token is a normal, revocable one). Also: the alert text no longer mentions re-issue; docs contain the "no manual D1 edits" rule.

## 5. Decisions for the owner
1. Approve this design (or change it) before any implementation.
2. Is the fallback action wanted at all, given that "Resend event" from the PayPal dashboard already covers the usual case? (Recommendation: yes, build it. PayPal may only allow resending events for a limited period (not verified), and an incident at night should not depend on the dashboard.)
3. Should the action also accept a `FULFILLING` row with a missing capture id when the admin supplies the capture id read from the PayPal dashboard? (Recommendation: **no**; keep the capture id coming only from our record or PayPal's own order lookup.)
4. May I mark the legacy section of `paypal-flow.md` as obsolete for Orders v2 and change the alert wording now (documentation/text only)?

Not verified: PayPal's real retention window for resending events; behaviour with a real Live capture that stays `PENDING` (a real echeck-type capture would be neither `COMPLETED` nor failed: the action refuses it as `PAYMENT_NOT_VERIFIED`, which is the safe outcome, but it has never been seen live).
