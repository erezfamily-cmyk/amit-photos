# Classification of the checks not yet done (14.10.2026)

Status: **analysis only; nothing was run, nothing is approved.** Three classes:
- **A. Required before the code is deployed** (merge of #155 with the payment flags `false`).
- **B. Required before the canary** (the first real purchase on Live).
- **C. May be deferred, with a documented limit** (and the point by which it must be closed).

Reference facts: with the flags `false` the public cannot create or capture an order, so there are no paid orders, no stuck orders, no disputes and no customer mail; the only new surface reachable in production is admin-only routes (password) and `GET /api/ping`. The canary is one attended purchase (`maxOrders=1`, one photo, short `closesAt`), real money, a known buyer.

## A. Required before deploying the code with payments off
| Check | Why |
|---|---|
| Production migrations 0002 then 0003 applied and verified (`docs/production-migrations-0002-0003-execution-plan-2026-10-14.md`) | The new code reads and writes the new columns/tables; without them health reports `SCHEMA_BEHIND`, the switch's audit insert fails and the dispute block is inactive. |
| Post-deploy read-only checks (same plan, section 9): `payments-status` closed, create/capture 503, webhook fails closed, `/api/ping` 200, `health` healthy with empty `schemaProblems`, switch reads "blocked" (no row), crons unchanged | They prove the deployed code is inert and the schema matches. Can only be done after the deploy, so they decide whether to leave it deployed (rollback of the code is a revert, no schema change). |
| `wrangler.toml` of the merged `main` keeps both flags `false` and two crons (tests enforce it; read it again after the merge) | #157's alert/cron config is deliberately not in #155. |
| A tested way back for the code (revert commit; Workers version rollback) | Nothing is irreversible at this step, but the way back must be known before the merge. |

Not required here, and why: `recover-fulfillment`, `switch` helper, disputes/reversals/declines, bounce, scanners — none can act while no order can be created or paid; the new admin routes are password-gated and add no public write.

## B. Required before the canary
| Check | Why |
|---|---|
| Legal and commercial decisions completed **and recorded** (see section D) | A real sale needs terms, refund/dispute policy, privacy and a contact that works. Not a test, a gate. |
| Readiness `READY` against real PayPal **Live** (app, webhook id, secrets, URL, subscribed events incl. refund/reversal/dispute types) | Sandbox `READY` is not evidence of Live. |
| `recover-fulfillment` rehearsed once on the Sandbox Preview with a real Sandbox order held in `FULFILLING` (needs the owner's approval for a Sandbox purchase; no Live) | It is the only recovery path for a paid-but-undelivered order, and it has only been run against fakes. A stuck paid order during the canary is real money and the PayPal dashboard "resend event" may not be available or fast enough. The logic (concurrency, refund/dispute blocks, interruption, audit) is covered by 19+11 tests; what the fakes cannot show is PayPal's real order/capture payload to this route. |
| The checkout switch exercised on the Preview through the admin route and the helper `switch` command (open with `closesAt`/cap, close, freeze, read) | The command was never exercised against a live Preview; it is the stop button during the canary. No PayPal event is needed. |
| Test of the whole Live money loop on the owner's own purchase is **the canary itself**; before it: `contact@amitphotos.com` routing (a reply from the buyer reaches the owner) and the recipient of alerts verified by one deliberate test alert in production | The buyer must be able to reach support, and the owner must receive the stop signal. |
| Attended canary plan: who watches, for how long, stop criteria, how to freeze (switch + flags), how to refund | Operational readiness; the freeze/emergency procedure already exists in documents but has not been adopted. |

## C. May be deferred, with a documented limit
| Check | Limit while deferred | Close by | Reason it is safe to defer |
|---|---|---|---|
| **Dispute and reversal events with real PayPal payloads** | Code is written against documented shapes and tested with fakes; refund payloads **were** verified with real Sandbox events. During the canary the owner checks the PayPal Resolution Center / transactions manually; an unrecognised event is rejected with 400 or ignored and shows as `WEBHOOK_FAILING` or nothing, never as a delivery or a refund decision. | Before opening beyond the canary | These events occur days to weeks after a sale, so they cannot affect the canary's delivery; the system fails safe (a person decides, the stuck/failed-webhook alerts fire); the Live webhook must still be **subscribed** to them. Try to simulate them in the Sandbox first and record the result, but do not block the canary if PayPal's Sandbox cannot produce them. |
| **Decline** (the buyer's card or funding is refused at PayPal) | The UI path is covered by source tests and mocked browsers, not by a provider-side decline. In the canary a decline just means the buyer retries or stops. | Before public opening | No money moves and no order completes on a decline; the cost is a lost sale, not a wrong charge. The canary buyer is known and can be told. |
| **Bounce handling** of the download-link e-mail | A bounced or never-delivered mail is not detected automatically. Mitigations that exist: the success page shows the link, admin `resend-link-email` and `reissue`, the retry sweep for failures the provider reports synchronously. | Before public opening (needs provider bounce/complaint events or a documented manual check) | The canary recipient is known and watched; mail is a convenience channel, the purchase page already shows the link. |
| **Other providers and enterprise link scanners** (e.g. Safe Links) | Only Gmail was tested with a real inbox (SPF/DKIM/DMARC pass; scanning did not consume the link thanks to the click-through landing page). | Before public opening | Canary to a known Gmail inbox is covered by the test already done; the design (fragment token, real click required) is the mitigation, not proof for other scanners. |
| Outside uptime service | During an attended canary the owner watches; with no external check a dead Worker would be noticed by people, not by an alert. | Before any unattended period | Proposal is ready; needs the owner's account. |
| Telegram receipt; `CHECKOUT.ORDER.APPROVED` missing event of 12.10 | Telegram is not used (alerts go by e-mail only); the 12.10 gap is in an event the completion path does not depend on (the capture response and `PAYMENT.CAPTURE.COMPLETED` complete the order). | Close or formally drop before public opening | No effect on money or delivery. |
| GitHub `RESEND_API_KEY` equals the Cloudflare one | `deploy.yml` re-puts the GitHub value on each deploy and has done so ten times with mail working. | After the first deploy, when the test alert is sent | Already exercised by past deployments; the test alert re-proves it. |
| Large database, network loss mid-migration, Time Travel retention | See the migration plan. | — | Small database, additive migrations, payments off. |

## D. Owner decisions that must be completed and recorded before Live and before the canary (not approved by this document)
Whether to sell digital licences through PayPal at all (the 12.10 demand review was no-go); prices and currencies; licence terms; refund and dispute policy (time window, what happens to a downloaded file, who answers a dispute); `/legal`, privacy and terms pages and account-deletion path; VAT/invoicing; PayPal business account verification and fees; the canary design (scope, duration, success and stop criteria, who monitors). These can be worked on at any time in parallel with the technical steps, but they must be finished before the Live app/webhook/secrets are created and before the canary. Migrations and the payments-off code deploy do not depend on them.
