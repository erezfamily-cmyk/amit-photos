# Digital checkout preparation — 13 October 2026

Status: code preparation for review, NOT permission to launch or enable payments.

The owner authorized implementing the proposed digital purchase flow and documenting the work in GitHub on 13 October. This supersedes the earlier instruction to defer checkout code until a business decision, for **code preparation only**. The demand result and all paid-launch gates remain open.

## Implemented

- A bilingual, mobile-oriented `/checkout/?photoId=...` page for one personal-use license, the largest available file (`large`), charged in ILS.
- Standalone photo pages, gallery cards and the lightbox link to this product preview even while payments are disabled. Single-image handoff no longer redirects to the legacy PayPal endpoint. Cart/print remain unavailable in the browser even if the global flag is true; their server-side launch policy still needs review.
- Read-only `GET /api/paypal/quote?photoId=...&sku=large` resolves the published photo, current D1 price and photo override through the existing Orders v2 price resolver. It requires no migration-0002 tables, writes nothing and calls no PayPal API.
- Public Orders v2 create/capture require BOTH exact strings `PAYMENTS_ENABLED=true` and `DIGITAL_PAYPAL_ENABLED=true`. Production and Sandbox example configs explicitly keep both false. Authenticated admin Sandbox test hooks retain their existing bypass; webhooks and download entitlements retain existing behavior.
- The checkout page starts disabled and requires a successful server quote and personal-license acknowledgment. The server compares the acknowledged minor-unit amount with its own fresh quote and rejects a changed price or reuse of an attempt for another product.
- Orders v2 redirect checkout uses the PayPal-provided approval URL, restricted in the client to HTTPS on `www.sandbox.paypal.com`. Public return/cancel go to the new checkout page. Existing admin test return pages are unchanged.
- A tab-scoped attempt is stored BEFORE create-order. A lost response retries the same idempotency key. On approval, the returned PayPal token must match that tab's pending order ID. The server capture response, rather than the redirect, supplies the download entitlement.
- Capture retries target the same order. The bearer download link is displayed only after successful server verification and is never written to storage or analytics. The page has no third-party analytics scripts, uses no-referrer, and removes PayPal return parameters after success.

## Validation performed

- 106/106 Node tests passed across the new checkout client/API tests and the existing Orders v2, payment-flag, download-token, Sandbox-isolation, Sandbox-schema and local migration-rehearsal suites.
- Twelve new behavioral tests cover exact dual flags, disabled quote preview, server overrides, unpublished images, changed prices, license acceptance, canonical create retry, checkout return URLs, attempt mismatch, lost create/capture responses, concurrent clicks, untrusted approval URLs, forged/expired returns no bearer token persistence, gallery preview routing in both languages legacy cart/print blocking, homepage inline-script syntax and personal-license pricing copy.
- Syntax checks passed for `worker.js`, `paypal-orders.js` and the new browser module.
- Desktop browser QA PARTIAL: the cloud browser loaded the existing Sandbox Preview at commit `99c122a`; Hebrew and English quote/disabled states rendered correctly, and Enter on the lightbox personal-license control navigated to checkout. All seven checks on that commit were green, including both Cloudflare builds. Local Chromium is unavailable and its download failed; the cloud browser resolved basic desktop QA. Later mocked Chromium CI QA passed at 390/768/1280px; gallery pointer interaction passed after the overlay fix. Real PayPal redirect E2E remains pending.
- Browser review also exposed an existing malformed `if data.lead_created` in the guide popup and full-size pricing copy promising commercial/all rights. The popup condition is repaired and full-size copy now says personal non-commercial use with copyright retained (HE/EN), with regression tests.
- Existing Sandbox admin hooks and callback-page tests pass. No calls were made to Cloudflare or PayPal, no cloud resources were created, and no migration was executed.

## Review / continuation

1. Review this draft PR and continue browser QA on its existing isolated Preview using `paypal-sandbox-test-photo`. The observed Preview is `https://feature-digital-checkout-preparation-amit-photos-paypal-sandbox.erez-family.workers.dev/checkout/?photoId=paypal-sandbox-test-photo&lang=he`. Both flags must remain false for this review.
2. Inspect Hebrew and English at 390px and desktop: long titles, tab order, disabled state, contact/license links, approval mismatch, cancellation and retry/success states.
3. Gallery integration and root asset cache-busting are implemented. Verify the full gallery → personal license → checkout path in the browser. Do not activate legacy cart/print paths; browser blocking is not proof that their backend routes are safe. The digital flag gates Orders v2 only.
4. Confirm current pricing and license wording, add final refund/support terms and decide whether/how to persist license acceptance/version. Current copy is product preparation, not approved launch terms.
5. Decide the paid canary image set and monitoring/stop criteria. This first implementation is not an allowlist-enforced canary: do not enable it merely because its UI works.
6. Finish the missing webhook and real dedup check, decline case, public-route Sandbox E2E and dual-flag kill-switch check.
7. Production migration 0002, Live credentials/webhook/API-base change and activation require their separate approvals and go-live checks. PayPal API base remains Sandbox-only.

## Known limits

- The first checkout sells only `large` in ILS. Existing server/admin SKU support remains intact.
- Existing server price semantics are preserved. The old size/promotion modal is bypassed. Preview CTAs do not show its promotional price; checkout shows the server quote. Review promotion semantics separately before promising discounts.
- A lost tab/session cannot recover from another device; support/recovery UX and purchase notification/invoice handling are not added here.
- A return URL is not payment proof. A successful capture can still require support if download transfer fails; the existing one-time-token transfer risk remains open.
- No Live enablement, final pricing decision, production migration, `prep/...` update, Gelato work or real purchase is part of this change.

## Automated browser QA follow-up

- `tests/digital-checkout.browser.mjs` serves repository assets on localhost and intercepts every API/provider response. It tests HE/EN at 390/768/1280px, long titles, success, capture retry, cancellation, changed price, forged return and gallery pointer navigation. This is **mocked browser QA, not a real PayPal E2E or payment-security certification**.
- A dedicated `digital-checkout-browser` CI job installs pinned Playwright 1.62.1/Chromium on the existing GitHub runner, runs the scenarios and retains screenshots for seven days. No credentials or external account are used. First run: the 12 checkout scenarios passed, but gallery pointer navigation failed because `.img-protect-overlay` (z-index 1) intercepted the button. The gallery action overlay now sits above it (z-index 2), while wishlist controls retain z-index 6. The regression rerun passed all 14 scenarios at `1625df2`, GitHub run `38401787192`.
- Native Preview configuration now explicitly sets both payment vars to false, since Preview vars do not inherit top-level vars. The isolation regression test checks that setting too.
- Long unbroken titles wrap inside the checkout card. The source test suite still passes 106/106.

After this job passes, the remaining live checks still need explicit Sandbox-only activation approval: verify the chosen Preview uses Sandbox D1/R2/credentials, authorize both flags on that Preview only, create/approve/capture the disposable digital fixture, check one fulfillment and one token, test decline/cancel/retry/dedup and turn both flags off again. No production or `prep/...` change is authorized here.

## Browser QA result and connected-session handoff

At `1625df2`, GitHub job `115310975967` passed **14/14 mocked browser scenarios**. The source/API suite passed **106/106**. Screenshots were manually inspected for HE/EN 390px, success and gallery navigation; no horizontal clipping was observed. Scenario screenshots are in the seven-day artifact on https://github.com/erezfamily-cmyk/amit-photos/actions/runs/38401787192 . This is not evidence of a real PayPal capture or webhook delivery.

For the connected Claude session:

1. Read PR #155 and this document; verify the exact head/checks and isolated Preview bindings. Do not merge or update `prep/...`.
2. Verify `/api/payments-status` and the disabled fixture checkout on that Preview, then confirm the checkout code matches the reviewed head. Production must remain closed.
3. Prepare a concrete Sandbox-only live test against `paypal-sandbox-test-photo`: identify the Preview/version, Sandbox D1/R2, buyer test account, active Sandbox price and existing webhook target/subscriptions. Do not print secrets or bearer download tokens.
4. **Before changing flags, obtain the owner's explicit approval** to temporarily set BOTH `PAYMENTS_ENABLED` and `DIGITAL_PAYPAL_ENABLED` to true on that named Sandbox Preview only. Approval to write/merge code is not payment activation approval. No Live or production settings are included.
5. After approval, test public create → buyer approval → capture → one-use download, cancellation, buyer decline, retries, current-price mismatch, existing webhook delivery and same-event dedup. Keep the missing historical webhook investigation separate; mock browser success does not close it.
6. Restore BOTH flags to false, verify public create/capture return 503 and status/quote report closed, then document results and exact tested head. If blocked by buyer credentials or PayPal Event Logs, report the concrete missing input without asking for secrets in chat.

No production migration or Live setup is authorized. The first live test needs a connected operator; the current agent has no Cloudflare/PayPal account tools.

## Connected-review fixes — after Claude's `15be7aa`

- First-visit cookie notice temporarily hides while a photo/buy/cart/wall dialog is open. Closing it restores the notice, without recording consent or dismissal. Browser cases at 1280×800 and 360×640 verify visibility, storage and actual pointer navigation.
- Known `INSTRUMENT_DECLINED` or identity-matched capture `DECLINED` returns HTTP 422 with stable `PAYMENT_DECLINED`. It makes no fulfillment/status/token write. Unknown/malformed failures retain the existing 502 retry/recovery path.
- The page presents the funding refusal separately. Only a definitive decline enables an explicit return to product details; this clears the failed attempt, requires fresh consent and a fresh key on the next create, and does not automatically charge or retry capture. Ambiguous/network failures retain the original key/order.
- The suite now has 108 passing source/API tests and 17 mocked browser scenarios; browser rerun pending on the new code. These are not a real PayPal negative test. No negative-test hook or provider mock header was added to application code.
- Provider reference: https://developer.paypal.com/v5/checkout/handle-funding-failure/ . This redirect integration uses an explicit restart screen, not the SDK's `actions.restart()`.
- The live-plan review is updated: prefer a dedicated Sandbox webhook for this Preview (and an isolated Sandbox app if necessary), leaving the existing main-Sandbox webhook untouched; creation/configuration needs owner authorization. Do not migrate the historical webhook investigation to a new target.
