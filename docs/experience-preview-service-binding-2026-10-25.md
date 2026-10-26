# Amit Photos — PR #181: private Sandbox ↔ public gallery service binding

## Verified problem
Read-only HTTP diagnostics in GitHub Actions, 25 Oct 2026:
- `https://amitphotos.com/api/photos` — HTTP 200, 2,310 public records. Experience path coverage: quiet 4/4, wonder 3/4, details 4/4, places 4/4.
- `https://www.amitphotos.com/api/photos` — HTTP 301.
- `https://amit-photos.erez-family.workers.dev/api/photos` — HTTP 404.
- The Sandbox Preview's `/api/experience-preview-photos` — HTTP 503.
The public catalogue is healthy; the Sandbox Worker cannot get it by its external subrequest. An in-zone Cloudflare Worker-to-Worker request may be restricted. This is the likely cause, not yet proven from Cloudflare runtime logs.

## Code prepared in this PR
`worker.js` supports an **optional** `env.PUBLIC_GALLERY_SERVICE.fetch` for this single preview-only, GET-only endpoint:
- Hostname must end in `-amit-photos-paypal-sandbox.erez-family.workers.dev`; production host gets 404.
- The binding sends `GET https://amitphotos.com/api/photos` **directly to the bound production Worker** (no browser redirect or public same-zone fetch).
- It accepts only a 200 JSON array of 1–5,000 rows, excludes explicitly unpublished photos, rewrites relative image URLs to public production asset URLs, returns 503 on any failure.
- The existing client `experiencePublicGalleryVerified` gate still requires a successful public API result; no JSON catalog fallback is used to unlock four experience cards.
- The existing direct HTTP fallback remains for environments without a binding. It has been observed to fail on the current Sandbox Preview.

## Cloudflare operator step — Sandbox only
Cloudflare account with `amit-photos-paypal-sandbox` and `amit-photos` Workers:
1. Open **Workers & Pages → amit-photos-paypal-sandbox → Settings → Bindings**.
2. Add a **Service binding** named `PUBLIC_GALLERY_SERVICE` targeting Worker **`amit-photos`** (production/default Worker), not the Sandbox Worker itself.
3. Save the Sandbox binding. If Cloudflare's Git integration or Wrangler controls Sandbox bindings declaratively, add only to the **Sandbox-specific configuration** used by its deployment, not the shared `wrangler.toml`. For example, the Sandbox-only section is:
   ```toml
   [[services]]
   binding = "PUBLIC_GALLERY_SERVICE"
   service = "amit-photos"
   ```
4. Redeploy the **Sandbox Preview** for the current PR head. Do not deploy to the production Worker, edit the main `wrangler.toml`, alter D1/R2, or change the payment flags.
5. Verify the actual Preview-host endpoint returns HTTP 200 + JSON public rows and at least 2 selected public IDs per route, then test `#experience` on iPhone (4 cards), 8 caption lightboxes, wall mockup, HE/EN, and GA4 event names without PII.

**Stop condition:** If the target `amit-photos` service has wrong environment/DB binding, or the Preview cannot inherit this binding, leave PR as Draft; do not redirect the Preview to the production DB or replace the published-photo check with `data/photos.json`.

## Verification and release safeguards
- Unit tests in `tests/experience-paths.test.mjs` cover no-binding fallback, binding success, unpublished filtering, production-host 404 and failure 503.
- PR must remain Draft until a real Preview HTTP 200 + visual QA is confirmed.
- No merchant checkout should be enabled. `PAYMENTS_ENABLED=false`.
- Investigate why Cloudflare's `amit-photos` production build check reports builds on PR branch commits. A successful build is not proof of active production release, but automatic PR-to-production promotion must be ruled out before merging.
- No changes to catalog, licensing, D1, PayPal, live purchases, or social cron schedules.

Cloudflare reference: https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/
