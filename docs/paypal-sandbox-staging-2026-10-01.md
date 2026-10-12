# PayPal Sandbox Staging — Amit Photos

עודכן: 1.10.2026

## מטרה

לבצע E2E אמיתי מול PayPal Sandbox בלי לכתוב ל-production D1 ובלי לאפשר רכישות באתר החי.

## עקרונות בידוד

- Worker נפרד: `amit-photos-paypal-sandbox`.
- D1 נפרד: `amit-photos-paypal-sandbox-db`.
- R2 נפרד מומלץ: `amit-photos-paypal-sandbox-images` עם 1–3 תמונות test בלבד.
- אין custom domain ואין route ל-`amitphotos.com`; משתמשים רק ב-workers.dev.
- אין cron triggers.
- PayPal API נשאר hard-coded ל-Sandbox.
- `PAYMENTS_ENABLED=true` מותר **רק** ב-Worker של staging כדי לבדוק את ה-flow המזויף; production נשאר `false`.
- Sandbox Client ID/Secret נשמרים כ-Secrets רק ב-Worker staging.
- אין שימוש ב-PayPal Live credentials בשום שלב.

## מה צריך ליצור ב-Cloudflare

1. D1 Database בשם `amit-photos-paypal-sandbox-db`.
2. R2 Bucket בשם `amit-photos-paypal-sandbox-images`.
3. Worker נפרד בשם `amit-photos-paypal-sandbox`.

לאחר יצירת D1:
- להחיל עליו את schema הבסיסי הנדרש ל-`photos`, `settings`, `download_tokens`, `sessions`.
- להחיל:
  - `migrations/0001_paypal_orders_v2.sql`
  - `migrations/0002_paypal_security_hardening.sql`
- להוסיף 1–3 רשומות `photos` test בלבד.
- להגדיר prices test ב-`settings`.

## Secrets ב-Worker staging

- `PAYPAL_CLIENT_ID` — Sandbox.
- `PAYPAL_CLIENT_SECRET` — Sandbox.
- בהמשך: `PAYPAL_WEBHOOK_ID` — Sandbox webhook של staging בלבד.
- `ADMIN_PASSWORD` — סיסמת staging נפרדת, לא production.

## אסור

- לא להשתמש ב-production D1.
- לא לקשר custom domain production.
- לא להעתיק PayPal Live credentials.
- לא להריץ E2E דרך `amitphotos.com`.
- לא להפעיל `PAYMENTS_ENABLED=true` ב-production.
- לא לערבב orders/tokens של Sandbox עם revenue reports של production.

## סדר E2E

1. `GET /api/admin/paypal/sandbox-status`.
2. create-order עם Idempotency-Key.
3. approve בחשבון buyer Sandbox.
4. capture.
5. בדיקת `paypal_orders`.
6. בדיקת `download_tokens`.
7. הורדה חד-פעמית.
8. duplicate capture.
9. buyer cancel.
10. decline / negative testing.
11. timeout/retry.
12. webhook recovery.

## תנאי מעבר הלאה

- כל הבדיקות עוברות ב-staging.
- אין כתיבה ל-production D1.
- אין Critical/High פתוח ב-security audit.
- production `PAYMENTS_ENABLED=false` מאומת שוב.


## מה כבר מוכן בריפו

- `wrangler.paypal-sandbox.example.toml` — config מבודד ללא custom routes וללא cron.
- `staging/paypal-sandbox-bootstrap.sql` — schema מינימלי + fixture test בלבד.
- `tests/paypal-staging-isolation.test.mjs` — guard שמונע שימוש ב-production D1/R2/domain ושומר production `PAYMENTS_ENABLED=false`.
- `.github/workflows/paypal-sandbox-staging.yml` — workflow ידני בלבד. הוא דורש:
  - staging D1 database ID.
  - הקלדה מפורשת של `DEPLOY_PAYPAL_SANDBOX_STAGING`.
  - הוא מסרב להמשיך אם ה-ID שווה ל-production D1 ID.

Full Node suite לאחר staging guard: **334/334 pass, 0 fail**.

## מה עדיין דורש פעולה ב-Cloudflare

1. ליצור D1 בשם `amit-photos-paypal-sandbox-db`.
2. ליצור R2 בשם `amit-photos-paypal-sandbox-images`.
3. להריץ על ה-D1 החדש בלבד את `staging/paypal-sandbox-bootstrap.sql`.
4. להריץ את workflow `Deploy PayPal Sandbox Staging` עם ה-D1 ID החדש.
5. ב-Worker staging להגדיר Sandbox secrets:
   - `PAYPAL_CLIENT_ID`
   - `PAYPAL_CLIENT_SECRET`
   - `ADMIN_PASSWORD` נפרד מ-production.
6. אחרי שיש URL workers.dev, ליצור ב-PayPal Sandbox webhook ל:
   `/api/paypal/webhook`
   ולשמור את ה-`PAYPAL_WEBHOOK_ID` כ-Secret ב-Worker staging.
7. רק אז להריץ Sandbox E2E.

לא להעתיק נתוני משתמשים או orders מ-production ל-staging.


## D1 staging verification complete — 1.10.2026

אומת ידנית ב-Cloudflare D1 Console:
- 6 tables + 4 indexes קיימים.
- fixture `paypal-sandbox-test-photo` קיים ו-`published=1`.
- prices: `{"small":1,"medium":2,"large":3}`.
- `paypal_orders` row count = 0.
- `download_tokens` row count = 0.
- `paypal_webhook_events` row count = 0.

סטטוס: D1 staging מוכן ל-Worker staging ו-Sandbox E2E.

## Temporary config path fix — 12.10.2026

### Native Preview configuration

The original unpinned `wrangler preview` failed because the configuration had no `previews` block. The attempted `wrangler@4.4.0 versions upload` replacement passed local dry-run but failed remotely at the Worker identity check. A similar CI-tag issue is reported at https://github.com/cloudflare/workers-sdk/issues/15682; that report is a possible explanation, not proof of the account's cause. Do not unset `WRANGLER_CI_MATCH_TAG` to bypass the identity check.

Generate a native Preview config with `--preview` and use Wrangler 4.149.0's Preview command:

```bash
python3 src/build_paypal_sandbox_config.py --database-id 7b027b93-c548-4ceb-bbe9-42c45264fc23 --preview --output /tmp/wrangler.paypal-sandbox-preview.json && npx --yes wrangler@4.149.0 preview --worker-name amit-photos-paypal-sandbox --config /tmp/wrangler.paypal-sandbox-preview.json
```

Set this only for the Sandbox Worker Preview command, and only on branches containing the updated helper. The Preview block explicitly uses Sandbox D1, R2 and Images; its public payment flag is false. Assets remain at the top level. Existing manual staging behavior is unchanged. Shared Preview secrets must be configured on Sandbox Previews Base separately before PayPal E2E. Local validation: 38/38 security/isolation tests and Wrangler 4.149.0 deploy dry-run passed. Native Preview creation cannot be tested locally without account access; remote verification is still pending.

- Reproduced the manual deployment failure with Wrangler 4.4.0: copying the TOML to `/tmp` left `main = "worker.js"` relative to `/tmp`, producing `The entry-point file at "worker.js" was not found.` Assets also resolved to `/tmp` instead of the repository.
- `src/build_paypal_sandbox_config.py` now generates a temporary JSON config with absolute repository paths. It validates the D1 UUID and rejects the production UUID before writing. The manual workflow consumes this generated config from `RUNNER_TEMP`.
- A Wrangler 4.4.0 `deploy --dry-run` passed with a dummy D1 UUID; no remote resources or payments were touched. Security and isolation tests: 37/37 passed.
- The separate Cloudflare Workers Builds check still fails on main. Its authenticated logs and deploy-command settings remain unavailable following a Cloudflare sign-in error. The manual workflow path bug is confirmed; it is **not yet proven** to explain that separate check.
- Check the Sandbox project's build/deploy command before enabling automatic deployment: the root `wrangler.toml` targets production `amit-photos`, while Sandbox requires its own generated config and isolated D1 ID. Do not rename the production config or copy production bindings into Sandbox.
