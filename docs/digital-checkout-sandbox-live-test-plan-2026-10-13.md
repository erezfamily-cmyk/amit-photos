# Digital checkout: Sandbox-only live test plan (prepared 13.10.2026)

**Status: PLAN ONLY. No flag was changed, no secret was set, no PayPal call was made, nothing was merged.** Production and `prep/...` are out of scope. Both payment flags are still `false` on the Preview (verified 13.10).

## 1. Environment (verified read-only on 13.10)

| Item | Value |
|---|---|
| PR / head | #155 (draft), head `908a5a3`; 9 checks green on that head (digital-checkout-browser, paypal-orders-v2, lead-funnel, b2b, taxonomy, python-data-tests, verify-live, both Cloudflare builds) |
| Preview | branch Preview `feature/digital-checkout-preparation-2026-10-13` of the Sandbox Worker `amit-photos-paypal-sandbox` (Preview id `8ef9ae2781484d48b596b3da8815f6f9`) |
| URL | `https://feature-digital-checkout-preparation-amit-photos-paypal-sandbox.erez-family.workers.dev` |
| Code deployed | latest build `af55c4e2` on `908a5a3`; the served `digital-checkout.mjs`, `gallery.js` and `checkout/index.html` are byte-identical (sha256) to the branch files |
| Data bindings | D1 `7b027b93-c548-4ceb-bbe9-42c45264fc23` (Sandbox), R2 `amit-photos-paypal-sandbox-images` (Sandbox), Images; PayPal API base is hard-coded to `api-m.sandbox.paypal.com` in `paypal-orders.js` |
| Flags now | `PAYMENTS_ENABLED=false`, `DIGITAL_PAYPAL_ENABLED=false`, `PAYPAL_SANDBOX_CLEANUP_ENABLED=true` (admin-only) |
| Secrets now | **none** on this Preview (no `PAYPAL_CLIENT_ID/SECRET`, `ADMIN_PASSWORD`, `PAYPAL_WEBHOOK_ID`), so no PayPal call is possible yet even if flags were on |
| Test photo | `paypal-sandbox-test-photo`, file `paypal-sandbox-test.jpg` (6095 bytes) present in the Sandbox R2 |
| Test price | **3.00 ILS** (sku `large`, 300 minor units; Sandbox `settings.prices` = small 1 / medium 2 / large 3) |

Blocked-state checks (all passed on the Preview): `/api/payments-status` → `{"enabled":false,"digitalEnabled":false}`; `/api/paypal/quote` → 3.00 ILS, `enabled:false`; unknown photo → 404; public `create-order` and `capture-order` → 503; admin route without auth → 401; production `/checkout/` → 404 and production `payments-status` unchanged.

## 2. What must be switched on, temporarily, and how

**On this Preview only** (never the main Sandbox Worker, `prep/...` or production):

- `PAYMENTS_ENABLED = "true"` and `DIGITAL_PAYPAL_ENABLED = "true"` (the public routes need BOTH exact strings).
- Mechanism: Claude sends a JSON Merge Patch to `PATCH /accounts/<id>/workers/workers/<worker>/previews/<preview>/deployments/latest` changing only those two `env` entries; omitted fields (assets, bindings, secrets) are inherited. Revert is the same call with `"false"`.
- Safe default: any new push to the PR branch triggers a Workers Builds redeploy from the config, which has both flags `false`, so a push closes the checkout by itself.
- While on, the Preview URL is public on workers.dev (unlisted): a visitor could start a Sandbox checkout (fake Sandbox money, Sandbox D1, no production data). Keep the window short (about 45 minutes) and do not post the URL. Protecting it with Cloudflare Access would create a new cloud resource and is not part of this plan.

**Needs from the owner before the window (no secrets in chat):**

1. Preview secrets (hidden-input commands, run from an empty folder; Preview name contains `/`, keep the quotes):
   `npx wrangler@4.149.0 preview secret put PAYPAL_CLIENT_ID --name "feature/digital-checkout-preparation-2026-10-13" --worker-name amit-photos-paypal-sandbox` (same for `PAYPAL_CLIENT_SECRET`, `ADMIN_PASSWORD`, and `PAYPAL_WEBHOOK_ID`). Values come from the Sandbox tab of developer.paypal.com (the Sandbox application chosen for this Preview and its dedicated webhook); `ADMIN_PASSWORD` may reuse the local `~/.sbx-admin-pw` value. Claude verifies only the secret NAMES.
2. Prefer a dedicated PayPal Sandbox webhook targeting `<Preview URL>/api/paypal/webhook`; do not redirect or overwrite the existing main-Sandbox webhook. If an isolated Sandbox app is needed to separate test delivery, propose it before creation. Its app credentials and webhook ID must match the Preview secrets. Creation/configuration requires owner authorization. Document destination-specific delivery if multiple Sandbox webhooks share one app/D1; a stored Event ID alone does not prove delivery to this Preview.
3. A Sandbox **personal buyer** account (developer.paypal.com → Testing Tools → Sandbox Accounts → Personal) able to pay in ILS with balance of at least 3.00; the email and password stay with the owner. A second buyer (or a funding source that fails) for the decline case, see T3. A phone for the mobile run.
4. No pushes to PR #155 during the window.

## 3. Test matrix

All runs use `paypal-sandbox-test-photo`, language HE then EN, desktop and phone.

| # | Case | Steps | Evidence Claude collects |
|---|---|---|---|
| T0 | Closed baseline | before flags | blocked checks above |
| T1 | Happy path | gallery → lightbox "personal license" → `/checkout/` → quote 3.00 ILS → consent → Continue to PayPal → buyer approves → return → page captures and shows the download link → download once | D1: one `paypal_orders` row `COMPLETED` with capture id; exactly one new `download_tokens` row (size `large`, amount 3); first download 200 JPEG 6095 bytes, second 410; PayPal-side order lookup; no bearer link in storage/analytics (DevTools) |
| T2 | Cancel | start checkout, cancel at PayPal → `/checkout/?cancelled=1` | order stays `CREATED`, no capture, no token, no approval event; page offers a clean retry without a duplicate charge |
| T3 | Decline | see note below | order not `COMPLETED`, no token, readable error and a safe retry, no double charge |
| T4 | Retry / dedup / lost response | (a) replay the completed PayPal order ID through the public capture API: same fulfillment/token (the browser removes approval parameters after success, so reloading the clean `/checkout/` URL is not this test). (b) 5 parallel public `capture-order` calls on the completed order. (c) API-created order approved by the buyer (the tab has no pending attempt, so the page refuses to capture: also the forged/mismatched-return case), then Claude runs the lost-response client (server completes, response ignored) followed by retries | one fulfillment, one token per capture id; `completed_at` and capture id unchanged; the repeated deliveries return the same URL |
| T5 | Price/consent guards | public `create-order` with a wrong `expectedAmountMinor` and with `licenseAccepted=false` | 409 `PRICE_CHANGED`; 400 `PERSONAL_LICENSE_ACCEPTANCE_REQUIRED`; no order created |
| T6 | Webhook | events for T1/T4 delivered to the Preview; PayPal Event Log **Resend** of one `CAPTURE.COMPLETED`; forged webhook | D1 `paypal_webhook_events`: `processed=1`; Resend → `duplicate:true` and no new order/token rows; forged → 400/401. The historical missing approval event stays a separate open check |
| T7 | Kill switch | after T1–T6 set the pair to (true,false), (false,true), then (false,false) | create/capture 503 in all three; `quote.enabled=false` and a disabled page when not both true; final state both `false` |
| T8 | Phone | repeat T1 and T2 on a real phone, HE and EN | screenshots, no horizontal scroll, buttons reachable (see the cookie-banner finding) |

**T3 decline note (updated after review).** The new code maps known `INSTRUMENT_DECLINED` and identity-matched `DECLINED` captures to HTTP 422 `PAYMENT_DECLINED`, with no entitlement or order-status write. The browser displays a specific refusal and an explicit return to product details; a fresh attempt requires consent again. Network/unknown failures retain same-order retry. Source mocks and browser mocks cover this; a real PayPal decline is still pending. A failing Sandbox buyer is best effort; if it cannot be produced, propose a separately reviewed, Sandbox-only deterministic negative-test mechanism before adding or enabling one. No mock header/hook exists in application code today.

## 4. Sequence and stop rules

1. Owner configures Preview secrets and its approved dedicated webhook; Claude checks secret names, runs the admin `sandbox-status` (expects `ok:true`) and T0.
2. Claude asks for the explicit "go" in chat, then flips both flags on, and runs T5 and the API parts of T4/T6 while the owner runs T1, T2, T3, T8.
3. Claude runs T7, restores both flags to `false` (even if a test failed), verifies public `create-order`/`capture-order` return 503, `payments-status` shows `enabled:false,digitalEnabled:false`, and the existing main-Sandbox webhook remains unchanged. Any temporary dedicated test webhook is disabled/cleaned up only with owner authorization.
4. Stop immediately and restore the flags if: a second token or capture appears for one order, an unexpected PayPal environment host appears, the page shows an error with a charge pending, or any non-Sandbox resource is touched.

## 5. Findings from the review (for the PR author)

- **Desktop overlap:** at 1280x800 on a first visit the cookie banner (`#cookie-notice`, `z-index` 99997, fixed, 74px) covers about 60% of the lightbox "Personal license details" button (button y 716–768, banner from y 726); only its top strip was clickable until dismissal. Fix: defer the notice while a dialog is open and restore it on close without recording consent. New browser regression scenarios cover 1280x800 and 360x640. Their first run on this fix is pending.
- **Public wording after merge:** `servePhotoPage` now links the standalone photo page "buy" button to `/checkout/` ("personal license details"); once merged, production would expose a disabled checkout preview page (production `/checkout/` is 404 today). That is a product decision.
- **`/api/payments-status`** gains `digitalEnabled`; the production health checks read `.enabled` through `jq`, so they stay compatible.
- **Production config:** `wrangler.toml` changes only by adding `DIGITAL_PAYPAL_ENABLED = "false"`.
- **Branch state:** 6 commits ahead of and 1 behind `main` (an automated image commit); no conflicts expected in the code paths above.

## 6. Not authorized

Merging, any production or `prep/...` change, a migration, PayPal Live, creating cloud resources, enabling flags before the owner's explicit approval.


## Author follow-up (supersedes the original code/QA snapshot above)

The original environment inspection describes deployed head `908a5a3`; after the cookie/decline code update, re-check the final PR head, checks and deployed file hashes before any live test. Documentation commit `15be7aa` is preserved. Source/API tests pass 108/108; the new 17-scenario mocked browser run is pending. Both payment flags remain false. No secrets, webhook configuration or real PayPal call were changed by the code author.
