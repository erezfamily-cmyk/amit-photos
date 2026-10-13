# Digital checkout preparation — 13 October 2026

Status: code preparation for review, NOT permission to launch or enable payments.

The owner authorized implementing the proposed digital purchase flow and documenting the work in GitHub on 13 October. This supersedes the earlier instruction to defer checkout code until a business decision, for **code preparation only**. The demand result and all paid-launch gates remain open.

## Implemented

- A bilingual, mobile-oriented `/checkout/?photoId=...` page for one personal-use license, the largest available file (`large`), charged in ILS.
- Standalone photo pages link to this product preview. Homepage/gallery purchase modals and their legacy integrations remain unchanged; replacing them is follow-up work before activation.
- Read-only `GET /api/paypal/quote?photoId=...&sku=large` resolves the published photo, current D1 price and photo override through the existing Orders v2 price resolver. It requires no migration-0002 tables, writes nothing and calls no PayPal API.
- Public Orders v2 create/capture require BOTH exact strings `PAYMENTS_ENABLED=true` and `DIGITAL_PAYPAL_ENABLED=true`. Production and Sandbox example configs explicitly keep both false. Authenticated admin Sandbox test hooks retain their existing bypass; webhooks and download entitlements retain existing behavior.
- The checkout page starts disabled and requires a successful server quote and personal-license acknowledgment. The server compares the acknowledged minor-unit amount with its own fresh quote and rejects a changed price or reuse of an attempt for another product.
- Orders v2 redirect checkout uses the PayPal-provided approval URL, restricted in the client to HTTPS on `www.sandbox.paypal.com`. Public return/cancel go to the new checkout page. Existing admin test return pages are unchanged.
- A tab-scoped attempt is stored BEFORE create-order. A lost response retries the same idempotency key. On approval, the returned PayPal token must match that tab's pending order ID. The server capture response, rather than the redirect, supplies the download entitlement.
- Capture retries target the same order. The bearer download link is displayed only after successful server verification and is never written to storage or analytics. The page has no third-party analytics scripts, uses no-referrer, and removes PayPal return parameters after success.

## Validation performed

- 77/77 Node tests passed across the new checkout client/API tests and the existing Orders v2, payment-flag, download-token, Sandbox-isolation, Sandbox-schema and local migration-rehearsal suites.
- Eight new behavioral tests cover exact dual flags, disabled quote preview, server overrides, unpublished images, changed prices, license acceptance, canonical create retry, checkout return URLs, attempt mismatch, lost create/capture responses, concurrent clicks, untrusted approval URLs, forged/expired returns and no bearer token persistence.
- Syntax checks passed for `worker.js`, `paypal-orders.js` and the new browser module.
- Browser rendering and real PayPal redirect E2E are **not completed**. This runtime has Playwright but no Chromium executable; browser download failed. Mobile layout, keyboard interaction and actual HE/EN appearance still need browser QA.
- Existing Sandbox admin hooks and callback-page tests pass. No calls were made to Cloudflare or PayPal, no cloud resources were created, and no migration was executed.

## Review / continuation

1. Review this draft PR, then test the disabled page in its isolated Preview using the existing Sandbox fixture photo. Both flags must remain false for this review.
2. Inspect Hebrew and English at 390px and desktop: long titles, tab order, disabled state, contact/license links, approval mismatch, cancellation and retry/success states.
3. Replace the homepage/gallery's old digital PayPal handoff with this Orders v2 flow and verify cache-busting. Do not activate its old cart or print payment paths. The new digital flag gates Orders v2 only; it is not proof that all legacy physical/cart paths are safe.
4. Confirm current pricing and license wording, add final refund/support terms and decide whether/how to persist license acceptance/version. Current copy is product preparation, not approved launch terms.
5. Decide the paid canary image set and monitoring/stop criteria. This first implementation is not an allowlist-enforced canary: do not enable it merely because its UI works.
6. Finish the missing webhook and real dedup check, decline case, public-route Sandbox E2E and dual-flag kill-switch check.
7. Production migration 0002, Live credentials/webhook/API-base change and activation require their separate approvals and go-live checks. PayPal API base remains Sandbox-only.

## Known limits

- The first checkout sells only `large` in ILS. Existing server/admin SKU support remains intact.
- Existing server price semantics are preserved. Gallery promotional display rules may differ from the backend resolver; the new page shows the server quote. Reconcile that discrepancy before connecting the old promotional modal.
- A lost tab/session cannot recover from another device; support/recovery UX and purchase notification/invoice handling are not added here.
- A return URL is not payment proof. A successful capture can still require support if download transfer fails; the existing one-time-token transfer risk remains open.
- No Live enablement, final pricing decision, production migration, `prep/...` update, Gelato work or real purchase is part of this change.
