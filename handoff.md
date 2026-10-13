# Handoff — amit-photos

> מסמך כניסה לכל מי (אדם או סוכן AI) שנכנס לפרויקט הזה בפעם הראשונה, או חוזר אחרי הפסקה.
> עודכן: **12.10.2026**. זה מסמך חי — לעדכן אותו כשקורה משהו מהותי, לא לתת לו להתיישן.
> לא מחליף את `CLAUDE.md` (כללי ארכיטקטורה מחייבים) — משלים אותו עם "מה המצב עכשיו ולמה".

---

## Acquisition and caption quality review — 12.10.2026

### PR #151 MERGED; webhook check still OPEN — what PayPal's log must show (13.10.2026)

- **Merge:** PR #151 squash-merged 2026-10-13 08:36:10Z as `66c7650450f1706c283b0e0485ce097479ac72db`. Before merging: head still `83d8891` (unchanged since review), base = current `main` (0 behind), checks green (`paypal-orders-v2` incl. the new schema test, `verify-live`, both Cloudflare builds), 4 files changed.
- **Verified after merge:** `staging/paypal-sandbox-bootstrap.sql` on `main` creates `sort_order`, `redbubble_url`, `redbubble_products`, `zazzle_products` (nullable, no default) and `tests/paypal-sandbox-bootstrap-schema.test.mjs` is on `main`; checks on the merge commit all success (production `deploy`/`build`/`Workers Builds: amit-photos`, `Workers Builds: amit-photos-paypal-sandbox`, `paypal-orders-v2`). `/api/payments-status` → `{"enabled":false}` and `/api/photos` → 200 on production, the main Sandbox Worker, the main Preview and the PR-branch Preview. `prep/...` was not touched; no public checkout enabled; no real purchases.
- **Exceptions:** the three `scriptThrewException` at 06:22Z on 13.10 are my own `/api/photos` probes before the schema fix; none since.
- **Safe webhook checks on the main Sandbox Worker (writes nothing):** `GET /api/paypal/webhook` → 405; POST without PayPal headers → 400 `PAYPAL_WEBHOOK_HEADERS_MISSING`; POST with forged headers → 401 `PAYPAL_WEBHOOK_SIGNATURE_INVALID` (it called PayPal's verify endpoint with its own credentials and webhook id and rejected the forgery); 0 forged rows in D1. So the endpoint is alive and verifying. D1 still has exactly 10 events; no new event since 20:22:06Z yesterday and no webhook-shaped request reached either Worker since.

**Webhook test status: NOT COMPLETED.** Do not mark it done until the missing approval event is identified and its receipt is verified.

Known: two orders were created at 20:10Z and both approved (`5CE517938N245005R`, `8S923706NG623915A`); D1 stores only one approval event in that window, `WH-49K20677JR0351154-8HJ81455X2175163M` (20:15:34Z), and does not record which order it belongs to. The capture events for both orders ARE stored (20:16:56Z and 20:22:06Z).

**What only PayPal's log can tell (missing facts):**
1. Which order `WH-49K20677JR0351154-8HJ81455X2175163M` is for (`resource.id`) — this identifies which order lacks an approval event.
2. Whether PayPal generated a second `CHECKOUT.ORDER.APPROVED` event for 20:10–20:30 UTC (23:10–23:30 Israel): an Event ID not in the stored list (see the previous entry), and its `resource.id`.
3. For that event: delivery status, number of attempts, target URL(s), each attempt's HTTP status/response, and whether further retries are scheduled.
4. The configured webhook: URL (expected: the main Sandbox Worker), webhook id, and subscribed event types (must include `CHECKOUT.ORDER.APPROVED` and `PAYMENT.CAPTURE.COMPLETED`).

**Owner actions (PayPal Sandbox → Event Logs → Webhooks Events; Apps & Credentials → Default Application → Webhooks):**
- Open `WH-49K20677JR0351154-8HJ81455X2175163M` and read `resource.id`.
- List `CHECKOUT.ORDER.APPROVED` events for 20:10–20:30 UTC and note every Event ID not in the stored list; open each and copy `resource.id`, status, attempts, target URL, responses.
- Read the webhook's URL, id and subscribed events.
- Only if such an event exists and was not delivered/failed: Resend that single event, then tell Claude. If no second approval event exists at all, report that.

**Completion criteria (Claude verifies in D1):** the missing event is identified (Event ID + order), its delivery history is explained, and after delivery/Resend a `paypal_webhook_events` row exists for it with `processed=1`, `attempts=1`. If PayPal never generated the event, classify as PayPal-side/no event and keep the check open or reclassified explicitly; do not claim receipt.

**Other remaining checks (blocked until you act or decide):** buyer-side decline (needs a negative-testing Sandbox buyer/card); live public-checkout test (excluded: payments stay blocked); a fresh E2E on the main Sandbox Worker (needs its admin password and, ideally, `main` merged into `prep/...`, which is NOT done); Live gates in `docs/paypal-reactivation-gate-2026-10-01.md`.

### Sandbox `/api/photos` 500 (error 1101) fixed — Sandbox D1 schema; webhook-lookup guidance corrected — 13.10.2026

**Diagnosis (13.10, read-only first):** overnight analytics showed page-load bursts (5–14 requests/s) on the Preview and the main Sandbox Worker, each with one `scriptThrewException`. `GET /api/photos` returned `500 error code: 1101` on every Sandbox host (production returned 200). Cause: the Sandbox D1 `photos` table was created from the minimal `staging/paypal-sandbox-bootstrap.sql` (11 columns) and lacked `sort_order`, `redbubble_url`, `redbubble_products`, `zazzle_products` (production has 28 columns), so the public gallery query `SELECT * FROM photos WHERE published=1 ORDER BY CASE WHEN sort_order IS NULL …` failed with "no such column". Sandbox-only: not a production bug and unrelated to payments or webhooks. This also explains the earlier "unexplained" exceptions (19:52:13Z, 19:54:23Z, 20:19:06Z): they coincided with page loads.

**Fix (owner-approved, Sandbox D1 `7b027b93-c548-4ceb-bbe9-42c45264fc23` only):** `ALTER TABLE photos ADD COLUMN` for `sort_order INTEGER`, `redbubble_url TEXT`, `redbubble_products TEXT`, `zazzle_products TEXT` (types, nullability and defaults read from production `PRAGMA table_info`: all nullable, no default). Photos columns 11→15; the single fixture row `paypal-sandbox-test-photo` is intact. No production change, no Worker deploy needed.

**Verified (13.10 ~08:31Z):** `/api/photos` → HTTP 200 (589 bytes, the fixture only) on the main Sandbox Worker, the main Preview and the PR-branch Preview; production 200. 54 read-only page-load requests (`/`, `/api/photos`, `/api/payments-status`, `/api/new-badge-settings`, `/api/print/catalog`, `/manifest.json` ×3 on each host) all 200; analytics for that window show only `success` (sampled, lagging). All payment flags still `{"enabled":false}` (production, main Sandbox Worker, both Previews).

**Repo changes in this PR:** `staging/paypal-sandbox-bootstrap.sql` now creates the four columns (nullable, no default); new `tests/paypal-sandbox-bootstrap-schema.test.mjs` builds an in-memory SQLite (`node:sqlite`) from the bootstrap and runs the exact gallery SQL extracted from `worker.js` (4 tests: gallery queries succeed, columns nullable/no default with production types, the old 11-column table fails with "no such column: sort_order", bootstrap keeps its production guard). 4/4 pass; with the old bootstrap 2 fail. Added to `.github/workflows/node-tests.yml` (command and path filters).

**Webhook lookup guidance — corrected.** `8S923706NG623915A` is an ORDER id, not an event id. PayPal's event list is keyed by Event ID (`WH-…`); for `CHECKOUT.ORDER.APPROVED` the payload's `resource.id` is the order id. Also, two orders were created at 20:10Z (`5CE517938N245005R` and `8S923706NG623915A`) and both were approved, yet only ONE approval event was stored in that window (`WH-49K20677JR0351154-8HJ81455X2175163M`, 20:15:34Z), and D1 does not record which order it belongs to. So the missing approval may belong to either order; do not assume it is 8S92. Procedure: in PayPal Sandbox → Event Logs → Webhooks Events, list `CHECKOUT.ORDER.APPROVED` events for 20:10–20:30 UTC (23:10–23:30 Israel). Any listed Event ID that is NOT in the stored list below is the candidate; open it and read `resource.id`, delivery status, number of attempts, target URL and each response. Resend only an event whose Event ID is not stored.

Stored `paypal_webhook_events` Event IDs (all `processed=1`): APPROVED — `WH-1V299061PU205324K-8CS45455N36510847` (1.10 16:22Z), `WH-3DW46090AX223271F-3WH37029N4082601X` (12.10 16:25Z), `WH-73A08398VJ025992F-7XY4852971623321A` (19:51Z), `WH-09230807HB7685528-8DP55799KE797603U` (19:55Z), `WH-49K20677JR0351154-8HJ81455X2175163M` (20:15Z). CAPTURE.COMPLETED — `WH-1MP44136H5558474N-9UP265712S648283J` (1.10 16:23Z), `WH-09743415KA625370N-8S179175X9740110R` (12.10 16:28Z), `WH-8GU83919VA6577722-3CK946710C332394Y` (19:52Z), `WH-8WC64999VJ144172E-0C852122TL927803U` (20:16Z), `WH-23454860CV024225A-4E453826RT890973D` (20:22Z).

**Remaining PayPal checks:** (1) PayPal webhook log for the missing approval (above); confirm the webhook URL (should be the main Sandbox Worker) and its webhook id; (2) buyer-side decline; (3) live public-checkout test on a Sandbox-only Worker (needs a deliberate `PAYMENTS_ENABLED=true` only there); (4) repeat a basic E2E (create → approve → capture → download) on the main Sandbox Worker if it is brought to the fixed code; (5) the remaining Live gates.

**Recommendation on `prep/paypal-orders-v2-2026-10-01`:** update it (merge `main` into it) only after the owner decides to test the main Sandbox Worker end to end, because that Worker still runs the 1.10 code without the download-token fix and its only deploy path is that branch. Benefits: the Worker the webhook points at would run the tested code. Risks: its Production deploy runs automatically on push; its `wrangler.paypal-sandbox.toml` already has `PAYMENTS_ENABLED="false"`. If done, verify `/api/payments-status` `false`, secrets/bindings intact, `/api/photos` 200 and a quick E2E. Not required for this schema fix; not done.

### STATUS AT A GLANCE (end of 12.10.2026) and RESUME POINT FOR 13.10.2026

**State now (all verified live on 12.10 night):**
- **PR #149 is merged** (squash `3ff8922`). Includes the native Sandbox Preview config, the safe one-time download-token fix, the Sandbox template default `PAYMENTS_ENABLED="false"` with regression tests, and the E2E documentation.
- **Production (`amit-photos`) is healthy and deployed** from `3ff8922`: `https://amitphotos.com/api/payments-status` → `{"enabled":false}`.
- **Main's Sandbox Preview is fixed and healthy:** build `c155ee4a` succeeded; `https://main-amit-photos-paypal-sandbox.erez-family.workers.dev/api/payments-status` → `{"enabled":false}`; the `Workers Builds: amit-photos-paypal-sandbox` check on `main` is green.
- **The main Sandbox Worker (`amit-photos-paypal-sandbox`) still runs the 1.10 code** from `prep/paypal-orders-v2-2026-10-01` (no download-token fix). Only its payment flag was changed (`e69131f`), and it returns `{"enabled":false}`. `main` was deliberately NOT merged into `prep/...`.
- **No real purchases, no PayPal Live, no Gelato.** Every payment flag (production, main Sandbox Worker, both Previews) is `false`.

**All Live gaps remain OPEN** (merge did not close them): missing `CHECKOUT.ORDER.APPROVED` webhook for order `8S923706NG623915A` (needs PayPal's webhook event log); buyer-side decline not run; public `/api/paypal/*` checkout not exercised live; token is still spent if a transfer fails mid-stream after the atomic claim; unexplained Worker exceptions (19:52:13Z, 19:54:23Z, 20:19:06Z); the conditions in `docs/paypal-reactivation-gate-2026-10-01.md`.

**Resume tomorrow, in this order:**
1. Owner: read PayPal Sandbox → Event Logs → Webhooks Events for `8S923706NG623915A` (steps in the "Missing CHECKOUT.ORDER.APPROVED" entry) and report status, attempts, target URL(s), responses; optionally Resend. Claude then confirms receipt in D1 and closes or narrows gap 1.
2. Decide whether to bring `main` into `prep/...` (would redeploy the Sandbox Worker with the fix; its `wrangler.paypal-sandbox.toml` already has the flag set to `"false"`).
3. Decide whether to run the decline test (needs a Sandbox negative-testing buyer/card) and whether to run a live public-checkout check on a Sandbox-only Worker.
4. Optionally enable Worker observability temporarily to diagnose the three exceptions, and clean up stale Previews.
5. Do not enable payments or touch PayPal Live until the reactivation-gate document is satisfied.

### PR #149 MERGED — post-merge verification and main Preview fix — 12.10.2026 (night)

- **Merge:** squash-merged on 2026-10-12 20:29:44Z as `3ff89228262b2d1bf2b4516dcf4503d0c2fb6776` (head was `ee64376`; between the last code head `a20b844` and `ee64376` only `handoff.md` changed). Before merging, all four GitHub workflows ran green on the final head (`PayPal Orders v2 CI`, `Python Data Tests`, `Lead Funnel CI`, `Business Live Verification`, triggered via workflow_dispatch); the Cloudflare builds on that docs-only head were `skipped` (`[skip ci]`) and had been green on the identical code at `a20b844`. `main` has no branch protection / required checks. The PR branch was not deleted.
- **Production deploy (`amit-photos`):** `Workers Builds: amit-photos` success (build `203bb28a` on `3ff8922`), `Deploy Worker`, `build`/`deploy`, `PayPal Orders v2 CI` and Pages build all success; new Worker deployments 20:30:28Z and 20:30:33Z. Post-deploy: `https://amitphotos.com/api/payments-status` → `{"enabled":false}`, home 200, `/api/download/<bogus>` → 404. Production now contains the `handleDownload` fix.
- **Main's Sandbox Preview fixed (owner-approved; scope: this one Preview only):** Preview `0563e1568f294258addab3e1339cd379` (branch `main`) had `npx wrangler preview` (build `9949ff1e` on the merge commit failed with "missing a previews block"). PATCHed its `settings.deploy_command` to the same `--preview … wrangler@4.149.0 preview --worker-name amit-photos-paypal-sandbox` command as Previews Base and re-read it (matches base; the PR-branch Preview untouched). One verification build was started: `08fdc90d…` stayed in "initializing" for ~5.5 min and was `terminated` by the platform before running any command, so it proved nothing; one retry `c155ee4a-d703-4d00-aaa9-9e2db380dcf4` on `3ff8922` ran the correct command and **succeeded** (`Preview: main (updated)`, `https://main-amit-photos-paypal-sandbox.erez-family.workers.dev`).
- **Verified after that build:** the main Preview `/api/payments-status` → `{"enabled":false}`; its deployment env has Sandbox D1 `7b027b93-…`, R2 `amit-photos-paypal-sandbox-images`, Images, `PAYMENTS_ENABLED=false`, `PAYPAL_SANDBOX_CLEANUP_ENABLED=true`, **no secrets** (not needed for the build; its admin route is 401). The GitHub check `Workers Builds: amit-photos-paypal-sandbox` on `3ff8922` turned green (20:38:38Z). Main Sandbox Worker, PR-branch Preview and production all `{"enabled":false}`.
- **Not done on purpose:** `main` was NOT merged into `prep/paypal-orders-v2-2026-10-01`, so the main Sandbox Worker still runs the 1.10 code (without the download-token fix); only its payment flag was fixed earlier (`e69131f`, build `787462a9`). No real purchases, no PayPal Live.

**Remaining gaps / open items:**
1. Missing `CHECKOUT.ORDER.APPROVED` webhook for order `8S923706NG623915A`: neither Worker saw a webhook-shaped request (investigation entry below); needs PayPal's webhook event log (owner), optionally Resend. Also compare the configured webhook URL and id in PayPal.
2. Buyer-side decline not run; public `/api/paypal/*` checkout not exercised live; a transfer that fails mid-stream after the atomic claim still spends the token; unexplained Worker exceptions (Preview 19:52:13Z/19:54:23Z, main Sandbox Worker 20:19:06Z; observability off).
3. Main Sandbox Worker on 1.10 code; decide separately whether to bring `main` into `prep/...`.
4. The PR-branch Preview (`c3077f23…`, with its secrets and old order data) auto-deletes when its branch is deleted; ~90 other Previews hold stale command snapshots (only matter if rebuilt); new Previews inherit Previews Base, which has no secrets.
5. Live remains gated by `docs/paypal-reactivation-gate-2026-10-01.md`: digital-only flag separation, checkout UX, Live credentials/webhook, security review.
6. Local Windows PC: `python3` is a broken Store stub; 4 unrelated tests fail locally (CRLF) and pass in CI.

### Missing `CHECKOUT.ORDER.APPROVED` for order `8S923706NG623915A` — investigation (12.10.2026, ~20:25Z)

**What D1 shows:** `paypal_webhook_events` has `CHECKOUT.ORDER.APPROVED` at 19:51:03Z (order 2), 19:55:16Z (order 3), 20:15:34Z (one order), and `PAYMENT.CAPTURE.COMPLETED` at 19:52:26Z, 20:16:56Z, 20:22:06Z. There is no approval event for `8S923706NG623915A` (PayPal API says it IS approved: `approveUrl:null`; capture succeeded). D1 only keeps events that were received, signature-verified and leased, so a failed or never-delivered event leaves no row.

**What Cloudflare analytics shows (GraphQL `workersInvocationsAdaptive`, per-second, status + subrequest counts; no paths/bodies):** a webhook delivery looks like a request with 2–3 subrequests (PayPal token, verify, order GET).
- Main Sandbox Worker (versions `82f58ffb` dash-flag deploy and `ebc08272` prep deploy): webhook-shaped requests at 20:15:33 (2 sub), 20:16:55 (3 sub) and 20:22:06 (3 sub) only, exactly matching the three stored events. Nothing after 20:22:06 up to 20:25:46Z. Around 20:19:02–20:19:42 (right after the 20:18:57 deploy) there was a burst of ~30 requests, almost all with 0 subrequests (page/asset loads, not webhooks) and one `scriptThrewException` at 20:19:06; the path is not visible, so it is undiagnosed.
- Preview (versions `30688eb9`, `ffae6a83`, `fa4c2fc7`): between 20:19 and 20:22 only my own calls (2-subrequest lookup 20:21:23, lost-response capture 20:21:41, zero-subrequest retries 20:22:12/13). No webhook-shaped request.
- Conclusion: **no webhook-shaped delivery for 8S92's approval reached either Worker**, and no retry arrived in the ~4 minutes after. The Workers never saw it, so the gap is on the delivery side (PayPal not sent/delayed/failed before reaching Cloudflare) or the destination configured at that moment. Neither a response code nor PayPal's retry schedule can be read from Cloudflare; PayPal's webhook event log is required.
- Uncorrelated Worker exceptions (not payment calls: 0 subrequests, inside page-load bursts): Preview 19:52:13Z and 19:54:23Z, main 20:19:06Z. Not diagnosed; observability is disabled on both.

**Webhook destination / `PAYPAL_WEBHOOK_ID` match (inferred, not read):** secrets cannot be read. Events delivered 20:15:33, 20:16:55 and 20:22:06 reached the main Sandbox Worker and were verified (verification only succeeds with the matching webhook id) and stored as processed, so the main Worker's `PAYPAL_WEBHOOK_ID` matches the webhook that currently delivers there and the current destination is the main Worker URL. The Preview verified events at 19:51:03, 19:52:26 and 19:55:15 while the webhook pointed at it, so its id matched the same subscription then. Both Workers hold a `PAYPAL_WEBHOOK_ID`; the Preview copy is now unused. To confirm the configured URL and id, read them in the PayPal dashboard (owner).

**Which tests ran where:**
- Preview (Sandbox, fixed code, fed by branch builds): everything E2E: status, create-order/idempotency/parallel/timeouts, capture (normal, duplicate, before approval, abort-before-completion + 5 parallel retries, lost-response after completion), real download + one-time token, cleanup dry-run/apply, forged-webhook rejection, webhook receipt for the first two approvals/captures while the URL pointed at it.
- Main Sandbox Worker (1.10 `prep/...` code, no download-token fix): no E2E with credentials. Only unauthenticated `GET /api/payments-status` → `{"enabled":false}`, admin route 401, and it processed three real webhooks (approval 20:15:33, captures 20:16:55 and 20:22:06) with signature verification. The only changes made to it: dashboard flag edit (version `82f58ffb`) and commit `e69131f` build (version `ebc08272`).

**Owner steps (PayPal Sandbox):** open https://developer.paypal.com/dashboard (switch to Sandbox) → left menu **Event Logs** → **Webhooks Events**; if the direct link https://developer.paypal.com/dashboard/webhooksEvents does not open, use the menu. Filter by event type `CHECKOUT.ORDER.APPROVED` and time around 20:15–20:25 UTC (23:15–23:25 Israel). Find the event whose resource id is `8S923706NG623915A`, open it and note: delivery status, number of delivery attempts, target URL(s), and each attempt's HTTP status/response. If no such event exists, note that. Also open Apps & Credentials → Default Application → **Webhooks** and note the webhook URL and the webhook id. If the event exists but failed, use **Resend** (safe: the handler ignores approval events and dedupes by event id) and tell Claude, who will confirm receipt in D1.

### Item 11, scenario 2 — response lost AFTER the server completed: PASS (live, client-side simulation) — 12.10.2026 (night)

Order `8S923706NG623915A`, approved by the owner (PayPal-side lookup `approveUrl:null`). Baseline before the test: order `CREATED`, no capture/token, `download_tokens`=5, `COMPLETED` orders=5, `PAYMENT.CAPTURE.COMPLETED` events=4.

**How:** `lostresp.mjs` (kept outside the repo) opens a TLS connection to the Preview, sends one `capture-order` request, keeps the connection open for 12 s with no data handler (the response is never consumed by the client) and then closes the socket. Unlike the 0.3 s abort, the connection stays up, so the Worker is not cancelled and can finish normally.

**Server state verified BEFORE any retry** (D1 read 20:22:01Z; request sent 20:21:41Z, socket closed 20:21:53Z):
- order `COMPLETED`, `completed_at` 20:21:45Z (4 s after the request), capture id `4DK469867W176694H`, `fulfillment_token` `19a7f2c1…`, fulfillment JSON present;
- `download_tokens` row `19a7f2c1…` for that capture (size small, `used=0`); tokens 5→6, completed orders 5→6.

**Retries (client now reads the response):** two `capture-order` calls on the same order → both HTTP 200 with the same URL `/api/download/19a7f2c1-e473-41fe-9dee-1cdf68eda548`.

**After the retries (D1 read 20:22:28Z):** order unchanged (`completed_at` still 20:21:45Z, same capture id); exactly 1 token for capture `4DK469867W176694H`; tokens total still 6; completed orders still 6; exactly 1 order carries that capture id; exactly **one** new `PAYMENT.CAPTURE.COMPLETED` event (20:22:06Z, processed, attempts 1) → one PayPal capture, one fulfillment, one token. No second capture or fulfillment was created.

**Limits of this evidence:**
- The "lost response" is simulated at the client (response left unread, connection then dropped); it is not real network packet loss or an edge failure. `bytesRead` reported 947, which is TLS/TCP-level buffering inside Node, not an application read; the application never processed the response.
- Only one run, one order. The earlier 0.3 s abort (scenario 1, disconnect before completion) and this scenario together cover both orderings, each with live evidence.
- The `CHECKOUT.ORDER.APPROVED` webhook for this order is NOT in D1 (the last approval event stored is 20:15:34Z for the previous order); the order is nonetheless approved per PayPal's API. Unexplained — possibly delivery during the 20:18:57Z redeploy or not retried yet; it does not affect this test, but it is a webhook-delivery gap to check in PayPal's webhook event log.

**Remaining gaps (conditions to review before Live):** buyer-side decline not run; public `/api/paypal/*` checkout not exercised live; webhook receipt by the Preview is circumstantial and one approval webhook did not arrive; a transfer that fails mid-stream after the atomic claim still spends the token; main's own Sandbox Preview still has the stale command (fix after merge); main Sandbox Worker runs 1.10 code without the download-token fix; not Live-ready per `docs/paypal-reactivation-gate-2026-10-01.md`. PR #149 not merged; no real purchases.

### Item 11 capture timeout/retry/parallel + gap 6 closed on `prep/...` — 12.10.2026 (night)

**Order `5CE517938N245005R`** (approved by the owner; PayPal-side lookup `approveUrl:null`; webhook `CHECKOUT.ORDER.APPROVED` 20:15:34Z). Baseline: order `CREATED`, no capture/token, `download_tokens`=4.

Two different failure modes, kept apart:
1. **Client disconnect BEFORE the server completes — PASS (live evidence).** `curl --max-time 0.3` on `capture-order`: no response received (http 000, exit 28). Three D1 snapshots over ~15 s: order still `CREATED`, no capture id, no fulfillment token, tokens still 4, so the Worker did not complete the operation and left no partial state. Then 5 parallel retries of the same capture: all 5 returned HTTP 200 with the **same** download URL; D1 shows exactly **one** new `download_tokens` row (4→5, `909be6b8…`, tx = capture id `6M5954660W557714D`), exactly one capture id, order `COMPLETED` (20:16:44Z), and exactly **one** new `PAYMENT.CAPTURE.COMPLETED` webhook event (20:16:56Z, processed, attempts 1) — i.e. one PayPal capture, one fulfillment, one token.
2. **Response lost AFTER the server completed — NOT proven live.** The 0.3 s abort did not reach completion, so it exercised case 1 only. Evidence for case 2 is limited to unit tests that simulate it (`capture-order recovers from ORDER_ALREADY_CAPTURED by reading the authoritative PayPal order`, `resume from FULFILLING reuses the locked fulfillment token`, `verified completed-capture webhook recovers a local digital order`, plus the earlier live repeat-capture-after-success returning the same token). A live proof needs a client that sends the request, lets the server finish, and discards the response (not an abort, because the Worker is cancelled on disconnect), against another approved order. Candidate: order `8S923706NG623915A` (created, not yet approved).

Earlier live retry evidence (create-order) is unchanged: client abort at 0.25 s → request not completed → retry created 1 order; 5 parallel create-orders with one key → 1 order, 1 D1 row.

**Gap 6 closed on the Sandbox Worker's Production branch (owner-approved):**
- Commit `e69131f` on `prep/paypal-orders-v2-2026-10-01` changed only `wrangler.paypal-sandbox.toml` line 12: `PAYMENTS_ENABLED = "true"` → `"false"` (diff = 1 line; `keep_vars`, cleanup flag, bindings untouched).
- It triggered Sandbox build `787462a9-79d7-45a3-aff4-7d49e4aec6c7` (`wrangler@4.4.0 deploy --config wrangler.paypal-sandbox.toml`): success, version `ebc08272-0fdc-4b04-a04b-6634fec46743`, deployed 20:18:57Z. Log lists `PAYMENTS_ENABLED: "false"`, `PAYPAL_SANDBOX_CLEANUP_ENABLED: "true"`.
- After deploy: all four secrets and D1/R2/Images bindings intact; `https://amit-photos-paypal-sandbox.erez-family.workers.dev/api/payments-status` → `{"enabled":false}`; its admin route still 401 without a password; Preview and production also `false`.
- Side checks: the commit also ran the `Workers Builds: amit-photos` check (success; a non-production-branch build of the production Worker's trigger); the production `amit-photos` Worker's latest deployment is still 2026-10-12 18:42:04Z (before this change), so production was not redeployed. PR #149 not merged; no real purchases.
- Note: the main Sandbox Worker still runs the 1.10 `prep/...` code (no download-token fix) — only the flag changed.

### Gap 6 (payment-flag default) and item 11 (timeout/retry) — 12.10.2026 (night)

**Gap 6, partially closed.**
- `wrangler.paypal-sandbox.example.toml` now ships `PAYMENTS_ENABLED = "false"` (E2E uses the admin routes, which work with the flag off); docs updated. Because the generator copies this TOML, the manual workflow output and Preview config now keep public checkout closed at top level too.
- Manual workflow `.github/workflows/paypal-sandbox-staging.yml` audited: no `--var`, no `--define`, no env or step that sets `PAYMENTS_ENABLED`; its only mention is the guard that production `wrangler.toml` stays `"false"`; it deploys only the generated ephemeral config.
- Regression tests (`tests/paypal-staging-isolation.test.mjs`): template has exactly one flag line equal to `"false"` (fails on the old TOML, verified); both generator modes emit top-level `vars.PAYMENTS_ENABLED === 'false'`; the workflow has no override and only deploys the generated config. `.github/workflows/node-tests.yml` now also runs `download-token-consumption` and `payments-feature-flag`, which were previously not in any PR CI.
- **Still open — not changed on purpose:** the main Sandbox Worker's own Production build deploys `npx wrangler@4.4.0 deploy --config wrangler.paypal-sandbox.toml` from branch `prep/paypal-orders-v2-2026-10-01`. That file (not in this PR) still has `PAYMENTS_ENABLED = "true"` with `keep_vars = true`; `keep_vars` only stops deletion of dashboard-only vars, a var defined in the TOML is re-applied on deploy. So a push to `prep/...` re-opens public Sandbox checkout (the dashboard `false` is overwritten). Fix needs a one-line commit to `prep/...` (which would also trigger a Sandbox production build) — requires explicit approval; not done.

**Item 11 (timeout/retry) — status and evidence**
- Existing unit tests (CI green): create-order reuse for the same Idempotency-Key; resume from `FULFILLING` reuses the locked token; capture recovery from `ORDER_ALREADY_CAPTURED`; webhook stale-lease reclaim; lease release on processing failure; concurrent duplicate webhook.
- Live on the Preview (Sandbox):
  - Client timeout on create-order: `curl --max-time 0.25` aborted (exit 28, no response); retry with the same key → 201 `5CE517938N245005R`; third call → 200 `reused:true`; D1 has exactly 1 row for the key. Note: the abort cancelled the request before the Worker finished, so this proves safe retry after a cancelled request, not "server finished but client lost the response".
  - Concurrent retries: 5 simultaneous create-orders with one key → one 201 and four 200 `reused:true`, a single PayPal order `8S923706NG623915A`, 1 D1 row.
  - Capture retry after success (round 1 and 2): second capture returned the same token, token count unchanged.
- **Not yet proven live:** capture with a client-side timeout followed by retry/parallel captures. Prepared: unapproved order `5CE517938N245005R` (owner approves via `https://www.sandbox.paypal.com/checkoutnow?token=5CE517938N245005R`; do NOT use order 3). Then Claude aborts a capture at ~0.25s, retries, and fires 5 parallel captures; pass = one fulfillment, one new `download_tokens` row, order `COMPLETED`.

**Local test note:** 412 tests ran on this Windows machine with 4 failures (`admin-dialog-accessibility` ×2, `purchase-disabled-ux`, `social-attribution-links`); the same 4 fail on a clean `origin/main` checkout here (Windows/CRLF), and CI is green on Linux. `paypal-staging-isolation` needs `python3`, which is only a Store stub here, so it is verified by CI.

### FINAL REPORT — PR #149 Sandbox Preview + PayPal Sandbox E2E (12.10.2026) — not merged

**Verified (with evidence in the entries below):**
- Root cause of the old Sandbox build command: each Worker Preview keeps its own copy of the base command taken when the Preview was created; this branch's Preview kept `wrangler@4.4.0 versions upload`. Fixed by updating only that Preview's command; build `3b7255d1…` then `230e0195…` ran `wrangler 4.149.0 preview --worker-name amit-photos-paypal-sandbox` and succeeded.
- Native Preview isolation: Sandbox D1 `7b027b93-…`, R2 `amit-photos-paypal-sandbox-images`, Images, `PAYMENTS_ENABLED=false`; production D1 rejected by the generator. Worker is on Worker Previews; Production branch `prep/paypal-orders-v2-2026-10-01` and its production command were never changed.
- PayPal Sandbox E2E through the admin-only routes with public payments off: sandbox-status, create-order (+ Idempotency-Key reuse, bad key), buyer approval, capture, order/token rows, **real file delivery** (6095-byte JPEG, byte-identical), one-time token (second GET 410), duplicate capture, capture before approval (502, order untouched), malformed/unknown ids (400/404), buyer cancel (no capture, no token, no approval event), webhook `CHECKOUT.ORDER.APPROVED` + `PAYMENT.CAPTURE.COMPLETED` received and processed (`processed=1`, attempts 1), forged webhook rejected (400/401), cleanup (dry-run, then exactly 3 abandoned 1.10 test orders deleted; completed orders/tokens/events untouched).
- Code fix: `handleDownload` no longer burns the one-time token on a missing R2 object (404) or R2 read error (503) and claims it atomically (`UPDATE … WHERE used = 0`); the old code also let parallel requests both succeed. 7 new tests (6 fail on the old code). CI on `4b60b14`: all six checks green.
- Payments flags at report time: main Sandbox Worker, the Preview and production `/api/payments-status` all `{"enabled":false}`. No production Worker/config/D1 data/route/cron change; no PayPal Live, no Gelato, no real purchase.

**Remaining gaps (open):**
1. **Buyer-side decline/negative card (item 10c) not run** (needs a Sandbox negative-testing buyer or card).
2. **Webhook attribution is circumstantial.** D1 is shared and event rows hold no worker id; "received by the Preview" rests on the owner pointing the only webhook at the Preview plus timing. Not captured: PayPal's delivery log (200 from the Preview URL) and a live "Resend" showing `duplicate:true`. The webhook was restored to the main Sandbox Worker (owner-confirmed; not independently verifiable by Claude until the next event arrives).
3. **Public checkout path not exercised live.** E2E used `/api/admin/paypal/*` with `PAYMENTS_ENABLED=false`. The public `/api/paypal/create-order|capture-order` routes (rate limit, CORS, payments gate) are covered only by unit tests; a live check would need the flag on, which was deliberately avoided.
4. **Order `6WS827844D284583C` was approved by mistake and never captured** (inferred from webhook + `approveUrl:null`); it will expire; it stays `CREATED` in D1 until Sandbox cleanup removes it after 7 days.
5. **Stale per-Preview commands.** Main's own Sandbox Preview (`0563e156…`) still runs `npx wrangler preview` and fails ("missing a previews block"), so `Workers Builds: amit-photos-paypal-sandbox` is red on `main`; fix after this PR merges (the helper on main lacks `--preview`). ~90 other Previews hold old snapshots; new Previews use Previews Base, which has no secrets, so each needs `wrangler preview secret put` before E2E.
6. (Partially closed by commit 841acbf; the prep-branch TOML still has `"true"`, see the entry above.) **Main Sandbox Worker runs 1.10 code** (no download-token fix, last code deploy from `prep/...`). Its `PAYMENTS_ENABLED=false` was set in the dashboard, so **any redeploy from `prep/...` or the manual workflow re-applies `PAYMENTS_ENABLED="true"` from the TOML** (`wrangler.paypal-sandbox.example.toml` still has `"true"`). Decide whether to change the TOML default or only deploy with care.
7. **Residual download risk:** if a transfer fails mid-stream after the atomic claim, the token is spent (rare; no replacement flow).
8. **Preview `PAYPAL_WEBHOOK_ID` secret is now unused** (webhook points back to the main Sandbox Worker) and can be deleted with `wrangler preview secret delete` if desired. Local `python3` on the owner's PC is a broken Store stub, so Python-based tests only run in CI.
9. **Not Live-ready.** Real-money activation still depends on `docs/paypal-reactivation-gate-2026-10-01.md` (digital-only flag separation, checkout UX, Live credentials/webhook, security gate). Nothing here changes that.

**Next precise step for the owner:** review PR #149 and decide on merge (all checks green, mergeable). Then ask Claude to fix main's Sandbox Preview command. Optional before merge: screenshot PayPal's webhook delivery log, and run the decline test.

### Item 9 (buyer cancel) — PASS on retest, order `7AT61812JF3543355` — 12.10.2026

Owner opened the checkout for the new order and clicked Cancel without approving (the click itself is owner-attested: the cancel page is static and logs nothing). Server-side verification afterwards:
- D1: order `7AT61812JF3543355` `CREATED`, `paypal_capture_id`/`fulfillment_token`/`fulfillment_json`/`completed_at` all empty; `download_tokens` count still 4.
- Webhooks: no event received after 19:55:16Z (last is the earlier `CHECKOUT.ORDER.APPROVED`), so no approval or capture event for this order; PayPal sends none on cancel.
- PayPal-side (read-only same-key lookup, no create/capture): `approveUrl` is still present, i.e. the order was never approved. **Contrast with order 3** (`6WS827844D284583C`), whose lookup returns `approveUrl:null`, which supports the earlier conclusion that order 3 was approved by mistake (still uncaptured, left to expire/cleanup).
- `/api/paypal/cancelled` renders (200); production `/api/payments-status` still `{"enabled":false}`.
- Item 9 therefore passes: cancel leaves no capture and no download token. Remaining: item 10c buyer-side decline (needs a Sandbox negative-testing card), restoring the PayPal Sandbox webhook URL to the main Sandbox Worker, PR #149 review/merge decision, and the final summary report.

### Item 9 (buyer cancel) — first attempt inconclusive; order 3 was approved by mistake — 12.10.2026

Owner opened the checkout for order `6WS827844D284583C` (created 19:53:01Z for the cancel test) and saw "PayPal Sandbox checkout cancelled — No capture was attempted", but may also have approved an order before cancelling. Read-only findings:
- **Webhook events since 19:50Z:** `CHECKOUT.ORDER.APPROVED` 19:51:03Z (order `656160943N702021D`, the intended approval), `PAYMENT.CAPTURE.COMPLETED` 19:52:26Z (that same order), and a **second** `CHECKOUT.ORDER.APPROVED` at **19:55:16Z** (`WH-09230807HB7685528-…`, processed, attempts 1), i.e. an approval that happened after order 3 was created. PayPal sends no webhook for a cancel. D1 stores no order id per event, so the event itself does not name the order.
- **D1:** order 3 `6WS827844D284583C` is `CREATED`, `paypal_capture_id` NULL, `fulfillment_token` NULL, `fulfillment_json` NULL, `completed_at` NULL; `download_tokens` count still 4 (no new token); the three other orders unchanged.
- **PayPal-side status (read-only same-Idempotency-Key lookup, `reused:true`, no create/capture):** orders 1 (`51U86380482741620`), 2 (`656160943N702021D`) and 3 (`6WS827844D284583C`) all return `approveUrl:null`, meaning PayPal no longer offers a payer approval link. For a merely cancelled/unapproved order the link would still be present. Order 3 therefore behaves like an **approved** order; combined with the 19:55:16Z approval event and the fact that order 3 is the only order created after 19:51 that could still be approved (the 1.10 orders are expired), the best-supported conclusion is that **order 3 was approved, not cancelled**. Caveat: PayPal's order JSON was not read directly (no credentials for Claude); this is inferred.
- The "cancelled" page is static (`handlePayPalCheckoutReturn` renders text only, touches no DB, carries no order id), so it proves nothing about which order was cancelled.
- **Action taken:** no capture was attempted on order 3 (instructed not to). It stays approved-and-uncaptured and will expire; it can be ignored or removed by the Sandbox cleanup after 7 days (status `CREATED`, no capture).
- **Retest:** new order `7AT61812JF3543355` created (key in `~/.sbx-e2e-key4`) for a clean cancel test: owner opens `https://www.sandbox.paypal.com/checkoutnow?token=7AT61812JF3543355` and clicks Cancel **without approving**. Pass criteria: no new `CHECKOUT.ORDER.APPROVED` event, order stays `CREATED` with no capture/token, `approveUrl` still present on a same-key lookup, token count still 4.

### PayPal Sandbox E2E round 2 results — 12.10.2026 (evening, Preview on fixed code `4b60b14`)

Preview: `https://docs-sandbox-preview-build-verificat-amit-photos-paypal-sandbox.erez-family.workers.dev`. Preview env: Sandbox D1/R2/Images, `PAYMENTS_ENABLED=false`, `PAYPAL_SANDBOX_CLEANUP_ENABLED=true`, secrets `ADMIN_PASSWORD`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID` (names verified via API; the PayPal Sandbox webhook was re-pointed to the Preview by the owner). Order `656160943N702021D` (1 ILS = 100 agorot), approved by the owner.

| # | Item | Result | Evidence |
|---|------|--------|----------|
| 4 | capture | PASS | 200 `{url:/api/download/b8867b6d-…}`; order `COMPLETED`, capture id set, `completed_at` 19:52:07Z |
| 6 | token row | PASS | `download_tokens` +1 (total 4), size small, amount 1 |
| 7 | real file delivery + one-time | **PASS** | 1st GET 200, `image/jpeg`, 6095 bytes, `Cache-Control: no-store`, attachment filename, byte-identical to the uploaded fixture; 2nd GET 410 "already used"; unknown token 404. Missing-file/R2-error/parallel behaviour covered by 7 unit tests (6/7 failed on the old code). |
| 8 | duplicate capture | PASS | repeat capture → 200 same token; token count unchanged |
| 10a | capture before buyer approval (order `6WS827844D284583C`) | PASS | 502 `PayPal capture failed`; order stays `CREATED`, no capture id, no fulfillment token |
| 10b | malformed / unknown order id | PASS | 400 `paypalOrderId לא תקין`; 404 `הזמנה לא נמצאה` |
| 11 | retry | PASS | same Idempotency-Key → `reused:true` (round 1); repeat capture idempotent (item 8) |
| 12 | webhook in the Preview | PASS (see caveat) | After re-pointing the webhook, D1 shows `CHECKOUT.ORDER.APPROVED` (19:51:03Z) and `PAYMENT.CAPTURE.COMPLETED` (19:52:26Z, `WH-8GU83919VA6577722-3CK946710C332394Y`), both `processed=1`, `attempts=1`, received after the Preview deployment that added `PAYPAL_WEBHOOK_ID` (19:50:05Z). Live negative checks on the Preview: no PayPal headers → 400 `PAYPAL_WEBHOOK_HEADERS_MISSING`; forged headers → 401 `PAYPAL_WEBHOOK_SIGNATURE_INVALID` (the Preview called PayPal's verify endpoint with its own webhook id and was rejected). Unit tests also cover invalid signature, dedupe, stale lease, concurrent duplicate, recovery. **Caveat:** D1 is shared and rows carry no worker id; "received by the Preview" rests on the owner having switched the only webhook URL to the Preview plus the timing above. Optional stronger proof: PayPal dashboard → Webhooks events → the CAPTURE.COMPLETED event → delivery log (200 from the Preview URL); "Resend" should return `{"ok":true,"duplicate":true}`. |
| 13 | cleanup | PASS | GET → 405; unauthenticated → 401; dry-run candidates `abandonedOrders:3, processedWebhookEvents:0`. A read-only D1 query showed those 3 were exactly the `CREATED` orders from 1.10 with no capture/token/`completed_at`, all for `paypal-sandbox-test-photo` (no order for any other photo exists in this D1). Apply deleted exactly 3 (`4BK91476MF489891N`, `3F137366PY9968258`, `6AR27897JN366411W`); completed orders (4), tokens (4) and webhook events (6) unchanged; second dry-run → 0 candidates. |
| 14 | production unaffected | PASS (limited) | `https://amitphotos.com/api/payments-status` → `{"enabled":false}`; main Sandbox Worker and Preview also `false`. Production D1 `802379c7-…` was only read for table-name metadata (no data read or written by Claude); no production config, route, cron or payment change. |

**Not yet done:**
- Item 9 buyer cancel: order `6WS827844D284583C` is created and unapproved, ready for the owner to open `https://www.sandbox.paypal.com/checkoutnow?token=6WS827844D284583C` and click Cancel; then confirm `/api/paypal/cancelled` renders and the order stays `CREATED`.
- Item 10c buyer-side decline: needs a Sandbox negative-testing buyer/card (owner action).
- **Restore the PayPal Sandbox webhook URL to the main Sandbox Worker** (`https://amit-photos-paypal-sandbox.erez-family.workers.dev/api/paypal/webhook`) when testing is finished. Until then the main Sandbox Worker receives no events.
- PR #149 still open and unmerged; CI on commit `4b60b14`: all six checks green (Sandbox and `amit-photos` Cloudflare builds, `paypal-orders-v2`, `lead-funnel`, `verify-live`, `python-data-tests`); final summary report pending.
- After merge: fix main's own Sandbox Preview (`0563e156…`).

### Round 2 (12.10.2026, late): download-token fix, R2 fixture, Preview redeploy — in progress

- **Amount correction:** order amounts are stored in minor units; `amount_expected=100` means 100 agorot = **1 ILS** (not 100 ILS).
- **Main Sandbox Worker:** owner set `PAYMENTS_ENABLED=false`; verified `/api/payments-status` → `{"enabled":false}`, admin route still 401 without password, all secrets/bindings intact. Preview and production also `false`.
- **Code fix (commit `4b60b14`, PR #149):** `handleDownload` no longer consumes the token on a missing R2 object (404) or an R2 read error (503); it reads the object first, then claims the token with `UPDATE … WHERE used = 0` and requires `changes > 0`, so parallel requests cannot both succeed (losers get 410 and cancel their stream). Previously the mark-used step ran first and was non-atomic. New `tests/download-token-consumption.test.mjs` (7 tests: missing file, R2 failure, retry after restore, transient failure then retry, 5 parallel requests → exactly one 200 + four 410, used token short-circuit, Drive fallback). 7/7 pass on the fix; against the old code 6/7 fail (including the parallel case, so the race was real). `payments-feature-flag` (11) and `paypal-orders-v2` (31) pass locally; `paypal-staging-isolation` needs `python3` (broken Store stub on this PC), left to CI.
- Sandbox-only Preview config now also sets `PAYPAL_SANDBOX_CLEANUP_ENABLED=true` (admin-authenticated, dry-run by default).
- **R2 fixture uploaded** to `amit-photos-paypal-sandbox-images/paypal-sandbox-test.jpg` (6095 bytes, Sandbox bucket only).
- **Preview rebuilt:** build `230e0195-987b-456a-90cc-aaa59c2c905a` on `4b60b14`, success, same `wrangler 4.149.0 preview` command; the three Preview secrets persisted across the redeploy; `PAYPAL_SANDBOX_CLEANUP_ENABLED=true`, `PAYMENTS_ENABLED=false` in the Preview env.
- New order `656160943N702021D` created for the retest; awaiting buyer approval and the Preview webhook setup (see below). Results of items 7 (file delivery), 9–14 follow in the next entry.

### PayPal Sandbox E2E items 1–8 on the PR Preview — 12.10.2026 (night)

Target: Preview of this branch (`https://docs-sandbox-preview-build-verificat-amit-photos-paypal-sandbox.erez-family.workers.dev`), admin routes only, `PAYMENTS_ENABLED=false`, shared Sandbox D1 `7b027b93-…`. Preview secrets `ADMIN_PASSWORD`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` were added by the owner with `wrangler preview secret put --name <branch> --worker-name amit-photos-paypal-sandbox` (verified by name only via API). First credential entry failed PayPal auth (value problem); re-entered with trimming and passed. Order used: `51U86380482741620` (1 ILS test photo), approved by the owner with a Sandbox buyer.

| # | Item | Result | Evidence |
|---|------|--------|----------|
| 1 | sandbox-status | PASS | `ok:true, environment:sandbox, paymentsEnabled:false, credentialsConfigured:true` (200); without password 401 |
| 2 | create-order + Idempotency-Key | PASS | 201 `51U86380482741620` + approveUrl; same key → 200 `reused:true`, same id; invalid key → 400 |
| 3 | buyer approval | PASS (manual) | Owner saw "PayPal Sandbox approval complete"; webhook `CHECKOUT.ORDER.APPROVED` stored `processed=1` at 16:25:44 |
| 4 | capture | PASS | 200 `{url:/api/download/<token>, title}` |
| 5 | `paypal_orders` | PASS | row `COMPLETED`, amount_expected=100 minor units (100 agorot = 1 ILS), capture id and fulfillment token present, `completed_at` set |
| 6 | `download_tokens` | PASS | one new row (size small, amount 1, ~24h expiry, `used=0` before download); total 2→3 |
| 7 | one-time download | PARTIAL | 1st GET → 404 `קובץ לא נמצא ב-R2`; 2nd GET → 410 `כבר שומש`; unknown token → 404. One-time semantics proven; **file delivery NOT proven** |
| 8 | duplicate capture | PASS | 2nd capture → 200 same url/token; token count stayed 3, order still `COMPLETED` |

**Blocker/finding for item 7:** the Sandbox R2 bucket `amit-photos-paypal-sandbox-images` is empty. The fixture photo row points to `r2_key=paypal-sandbox-test.jpg`, which does not exist. `handleDownload` (`worker.js`) marks the token `used` *before* reading R2 ("prevents reuse even if fetch fails"), so a missing file burns the buyer's token. This is the current design, not changed here. Product risk to consider before real payments: a transient R2 miss permanently consumes a paid download link. Consider marking used only after the object is found, or issuing a replacement.

**Observed side facts:** the Sandbox D1 is shared by the Sandbox Worker and every Preview, and also holds earlier 1.10 test orders (2 other `COMPLETED`). The 16:25 webhook was received by a Worker holding `PAYPAL_WEBHOOK_ID` (only the main Sandbox Worker has it; the Preview does not) and was signature-verified and processed, so item 12 is partially evidenced against the main Sandbox Worker, not against the Preview. No `PAYMENT.CAPTURE.COMPLETED` event for the new capture had arrived at last check.

**Still open:**
- Items 9–14 not run. 9–10 need buyer-side cancel/decline actions by the owner; 11 timeout/retry design; 12 needs `PAYPAL_WEBHOOK_ID` on the Preview plus a Sandbox webhook pointing at it; 13 needs `PAYPAL_SANDBOX_CLEANUP_ENABLED=true` on the Preview; 14 final check below.
- Upload a small test JPEG to R2 key `paypal-sandbox-test.jpg` in the Sandbox bucket (owner approval pending), then repeat create → approve → capture → download to prove file delivery and the full item 7.
- Main Sandbox Worker `PAYMENTS_ENABLED` is still `true` (owner to set `false` in the dashboard, Production variables). Not done yet.
- PR #149 stays open; main's Sandbox Preview fix deferred until after merge. No production change; production `/api/payments-status` was `{"enabled":false}`.

### Sandbox Preview build root cause (corrected) and PayPal E2E readiness — 12.10.2026 (night)

Supersedes the earlier "root cause found" entry, whose Production-branch concern was wrong.

**Proven via Cloudflare API (read-only unless stated):**
- The real Worker `amit-photos-paypal-sandbox` has script tag `cd58f34c813d48689b3f6b51223e511f`. It is already on Worker Previews (`previews_enabled=true`). Its Production branch is `prep/paypal-orders-v2-2026-10-01` with deploy command `npx wrangler@4.4.0 deploy --config wrangler.paypal-sandbox.toml`. **Both unchanged; there is no Production-branch discrepancy.** Last production deploy was 1.10 16:42 UTC.
- Its **Previews Base** `deploy_command` is the intended 4.149.0 `--preview --worker-name` command (matches what the user saw in the dashboard).
- Each Preview stores its own copy (`settings`) of the base command, captured when the Preview is created. The PR branch's Preview (`preview_id` `c3077f23a7fc47779eaaa1c86ebed24a`, created 12:26:26 UTC at the first push) kept the old `wrangler@4.4.0 versions upload` copy, so editing Previews Base did not affect it. That is why builds `0e7e335f`, `7eea2123` etc. ran the old command.
- The Builds API presents a Preview's settings under that preview id as `external_script_id` / `production_settings`, which made it look like a Worker's production config. It is not. Earlier "production_settings changed / Production branch is the PR branch" statements were a misreading and are retracted.
- **Change made:** PATCHed only that Preview's `deploy_command` to the 4.149.0 `--preview` command, then ran one manual build `3b7255d1-5a53-4868-8038-34b123970970` on `49e0629`: success, Preview URL `https://docs-sandbox-preview-build-verificat-amit-photos-paypal-sandbox.erez-family.workers.dev`, `/api/payments-status` = `{"enabled":false}`. Push-triggered build `4b07f3c5` on this docs commit was skipped (`[skip ci]`).
- **Side finding:** the Preview for `main` (`0563e156…`) still has the stale `npx wrangler preview`; build `064d3438` fails with "missing a previews block", which is why `Workers Builds: amit-photos-paypal-sandbox` is red on main. The helper on main has no `--preview` option yet, so patch main's Preview only after PR #149 merges (needs explicit approval). 90+ other Previews hold old snapshots; they are only relevant if rebuilt.

**PayPal Sandbox E2E readiness (plan: `docs/paypal-sandbox-staging-2026-10-01.md`; code: `paypal-orders.js`, `worker.js` ~L7978):**
- Safe path exists: `/api/admin/paypal/{sandbox-status,create-order,capture-order,cleanup}` are behind `checkAuth` (session or `X-Admin-Password`) and run with `allowWhenPaymentsDisabled`. E2E therefore needs NO public enablement; keep `PAYMENTS_ENABLED=false`. Create-order returns an approve URL for the Sandbox buyer.
- The Sandbox Worker itself (`amit-photos-paypal-sandbox.erez-family.workers.dev`) has all four secrets (`ADMIN_PASSWORD`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`) and `PAYPAL_SANDBOX_CLEANUP_ENABLED=true`, but ALSO `PAYMENTS_ENABLED=true`: `/api/payments-status` returns `{"enabled":true}` publicly (Sandbox PayPal only, fake money, running 1.10 prep-branch code). Not changed; owner should decide whether to close it.
- The PR Preview has D1/R2/Images and `PAYMENTS_ENABLED=false` only. **No secrets**, so its admin routes and PayPal calls cannot work there until `ADMIN_PASSWORD` and the Sandbox `PAYPAL_CLIENT_ID`/`PAYPAL_CLIENT_SECRET` (and later `PAYPAL_WEBHOOK_ID`, `PAYPAL_SANDBOX_CLEANUP_ENABLED`) are added as Preview settings. Secret values are not available to Claude; the user must enter them.
- Unauthenticated checks done: `/api/admin/paypal/sandbox-status` → 401 on both Sandbox hosts; production `/api/payments-status` → `{"enabled":false}`. Authenticated sandbox-status not run (no admin password).
- Local Node tests did not complete on this machine (hang); CI and Codex verified tests on `49e0629`.

**E2E checklist (run only against Sandbox, via admin routes):** 1 sandbox-status ok · 2 create-order with Idempotency-Key, same key again → `reused:true` · 3 approve with Sandbox buyer · 4 capture · 5 `paypal_orders` row captured · 6 `download_tokens` row · 7 one-time download works, second fails · 8 duplicate capture idempotent · 9 buyer cancel (`/api/paypal/cancelled`) · 10 decline/negative buyer · 11 timeout/retry · 12 webhook delivery + signature verification + replay dedupe (needs `PAYPAL_WEBHOOK_ID` for the URL under test) · 13 cleanup endpoint dry-run · 14 confirm prod D1 untouched and production `/api/payments-status` still false.

**Exact next step for the owner:** decide target. Recommended: Preview of this branch. Add Preview secrets (`ADMIN_PASSWORD`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`; plus a Sandbox buyer account) in Cloudflare > Worker `amit-photos-paypal-sandbox` > Settings > Previews. Then Claude runs checklist items 1–8 through the admin routes. Not done and not authorized here: merge, `migrate_to_previews` (not needed — already migrated), any production change.

### Cloudflare Sandbox Preview failure confirmed — 12.10.2026

- Build `0e7e335f-a591-4f15-b52a-1fe8753e3b22` on head `75cfdd1` failed. The supplied full log proves it still executed Wrangler 4.4.0 `versions upload` without generator `--preview`, then failed the Worker name/identity check. It did NOT test the native Preview command. At 16:30–16:31 Asia/Jerusalem the user supplied the complete intended command after being asked to refresh, and confirmed the settings URL is `/workers/services/view/amit-photos-paypal-sandbox/production/settings#builds`. The screenshot shows the Sandbox name and no configured cron triggers. This documentation push checks the next build after that confirmation. If the old command persists, investigate the actual Builds trigger configuration rather than repeatedly editing code or assuming the user selected the wrong Worker. Native remote upload remains unverified; PR #149 is not ready to merge.

- At 16:18 Asia/Jerusalem, the user supplied the complete native Preview command and a screenshot explicitly showing the Sandbox Previews Base / Preview command field. The previously failed build #22557f17 still executed Wrangler 4.4.0 versions upload, so it did NOT test the native Preview command. This push initiates a fresh verification after the field confirmation. Remote outcome pending.

- At 16:06 Asia/Jerusalem on 12.10, the user confirmed saving the Sandbox native Preview command using generator `--preview`, Wrangler 4.149.0 and explicit `--worker-name amit-photos-paypal-sandbox`. This follow-up push on PR #149 verifies the newly saved settings with code containing the preview option. Remote outcome pending; no production configuration was changed.

- Fresh verification commit `46f6028` failed both Cloudflare Preview checks; Business Live Verification passed. The supplied remote log confirms the replacement command executed but Wrangler 4.4.0 failed the Worker identity check. The user supplied a Sandbox deployments page URL; the supplied text log itself contains no Worker/build header. The initially suspected wrong-target explanation is not proven. A similar CI-tag failure is reported in Cloudflare workers-sdk issue #15682, also not account-specific proof.
- PR #149 is expanded to implement native Preview configuration: generator `--preview` emits explicit Sandbox D1/R2/Images bindings and `PAYMENTS_ENABLED=false` under `previews`. Ordinary manual staging config remains unchanged. Use the documented Wrangler 4.149.0 native Preview command only for the Sandbox Worker and branches with the updated helper. Keep identity validation enabled. 38/38 security/isolation tests and current Wrangler deploy dry-run passed; authenticated native Preview upload remains unverified. No Live payments or production resource changes were performed.

- User-provided Cloudflare build logs establish the actual failure: main build #88aa579d executed unpinned `npx wrangler preview`, installed Wrangler 4.149.0, and failed with a missing `previews` configuration block. Initialization, checkout and dependency installation completed; the earlier inference that failure happened before any build work was incorrect.
- Cloudflare Settings screenshots show the Sandbox production branch remains `prep/paypal-orders-v2-2026-10-01`, using `npx wrangler@4.4.0 deploy --config wrangler.paypal-sandbox.toml`. That TOML exists on the prep branch and selects isolated Sandbox D1/R2. It does not exist on main. Production-branch settings were not changed.
- Sandbox Preview builds were enabled with `npx wrangler preview`, no build command, and root `/`. The user saved and supplied the complete replacement Preview command:

```bash
python3 src/build_paypal_sandbox_config.py --database-id 7b027b93-c548-4ceb-bbe9-42c45264fc23 --output /tmp/wrangler.paypal-sandbox-preview.json && npx --yes wrangler@4.4.0 versions upload --config /tmp/wrangler.paypal-sandbox-preview.json
```

- The exact generated Sandbox configuration passed Wrangler 4.4.0 `versions upload --dry-run` locally. It selects D1 `7b027b93-c548-4ceb-bbe9-42c45264fc23` and R2 `amit-photos-paypal-sandbox-images`; no remote upload or payment occurred during this local check. `PAYMENTS_ENABLED=true` in that config is restricted to the Sandbox Worker; production remains false.
- Retry build #0d36ad0c still executed the old `npx wrangler preview` command. Therefore the retry did not validate the replacement settings. A fresh branch push is now being used to verify the saved Preview command. Outcome pending; do not mark the remote failure resolved before successful remote logs/checks.

### Sandbox deployment investigation — 12.10.2026

- Production build and deployment of main `1f53356` completed successfully after PR #147; the separate Cloudflare Sandbox build still fails.
- Independently reproduced a confirmed bug in the manual Sandbox workflow: relocating its TOML to `/tmp` breaks relative `main` and asset paths. Wrangler 4.4.0 exits with `The entry-point file at "worker.js" was not found.`
- [PR #148](https://github.com/erezfamily-cmyk/amit-photos/pull/148) was squash-merged into main after explicit user approval on 12.10.2026 as `d1c83e01a0a27fc6e52638d389519f5b8efb12c2`. Final PR head `37f2157` passed PayPal Orders v2 CI, Python Data Tests, Business Live Verification and the production Cloudflare build. Implemented fix: generate JSON with absolute code/assets paths, validate UUID and reject production D1, run the existing isolation/security suite in CI for workflow/helper changes. 37/37 tests passed and Wrangler 4.4.0 dry-run passed using dummy resources. No Sandbox deployment or payment was executed.
- This fixes the verified manual workflow defect; the cause of the separate Cloudflare Workers Builds failure remains unconfirmed. GitHub exposes no error text or annotations. No Cloudflare API credential is available, and browser sign-in reached a generic Cloudflare error, so automated sign-in was stopped. Read authenticated build logs and inspect its configured deploy command when access becomes available. Production remains `PAYMENTS_ENABLED=false`.

Status: [PR #147](https://github.com/erezfamily-cmyk/amit-photos/pull/147) was squash-merged into main on 12.10.2026 after explicit user approval, as `cb1e50b3e1e8550a7d49be3722b875f4ff0b97e3`. Final PR head `3fe1076279fe11ef558fbd3ea917f9686d664edf` passed all four GitHub workflows and Cloudflare `Workers Builds: amit-photos`. The separate `Workers Builds: amit-photos-paypal-sandbox` failed on both the PR and unchanged base main `f5b45b2c9d36f75175a944208df4bd9804818515`; its underlying cause remains unknown and requires authenticated Cloudflare build logs. No payment code or resource configuration changed. Production build and deployment were verified successful on main `1f53356`. Production payments remain disabled; no real payment or manual social publication was executed. Next ordinary GA and scheduled caption runs still need observation.

- Read-only live check on 12.10 confirmed `/api/payments-status` returns `{"enabled":false}`. The canonical Sandbox backend is **merged PR #110**; PR #76 is closed without merge. Older statements below claiming no implementation exists are superseded.
- Current `paypal-orders.js` still uses only `api-m.sandbox.paypal.com`. Public checkout UI, a separate digital-only enablement flag, explicit Live configuration, and current-code Sandbox E2E remain required before any production activation. Do not flip the global payment flag. Gelato stays out of scope.
- Latest saved GA report covers 2–9.10: 65 sessions, 26.2% engagement, 69.2% Direct, 5 free-guide page sessions / 1 successful guide request, 2 licensing page sessions, and no licensing-interest events. The experiment began 2.10 at 12:03:19Z; its initial 7-day window ended 9.10. Demand thresholds for digital PayPal are not met.
- Found and fixed scorecard last-row overwrite: Instagram 4 + PDF 1 sessions for the same guide campaign were reported as 1 session / 100% request rate. The available source rows support **5 sessions / 20% event-to-session rate**. Historical reports have not been rewritten. Future reports use a dedicated campaign-level GA query, independent of the top-20 source table; unique active users come from GA totals rather than summed source rows. On query failure, fallback sums available sessions and marks multi-source unique users unavailable.
- Live Instagram data through 11.10: weekly content views 957 vs 954; no saves/shares. Sample remains small. Several captions were empty, hashtag-only, or truncated. Do not infer that higher posting volume is the answer.
- Shared caption quality helper now rejects token-truncated or textless AI responses, supplies a short factual fallback, preserves complete CTA links, and trims overlong prose only at complete sentence boundaries. Instagram, Facebook and Reel publication entrypoints reject empty/hashtag-only/overlong captions before network calls. Existing video approval and MP4-hash requirements are preserved; captions approved for existing videos are validated, never silently rewritten.
- Generated photo captions no longer promise purchases while checkout is disabled. Photo and guide destinations use the existing UTM builder. No existing public post, video, queue, subscriber record or historical report was edited; no AI generation or publication was executed during validation.
- Validation: **31/31** mocked caption/GA tests, **4/4** photo-strength pipeline tests, Python compilation and `git diff --check` passed. `tests/social-attribution-links.test.mjs`: **1/2 passed**; identical baseline failure on untouched main `f5b45b2` expects the old Pinterest helper implementation, superseded by the curated queue publisher. This unrelated test has not been rewritten in this PR.
- Next: review/merge this focused PR, then verify the next ordinary GA report and scheduled photo captions. Prioritize qualified traffic to the guide/licensing offers. Keep production PayPal off until demand, digital-only flag separation, checkout UX and Sandbox/security gates are satisfied. Paid campaigns and video publication require their own explicit authorization.

---

## Pinterest queue and publishing — 4.10.2026

- PR #139 מוזג ל-`main` כ-`87b7dbbd6f5358eb354056502a61b57cdd356322` ומכין תור פרסום מבוקר. בגיליון Google `pinterest_queue` (לשונית `pinterest_queue.csv`) וב-`data/pinterest_queue.csv` יש 447 רשומות תואמות לפי מזהה: לכל הרשומות תיאור, קישור ייעודי `?photo=<id>` ותגיות. תוקנו 59 תיאורים/תגיות, 6 כותרות ו-447 קישורים. בעת מיזוג PR #139 סומנו 11 תמונות שכבר נרשמו ב-`data/pinterest_posted.json` כ-`posted=TRUE`. אחרי הפיילוט: 12 `TRUE`, 435 `FALSE` והיסטוריית 247 מזהים; אחרי חידוש הפרסום המספרים העדכניים רשומים להלן. אין למחוק את ההיסטוריה.
- `src/pinterest_post.py` קורא את CSV המאגר כמקור הפרסום, מצלב עם `/api/photos` כדי לפרסם רק תמונות חיות ולקחת URL ציבורי של התמונה, ומשתמש בתיאור הערוך ובקישור לתמונה עם UTM. הוא בוחר עד שלוש תמונות מקטגוריות שונות, מדלג על מזהים בהיסטוריית הפרסום ושומר CSV ו-JSON אחרי כל Pin מוצלח. הוסרה ההבטחה הישנה `Available for purchase` ופרמטר `buy=1` כל עוד התשלומים כבויים.
- מקור התור התפעולי הוא CSV ב-GitHub; ה-JSON הוא היסטוריית dedup גם לתמונות מחוץ ל-447. PR #141 הוסיף סנכרון `posted=TRUE` לפי מזהה בלבד, בלי למחוק TRUE קיים, בדיקת התאמת כל מזהי הגיליון, workflow ידני (`pinterest-sheet-sync.yml`) ושלב סנכרון אחרי שמירת פרסום בפיילוט. Google Sheets API הופעל ונבדקו קריאה וכתיבה. שלב הסנכרון המשולב ב-workflow היומי אומת בפרסום נוסף בריצה `37199838411`; אם ריצת סנכרון עתידית תיכשל, יש להצליב `FALSE` בגיליון מול JSON ההיסטוריה.
- ה-workflow לאחר מיזוג PR #139 הוחלף זמנית ב-CI לקריאה בלבד, ללא cron, טוקן או פרסום. 5 בדיקות ממוקדות, Pinterest queue validation, Python Data Tests ו-Business Live Verification עברו ב-PR. נוסף שלב `--dry-run` לקריאה בלבד מול הקטלוג החי; הפיילוט שתועד להלן אימת את טוקן הגישה ואת פרסום פין אחד. ההשהיה הזו הייתה זמנית: ביקורת 66 הרשומות וסנכרון הגיליון הושלמו, ו-PR #142 חידש פרסום יומי. קוד הפרסום צורך `PINTEREST_ACCESS_TOKEN`; workflow נפרד לחידוש שבועי צורך גם `PINTEREST_REFRESH_TOKEN`.
- בזמן הביקורת שינוי להפעלה אוטומטית נדחה בבדיקת אישור אוטומטית בשל פרסום פומבי ללא פיילוט מפורש. אין לעקוף את החסימה. אישור מפורש לפין הניסיוני התקבל והפיילוט הושלם. המשתמש ביקש לאחר מכן להחזיר את הפרסום האוטומטי, ו-PR #142 מימש זאת לאחר בדיקה.

---

### פיילוט Pin יחיד — 4.10.2026: הושלם

- עמית אישר במפורש פרסום פין ניסיון אחד. PR #140 מוזג כ-`d695ee63eab9cd5fcd9085c1a6f0c17d6daaff96`; המועמד הקבוע היה `1A8y2S1s8pDnIzK0lbW6NpxJS5plJcYzJ` ("פרח אדום בשמש"), עם `PINTEREST_POST_LIMIT=1` וללא cron.
- שתי הריצות הראשונות (#1/#2) נכשלו **לפני פרסום**: בדיקת יחידה הניחה בחירה של יותר מתמונה אחת למרות הגבלת הפיילוט ל-1. הבדיקה תוקנה ב-`39f50d3`. ריצה חוזרת של #2 (run `37195647061`) עברה; dry-run אישר את המועמד והפרסום החזיר Pinterest Pin ID `512636370109452329`.
- הפין הציבורי נצפה ב-`https://www.pinterest.com/pin/512636370109452329/`: כותרת "פרח אדום בשמש", תיאור הגיליון והתגיות, חשבון `erezphoto`, לוח "פרחים וצמחים". הקישור `https://amitphotos.com/?photo=1A8y2S1s8pDnIzK0lbW6NpxJS5plJcYzJ&utm_source=pinterest&utm_medium=organic_social&utm_campaign=gallery_pins&utm_content=1A8y2S1s8pDnIzK0lbW6NpxJS5plJcYzJ` נבדק ישירות באתר ופתח את lightbox של אותה תמונה. Pinterest דרש התחברות כדי ללחוץ על כפתור Visit, לכן לא אושר click-through מתוך Pinterest עצמו; היעד שנשלח בקוד והעמוד המקבל אומתו בנפרד.
- `data/pinterest_queue.csv` ו-`data/pinterest_posted.json` נשמרו ב-`main` לאחר הפרסום; שורה 347 בלשונית הגיליון עודכנה ל-`posted=TRUE` ונקראה חזרה. התזכורת למחר הושהתה, כי הפיילוט הושלם.
- dry-run דיווח `live matches=381` מתוך 447 רשומות תור; 66 מזהים אינם מופיעים ב-`/api/photos` כרגע. תנאי ההפעלה ההיסטורי הזה הושלם בהמשך: הרשומות החסרות מסוננות לפי ה-API והסנכרון נבדק בפועל. workflow הפיילוט נשאר `workflow_dispatch` ללא cron; הרצה חוזרת עם אותו ID תיעצר כ-"already posted". אין צורך כרגע ב-`PINTEREST_REFRESH_TOKEN`.
- `PAYMENTS_ENABLED=false` נשאר ללא שינוי.

### ביקורת תור וסנכרון גיליון — 4.10.2026

- PR #141 מוזג ל-`main` כ-`05524b87e700c1c40f4fe22ecfba3791ff28a393`. בדיקות Python Data Tests ו-Pinterest queue validation עברו; `src/audit_pinterest_queue.py` מצלב את התור עם הקטלוג החי, `data/photos.json` ומצב HIDE ב-Drive.
- מצב נקודתי: 381/447 מזהים בתור נמצאים ב-`/api/photos`; 66 אינם חיים: 6 נמצאים במפורש ב-Hidden של Drive, 17 עדיין ב-`data/photos.json` אך אינם ב-API החי, ו-43 אינם בקובץ הסטטי או ב-API. מתוכם רשומה אחת כבר מסומנת TRUE מהעבר. אלה נתוני זמינות, לא הוכחה למחיקה או סיבה לפרסם תמונות נסתרות. המפרסם מצליב מול ה-API בכל ריצה ולכן מדלג על כל 66; הרשומות נשמרות לצורך היסטוריה ובירור, ללא שינוי מצב האתר.
- `src/sync_pinterest_sheet.py` נבדק ביחידות: הוא מסרב לסנכרן אם מזהי 447 הרשומות שונים בין Sheet ל-CSV, ורק מעלה `posted` ל-TRUE עבור מזהים שנמצאים בהיסטוריית הפרסום. אין כתיבת FALSE. שלב הסנכרון תלוי בשמירת מצב הפרסום ב-GitHub.
- Google Sheets API בפרויקט `717200418816` היה כבוי וגרם ל-403 בריצה `37197237040`. עמית הפעיל אותו. ניסיון 3 של אותה ריצה עבר בקריאה בלבד: `Sheet rows=447; repo rows=447; posted IDs=247; missing TRUE updates=0`.
- ריצת `Pinterest Sheet status sync` מספר `37197817994` עברה גם בדיקת כתיבה של `TRUE` לאותו תא שכבר היה `TRUE`, ללא שינוי מצב. קריאה חוזרת דרך Google Sheets אישרה 447 רשומות, מהן 12 TRUE ו-435 FALSE. סקריפט הבדיקה הוקשח כדי לסרב לכתיבת ניסיון אם יימצא פער אמיתי. סנכרון עתידי של פין חדש טרם נבדק מקצה לקצה, אך הקריאה, התאמת המזהים ויכולת הכתיבה אומתו.
- Google Sheets API והרשאות הקריאה/כתיבה אומתו. חידוש הפרסום היומי מתועד בסעיף הבא. `PINTEREST_REFRESH_TOKEN` אינו דרוש ל-`src/pinterest_post.py` עצמו, אך נחוץ ל-workflow השבועי `pinterest-token-refresh.yml`; יש לעקוב אחר ריצת החידוש הבאה.

### פרסום אוטומטי חודש — 4.10.2026

- המשתמש ביקש להחזיר את הפרסום האוטומטי. PR #142 מוזג כ-`0924286da54f851989c2a8d4e838b890d5feb6b1`, והוסיף `.github/workflows/pinterest-daily.yml`. התזמון הקודם חודש: כל יום ב-14:00 UTC (17:00 בישראל בשעון קיץ, 16:00 בחורף), עד שלושה פינים לריצה מקטגוריות שונות. workflow האימות `pinterest-post.yml` נשאר לקריאה בלבד ב-PR.
- ריצת ההשקה `37199838411` על `main` הוגבלה לפין אחד ועברה את כל השלבים: בדיקות, בדיקת התאמת 447 מזהים בגיליון, פרסום, commit/push של CSV+JSON ל-`main`, וסנכרון TRUE אחד לגיליון. פורסמה תמונה `1jmBaBvk8rKoV5rvARPayvd010U_CW_gp` ("כניסה לשירותים ציבוריים", "טבע דומם") כ-Pin `512636370109452598`. Pinterest API החזיר את המזהה; צפייה ציבורית בפין טרם אומתה בנפרד.
- קריאה חוזרת אישרה שהמזהה החדש מסומן `posted=TRUE` ב-CSV ובשורה 2 של הגיליון. המצב הנקודתי לאחר הריצה: 447 רשומות, 14 TRUE ו-433 FALSE בגיליון, 249 מזהים בהיסטוריית `data/pinterest_posted.json`. לפני ריצת ההשקה היו כבר 13 TRUE/248 מזהים, כלומר היה עדכון נוסף מאז פיילוט 12/247; אין לייחס אותו לריצת ההשקה.
- טריגר `push` הזמני שגרם לריצה אחת הוסר ב-`f5ea8487d11036dcba0582ef9c22f1e0ef8d9a26`. נותרו `schedule` ו-`workflow_dispatch` בלבד. ה-job מוגבל ל-`main`, רץ תחת נעילת `pinterest-publication` ללא ביטול ריצה קודמת, קורא את `main` העדכני, בודק את הגיליון לפני פרסום, שומר גם פרסום חלקי, ואז מסנכרן את הגיליון. מזהים שאינם ב-`/api/photos` לא ייבחרו.
- מבחן מעשי של הריצה הראשונה עבר; הריצה המתוזמנת הבאה עדיין לא אומתה. יש לבדוק את `Pinterest daily publishing` ב-GitHub Actions לאחר 14:00 UTC ולוודא שכל השלבים ירוקים ושמספר TRUE עולה בהתאם. אם API, Git push או Sheet sync נכשלים, אין להניח שסימון FALSE משקף אי-פרסום; יש לבדוק את JSON והלוגים לפני ריצה חוזרת. אין שינוי לתשלומים (`PAYMENTS_ENABLED=false`).

### בדיקת הריצה המתוזמנת הראשונה — 4.10.2026, 18:03 שעון ישראל

- ה-workflow ב-`main` עדיין מוגדר ל-`schedule: 0 14 * * *`, עם `workflow_dispatch`, עד 3 פינים לריצה ונעילת `pinterest-publication`. ענף ברירת המחדל הוא `main`. בבדיקת רשימת GitHub Actions עד 15:03 UTC **לא הופיעה כלל ריצת `schedule` של `Pinterest daily publishing`**. לכן אין תוצאת פרסום מתוזמן שאפשר לאמת, ואין לייחס לריצה המתוזמנת את הצלחת ריצת ההשקה `37199838411` (אירוע `push`).
- קריאה חוזרת אישרה 447 מזהים בתור GitHub ובלשונית `pinterest_queue.csv`, 14 דגלי `posted=TRUE` זהים בשניהם, ו-249 מזהים ייחודיים ב-`data/pinterest_posted.json`. שני קובצי המצב ב-`main` לא השתנו מאז ההשקה; כל 14 הדגלים מסומנים גם בהיסטוריית מניעת הכפילויות. לא נצפה פרסום חדש או פער סנכרון. `PAYMENTS_ENABLED = "false"` נשאר ב-`wrangler.toml`.
- לא בוצעה הפעלה ידנית או ניסיון פרסום חוזר: אלה לא היו מאמתים את טריגר התזמון ועלולים לפרסם פינים נוספים. יש לבדוק את ריצת `schedule` הבאה לפני הכרזה על תקינות התזמון; אם תופיע ריצה באיחור, להשוות את מזהי ה-Pins החדשים ללוג, לקטלוג החי, ל-CSV, ל-JSON ולגיליון לפני כל retry.

## Production health-check runner — 4.10.2026

- GitHub Actions `.github/workflows/health-check.yml` was already scheduled daily at 07:00 UTC (10:00 Israel summer / 09:00 winter). It is the authoritative production health-check runner; do not create a duplicate AI scheduled check.
- Hardened the existing workflow: bounded retries, read-only permissions, job timeout, serialized runs, non-empty array validation for photos, thumbnail passed via environment rather than shell interpolation, and an always-running summary that detects failed/skipped steps. A missing thumbnail now fails instead of reducing the denominator.
- Homepage, photo API, sitemap and sample image remain the four core checks. Existing licensing/business/admin markers and `PAYMENTS_ENABLED=false` guardrail remain checked. Workflow changes also trigger a live run on push.
- Local verification: YAML parsed; all six shell blocks passed `bash -n`; five summary scenarios and four API-validation cases passed.
- The reported Claude `403 policy denial` is a runner/proxy access failure, not evidence of a production outage. Inspect the GitHub run before concluding the site is down.
- Live verification passed on 4.10.2026 at 09:17 Israel: [health run #7](https://github.com/erezfamily-cmyk/amit-photos/actions/runs/37182347635), all four core checks + business/admin/payment guardrail; API returned 2,310 photos. PR Business Live Verification run 37182354449 also passed.
- **Closed external step (4.10.2026):** the owner paused the weekly Claude Code routine “בדיקת בריאות שבועית — amitphotos.com” in Claude Routines; the screenshot showed `Paused` and the toggle off. Keep the daily GitHub Actions check as the sole active health-check schedule. PR #138 was merged and its post-merge run passed 4/4: https://github.com/erezfamily-cmyk/amit-photos/actions/runs/37182427171.


## ⚡ הדבר הכי חשוב לדעת עכשיו

**תשלומים כבויים באתר החי, בכוונה, ולא באג.**

```
PAYMENTS_ENABLED = "false"   ב-wrangler.toml (production)
```

- כל נתיב שמזיז כסף (`/api/verify-payment`, `/api/print/order-complete`) מחזיר `503 PAYMENTS_TEMPORARILY_DISABLED` בשרת — לא רק כפתורים מוסתרים בצד לקוח.
- **הסיבה:** מעבר מ-PayPal Payments Standard (הישן, redirect-based) ל-**PayPal Orders API v2**. עד שההפעלה המחודשת תבוצע, האתר בפאזת תיקוני UX/אבטחה/אנליטיקה.
- **זו החלטה עומדת, לא נבדקת מחדש בכל שיחה:** התוכנית (`docs/analytics-driven-ux-plan-2026-09-26.md`) קבעה לתת לאירועי אנליטיקה חדשים לצבור **baseline של 14–28 יום** לפני שמשווים שוב ושוקלים הפעלה מחודשת. כלומר — **אל תציע להדליק את הדגל בחזרה בלי לבדוק תאריך ה-baseline קודם.**
- **מסמך תכנון המעבר בפועל ל-Orders API v2 כבר קיים:** `docs/paypal-orders-v2-migration-2026-09-30.md` (עיצוב בלבד, אין עדיין קוד). מחכה ל-Sandbox App + Client ID/Secret + חשבון קונה-בדיקה מעמית (חד-פעמי, דרך developer.paypal.com) לפני שהעבודה בפועל יכולה להתחיל — הבנייה עצמה יכולה להתקדם במקביל לחלון ה-baseline, לא צריך לחכות לו.
- הורדות של רכישות ישנות (טוקנים תקפים שכבר נוצרו) **ממשיכות לעבוד** — הנעילה חוסמת רק יצירת עסקאות/טוקנים חדשים.
- מי שיפעיל בחזרה: לשנות `PAYMENTS_ENABLED = "true"` ב-`wrangler.toml`, לפרוס, ולוודא `GET /api/payments-status` מחזיר `{"enabled":true}`.

---

## 🖼️ הפרויקט בקצרה

- **מה:** פורטפוליו צילום עברי (Fine Art / נוף / טבע / מאקרו) של עמית ארז. ~2,300+ תמונות מפורסמות.
- **URL:** https://amitphotos.com
- **Stack:** Cloudflare Worker (`worker.js`, קובץ ענק אחד — כל ה-API) + D1 (SQLite) + R2 (תמונות) + Assets. Frontend: HTML/CSS/Vanilla JS, דו-לשוני HE (ראשי) / EN.
- **Repo:** ציבורי ב-GitHub (`erezfamily-cmyk/amit-photos`) — **לא לחשוף סודות בקוד!**
- **Deploy:** `git push` ל-`main` → GitHub Actions (`deploy.yml`) → `wrangler deploy` אוטומטי. אין deploy ידני נדרש בדרך כלל.
- **בעל הפרויקט:** עמית (זכר, לפנות בלשון זכר).

לארכיטקטורה מלאה (מיזוג גלריה D1+JSON, מבנה keys ב-R2, auth, קבצים מרכזיים, סקריפטי מיגרציה) — **`CLAUDE.md`** הוא המקור המחייב, לא כפול כאן.

---


## 📈 Lead funnel measurement audit — 1.10.2026

נמצא פער מדידה חשוב בזמן בניית המודל העסקי:
- טופס ה-newsletter בדף הבית שלח `generate_lead` על כל submit מוצלח, גם אם האימייל כבר היה קיים.
- עמוד `/free-guide/` לא שלח `generate_lead` בכלל.
- לכן `generate_lead` לא היה KPI אמין להשוואת free-guide מול newsletter.

תיקון מוצע ב-Draft PR נפרד:
- ה-API של subscribers מחזיר metadata לא-רגיש בלבד: `created`, `already`, `marketing_upgraded`.
- `generate_lead` נשלח רק כשנוצר subscriber חדש או כשיש upgrade אמיתי להסכמה שיווקית.
- `guide_request_success` מודד בקשת מדריך מוצלחת גם כשהמשתמש בוחר לא להצטרף לשיווק.
- הדוח השבועי מפריד בין בקשות מדריך לבין לידים חדשים/משודרגים.
- לא נשלח email/PII ל-GA.
- אין שינוי ב-`PAYMENTS_ENABLED` ואין שינוי במסלול התשלומים.

המשמעות העסקית: רק אחרי שהתיקון נפרס ומצטברים נתונים אפשר להשוות באופן הוגן `free-guide -> guide_request_success -> generate_lead`.

## 🗓️ מה קרה לאחרונה (מהחשוב לפחות חשוב)

### השבוע האחרון (25–30.9.2026)
1. **כיבוי תשלומים בפרודקשן** (25.9) — מתג `PAYMENTS_ENABLED` fail-closed, `GET /api/payments-status`, חסימת שרת ב-`handleVerifyPayment`/`handlePrintOrderComplete`, UI מותאם. ראה `git show 306d0a01`.
2. **יישור UX לנעילת התשלומים** (PR #12/#13, 27.9) — הודעות רכישה + cache-busting לנכסי מצב-תשלום.
3. **ביקורת UX חיה מבוססת-נתונים** (26.9, יום מלא) — עיצוב מחדש להיררכיית דף הבית (הירו, ניווט, featured grid, הסרת עדויות אירועים סותרות מיצוב), תיקון SW cache-first קריטי (מבקרים חוזרים לא ראו עדכוני תמונות), 58 רשומות עם טקסט עברי פגום תוקנו, אדמין מותאם מובייל. פירוט מלא: `docs/daily-summary-2026-09-26.md`.
4. **סבב תיקוני מובייל לאדמין** (27.9, ~8 PR-ים) — טפסים, טבלאות, כלי מדיה, ניווט צד, סושיאל — כל האדמין.
5. **אנליטיקה → החלטות UX** (PR #62–64, 28.9) — מדידת UX ציבורי, קיצור נתיב יצירת קשר מתמונה, הפיכת אנליטיקס להחלטות עיצוב.
6. **תיקוני אבטחה/יציבות** (28–30.9) — XSS בשם נרשם לניוזלטר (#65), ייחוס תנועה סושיאל אוטומטית (#67), URL אנליטיקס דף הבית (#66), stale cache-busting hashes אחרי גלי PR מקבילים (#54, #68).
7. **ייבוא תמונות גאורגיה + באג טקסט פגום חוזר** (30.9) — 12/13 תמונות חדשות מדרייב עלו לגלריה (1 תקלה חולפת, ממתינה לריצה הבאה). תוך כדי כך התגלה שהבאג "טקסט עברי פגום" מ-26.9 **עדיין פעיל בפועל** (2 רשומות חדשות + 11 ישנות שחזרו למצב פגום) — כי `agent_photos.py` (צינור ה-Drive, לא `worker.js`) מעולם לא בדק את פלט ה-AI שלו. תוקן ב-PR #69 (ולידציה+ניסיון חוזר, כמו ב-`generateHebrewTitle`). תיעוד מתוקן: `docs/corrupted-photo-titles-2026-09-26.md`.
8. **סגירת cherry-pick מיושן** (30.9) — כל 8 הפריטים שנרשמו כ"עדיין חסרים" ב-`docs/security-ux-audit-status-2026-09-26.md` נבדקו מול `main` הנוכחי ונמצאו **כולם כבר פתורים** דרך עבודה עצמאית — אין יותר צורך לשחזר מהענף הישן.
9. **מסמך תכנון PayPal Orders API v2** (ערב 30.9) — `docs/paypal-orders-v2-migration-2026-09-30.md`, מוכן לסקירת עמית מחר בבוקר. ראה גם למעלה.
10. **ייבוא תמונות נוסף + באג CI אמיתי** (לילה 30.9) — 38 תמונות חדשות נוספות מכל התיקיות שעמית העלה היום (22 גאורגיה, 10 טבע דומם, 5 פרחים וצמחים, 1 מאקרו). סריקת ביקורת מלאה על כל 2,424 התמונות החיות — **0 שדות פגומים**, אישוש בריצת-אמת (לא רק טסטים) שתיקון PR #69 עובד. תוך כדי בדיקה למה תמונה אחת ספציפית (`DSC_9287.jpg`, גאורגיה — קובץ Drive תקין לגמרי) לא נכנסת בשום ריצה, התגלה ש-`update-photos.yml` **מעולם לא commit את `data/copyright_flagged.json`** — כל סימון זכויות-יוצרים חדש (מאז יולי) נמחק בשקט בסוף כל ריצת CI, והתמונה המסומנת מנותחת מחדש (ומבזבזת קריאת API) בכל ריצה עתידית לנצח, בלי שום עקבות. תוקן ב-PR #74 (שני חצאים: commit + change-detection, אחרת התיקון לא באמת מופעל). `DSC_9287.jpg` אמור להיפתר לבד בריצה היומית הבאה.

### הקשר חשוב: כמה סשנים מקבילים
יש תקופות שבהן **כמה סשנים של Claude Code רצים במקביל באותה תיקיית עבודה בדיוק** (לא git worktrees נפרדים — אותו `.git/index` ואותם קבצים על הדיסק). זה קרה בפועל ב-25.9 (זיהוי + תיאום עם סשן "amit-photos-46" שעבד על ביקורת אבטחה/UX/אנליטיקה, ועדיין פעיל נכון ל-30.9 — הוא אחראי לחלק ניכר מה-PRs ברשימה למעלה).

**כללי זהב אם זה קורה שוב:**
- `git status` **תמיד** ממש לפני `git add`/`git commit` — לא לסמוך על מה שראית לפני כמה פעולות.
- לעולם לא `git add -A` / `git add .` — רק נתיבים מפורשים.
- אם רואים קבצים שהשתנו ולא נגעת בהם — כנראה סשן אחר. לתאם דרך `SendMessage` לפני commit.
- לפני merge/cherry-pick/deploy לענף משותף — לבדוק אם יש PR-ים פתוחים או קומיטים חדשים שאולי מתנגשים.
- ענף ישן (`fix/security-analytics-ux-audit`, 19+ קומיטים) **קיים אך אף פעם לא מוזג במלואו** — ראה `docs/security-ux-audit-status-2026-09-26.md` לרשימת קומיטים ספציפיים שעדיין לא הגיעו ל-`main` (למשל HSTS/CSP, נגישות מודלים/לייטבוקס, `<main>` landmarks, דליפת עברית/אנגלית בווידג'טים). **לפני שמנסים לשחזר קומיט משם — לבדוק קודם אם PR חדש יותר כבר כיסה את זה אחרת**, כדי לא לכפול עבודה או לדרוס גרסה עדכנית יותר.

---

## 📚 מפת תיעוד — איפה למצוא מה

| קובץ | מה יש בו | עדכני נכון ל- |
|---|---|---|
| `CLAUDE.md` (וגם `AGENTS.md` — עותק זהה לתאימות כלים) | ארכיטקטורה מחייבת: מיזוג גלריה, R2 keys, auth, קבצים מרכזיים, i18n, SEO | מתעדכן שוטף |
| `docs/daily-summary-2026-09-26.md` | סיכום יום עבודה מלא — הכי מפורט על מה קרה ב-26.9 | 26.9.2026 |
| `docs/security-ux-audit-status-2026-09-26.md` | סטטוס אמיתי (מאומת בקוד, לא מזיכרון) של מה מוזג מהענף הישן ומה לא | 26.9.2026 |
| `docs/analytics-driven-ux-plan-2026-09-26.md` | התוכנית שקובעת למה תשלומים כבויים ומתי לבדוק שוב | 26.9.2026 |
| `docs/paypal-orders-v2-migration-2026-09-30.md` | מסמך עיצוב מלא למעבר בפועל ל-Orders API v2 — ארכיטקטורה, סכמת D1, endpoints, checklist אבטחה, תוכנית בדיקות. אין קוד עדיין, ממתין לסקירת עמית | 30.9.2026 |
| `docs/paypal-flow.md` | זרימת PayPal **הישנה** (Payments Standard) — עדיין רלוונטי להבנת המנגנון הקיים לפני המעבר ל-Orders API v2 | אפריל 2026 (ישן, אבל המנגנון לא השתנה) |
| `docs/gallery-merge-architecture.md` | פירוט מיזוג D1+photos.json | — |
| `docs/site-overview.md` | מפת עמודים, טבלאות D1, רשימת API — **ישן (17.5.2026), חלק מהמספרים לא מעודכנים**, אבל שימושי כסקירה מבנית | 17.5.2026 ⚠️ |
| `docs/CHANGELOG.md` | ⚠️ לא מתעדכן — אל תסמוך עליו לפעילות אחרונה | 17.5.2026 ⚠️ |
| `memory/` (מחוץ לריפו, `~/.claude/projects/.../memory/`) | זיכרון ארוך-טווח בין שיחות — סטטוס פרויקטים, לקחים, החלטות. `MEMORY.md` הוא האינדקס | מתעדכן שוטף |

**עצה:** לפני שסומכים על מספר/תאריך/סטטוס — לבדוק בקוד/ב-git החי, לא רק בתיעוד. גם המסמכים האלה יכולים להתיישן (ראה איך `site-overview.md` כבר מיושן).

---

## 🧩 החלטות ולקחים שחוזרים (לפי נושא)

- **תשלומים כבויים** — ראה למעלה. לא לגעת בלי לבדוק סטטוס baseline קודם.
- **סשנים מקבילים** — `git status` תמיד לפני commit, ראה למעלה.
- **"תוקן" לא אמין בלי אימות חי** — כל ממצא בביקורת ה-UX מ-26.9 אומת בדפדפן אמיתי (screenshots, console errors), לא רק קריאת קוד. שני ממצאים (ספירה סטטית, קיר קטגוריות) התגלו רק ככה. תעדוף בדיקה חיה על פני "זה אמור לעבוד".
- **עמית עונה "כן" גם לשאלת A-או-B** — לפעולות פרסום/רכישה אמיתיות תמיד לנסח אישור מפורש מחדש, לא להסיק מדפוס.
- **כל עמוד ציבורי חדש** חייב `data-he`/`data-en` + `setLang()` מהרגע הראשון (לא בדיעבד).
- **עמית עובד בעיקר מהנייד** — כל שינוי אדמין/UI כדאי לבדוק ב-viewport צר (390px), לא רק דסקטופ.
- **לכתוב תשובות בעברית, לפנות בלשון זכר.**

לרשימה המלאה והמפורטת יותר — קובצי `feedback_*.md` ב-memory.

---

## ✅ מה עובד ומה עדיין פתוח (תמונת מצב)

**עובד ופרוס:** גלריה + פילטרים + לייטבוקס, בית ספר לצילום (24 מדריכים ב-`/camera/`), מקומות לצילום, ניתוח תמונות (`/learn/`), משחקים (פאזל/קוויז), ניוזלטר, אדמין מלא (כולל מובייל), אנליטיקה מפורטת, אוטומציות סושיאל (Instagram/Facebook/Pinterest/Threads/Redbubble/Zazzle), GA weekly report.

**כבוי בכוונה:** רכישות (PayPal) — ראה למעלה.

**ידוע כפתוח / ממתין:**

- **מעבר בפועל ל-PayPal Orders API v2** — עיצוב מוכן (`docs/paypal-orders-v2-migration-2026-09-30.md`), ממתין ל-(1) סקירת עמית למסמך עצמו, (2) חשבון Sandbox + Client ID/Secret + חשבון קונה-בדיקה מעמית (חד-פעמי, developer.paypal.com), (3) סיום חלון ה-baseline לפני הפעלה בפועל — אבל הבנייה עצמה לא צריכה לחכות לתנאי #3.
- `DSC_9287.jpg` (גאורגיה) — הסיבה כבר ידועה (ראה #10 למעלה: סימון זכויות-יוצרים שנמחק בשקט בגלל באג CI, עכשיו מתוקן ב-PR #74). לבדוק שהיא נכנסת בפועל בריצה היומית הבאה; אם לא, לבדוק את `data/copyright_flagged.json` (עכשיו נשמר בפועל) לראות אם היא שם ולמה.
- להמשיך לעקוב אחרי metrics אחרי כל שינוי UX גדול לפני שממשיכים הלאה.

**עודכן 30.9.2026:** שחזור הענף הישן (`fix/security-analytics-ux-audit`) שהיה רשום כאן כפתוח —
**נבדק מול `main` הנוכחי ונמצא מיותר: כל 8 הפריטים כבר פתורים** דרך עבודה עצמאית מאוחרת יותר,
לא דרך הענף הישן עצמו. פירוט מלא ב-`docs/security-ux-audit-status-2026-09-26.md` (עודכן). אל
תבזבזו זמן על cherry-pick מהענף הזה בלי לבדוק שוב קודם.

---

*אם אתה סוכן AI שנכנס לפרויקט הזה: קרא את `CLAUDE.md` ואת המסמך הזה קודם, ואז תסתכל אם יש `docs/*-2026-*.md` חדש יותר מהתאריך שרשום כאן — אם כן, זה כנראה מעודכן יותר ממה שכתוב פה.*


### Lead source attribution audit — 1.10.2026

נבדקו כל מקורות ההרשמה הפעילים בקוד:
- `lead_magnet` — עמוד `/free-guide/`
- `popup` — popup בדף הבית
- `subpage_strip` — strip שמוזרק לעמודי משנה דרך `assets/js/nav.js`
- `homepage_section` — טופס newsletter בדף הבית
- `newsletter_issue` — הרשמה מתוך גיליון newsletter

פער נוסף שנמצא:
- `popup` ו-`subpage_strip` שלחו בעבר `generate_lead` גם כשאותו email כבר היה קיים.
- `newsletter_issue` לא שלח `generate_lead` בכלל.
- לכן source attribution של leads לא היה עקבי בין כל 5 המקורות.

תיקון נוסף באותו Draft PR:
- כל חמשת המקורות משתמשים באותה הגדרה של lead חדש/שדרוג הסכמה.
- בקשות guide נשמרות בנפרד מ-lead marketing אמיתי.
- אין PII ב-GA.
- אין שינוי ב-payment flow.



### Weekly Business Review automation — 1.10.2026

נמצא שכבר קיימת אוטומציה שבועית ב-`.github/workflows/ga-weekly-analysis.yml`:
- רצה בכל יום שני ב-07:00 UTC.
- מפעילה `src/ga_weekly_report.py`.
- שולחת דוח במייל ושומרת את `data/ga_reports.json`.

לכן **לא נוספה אוטומציה מקבילה**. במקום זאת, Draft PR #79 מרחיב את הדוח השבועי הקיים:
- מוסיף D1 subscriber summary לפי source, ללא PII.
- מוסיף KPI עסקיים דטרמיניסטיים: Direct share, lead rate, marketing opt-in, digital intent, print intent.
- מוסיף sample-size guardrail.
- מפיק **next_action אחד בלבד** לשבוע הבא + reason.
- שומר את `business_review` בתוך `data/ga_reports.json`.
- מציג את ההחלטה גם במייל השבועי לפני ניתוח ה-AI.

החלטת ה-next_action אינה מבוססת רק על Claude: היא מחושבת בקוד לפי כללים שקופים, ורק אחר כך Claude מוסיף ניתוח טקסטואלי. כך נמנעת החלפת אסטרטגיה בגלל ניסוח משתנה של מודל AI.

אין שינוי ב-schedule, אין workflow חדש, אין payment enablement ואין deploy במסגרת ה-Draft.



### Acquisition attribution — 1.10.2026

המשך התוכנית העסקית זיהה ש-Direct הוא עדיין צוואר בקבוק מרכזי למדידה. Draft PR #79 הורחב:
- GA weekly report מושך כעת גם `sessionSource`, `sessionMedium`, `sessionCampaignName`.
- Source / Medium / Campaign מופיעים בדוח הטקסט ובמייל השבועי.
- נוספו מראש אירועי העסק החדשים לרשימת הדוח:
  - `licensing_personal_interest`
  - `licensing_commercial_contact`
  - `b2b_intent`
  - `b2b_package_select`
  - `b2b_contact_start`
- אין PII.
- אין שינוי בתשלומים.

Business docs מגדירים UTM convention וניסוי attribution של 7 ימים. אין להתחיל paid ads לפני שיש attribution יציב ויכולת לזהות איזה קמפיין מביא פעולות עסקיות.



### PR #79 QA pass — 1.10.2026

בוצע סבב QA ממוקד על lead measurement / weekly business review.

ממצאים ותיקונים:
- נמצא שהדוח השבועי משך Source/Medium/Campaign אבל לא שמר אותם ב-`data/ga_reports.json`; תוקן כדי לשמור היסטוריית campaign.
- הוסר KPI מטעה `guide_to_lead_pct` שחילק את כלל ה-`generate_lead` (מכל המקורות) רק בבקשות מדריך; הוחלף ב-`guide_request_rate_pct` עקבי.
- אומת ש-`nav.js` כבר טוען את `assets/js/analytics.js` בעמודי משנה שחסרה בהם טעינת GA ישירה, ולכן אין צורך להוסיף סקריפט כפול.
- אומת שה-endpoint החדש `/api/admin/subscriber-summary` מוגן ב-`checkAuth`.
- אומת שה-summary מחזיר aggregates בלבד ולא email/PII.

נוסף workflow ממוקד:
- `.github/workflows/lead-funnel-ci.yml`
- מריץ `node --test tests/subscriber-consent-model.test.mjs`
- מריץ `python3 -m py_compile src/ga_weekly_report.py`
- read-only permissions בלבד.

הערה: סביבת העבודה של ChatGPT לא הצליחה לבצע clone ישיר מ-GitHub בגלל חסימת DNS, ולכן האימות המקומי לא נחשב. ה-CI ב-GitHub הוא מקור האימות הבא לפני Ready/Merge.



### PR #79 final QA — 1.10.2026

סבב QA נוסף מצא ותיקן שני פערי סמנטיקה במדידה:
- `generate_lead` נשלח בעבר גם עבור subscriber חדש שביקש Free Guide אך **לא** נתן marketing consent. זה היה מערבב lead magnet delivery עם owned marketing audience.
- נוסף flag שרת לא-רגיש `lead_created`, והוא true רק כאשר:
  - subscriber חדש נתן marketing consent, או
  - subscriber קיים שודרג כעת מ-0/NULL ל-1.
- כל מקורות ההרשמה משתמשים כעת ב-`lead_created` במקום להסיק lead מ-`already`.

בנוסף:
- subscriber summary מפריד כעת בין:
  - new subscribers בתקופה לפי source,
  - marketing opt-ins/upgrades בתקופה לפי `consent_marketing_at`,
  - current marketing audience.
- ה-KPI בדוח נקרא במפורש `new_subscriber_marketing_opt_in_pct`, ובנפרד נשמר `period_marketing_opt_ins`.
- נוספו tests שמכסים guide-only ללא marketing consent לעומת guide+marketing.
- Lead Funnel CI עבר בהצלחה: Node tests + Python syntax check.

PR #79 יכול לעבור ל-Ready for Review. אין merge/deploy אוטומטי במסגרת הסבב הזה.



### Admin UTM campaign link builder — 1.10.2026

נוסף כלי פנימי ב-Admin תחת אזור Analytics:
- יוצר deep links ליעדים העסקיים: `/free-guide/`, `/licensing/`, `/business/`, `/#gallery`, `/camera/`, `/locations/`.
- משתמש ב-`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`.
- source/medium/destination מוגבלים לרשימות בטוחות.
- campaign/content עוברים normalization ל-`a-z0-9_-`.
- אין PII.
- כולל copy/open לבדיקה.
- mobile-friendly.
- לא שולח קישורים החוצה ולא מפרסם אוטומטית; זה רק generator פנימי.

מטרת הכלי: לאפשר discipline עקבי ב-UTM בלי להקליד ידנית בטלפון, כדי שהדוח השבועי החדש יוכל לזהות קמפיינים במקום שכולם ייראו כ-Direct.


### Business-model work status — 1.10.2026

מצב העבודה המתועד להמשך:

- **PR #79 — Lead funnel measurement**
  - עבר סבב QA ממוקד.
  - Lead Funnel CI עבר בהצלחה: Node subscriber/consent tests + Python syntax check.
  - `generate_lead` מוגדר כעת רק ל-marketing lead אמיתי דרך `lead_created`; בקשת Free Guide בלי marketing consent נשארת `guide_request_success` בלבד.
  - subscriber summary מפריד בין new subscribers, opt-ins/upgrades בתקופה, ו-current marketing audience.
  - Source / Medium / Campaign נשמרים גם בהיסטוריית `data/ga_reports.json`.
  - PR #79 הועבר מ-Draft ל-**Ready for Review**.
  - עדיין **לא מוזג ולא נפרס**.

- **PR #82 — Admin UTM campaign link builder**
  - עדיין Draft.
  - מוסיף כלי פנימי ב-Admin > Analytics ליצירת deep links עם UTM.
  - אין PII, אין פרסום אוטומטי, אין הרשאות חיצוניות ואין שינוי בתשלומים.
  - זהו הכלי הבא שמיועד ל-QA לפני הפעלת ניסוי acquisition.

- **PR #80 — Digital Licensing MVP**
  - עדיין Draft, ללא deploy.
  - מחירי הבסיס נטענים מאותה תשתית מחירים קיימת של ההורדות; checkout הסופי נשאר server-authoritative.
  - אין הפעלת תשלומים.

- **PR #81 — B2B Art & Licensing MVP**
  - עדיין Draft, ללא deploy.
  - כולל attribution מחבילת B2B עד `contact_form_success`, ללא PII.

- **PR #78 — Business-model TODO/scorecard**
  - עדיין Draft.
  - מכיל KPI scorecard, acquisition playbook ו-Acquisition Experiment 01.

- **PR #76 — PayPal Orders v2**
  - נשאר Draft; אינו חוסם את ניסויי המודל העסקי.
  - `PAYMENTS_ENABLED=false` נשאר כלל מחייב.


### PR #82 QA pass — 1.10.2026

בוצע סבב QA על Admin UTM campaign link builder.

שינויים שבוצעו:
- הוצא logic של בניית URL למודול testable:
  - `assets/js/admin-campaign-links.mjs`
- נוספו guardrails:
  - destination/source/medium allowlists.
  - normalization ל-campaign/content.
  - חסימה בסיסית של email/phone בתוך UTM לפני normalization.
  - כפתור "פתח לבדיקה" נשאר disabled עד שנוצר URL חוקי.
  - שדות campaign/content מוגדרים ללא autocomplete/autocapitalize כדי לצמצם טעויות במובייל.
- נוספו tests:
  - בניית UTM תקין.
  - שמירת `#gallery`.
  - חסימת destination/source/medium לא חוקיים.
  - חסימת PII ברור.
  - דרישת campaign לא-ריק.
- נוסף CI ממוקד:
  - `.github/workflows/admin-campaign-links-ci.yml`
  - מריץ `node --test tests/admin-campaign-links.test.mjs`.

עדיין אין merge/deploy. יש להמתין ל-CI לפני מעבר PR #82 ל-Ready.


### Digital Licensing MVP — 1.10.2026

נפתח כיוון MVP מסחרי ראשון, בלי להפעיל תשלומים:
- מסמך מוצר: `docs/digital-licensing-mvp-2026-10-01.md`
- עמוד ציבורי דו-לשוני: `/licensing/`
- שימוש אישי נשען על ה-SKU הקיימים `small / medium / large` והמחירים הקיימים כ-test prices.
- שימוש מסחרי נשאר inquiry/quote בלבד בשלב הראשון — לא נבנה עדיין checkout מסחרי אוטומטי.
- אין שינוי ב-PayPal backend ואין שינוי ב-`PAYMENTS_ENABLED`.
- לא נוסף קישור לניווט הראשי עדיין; קודם review של copy/UX.
- נוספו אירועי analytics לא-PII:
  - `licensing_personal_interest`
  - `licensing_commercial_contact`
- `.github/workflows/deploy.yml` עודכן כך ששינויים תחת `licensing/**` יפעילו deploy אחרי merge עתידי.
- Gelato לא חלק מ-MVP הרישוי הדיגיטלי.


### Licensing acquisition readiness — 1.10.2026

עמוד `/licensing/` קיבל metadata מלא לשיתוף ומדידה:
- canonical + hreflang כבר קיימים.
- נוספו Open Graph ו-Twitter Card.
- social preview משתמש כרגע בתמונת המותג הקיימת של האתר.
- המטרה היא לאפשר בדיקת קישורי UTM ב-social/newsletter עם preview תקין.
- אין שינוי בתשלומים ואין checkout activation.


### PR #80 replacement QA — 1.10.2026

Digital Licensing MVP נבנה מחדש מענף נקי מ-main לאחר מיזוגי #79/#83.

ממצא QA חשוב:
- העמוד הסטטי `/licensing/` כלל `analytics.js` אך לא את bootstrap של GA/gtag.
- המשמעות: אירועי `licensing_personal_interest` / `licensing_commercial_contact` לא היו נשלחים בעמוד הזה.
- תוקן על ידי טעינת gtag עם Measurement ID הקיים של האתר לפני `analytics.js`.

בנוסף:
- מקור המחירים נשאר `GET /api/admin/prices`; אין price table נפרד.
- fallback מוצג רק אם API המחירים לא זמין; checkout עתידי נשאר server-authoritative.
- `PAYMENTS_ENABLED=false` ללא שינוי.
- אין PayPal/Gelato activation.


### B2B Art & Licensing MVP — 1.10.2026

המשך התוכנית העסקית פתח ניסוי B2B מינימלי:
- מסמך: `docs/b2b-art-mvp-2026-10-01.md`
- עמוד דו-לשוני: `/business/`
- שלוש הצעות בלבד:
  1. Digital Display License
  2. Wall Art Selection
  3. Custom Collection
- אין מחירון B2B קשיח בשלב הזה; משתמשים ב-tailored quote כדי ללמוד מהשוק.
- אין CRM, אין checkout עסקי אוטומטי, אין Gelato commitment.
- אירועי analytics לא-PII:
  - `b2b_intent`
  - `b2b_package_select`
  - `b2b_contact_start`
- ה-CTA מפנה לטופס הקשר הקיים באתר, שבו כבר קיימת אפשרות "רישיון מסחרי".
- לא נוסף קישור לניווט הראשי לפני review.
- `PAYMENTS_ENABLED=false` נשאר ללא שינוי.


### B2B contact funnel refinement — 1.10.2026

נוסף חיבור בין `/business/` לטופס הקשר הקיים:
- בחירת חבילה בעמוד העסקי נשמרת זמנית ב-`sessionStorage` רק כ-context לא רגיש:
  - `digital_display`
  - `wall_art`
  - `custom_collection`
  - `business_quote`
- המעבר לטופס הקשר בוחר מראש "רישיון מסחרי".
- subject פנימי מקבל את סוג החבילה, בלי PII.
- placeholder מותאם להקשר העסקי שנבחר.
- `contact_form_success` מקבל attribution `source=business` + package label בטוח.
- אין שם/אימייל/טקסט חופשי שנשלחים ל-GA.
- ה-context פג אחרי 30 דקות ונמחק אחרי שליחה מוצלחת.

כך אפשר למדוד איזה offer עסקי מביא פניות אמיתיות בלי לבנות CRM חדש ובלי לשכפל טפסים.


### B2B acquisition readiness — 1.10.2026

עמוד `/business/` הוכן להפצה מבוקרת:
- נוספו canonical + hreflang.
- נוספו Open Graph ו-Twitter Card.
- social preview משתמש כרגע בתמונת המותג הקיימת של האתר.
- העמוד מוכן לניסוי deep-link/UTM לאחר review ו-merge.
- אין paid ads, אין checkout עסקי ואין Gelato commitment.


### PR #81 replacement QA — 1.10.2026

B2B MVP נבנה מחדש מענף נקי מ-main לאחר מיזוגי #79/#83/#84.

ממצאי QA ותיקונים:
- הוסר canonical כפול מ-`/business/`.
- נמנעה ספירה כפולה של `b2b_contact_start` ב-CTA הראשי: האירוע נשלח פעם אחת בלבד דרך funnel logic.
- בחירת "רישיון מסחרי" בטופס אינה תלויה עוד ב-`selectedIndex=2`; היא מאתרת את option לפי `data-i18n="contact.f.t2"`.
- context לא חוקי/ישן ב-`sessionStorage` נמחק; TTL נשאר 30 דקות.
- `contact_form_success` ממשיך לקבל רק `source=business` + package label בטוח, ללא PII.
- `analytics.js` כבר מבצע GA bootstrap בעצמו, לכן אין צורך ב-gtag script כפול בעמוד B2B.
- `PAYMENTS_ENABLED=false` ללא שינוי; אין checkout עסקי ואין Gelato activation.


### Business model execution — current status 1.10.2026

מצב עדכני מאומת מול GitHub:

#### כבר מוזג ל-`main`
- **PR #79 — Lead funnel measurement**
  - מדידת `guide_request_success` נפרדת מ-`generate_lead`.
  - `generate_lead` מייצג marketing lead אמיתי בלבד.
  - subscriber summary אגרגטיבי ללא PII.
  - Source / Medium / Campaign בדוח השבועי.
  - Business Review דטרמיניסטי + next action אחד.

- **PR #83 — Admin UTM Campaign Link Builder**
  - כלי mobile-friendly תחת Admin > Analytics.
  - allowlists + normalization + PII guardrails.
  - ללא פרסום אוטומטי וללא הרשאות חיצוניות.

- **PR #84 — Digital Licensing MVP**
  - עמוד `/licensing/` דו-לשוני.
  - מחירי בסיס מגיעים מ-`/api/admin/prices`.
  - GA/analytics תקינים.
  - Personal-use digital licensing + commercial inquiry.
  - אין checkout activation.

- **PR #85 — B2B Art & Licensing MVP**
  - עמוד `/business/`.
  - Digital Display / Wall Art / Custom Collection.
  - package context קצר-חיים עובר לטופס הקשר הקיים.
  - attribution עד `contact_form_success`, ללא PII.
  - אין checkout עסקי ואין Gelato commitment.

#### PRs ישנים שהוחלפו
- #80 נסגר והוחלף ב-#84.
- #81 נסגר והוחלף ב-#85.
- #82 נסגר והוחלף ב-#83.

#### Deploy verification
המיזוגים ל-`main` בוצעו, אבל דרך GitHub connector לא הופיעו workflow runs על merge commits #84/#85 בזמן הבדיקה. לכן אין לתעד כרגע “live verified” רק על בסיס merge.
לפני פתיחת חלון הניסוי יש לבצע אימות חי של:
- `/licensing/`
- `/business/`
- Admin UTM builder
- GA events הרלוונטיים
- טופס B2B end-to-end ללא שליחת PII ל-GA

#### Business-model experiment
היעד הבא הוא **Acquisition Experiment 01**:
1. Free Guide
2. Personal Digital Licensing
3. B2B Wall Art

חלון המדידה המתוכנן: 7 ימים, ורק לאחר live verification של התשתית שמוזגה.

במהלך חלון הניסוי:
- לא משנים pricing.
- לא משנים hero.
- לא משנים checkout.
- לא מתחילים paid ads.
- לא מעמיקים Gelato.
- משתמשים ב-UTM בכל הפצה יזומה.
- בסוף השבוע בוחרים follow-up אחד בלבד.

#### Payment / Gelato guardrails
- `PAYMENTS_ENABLED=false` נשאר מחייב.
- PR #76 PayPal Orders v2 נשאר נפרד ואינו חוסם את הניסוי העסקי.
- Gelato נשאר אפשרות fulfillment בלבד; לא מקדמים אינטגרציה עמוקה לפני signal של print demand + margin/quality validation.

#### Strategy documentation
הענף `strategy/business-model-todo-clean-2026-10-01` נפתח מחדש מ-`main` הנוכחי כדי להחליף את PR #78 הישן והמסוכסך.
המטרה: להכניס ל-`main` מקור אמת אחד ל-`TODO.md`, acquisition playbook ו-Acquisition Experiment 01, לאחר יישור הסטטוסים למה שכבר מוזג.



### Business-model strategy source of truth — 1.10.2026

המסמכים הבאים יושרו לסטטוס בפועל לאחר מיזוגי #79/#83/#84/#85:
- `TODO.md`
- `docs/acquisition-playbook-2026-10-01.md`
- `docs/acquisition-experiment-01-2026-10-01.md`

הסטטוס העדכני:
- measurement, UTM builder, Digital Licensing ו-B2B כבר מוזגו ל-`main`.
- ניסוי Acquisition Experiment 01 עדיין **לא התחיל**.
- launch gate שנותר: live verification של העמודים/אירועים לאחר deploy.
- לאחר האימות מתחיל חלון 7 ימים ללא שינויי pricing/hero/checkout.
- בסוף 7 ימים בוחרים follow-up אחד בלבד לפי הנתונים.
- `PAYMENTS_ENABLED=false` נשאר.
- PayPal PR #76 ו-Gelato אינם חלק מהפעלת הניסוי.

PR #78 הישן מבוסס על base מיושן והוא מוחלף בענף:
`strategy/business-model-todo-clean-2026-10-01`.



### Business-model docs merged + live verification status — 1.10.2026

- PR #87 (business-model TODO / acquisition playbook / Experiment 01) merged to `main`.
- `TODO.md` is now the current business-model execution source of truth.
- Acquisition Experiment 01 remains **not launched** until live verification is complete.
- Attempts to verify `https://amitphotos.com/licensing/`, `/business/` and `/admin.html` from the current ChatGPT environment were blocked by network/DNS access.
- Opera Browser Connector was available as a capability but the browser was not connected (`Allow AI connection` disabled/not connected), so no claim of live verification is made.
- This does **not** roll back or change the merged code; it only means the launch gate remains open.

### PR #77 photo-strength QA replacement — 1.10.2026

PR #77 was based on an older `main` and is being replaced by a clean branch from current `main`.

QA found two concrete bugs in the old draft:
- `src/instagram_post.py` called `save_social_photo_mapping(...)` without importing it — runtime `NameError` after a successful Instagram publish.
- `src/weekly_report.py::build_reel_summary()` used `post_lookup` without defining it — runtime `NameError` when building reel summaries.

Clean replacement fixes both and keeps the pipeline advisory-only:
- persists Instagram/Facebook post → photo mapping;
- stores per-photo website analytics in GA report history;
- builds `data/photo_strength_report.json` conservatively;
- does **not** auto-reorder the public gallery;
- low-sample photos stay low confidence;
- adds compile checks + unit tests for the wiring.

No payment, checkout, Gelato or gallery-order behavior is changed.



### Photo-strength pipeline merged — 1.10.2026

- PR #88 merged to `main` after both relevant checks passed:
  - Python Data Tests ✅
  - Lead Funnel CI ✅
- Merge commit: `d9295bcebc2726caaa385229fd2a5d2359b36493`.

What is now in `main`:
- persistent social post → photo mapping for Instagram/Facebook;
- per-photo website analytics stored in weekly GA history;
- conservative `data/photo_strength_report.json`;
- confidence penalties for low-sample photos;
- `featured_review_shortlist` for editorial review;
- no automatic public-gallery reorder;
- compile + unit tests for the pipeline wiring.

Important:
- this pipeline is advisory only.
- do not use a low-sample score as a merchandising decision.
- `PAYMENTS_ENABLED=false` remains unchanged.
- no PayPal/Gelato behavior changed.

Next business gate remains live verification of the already-merged acquisition stack before launching Acquisition Experiment 01.



### Fulfillment guardrail — 1.10.2026

החלטה מפורשת: **לא מקדמים Gelato בשלב הנוכחי**.

עד להחלטה חדשה:
- אין אינטגרציית Gelato חדשה.
- אין checkout להדפסות שמסתמך על Gelato.
- אין בחירת ספק fulfillment או אוטומציית הזמנות הדפסה.
- ניסויי המודל העסקי מתמקדים ב-Free Guide, Digital Licensing ו-B2B.
- Print יכול להישאר כרעיון/מדד ביקוש בלבד, ללא התחייבות לספק fulfillment.
- `PAYMENTS_ENABLED=false` נשאר ללא שינוי.



### PayPal reactivation plan — 1.10.2026

החלטת עבודה:
- PayPal Production **לא חוזר עכשיו**.
- Acquisition Experiment 01 רץ קודם עם payments off כדי למדוד demand נקי.
- checkpoint ראשון להחלטה: סביב 10.10.2026, אחרי 7 ימים מלאים של תנועה עם UTM.
- זו נקודת החלטה בלבד, לא תאריך הפעלה אוטומטי.

קריטריונים ראשוניים ל-Digital-only canary:
- לפחות 20 qualified sessions ב-/licensing/;
- לפחות 3 digital purchase-intent actions או intent rate של 10%+;
- attribution ו-GA events עובדים;
- PR #76 נבנה מחדש מ-main הנוכחי ועובר שוב Sandbox E2E/security.

Guardrail חשוב:
- לא הופכים את PAYMENTS_ENABLED הגלובלי ל-true, כי הוא פותח גם legacy print paths.
- לפני Production צריך flag נפרד כגון DIGITAL_PAYPAL_ENABLED.
- legacy print/Gelato נשארים כבויים.
- Gelato מחוץ לתוכנית הנוכחית.

נוסף מסמך:
- `docs/paypal-reactivation-gate-2026-10-01.md`

נוסף גם שדרוג ל-health-check:
- תיקון thumbnail URL יחסי.
- smoke checks ל-/licensing/ ול-/business/.
- בדיקת Admin UTM builder.
- בדיקה אוטומטית ש-/api/payments-status מחזיר enabled=false.


### Live acquisition smoke verification passed — 1.10.2026

GitHub Actions `Business Live Verification` עבר בהצלחה מול האתר החי.

אומת בפועל:
- `/licensing/` נטען ומכיל:
  - `licensing_personal_interest`
  - מקור המחירים `/api/admin/prices`
  - GA measurement marker
- `/business/` נטען ומכיל:
  - `b2b_contact_start`
  - `amit_b2b_context`
  - analytics helper
- `/admin.html` לאחר cache-busting redirect מכיל את UTM builder.
- `/api/payments-status` מחזיר `enabled=false`.
- thumbnail ציבורי לדוגמה נטען בהצלחה אחרי תיקון URL יחסי.

תוקנו תוך כדי שני false negatives ב-health verification:
1. Admin מחזיר redirect עם `_v`, ולכן הבדיקה צריכה `curl -L`.
2. `set -o pipefail` + `grep -q` יצר Broken Pipe אחרי match; הוחלף ב-here-string.

מה עדיין לא מסומן כמאומת:
- receipt בפועל של אירועי licensing/B2B בתוך GA/weekly report.
- לכן Acquisition Experiment 01 עדיין לא מתחיל עד אימות analytics receipt.

PayPal נשאר כבוי.
Gelato נשאר מחוץ לתוכנית.


### Professional photo curation review added — 1.10.2026

נוסף מסלול ביקורת מקצועי לתמונות, בנפרד מ-photo-strength analytics.

מטרת הבדיקה:
- לאתר תמונות חלשות טכנית או קומפוזיציונית;
- לאתר near-duplicates / סצנות חוזרות;
- לבדוק האם קטגוריות גדולות מדי או לא עקביות;
- להפריד בין קטגוריית נושא לבין location collection ו-style tags;
- לזהות תמונות עם resolution נמוך, metadata חסר או התאמה חלשה ל-licensing/B2B;
- להמליץ KEEP / KEEP_SECONDARY / REVIEW_DUPLICATE / REVIEW_CATEGORY / REVIEW_TECHNICAL / ARCHIVE_CANDIDATE / HIDE_CANDIDATE / LEGAL_REVIEW.

Guardrail:
- אין מחיקה אוטומטית.
- אין hide אוטומטי.
- החלטה להסיר תמונה מהפורטפוליו הציבורי דורשת visual review בפועל.

Snapshot נוכחי:
- 1,390 תמונות.
- 27 קטגוריות.
- 120 ללא description.
- 142 rows בתוך קבוצות title חוזרות.
- 650 ללא parent_category.
- 78 תמונות עם long edge < 2000px או short edge < 1200px — מועמדות לבדיקה, לא להסרה אוטומטית.
- 164 ללא EXIF.
- photo-strength עדיין waiting_for_mapped_data ולכן לא משתמשים בו כרגע לדירוג מלא.

ממצא taxonomy:
המערכת מערבבת באותה רמה subject/genre (למשל בעלי חיים, צילום מופשט) עם geography (ישראל, גאורגיה, איטליה וכו') ו-style (שחור-לבן). הכיוון המומלץ הוא:
- primary visual category
- collection/location נפרד
- style tags

קטגוריות ראשונות ל-review:
1. פרחים וצמחים
2. בעלי חיים
3. ישראל
4. צילום מופשט
5. מאקרו-צילומי תקריב

נוספו:
- `docs/photo-curation-review-2026-10-01.md`
- `src/photo_catalog_audit.py`
- `tests/test_photo_catalog_audit.py`
- `.github/workflows/photo-catalog-audit-ci.yml`

הבדיקה הזו לא תלויה ב-PayPal או Gelato ולא משנה public gallery ordering אוטומטית.



### Admin flower-curation pilot — 1.10.2026

הוחלט שקטגוריית `פרחים וצמחים` היא הפיילוט הראשוני לתהליך הקיורציה.

בענף:
`feature/admin-flower-curation-pilot-2026-10-01`

נוסף:
- `data/flower-curation-pilot.json` — דוח פרטני ל-162 תמונות.
- סימוני Admin לכל תמונת פיילוט.
- פילטרים:
  - פיילוט פרחים
  - לבדיקה
  - עדיפות גבוהה
  - כפילויות לבדיקה
  - רזולוציה לבדיקה
- badge על כרטיסי התמונות.
- דוח פרטני מתוך תפריט התמונה עם:
  - recommendation
  - priority
  - resolution
  - filename
  - reasons
  - הנחיית פעולה.
- פתיחה מהדוח למסך עריכת התמונה.

Snapshot:
- 162 תמונות בפיילוט.
- 43 מסומנות עם לפחות flag אחד.
- 12 בעדיפות גבוהה.
- 17 מועמדות עקב כותרת כפולה.
- 6 מועמדות כ-probable file duplicate.
- 8 מועמדות לבדיקת רזולוציה.
- 18 ללא description.
- 23 ללא EXIF.

Guardrails:
- אין hide אוטומטי.
- אין delete אוטומטי.
- כל המלצה דורשת visual review.
- הסתרה תתבצע רק בהחלטה ידנית דרך published=0.
- מחיקה נשארת destructive action נפרדת עם confirmation.

המטרה: להשתמש בפיילוט הפרחים כדי לכייל את תהליך הסימון, הדוח והחלטות הקיורציה לפני הרחבה לקטגוריות נוספות.


### Flower curation pilot in Admin — 1.10.2026

הוחלט שקטגוריית **פרחים וצמחים** תהיה פיילוט ראשון לתהליך קיורציה מקצועי באדמין.

מטרת הפיילוט:
- לסמן באדמין תמונות שמומלץ לבדוק;
- להציג סיבה מפורטת לכל סימון;
- להבדיל בין recommendation לבין החלטה סופית;
- לקבל החלטה ידנית אם KEEP / KEEP_SECONDARY / HIDE / DELETE / שינוי קטגוריה.

נוצר דוח פיילוט:
- `data/flower-curation-pilot.json`
- 162 תמונות בקטגוריה.
- 43 תמונות עם לפחות flag אחד.
- 12 high-priority review candidates.
- 17 מועמדות בגלל duplicate title.
- 6 מועמדות בגלל probable file duplicate / copy variant.
- 8 מועמדות בגלל low resolution ל-Licensing.
- 18 ללא description.
- 23 ללא EXIF.

Guardrails:
- אין מחיקה אוטומטית.
- אין hide אוטומטי.
- אין שינוי published אוטומטי.
- אין שינוי קטגוריה אוטומטי.
- כל recommendation הוא review-only עד החלטה ידנית.
- מחיקה פיזית מ-R2/D1 מתבצעת רק לאחר אישור מפורש.
- הסתרה צריכה להיות reversible דרך `published=0` לפני ששוקלים מחיקה.

הכוונה ב-Admin:
- להוסיף מצב/פילטר "פיילוט קיורציה — פרחים וצמחים".
- להציג badge לפי recommendation כגון REVIEW_DUPLICATE / REVIEW_TECHNICAL / REVIEW_METADATA.
- להציג reasons פרטניים לכל תמונה.
- לאפשר מעבר מהיר ל-lightbox/עריכה לפני החלטה.
- לייצר דוח פרטני שמרכז recommendation + reason + החלטת בעל האתר.

הפיילוט נועד לבדוק את UX ואת איכות ההמלצות לפני הרחבה לקטגוריות נוספות.



### Flower curation owner-decision workflow — 1.10.2026

PR #93 (Draft) הורחב כך שהפיילוט אינו רק advisory אלא מאפשר החלטת בעלים ידנית ומתועדת.

נוסף:
- endpoint פנימי ומוגן auth: `/api/admin/curation-decisions`.
- persistence פיילוטי ב-`settings` תחת `flower_curation_decisions_v1` — ללא migration חדש ל-D1.
- החלטות נתמכות: `KEEP`, `KEEP_SECONDARY`, `HIDE`, `DELETE`, `CHANGE_CATEGORY`.
- recommendation נשאר נפרד מהחלטת הבעלים; שום recommendation לא מבצע פעולה אוטומטית.
- `HIDE` משתמש ב-`published=0` ולכן הפיך.
- `DELETE` נשאר פעולה נפרדת עם confirmation מפורש למחיקה לצמיתות.
- `CHANGE_CATEGORY` נשמר כהחלטה רק אחרי ששינוי קטגוריה אמיתי נשמר דרך מסך העריכה.
- נוסף מעבר ישיר ל-Lightbox מהדוח לפני החלטה.
- נוספו פילטרים `טרם הוחלט` / `הוחלט`.
- נוסף export של `flower-curation-owner-review.json` לכל 162 תמונות עם:
  - `photo_id`
  - `title`
  - `thumbnail`
  - `recommendation`
  - `reasons`
  - `resolution`
  - `current_published_status`
  - `final_owner_decision`
  - `final_category`
  - timestamp של ההחלטה.

Guardrails נשארו:
- אין hide/delete/change-category אוטומטי.
- אין שינוי אוטומטי בסדר הגלריה.
- visual review נדרש לפני החלטה אמנותית.
- PayPal/Gelato לא שונו.
- `PAYMENTS_ENABLED=false` נשאר ללא שינוי.
- PR #93 נשאר Draft עד QA.


### End-of-day handoff — Flower curation pilot — 1.10.2026

- PR #93 נשאר **Draft** ולא מוזג ל-`main`.
- כל ארבעת ה-checks האחרונים עברו:
  - Admin Flower Curation Pilot CI ✅
  - Admin Campaign Links CI ✅
  - Lead Funnel CI ✅
  - Business Live Verification ✅
- תוקן טסט ישן שהיה תלוי בניסוח מדויק של guardrail; לא הייתה רגרסיה התנהגותית.
- ה-Admin כולל כעת:
  - פילטר `פיילוט קיורציה — פרחים וצמחים`;
  - פילטר `עדיפות גבוהה`;
  - recommendation + reasons + resolution + published status;
  - פתיחה ל-Lightbox ולעריכה;
  - החלטות ידניות `KEEP / KEEP_SECONDARY / HIDE / DELETE / CHANGE_CATEGORY`;
  - persistence של final owner decision;
  - export מלא של דוח הפיילוט.
- לא בוצע שום `HIDE` או `DELETE` בפועל.
- אין שינוי אוטומטי בקטגוריה או בסדר הגלריה.
- `PAYMENTS_ENABLED=false` נשאר ללא שינוי.
- PayPal PR #76 נשאר נפרד ולא למזג.
- Gelato מחוץ לתוכנית.

### נקודת המשך למחר

1. להיכנס ל-Admin → תמונות.
2. לבחור `פיילוט קיורציה — פרחים וצמחים` ואז `עדיפות גבוהה`.
3. לבצע visual review ידני ל-12 התמונות בעדיפות גבוהה.
4. לכל תמונה לבחור רק אחרי צפייה: `KEEP`, `KEEP_SECONDARY`, `HIDE`, `DELETE` או `CHANGE_CATEGORY`.
5. אם יש ספק — להשאיר REVIEW ולא להסתיר/למחוק.
6. אחרי סיום 12 התמונות: לייצא `flower-curation-owner-review.json` ולעבור על התוצאות לפני הרחבה לקטגוריה נוספת.

מצב branch בסיום היום: `feature/admin-flower-curation-pilot-2026-10-01`; PR #93 Draft; head `3d3982b18f8ab3dbd7375ae02c3497d5353aca77`.


### Drive sync preservation guard — Flower curation — 2.10.2026

נבדקה שרשרת Google Drive → `data/photos.json` → D1/R2 כדי לוודא שהחלטות ידניות באדמין נשמרות.

ממצאים:
- `title` / `description` / `category` שנערכים באדמין נשמרים ב-D1, שהוא המקור הראשי בגלריה, ולכן סריקת Drive לא דורסת אותם.
- `HIDE` נשמר כ-`published=0` ב-D1.
- נמצא פער: `auto_import_new_photos.py` קרא בעבר את `/api/photos` הציבורי ולכן לא ראה hidden photos; בנוסף, תמונה שנמחקה מ-D1 אך עדיין נשארה ב-Drive הייתה יכולה להיחשב חדשה ולהיות מיובאת מחדש.

תיקון:
- importer קורא מעכשיו `/api/photos?admin=1` עם auth, ולכן רואה גם `published=0` ולא מעלה hidden photos מחדש.
- importer קורא גם `/api/admin/curation-decisions` ומייצר tombstone לכל `DELETE`.
- Drive ID שסומן `DELETE` לא ייובא מחדש כל עוד החלטת הקיורציה נשמרת, גם אם הקובץ עדיין קיים ב-Google Drive.
- קריאת tombstones היא fail-closed: אם אי אפשר לקרוא את החלטות הקיורציה, הייבוא נעצר במקום להסתכן בהחזרת תמונה שנמחקה.
- ב-Admin נשמר `DELETE` tombstone לפני המחיקה מ-D1/R2; אם המחיקה נכשלת, ההחלטה הקודמת משוחזרת.

משמעות לעבודה הידנית:
- `KEEP` / `KEEP_SECONDARY`: נשמרים כהחלטת בעלים.
- `HIDE`: נשאר hidden גם אחרי הסריקה היומית.
- `CHANGE_CATEGORY`: הקטגוריה ב-D1 נשמרת ואינה נדרסת על ידי Drive.
- `DELETE`: לא חוזר לפרודקשן בריצה היומית, גם אם המקור נשאר ב-Drive.

אין שינוי ב-PayPal/Gelato, אין שינוי אוטומטי בסדר הגלריה.


### Admin navigation hotfix — 2.10.2026

לאחר מיזוג PR #93 התגלה שה-sidebar באדמין מוצג אך רוב הפריטים אינם מגיבים ללחיצה.

Root cause:
- ב-`admin.html` נכנסו בטעות שתי הצהרות פונקציה כפולות:
  - `function renderGrid() { function renderGrid() {`
  - `async function confirmDelete(id) { async function confirmDelete(id) {`
- השגיאה יצרה `SyntaxError: Unexpected token ')'` והפילה את כל סקריפט ה-JavaScript הראשי, ולכן listeners של `.nav-item` לא נרשמו.

Fix:
- הוסרו שתי הכפילויות בלבד.
- נוספה בדיקת Node שמוודאת שכל inline scripts של `admin.html` עוברים parsing לפני merge.
- אין שינוי בנתוני התמונות, בהחלטות הקיורציה, ב-PayPal או ב-Gelato.


### Admin navigation resilience follow-up — 2.10.2026

לאחר hotfix PR #94 בוצעה בדיקה חיה דרך Opera Browser Connector. ה-sidebar עדיין לא הציג click handlers באופן אמין, ולכן נוסף hardening נוסף:

- ניווט ה-Admin נקשר עכשיו בתחילת הסקריפט, לפני אתחול מודולי התמונות/לקוחות/אנליטיקה.
- כך תקלה עתידית במודול feature לא תשבית את הניווט כולו.
- נמנעת קשירה כפולה של handlers בהמשך הסקריפט.
- אם מתרחשת שגיאת JavaScript לא מטופלת, כותרת הטאב מסומנת ב-⚠ ובטקסט השגיאה לצורך אבחון מיידי.
- אין שינוי בנתוני תמונות, החלטות קיורציה, תשלומים או Gelato.


### Flower curation scoring + reversible production hide — 2.10.2026

Owner approved moving clearly problematic flower images out of production and assigning scores across the full pilot.

Scoring:
- Added `data/flower-curation-scores.json` for all 162 flower photos.
- 12 photos already inspected visually receive a full 0–100 visual score.
- Remaining 150 receive a clearly labeled `technical_provisional` score only.
- Provisional technical formula: 55% resolution, 30% uniqueness/duplicate risk, 15% metadata completeness.
- Visual formula: 25% sharpness, 20% composition, 15% light/color, 15% resolution, 10% uniqueness, 10% category fit, 5% metadata.
- Admin now shows score badges: `V` = full visual review, `T` = technical provisional.
- Added filters for score <60 and visual-review-complete, plus score fields in the curation dialog/export.

Approved production HIDE actions (reversible; no DELETE):
- חמניות צהובות — `15h8IlkqnlorfEseEFBHjNikOSgMvsCQ_`
- זרעים של דנדליון — `1Tpaw2ooFcWip-poF5_tXOxN1K-PQHpWA` (weaker duplicate)
- עלים ירוקים בשמש — `1yu2k9PJbstdauHCz0dVbM9QMNSiPR-lI` (duplicate variant)
- פרח דליל סגול — `1PcDKeeJvmjYmuSALPGTVgclA0mmup8z7` (duplicate variant)

A dedicated GitHub Action applies only HIDE, records owner decision HIDE, and verifies the four IDs are `published=0` and absent from the public gallery. It contains no DELETE action.

Important: technical provisional scores are not artistic verdicts. Continue visual review before additional HIDE/DELETE/category actions.


### Flower HIDE workflow auth follow-up — 2.10.2026

The first production HIDE run failed before changing any photo because the GitHub `ADMIN_PASSWORD` secret returned HTTP 403 against the live Admin API.

The HIDE workflow was changed to use the existing Cloudflare deployment credentials and update D1 directly:
- only `published=0` for the four approved photo IDs;
- preserves the four `HIDE` owner decisions inside `flower_curation_decisions_v1` using SQLite JSON functions;
- purges Cloudflare cache;
- verifies all four rows are `published=0`;
- verifies none of the four IDs appears in the public `/api/photos` response.

No DELETE or R2 removal is performed.


### Admin review cue for flower scores 0–89 — 2.10.2026

Added a non-destructive Admin cue for the 29 flower photos currently scored below 90:
- new filter chip: `⚠ לבחינה 0–89 (29)`;
- each scored photo below 90 shows a separate `⚠ לבחינה` badge next to its V/T score;
- wording is intentionally review-oriented, not an automatic quality verdict;
- no photo is hidden, deleted, recategorized, or reordered by this change.


### Flower review overlay in Admin — 2.10.2026

Improved the 0–89 review cue in the photo grid:
- every flower photo scored below 90 now shows a visible overlay directly on the image: `⚠ לבחינה <score>`;
- overlay sits at the top-left of the thumbnail, avoiding the selection checkbox at top-right and Pinterest badge at bottom-left;
- V/T numeric score remains in the title area for detail;
- the separate text `⚠ לבחינה` badge was removed from the title area to avoid duplication;
- the `⚠ לבחינה 0–89 (29)` filter remains unchanged;
- no photo state, category, ordering, HIDE, or DELETE action is changed.


### Flower Review Mode MVP — 2.10.2026

Added a guided manual review workflow for the 29 flower photos scored 0–89.

Admin behavior:
- new `▶ מצב Review reviewed/total` control;
- review queue is sorted lowest score first;
- dialog shows progress `נבדקו X מתוך 29` with a progress bar;
- full score-component breakdown is shown when available;
- large action buttons: KEEP / SECONDARY / HIDE / CHANGE_CATEGORY;
- after a successful decision, Review Mode advances automatically to the next undecided image;
- `דלג לתמונה הבאה` leaves the current photo undecided and moves on;
- reviewed thumbnails change from `⚠ לבחינה` to `✅ נבדק`;
- completion closes Review Mode and reports that all candidates were reviewed.

Safety:
- HIDE still requires the existing explicit confirmation and remains reversible via `published=0`;
- DELETE remains outside the large Review Mode action row and still requires its destructive confirmation;
- scores do not auto-hide, auto-delete, auto-recategorize or auto-reorder photos.


### KEEP_SECONDARY public-gallery behavior — 2.10.2026

`KEEP_SECONDARY` now has a concrete public-site meaning:
- the photo stays published and remains in its current category;
- it is moved behind regular / KEEP photos in the public gallery;
- existing manual / newest ordering is preserved inside the primary tier and inside the secondary tier (stable partition);
- category filtering inherits the same behavior because the public API ordering is preserved by the gallery client;
- Featured ordering is intentionally unchanged for now;
- Admin ordering is unchanged;
- changing a curation decision invalidates the cached public photo response so the new ordering can appear immediately;
- Drive scan behavior is unchanged: KEEP_SECONDARY remains an owner decision and the Drive source file is untouched.

No HIDE, DELETE, category change, or payment behavior is triggered by KEEP_SECONDARY.


### Gallery taxonomy consolidation — 2.10.2026

Business decision implemented at the public-navigation layer:
- 7 subject galleries remain top-level.
- `מקומות בעולם` is the 8th primary destination and contains all 18 geographic categories.
- Added missing `גאורגיה` to the location grouping.
- `שחור-לבן` and `צילומי לילה` are shown in a separate Style row instead of as primary galleries.
- All 1,390 photos remain available; this is a discovery/navigation change, not content deletion.
- Google Drive remains the master archive. No file was deleted, moved or renamed in Drive.
- Added `data/gallery-taxonomy.json` and `docs/gallery-taxonomy-business-2026-10-02.md` as the canonical taxonomy snapshot.

Curation direction:
- flower-pilot workflow is the template for rollout to other galleries;
- owner decisions are preserved;
- KEEP_SECONDARY remains public but at gallery tail;
- HIDE remains reversible;
- no automatic Drive deletion.


### All-gallery visual scoring policy — 2.10.2026

Owner approved expanding the successful flower-pilot curation model to the rest of the portfolio.

Scoring policy:
- preserve existing owner-reviewed decisions; do not overwrite photos the owner already reviewed;
- all remaining photos must receive actual visual review for sharpness, composition, and light/color before those components are scored;
- missing visual review must display `טרם נבדק`, never misleading `0/100`;
- full weighted score is authoritative only after visual components are populated;
- owner Review queue contains only score <=85 or materially problematic photos;
- score >85 does not require owner confirmation;
- low-resolution below the approved threshold may be auto-HIDE (reversible) but never auto-DELETE;
- Google Drive remains the untouched master archive.

This policy supersedes the earlier technical-provisional-only display as the target rollout model.


### Admin null visual-score display fix — 2.10.2026

- technical provisional visual components are intentionally null until actual visual review;
- Admin no longer converts null to misleading 0/100;
- null visual components now display `טרם נבדק`;
- real numeric components continue to display their actual score;
- no underlying score data was changed.


### Full-portfolio visual curation rollout — 2.10.2026

PR #105 merged to `main` (squash merge `6feb0e658ce1e59646cac495292bbc619218ab96`).

What changed:
- The flower-pilot scoring model is now generalized to all 1,390 photos through `data/portfolio-curation-scores.json`.
- Existing completed flower visual reviews are preserved; owner decisions are not overwritten.
- Remaining photos start with `score_kind=pending_visual`.
- Sharpness, composition, light/color and category-fit stay `null` until an actual Claude Vision review is completed. Admin shows `טרם נבדק`, never a misleading 0/100.
- Full score formula remains:
  - 25% sharpness
  - 20% composition
  - 15% light/color
  - 15% resolution
  - 10% uniqueness
  - 10% category fit
  - 5% metadata
- Owner Review queue now follows the approved rule: only completed visual scores <=85 or a material problem enter Review.
- Scores >85 do not require owner confirmation.
- Admin export is now full-portfolio: `portfolio-curation-owner-review.json`.
- New incremental workflow: `.github/workflows/portfolio-visual-curation.yml`, default batch 200 still-unreviewed photos per run, with completed reviews preserved between runs.
- CI: Portfolio Visual Curation, Portfolio Visual Curation CI, Admin Flower Curation Pilot CI, Admin Campaign Links CI and Python Data Tests were green before merge.

Initial portfolio snapshot at merge:
- total: 1,390
- visual_complete preserved from flower pilot: 12
- pending_visual: 1,378
- initial owner-review-required among preserved completed scores: 11
- initial completed score >85 and clear: 1
- critical low-resolution candidates under the conservative threshold (long edge <1200 or short edge <800): 42

Safety / next step:
- The scoring pipeline itself is advisory and does not change D1/R2, category, published state or Google Drive.
- It performs no automatic DELETE.
- Automatic low-resolution HIDE has NOT yet been connected in PR #105. Keep it as a separate reversible production action so it can explicitly protect any existing KEEP / KEEP_SECONDARY owner decisions.
- Google Drive remains the untouched master archive.
- PAYMENTS_ENABLED remains false; PayPal PR #76 and Gelato remain separate/out of scope.


### Critical low-resolution auto-HIDE — 2.10.2026

PR #106 added the reversible auto-HIDE policy for critically low-resolution photos.
Its first production run stopped before changing any photo because the Cloudflare deployment token could not read D1 directly.

Hotfix PR #108 then moved the production action to the existing authenticated Admin API and merged as:
`22b8a5d969057bcb86893d153e43f7b59a47714e`.

Final production result:
- critical candidates under threshold (long edge <1200px OR short edge <800px): 42
- existing owner decisions found overall: 30
- critical candidates protected because they already had an owner decision: 6
- eligible critical candidates: 36
- actually HIDDEN: 36
- late protected during per-photo recheck: 0
- public-gallery verification: all 36 applied IDs are absent ✅
- DELETE operations: 0
- Google Drive changes: 0
- public cache purge: success

Safety behavior:
- any existing owner decision protects a photo from the resolution automation;
- HIDE is applied only through `published=false` and a stored HIDE curation decision;
- owner decisions are re-checked immediately before every individual mutation;
- if saving the HIDE decision fails after publication is changed, the workflow attempts to roll `published` back to true;
- no file is removed from R2 or Google Drive.

The visual-scoring workflow from PR #105 is independent of this resolution action and continues filling real visual scores incrementally.


### Business + PayPal progression — 2.10.2026

Acquisition Experiment 01:
- PR #109 merged to `main` as `73061ad1c2710fd6dd1f14d954b6fa93b1d737f3`.
- Business Live Verification now includes `/free-guide/` in addition to `/licensing/`, `/business/`, Admin UTM builder and payments-disabled guardrail.
- Technical launch gate is complete.
- The experiment is **launch-ready**, but the 7-day clock has NOT started yet because no first distribution action has been published/sent.
- No paid traffic, no automatic social publishing, no mass outreach.

PayPal Orders v2:
- Old PR #76 remains unmerged and should be treated as superseded for implementation purposes because it accumulated unrelated historical changes and is no longer suitable to merge onto current `main`.
- Clean replacement Draft PR #110 was created from current `main`.
- It preserves the previously validated PayPal security architecture: server-side Orders v2 create/capture, authoritative amount/currency/order identity checks, idempotency, rate limiting, duplicate capture recovery, verified webhook signature + dedup/recovery, isolated Sandbox staging, and permanent 410 for the legacy insecure completion endpoints.
- `PAYMENTS_ENABLED=false` remains unchanged.
- No checkout UI, PayPal Live, print activation or Gelato activation is included.
- PR #110 latest focused checks are all green: PayPal Orders v2 CI, Lead Funnel CI, Digital Licensing CI and B2B Funnel CI.
- The earlier unrelated full Node-suite failures were stale Admin dialog-count and homepage cache-busting expectations, not PayPal security failures.
- PR #110 remains Draft; do not merge or enable production payments until the deliberate next gate.


### PayPal Orders v2 merged safely — 2.10.2026

PR #110 merged to `main` as `f4f1f4438f1c4bd33e69f357ac2e7f21fe2c7e7f`.

Post-merge verification:
- Deploy Worker ✅
- Pages build/deployment ✅
- PayPal Orders v2 CI ✅
- Cloudflare deploy log explicitly shows `PAYMENTS_ENABLED: "false"` ✅
- Production D1 binding remains `amit-photos-db`.
- Production R2 binding remains `amit-photos-images`.
- Cache purge succeeded.
- Public PayPal create/capture routes remain fail-closed because the production flag is false.
- Legacy insecure payment completion endpoints remain permanently retired with HTTP 410.
- No PayPal Live activation and no Gelato activation occurred.

Acquisition Experiment 01:
- launch package merged in PR #111.
- Technical setup is complete.
- The 7-day window has not started because no real distribution action has been published/sent yet.
- First recommended distribution path remains Free Guide / Instagram.


### Continuation checkpoint — 2.10.2026

Current `main`: `44b958e94ee5c59c7cc215df263d0eb026aa5329`.

Verified after the PayPal merge and subsequent automation:
- latest Pages build/deployment on current main: success ✅
- scheduled automatic photo update run `37001467768`: success ✅
- PayPal Orders v2 remains merged and production payments remain disabled;
- Acquisition Experiment 01 remains technically launch-ready;
- the 7-day acquisition measurement window has **not** started because no real distribution action has been published/sent yet.

Documentation correction:
- PR #110 is now the canonical PayPal Orders v2 implementation merged to main.
- old PR #76 is superseded and must not be treated as the active implementation path.

Next execution order:
1. Keep production PayPal disabled.
2. Start Acquisition Experiment 01 with the Free Guide as the first distribution path when an actual external post/share is made.
3. Record the exact first-distribution timestamp as Day 1.
4. Keep campaign URL, offer, consent text, Free Guide asset and primary KPI frozen for the 7-day window.
5. Continue portfolio visual curation and owner review independently; do not let curation work alter the acquisition experiment variables.


### Acquisition Experiment 01 scorecard — 2.10.2026

PR #112 merged to `main` as `41a92befbf84def7dc2fa05c525fc78fbf8e2d26`.

What was added to the existing weekly GA report:
- campaign-level event attribution using `eventName + sessionCampaignName`;
- only the three frozen Acquisition Experiment 01 campaigns are included;
- deterministic scorecard for:
  - Free Guide — primary `guide_request_success`, secondary `generate_lead`;
  - Personal Licensing — primary `licensing_personal_interest`, secondary `purchase_intent`;
  - B2B Wall Art — primary `b2b_contact_start`, secondary `contact_form_success`;
- sessions, active users, primary-event count/rate and secondary-event count are persisted in `data/ga_reports.json`;
- the scorecard is included in the weekly email;
- no new workflow was added; the existing weekly GA workflow remains the single reporting path.

Validation before merge:
- Python Data Tests ✅
- Lead Funnel CI ✅

Experiment state is still **not started** until the first real external distribution action is actually published/sent.
Production payments remain disabled.


### Acquisition Experiment 01 launched — 2.10.2026

The first real distribution action is now verified live on Instagram.

Verified directly from the connected Instagram account `amite`:
- story id: `17882329722524331`
- published at: `2026-10-02T12:03:19Z`
- local Israel time: `2026-10-02 15:03:19 Asia/Jerusalem`
- channel/path: Free Guide / Instagram Story
- campaign: `202610_freeguide_photo_tips`

This timestamp is the official Day 1 start of Acquisition Experiment 01.
The 7-day measurement window is now active.

Freeze rules remain in force during the window:
- do not change destination pages;
- do not change campaign names;
- do not change primary KPI;
- do not change the core offer, licensing prices, consent wording, or Free Guide asset;
- do not add paid traffic or production PayPal.

Production payments remain disabled.


### Personal Licensing distribution — 2.10.2026

Second Acquisition Experiment 01 path published and verified on Threads:
- account: `Amit Erez (amite)`
- post id: `17906411154574588`
- permalink: `https://www.threads.com/@amite/post/Dd_dv6lDZUX`
- published at: `2026-10-02T12:17:23Z`
- local Israel time: `2026-10-02 15:17:23 Asia/Jerusalem`
- campaign: `202610_licensing_personal`
- UTM source/medium: `threads / social`

This is the second live distribution action.
The experiment's Day 1 clock remains anchored to the earlier Free Guide Instagram Story at 15:03:19 Israel time.


### Full-image visual curation merged — 2.10.2026

PR #107 `fix: use full images for visual curation scoring` was squash-merged to `main` as:
`e93dc43f5d71364375ae8eb8f0666939f6ba5052`.

What is now active:
- visual scoring starts from the full portfolio image, not the thumbnail;
- full images are normalized to a high-quality 1800px JPEG for Vision review;
- sharpness, composition, light/color and category-fit therefore use a materially better review source;
- rollout proceeds gallery-by-gallery;
- owner-review threshold remains <=85 or material problem;
- no automatic DELETE, category mutation, Google Drive mutation, or publication change is introduced by this scoring pipeline.

Post-merge workflow:
- Portfolio Visual Curation run `37008370236`;
- tests job: success ✅;
- score job: started automatically and is currently processing the next gallery batch;
- Pages deployment also started from the same merge commit.

Production payments remain disabled with `PAYMENTS_ENABLED=false`.
Acquisition Experiment 01 remains in its active 7-day measurement window and its frozen variables must not be changed.


### Maintenance cleanup — 2.10.2026

Completed:
- legacy PR #76 was closed without merge; PR #110 remains the canonical PayPal Orders v2 implementation;
- `TODO.md` was synced to the real acquisition state: Instagram Free Guide + Threads Personal Licensing live, B2B pending, 7-day freeze active;
- production payments remain disabled with `PAYMENTS_ENABLED=false`.

Open maintenance PR:
- PR #113 `chore: remove duplicate Spain and Andorra category key`;
- scope: one-file cleanup in `worker.js`;
- removes the duplicate `ספרד ואנדורה` key from `HE_TO_EN_CATEGORY`;
- surviving value is identical, so no behavior change is intended;
- no acquisition variables, payments, D1/R2 data, or Google Drive content are changed;
- CI was started and must be green before merge.


### Maintenance PR #113 merged — 2.10.2026

PR #113 `chore: remove duplicate Spain and Andorra category key` was squash-merged to `main` as:
`a798cc10a77f42eae01ae09bec4157ac5888f42b`.

Pre-merge CI:
- Lead Funnel CI ✅
- PayPal Orders v2 CI ✅

Change:
- removed the duplicate `ספרד ואנדורה` key in `worker.js`;
- surviving mapping value is unchanged;
- intended behavior change: none;
- removes the Wrangler duplicate-object-key warning source.

No acquisition experiment variables, production payment state, D1/R2 data, or Google Drive content were changed.


### Free Guide email-delivery reliability fix — 2.10.2026

User reported that the Free Guide signup appeared successful but no automatic email arrived.

Verified:
- Gmail contained no recent automatic Free Guide PDF message to the connected account;
- other Amit Photos emails from contact@amitphotos.com do arrive, so the symptom is specific to the Free Guide delivery path;
- the live /free-guide/ page is rendered by handleFreeGuide() in worker.js;
- existing-subscriber delivery previously swallowed Resend failures and still returned HTTP 200 / UI “Sent”.

PR #114 `fix: surface free-guide email delivery failures` was merged to main as:
`7fec9abd7c7eafa1877ff933b195a08f83c96845`.

Fix now live:
- Resend success/failure is checked for both new and existing subscribers;
- API returns `email_sent`, `email_delivery_attempted`, and a direct `download_url` for guide requests;
- Free Guide UI shows “Sent” only when the provider accepted the email;
- on delivery failure, signup still remains saved and the user gets a direct PDF download fallback;
- Lead Funnel CI now runs subscriber confirmation-email regression tests;
- explicit Resend 4xx regression tests cover both new and existing subscribers.

Pre-merge CI:
- Lead Funnel CI ✅
- PayPal Orders v2 CI ✅
- confirmation-email regression suite ✅

Production deploy:
- Deploy Worker run #461 / run id 37017099130 ✅
- Wrangler deploy ✅
- Cloudflare cache purge ✅

Important limitation:
- this fixes false-success reporting and guarantees a direct-download fallback, but the underlying Resend provider rejection/secret/domain cause is not yet independently confirmed from provider logs in this session.
- PAYMENTS_ENABLED remains false.
- Acquisition Experiment 01 offer/copy/UTM/primary KPI remain unchanged.


### Free Guide email root cause fixed and production-verified — 2.10.2026

Root cause confirmed:
- `RESEND_API_KEY` existed in GitHub Actions, but the production Cloudflare Worker had no `RESEND_API_KEY` binding;
- deploy logs before the fix listed DB, PHOTOS and PAYMENTS_ENABLED only;
- Resend showed no `POST /emails` calls from the Free Guide flow on the failure day;
- `amitphotos.com` is verified in Resend with sending enabled;
- the recipient address used for verification was not suppressed.

Fixes:
- PR #115 added secure sync of the existing GitHub Actions `RESEND_API_KEY` into the Worker using `wrangler secret put`;
- the first ordering attempt failed because Cloudflare requires the latest Worker version to be deployed before modifying secrets;
- PR #116 reordered deploy to: Worker deploy -> Resend secret sync -> cache purge;
- merge SHA for #116: `71583be0e839b9e8feac9f8cfc4ab6faa9c321fb`;
- Deploy Worker run #463 / run id `37018703520` completed successfully, including:
  - Deploy with Wrangler ✅
  - Sync Resend secret to Worker ✅
  - Cloudflare cache purge ✅

Live production smoke:
- a real `lead_magnet` signup was submitted with privacy consent and `consent_marketing=false`;
- smoke run `37019025883` passed and verified `email_sent=true` plus `email_delivery_attempted=true`;
- Resend recorded subject `הנה ה-PDF שלך — 50 טיפים לצילום` with status `delivered`;
- Gmail independently showed the same message in INBOX;
- no marketing consent was added by the test.

The temporary smoke workflow was removed after verification.
Production payments remain disabled with `PAYMENTS_ENABLED=false`.
Acquisition Experiment 01 offer/copy/UTM/primary KPI remain unchanged.


### Free Guide redesign — bilingual visual edition — 2.10.2026

Goal:
- replace the old `50tips-heb.pdf` and `50tips-eng.pdf` assets with a significantly more visual, beginner-friendly edition;
- preserve the existing file names/URLs so current signup/download flows continue to work;
- use the replacement moment as the new measurement baseline for the Free Guide asset;
- drive measurable return traffic from the PDF into relevant educational and portfolio pages.

Implementation branch:
- `feature/free-guide-redesign-2026-10-02`
- PR #117: `feat: redesign bilingual photography free guide`

What changed:
- both Hebrew and English guides rebuilt as 13-page photography-magazine style PDFs;
- 50 tips organized into visual chapters: composition, light/exposure, focus/sharpness, depth-of-field/macro, motion/timing, landscape/architecture, portrait/storytelling, night/color, black-and-white/editing;
- cover, chapter photography, practice page, and resource/end page use Amit's own portfolio images;
- image selection restricted to photos already marked:
  - `visual_complete`
  - score > 85
  - `owner_review_required=false`
  - `material_problem=false`
- contextual “why this works” explanations were added on chapter images;
- language was rewritten for beginner photographers, with shorter explanations and reduced unexplained jargon;
- a short beginner glossary was added;
- supported technical terms inside the PDF are themselves clickable, linking to the matching guide on amitphotos.com;
- examples include ISO/aperture/shutter speed/exposure, histogram, focus/continuous focus, depth of field, macro, white balance, panning, portrait, black-and-white, crop/editing;
- chapter-level “read the full guide” links remain available in addition to term-level links;
- end page links to:
  - galleries: `/#gallery`
  - all photography guides: `/camera/`
  - photo analysis/learning: `/learn/`
  - photography locations in Israel: `/locations/`
  - photography videos: `/videos/`

Measurement:
- PDF outbound links use:
  - `utm_source=free_guide`
  - `utm_medium=pdf`
  - `utm_campaign=202610_freeguide_photo_tips`
  - per-link `utm_content` values;
- final successful build contained:
  - Hebrew: 13 pages, 70 clickable links;
  - English: 13 pages, 71 clickable links;
- replacement of the live PDFs should be treated as the new Day 1 / baseline for evaluating the redesigned guide's downstream site engagement.

Build + QA:
- repeatable builder: `scripts/build_free_guide.py`
- build workflow: `.github/workflows/build-free-guide.yml`
- build metadata: `data/free-guide-build.json`
- final successful workflow run: `37026971570`
- generated PDF sizes are ~5.4 MB each;
- both PDFs rendered page-by-page after generation and were visually reviewed as full montages;
- no visible clipping, overlap, broken glyphs, or RTL layout failures were found in the final render;
- final guide build was also verified by `pdfinfo` as A4 / 13 pages for each language.

Important:
- the old guide content is being replaced in place at the same filenames rather than archived as a second public download;
- this does not re-enable payments; `PAYMENTS_ENABLED=false` remains unchanged;
- the Free Guide delivery reliability fixes from PRs #114-#116 remain in place;
- the design/copy/link changes are limited to the PDF asset and its build tooling.


### Free Guide redesign experiment — official restart — 2.10.2026

The redesigned Free Guide is now live in production and the measurement window has been explicitly restarted by user instruction.

Production release:
- PR #117 merged to `main` as `8ad3fee0a58a0f3f3c76cdd5859f290bec7f7a19`;
- Deploy Worker run `37028858995` completed successfully;
- GitHub Pages run `37028857612` completed successfully at 2026-10-02 18:45:13 Asia/Jerusalem;
- live assets remain at the same public filenames:
  - `50tips-heb.pdf`
  - `50tips-eng.pdf`

Official experiment restart:
- start timestamp: **2026-10-02 18:55:27 Asia/Jerusalem**;
- ISO timestamp: **2026-10-02T18:55:27+03:00**;
- this is the new Day 1 baseline for the redesigned Free Guide;
- planned 7-day measurement window: through **2026-10-09 18:55:27 Asia/Jerusalem**.

Measurement for the Free Guide path:
- campaign: `202610_freeguide_photo_tips`;
- primary KPI: `guide_request_success`;
- secondary KPI: `generate_lead`;
- PDF downstream engagement is additionally attributable through:
  - `utm_source=free_guide`
  - `utm_medium=pdf`
  - `utm_campaign=202610_freeguide_photo_tips`
  - per-link `utm_content`.

Freeze for this 7-day Free Guide measurement window:
- do not change the PDF asset;
- do not change the Free Guide destination page or core offer;
- do not change campaign naming / UTM schema;
- do not change the primary KPI definition;
- do not change consent wording specifically for the experiment;
- do not add paid traffic to this Free Guide experiment;
- keep production payments disabled with `PAYMENTS_ENABLED=false`.

Interpretation note:
- the earlier Acquisition Experiment 01 timestamps remain historical records for the previous asset/distribution phase;
- for evaluating the redesigned Free Guide itself, use **2026-10-02 18:55:27 Asia/Jerusalem** as the new baseline and do not mix pre-relaunch Free Guide performance into the 7-day redesigned-guide result.


### Admin bulk curation actions — 2.10.2026

Added owner-controlled bulk review helpers in Admin Photos:
- `בחר <1000px` selects every photo whose **short edge** is below 1000px.
- `בחר ציון <80` selects only photos with a **completed visual score** below 80; pending/provisional scores are excluded.
- Added matching stat/filter chips with live counts.
- Added `HIDE מהפרודקשיין` to the bulk action bar. It sets `published=0` and records owner decision `HIDE`.
- Existing bulk DELETE stays a separate destructive action with confirmation.
- No automatic delete/hide runs from these controls; the owner must select and confirm.
- Mobile-first toolbar behavior is preserved by the existing responsive Admin layout.
- PayPal/Gelato/payment configuration is unchanged.


### Bulk DELETE tombstone hotfix — 2.10.2026

User reported that photos deleted via the new bulk selector reappeared after refresh.

Root cause:
- bulk DELETE removed rows from D1/R2 but did not first persist a curation `DELETE` tombstone;
- Admin reload merges D1 with Drive-backed `data/photos.json`, so a deleted D1 row could immediately reappear as a Drive-only card after refresh, even before the scheduled importer ran.

Fix:
- bulk DELETE now writes the `DELETE` owner decision before destructive deletion, with rollback of the decision if deletion fails;
- regular photo-menu DELETE now uses the same tombstone-first behavior;
- Admin Drive merge excludes any Drive photo whose owner decision is `DELETE`;
- existing importer protection already honors the same `DELETE` tombstones, so deleted photos remain excluded on later Drive sync runs.

No Google Drive source file is deleted. PayPal/Gelato/payment configuration unchanged.


### Bulk HIDE <80 hardening — 2.10.2026

Before merging the DELETE tombstone hotfix, the bulk HIDE path was re-verified and hardened:
- `בחר ציון <80` now selects only photos that are actually in D1/R2 (production-managed), excluding Drive-only cards.
- It still requires `score_kind=visual_complete`; pending/provisional scores never qualify.
- Bulk HIDE sets `published=0` and then persists owner decision `HIDE`.
- If saving the HIDE decision fails after publication was changed, Admin attempts to roll the photo back to `published=1`.
- Already-hidden photos can still receive/refresh their owner `HIDE` decision without unnecessary publication writes.

This keeps bulk HIDE reversible and prevents silent partial state.


### Admin curation persistence + bulk actions — status after PR #120

Current merged state:
- PR #119 merged to `main`: owner-controlled bulk curation actions.
- PR #120 merged to `main` at merge SHA `c1b9c0bc7727a8635e1b72d08adbe4853ce5f03c`.
- CI for PR #120 passed 5/5 before merge.
- Production deploy for the PR #120 merge SHA has not yet been independently verified in GitHub Actions at the time of this handoff update.

Admin bulk curation capabilities now intended in `main`:
- `בחר <1000px` selects photos whose short edge is below 1000px.
- `בחר ציון <80` selects only D1/R2 photos with `score_kind=visual_complete` and visual score below 80.
- Bulk `HIDE מהפרודקשיין` sets `published=0` and persists owner decision `HIDE`.
- Bulk HIDE is transactional: if persisting the HIDE decision fails after publication was changed, Admin attempts rollback to `published=1`.
- Bulk DELETE now persists a `DELETE` tombstone before deleting the photo from D1/R2.
- Single-photo DELETE now uses the same tombstone-first behavior.
- Admin Drive merge excludes photos whose owner decision is `DELETE`, so deleted photos should not reappear after refresh.
- Existing Drive importer already respects DELETE tombstones and blocks re-import from Google Drive.
- Google Drive source files are not deleted by these Admin actions.

Incident that triggered PR #120:
- User bulk-deleted the <1000px group.
- Photos reappeared after refresh because the initial bulk DELETE path removed D1/R2 rows but did not write DELETE tombstones.
- Root cause fixed in PR #120.
- Photos deleted before the hotfix may need to be selected and deleted one more time after the corrected Production deploy is verified.

Next required verification:
1. Verify Deploy Worker / Production is running merge SHA `c1b9c0bc7727a8635e1b72d08adbe4853ce5f03c`.
2. In Admin, select `<1000px`, delete a small sample, refresh, and confirm they do not return.
3. Select `ציון <80`, run bulk HIDE, refresh, and confirm all selected photos remain `published=0` and retain owner decision `HIDE`.
4. After both pass, user can safely process the full batches.
5. Recount how many owner-review photos remain.

Operational constraints unchanged:
- `PAYMENTS_ENABLED=false`.
- Do not enable PayPal Production.
- Gelato remains out of scope.
- PR #76 PayPal remains separate and must not be merged as part of curation work.


### Drive-only bulk DELETE fix — 3.10.2026

After PR #120 reached Production, owner reported that bulk DELETE still appeared to do nothing after selection + confirmation.

Root cause:
- photos deleted before the tombstone hotfix had already lost their D1/R2 rows;
- after refresh they appeared as Drive-only cards from `data/photos.json`;
- the new bulk DELETE handler intentionally skipped non-R2 cards, so confirming DELETE on those returned cards incremented failures and left them visible.

Fix branch: `fix/bulk-delete-drive-only-2026-10-03`
- Drive-only cards are now deletable from the site by persisting owner decision `DELETE` only;
- no D1/R2 DELETE call is attempted when no D1/R2 row exists;
- after the tombstone is saved, the Drive-only card is removed from the Admin UI immediately;
- the existing Admin merge and Drive importer both honor the tombstone, so it stays gone after refresh and future sync;
- Google Drive source file remains untouched;
- R2-backed photos still use tombstone-first + real D1/R2 deletion with rollback on failure.


### Processed curation items hidden from action queues — 3.10.2026

Owner reported that after completing DELETE/HIDE work, logging out and back into Admin still showed already-treated photos in the bulk action queues.

Root cause:
- `<1000px` and `<80` filters/counts were derived only from dimensions/scores.
- persisted owner decisions were not used to exclude already-processed items.

Fix:
- `<1000px` queue excludes photos with owner decision `DELETE`.
- `<80` queue excludes photos with owner decision `HIDE` or `DELETE`.
- quick-select buttons apply the same exclusion rules.
- live counters apply the same exclusion rules.
- after login/reload, persisted curation decisions should therefore keep already-treated photos out of the actionable queues.


## 2026-10-03 — Reversible Google Drive HIDE archive
- Connected Google Drive account verified and root Portfolio folder identified as `1LpmT9PNKjCq5kb_GReuavkJPPbeMawMW`.
- Created external root folder `Amit Photos Hidden` (Drive id `1LxJF0lQecSZ5EFxTHu0Njr616CEaOmf5`). It is outside Portfolio, so the recursive Portfolio scanner will not index it.
- Added `src/sync_drive_curation.py` on branch `feature/drive-hide-archive-2026-10-03`.
- Intended behavior: owner decision `HIDE` moves the original Drive image out of Portfolio into the Hidden folder and records the exact original parent in `data/drive-curation-state.json`; changing the owner decision away from HIDE restores the image to that exact parent.
- The sync never permanently deletes Drive files. DELETE remains a separate tombstone/archive policy.
- Parent moves force removal of `data/last_scan.json` so the next agent run performs a full Portfolio rescan; Drive parent changes do not reliably change file modifiedTime.
- The daily `update-photos.yml` runs the HIDE sync before `agent_photos.py` and tracks the sync state file in commits.
- Admin HIDE now dispatches `update-photos.yml` best-effort immediately; bulk HIDE dispatches once after the batch. A dispatch failure never rolls back the website HIDE.
- `KEEP` / `KEEP_SECONDARY` now detects a previous curation HIDE, restores `published=1`, saves the new owner decision, and dispatches the Drive workflow so the original file can return to its recorded Portfolio parent.
- Safety fallback: production Google credentials are currently historically configured with Drive read-only scope. If the token lacks `https://www.googleapis.com/auth/drive`, the sync exits successfully with a PENDING message; website HIDE remains intact and the daily photo workflow is not broken. One-time Google reauthorization with Drive write scope is still required before automatic moves can execute from GitHub Actions.


## 2026-10-03 — Google Drive write re-authorization
- `src/refresh_token.py` now requests `https://www.googleapis.com/auth/drive` instead of `drive.readonly`.
- This is required for the reversible HIDE/RESTORE workflow to move files between `Portfolio` and `Amit Photos Hidden`.
- One-time owner action on a trusted local machine:
  1. Ensure `credentials.json` exists in the repo root.
  2. Run `python src/refresh_token.py` and approve the Google Drive permission in the browser.
  3. Update GitHub Actions secret with `gh secret set GOOGLE_TOKEN < token.json`.
  4. Run `gh workflow run update-photos.yml` and verify the sync step no longer reports PENDING.
- Do not paste `token.json` into chat or commit it to Git.


## 2026-10-03 — Drive HIDE/RESTORE live verification after write-scope reauth
- Owner regenerated the Google OAuth token locally and successfully updated GitHub Actions secret `GOOGLE_TOKEN`.
- PR #124 (`fix: Drive HIDE sync state and write-scope reauth`) merged to `main` at `62c926b6f67660978d4b6a2a040f8bffbcb94252`.
- Root cause of earlier runs #276/#277: `data/drive-curation-state.json` had literal escaped newlines and was invalid JSON; fixed in PR #124 and covered by a regression test.
- Workflow run #278 (`update-photos.yml`, manual dispatch) completed successfully end-to-end. Critically, step `סנכרון HIDE הפיך מול Google Drive` passed, followed by Agent, R2/D1 import, token refresh, Cloudflare secret sync, deploy, cache purge and DB migration — all green. This confirms the new GitHub token is accepted by the Drive HIDE/RESTORE sync path.
- A second manual run #279 was started almost simultaneously. Its Drive HIDE sync, Agent and import steps also passed. It later failed only at `Commit ו-push אם יש תמונות חדשות` because run #278 had already pushed changes to `main`, producing a rebase conflict in `data/last_scan.json`. This is a workflow concurrency/race issue, not a Drive permission failure.
- In #279, Cloudflare secret sync still succeeded for both `GOOGLE_CREDENTIALS` and `GOOGLE_TOKEN` after the git conflict.
- Follow-up hardening recommended: add workflow-level `concurrency` for `update-photos.yml` (single in-flight run, ideally `cancel-in-progress: false`) or otherwise serialize the commit/push stage so two update-photo runs cannot race on `data/last_scan.json`.
- Current operational meaning: reversible Drive HIDE/RESTORE is authorized and functioning at the workflow level. Do not start duplicate manual update-photo runs in parallel until concurrency hardening is merged.


## 2026-10-03 — Final OAuth write-scope verification (run #281)
- The local OAuth refresh flow was fixed by fully rewriting `src/refresh_token.py`; owner successfully generated a new `token.json`, updated GitHub Actions secret `GOOGLE_TOKEN`, and manually dispatched `update-photos.yml`.
- Run #281 (`37119359650`, SHA `9d8b49840735b216a2f544d4968958b300aea0cf`) completed successfully end-to-end.
- Crucially, the Drive curation step no longer logged `PENDING: Google Drive write scope is not authorized`. This confirms the new OAuth token has the required Google Drive write scope and the previous `drive.readonly` blocker is resolved.
- Drive curation summary from run #281: `moved=0, restored=0, skipped=18, tracked_hidden=0`.
- The 18 skipped HIDE decisions were skipped with `no verified Portfolio parent`. This is now the remaining functional issue: authorization is fixed, but those existing HIDE decision file IDs are not currently being verified as descendants of the configured Portfolio folder, so no Drive files were moved during #281.
- Operational status: website HIDE remains applied; OAuth write authorization is healthy; Drive move/restore still needs parent-mapping/Portfolio-parent diagnosis for the 18 existing skipped decisions before claiming end-to-end HIDE movement is complete.
- Do not reintroduce a read-only token. Keep using the regenerated OAuth token with `https://www.googleapis.com/auth/drive` scope.


## 2026-10-03 — Task closure pass
- PR #125 merged: empty `PORTFOLIO_FOLDER_ID` no longer disables the known Portfolio root fallback. One manual `update-photos.yml` run is still needed when owner is back at the terminal to verify the 18 existing HIDE decisions physically move to the external Hidden folder.
- PR #126 merged as `8ab9ef0ac881d62bedc1459127645d735d8dcdf3`: `update-photos.yml` now has workflow-level concurrency (`cancel-in-progress: false`), preventing duplicate runs from racing on `data/last_scan.json`.
- Old draft PR #118 was confirmed still conceptually needed but stale against current Admin code, so it was closed without merge.
- Replacement PR #127 merged as `d033bea373df586af7075f783740eead7bbd0e42`: Admin now retries persisted curation-decision loading, never interprets a failed load as an empty owner-decision map, and no longer invokes login twice.
- `TODO.md` was reconciled with current code/merged PRs: full-portfolio curation rollout, pending-score display, <=85 review routing, >85 auto-clear routing, photo-strength pipeline, and relogin persistence are marked complete where verified.
- Operational constraints unchanged: `PAYMENTS_ENABLED=false`; PayPal Production remains disabled; Gelato remains out of scope; redesigned Free Guide experiment remains frozen through the 7-day measurement window.


## 2026-10-03 — update-photos run #282 follow-up + visual curation unblock
- Manual `update-photos.yml` run #282 (`37124947838`) failed before HIDE processing because the Google access token had expired and google-auth attempted a refresh that re-sent scopes; Google returned `invalid_scope`.
- The same run also hit a separate Wrangler failure while syncing Worker secrets before deployment: current Wrangler refuses `secret put` when the latest Worker version is not yet deployed.
- PR #129 merged as `32bf611f2bc6a5114893ce19fe14cfe4f8d2bc07`:
  - Drive OAuth refresh now uses a direct refresh-token grant without re-sending scope.
  - refreshed authorized-user JSON preserves refresh token/scopes and writes `token_refreshed.json` so the existing GitHub secret update step can persist it.
  - Cloudflare Google secret sync now runs after deploy and only on runs that actually deploy.
- PR #128 merged as `70f550677ff8f64faa3efd72c6276db575ff3fd8`:
  - visual curation falls back to the original Google Drive image when the public/R2 full-image URL is missing (the six remaining flower items were returning 404).
  - one batch can now continue into the next gallery instead of wasting unused batch capacity.
  - the curation workflow receives `GOOGLE_TOKEN_JSON`, installs `google-auth`, and normalizes score state before validation instead of relying on a stale hard-coded portfolio count.
- Next verification required: dispatch `update-photos.yml` once more from current `main` and inspect the HIDE step logs. Success criteria: no `invalid_scope`, no `PENDING`, and actual `HIDE moved ...` lines for eligible decisions (or an explicit justified skip count).
- After that, the scheduled Portfolio Visual Curation workflow should be able to continue beyond the six previously-blocking flower images.


## 2026-10-03 — Drive HIDE end-to-end verification complete
- Manual `update-photos.yml` run #284 (`37126343871`) completed **successfully** on `dd5823362268f8800323d46f167904e0c5675b08`.
- Drive HIDE sync result: `moved=18, restored=0, skipped=0, tracked_hidden=18`.
- No `PENDING` or `invalid_scope` remained in the successful run.
- Google Drive readback of `Amit Photos Hidden` confirmed exactly 18 files present, matching the 18 moved IDs from the Actions log.
- `data/drive-curation-state.json` now tracks 18 hidden items, each with the original `source_parent_id`, so KEEP/KEEP_SECONDARY restoration remains reversible.
- The rest of run #284 also passed: Agent, token update, R2/D1 import, sitemap/assets, commit/push, Cloudflare deploy, Worker secret sync, cache purge, and DB migration.
- Next Drive-specific verification is only the reverse path: choose one hidden photo in Admin, set KEEP or KEEP_SECONDARY, then verify it returns to its exact recorded original Drive parent and is removed from Hidden.


## 2026-10-03 — RESTORE verified; queued checkout and push recovery fix

- Run #289 succeeded; Run #292 (37133231482) restored photo `1V2x1O-7f6CMhpmNghfzq3ce5r9yI-HKB` to original parent `1bTahC57r7wmDgzNXzm7t8U9RoF8vCVDO`. Its Drive summary was `moved=0, restored=1, skipped=0, tracked_hidden=24`.
- Run #292 then failed rebasing `data/drive-curation-state.json`, `data/last_scan.json`, and `data/photos.json`. Main still tracks 25 Hidden entries. Do not repeat the physical move or manually guess state from counts.
- Root cause: concurrency already serializes update-photo runs, but queued dispatches retain their original event SHA. Both #289 and #292 started at `47307afa658459f7f379b66ddf53208f35501229`; the default checkout let #292 process stale state after #289 had pushed.
- Fix prepared: checkout current `main` after acquiring the existing non-cancelling workflow lock; checkpoint Drive state and scan invalidation immediately, before agent/import/deploy; retry non-fast-forward pushes up to five times with rebase; fail on conflicts without force-push or automatic data replacement.
- Drive sync checkpoints each successful operation. An already-restored photo is removed from state only after verifying its exact original parent, and forces a catalog rescan. Partial failures preserve the completed operations; a failure artifact retains state for diagnosis.
- Asset version rewriting now happens after Git persistence, before deployment, so unrelated HTML changes cannot interfere with rebase.
- A narrow push trigger on the sync implementation/workflow/helper starts a fresh reconciliation after the fix merges, without requiring another manual dispatch.
- Local verification: 14 targeted tests, including real local bare-repository push rejection/rebase/conflict/exhaustion cases. Drive Sync CI added for the PR.
- Still pending at preparation: merge/check live reconciliation run, confirm state and actual Drive parents agree, and verify deploy/cache purge. Do not claim 24/24 until live readback.
- Payments stay disabled; no PayPal Production or Gelato changes.


## 2026-10-03 — Drive persistence fix CLOSED after live verification

- PR #132 merged as `20ba24a92ba3485b390af68bbc9daae5684955f6`; all three PR checks passed. Local targeted suite: 14/14.
- Automatic reconciliation run #293 (`37137012698`) completed successfully end-to-end: https://github.com/erezfamily-cmyk/amit-photos/actions/runs/37137012698
- Verified log: `RESTORE reconciled 1V2x1O-7f6CMhpmNghfzq3ce5r9yI-HKB: already in original parent 1bTahC57r7wmDgzNXzm7t8U9RoF8vCVDO`.
- Summary: `moved=0, restored=0, reconciled=1, skipped=0, tracked_hidden=24`. No second physical move was needed. Main readback confirmed 24 Hidden entries and the stale entry absent, correcting the 25-entry mismatch reported after #292. The exact photo parent was queried in Drive during #293; this is not a separate full Hidden-folder inventory count.
- State checkpoint pushed as `6049a57`; catalog/scan update pushed as `9ba49524bf390a9c51ec1bd55937354814efc9df`. Both persistence steps passed. Deployment, Worker secret sync, cache purge and DB migration all passed.
- Production Worker version reported by this run: `f4eb3e00-738a-47f6-8dc9-0b1bd2dbb0b9`.
- This supersedes the pending verification statements in the preparation entry above. Root cause was a stale queued checkout, not a failed RESTORE or missing Google write scope.
- Keep the existing workflow lock (`cancel-in-progress: false`) and `ref: main`; retries protect against unrelated remote commits but deliberately stop on same-file conflicts. GitHub concurrency may replace older pending runs; curation state is read afresh rather than treating dispatches as an ordered event journal.
- No owner terminal action needed for this fix. Next existing queue: continue remaining visual reviews; preserve the current acquisition experiment window and payment guardrails.


## 2026-10-03 — Full portfolio visual scoring COMPLETE

- PR #134 merged as `39f5d5c14c7d35e497744775b6afce103077275d`, expanding the scoring batch to the remaining portfolio and using the safe generated-data push helper.
- Run #23 (`37137970332`) passed and scored 832 photos. Nine items remained because public image retrieval failed and the score job lacked `google-auth`, so its authorized Drive fallback could not initialize.
- PR #135 merged as `b4362f76ae1c23cf20ca64a97b9f0cd20f076ca3`, adding `google-auth` to the score runtime. The follow-up run #25 (`37141784579`) scored the remaining 9 with `failures=0`.
- Final state committed to `main` as `9ee8a17f480c9cdc6099e23afaa55fc4cf72ceb0`: `total=1322`, `visual_complete=1322`, `pending_visual=0`, `completed_galleries=27/27`, `owner_review_required=569`, `auto_clear_above_85=753`, `critical_low_resolution=0`.
- The total is the current published catalog after Drive HIDE/RESTORE cleanup; the earlier pre-cleanup snapshot contained 1,346 items. All 1,322 items currently in the scoring state have complete visual components.
- `owner_review_required=569` is the score-based candidate count (score <=85 or a material problem) before Admin removes photos with an existing owner decision. Admin should continue showing only unresolved candidates, with problematic scores first. No image was automatically hidden or deleted by this scoring pipeline.
- Payments remain disabled (`PAYMENTS_ENABLED=false`); PayPal Production and Gelato were not changed.
