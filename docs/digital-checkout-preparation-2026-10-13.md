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
- Desktop browser QA PARTIAL: the cloud browser loaded the existing Sandbox Preview at commit `99c122a`; Hebrew and English quote/disabled states rendered correctly, and Enter on the lightbox personal-license control navigated to checkout. All seven checks on that commit were green, including both Cloudflare builds. Local Chromium is unavailable and its download failed; the cloud browser resolved basic desktop QA. Mobile 390px layout, pointer interaction/overlay behavior and real PayPal redirect E2E remain pending.
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
