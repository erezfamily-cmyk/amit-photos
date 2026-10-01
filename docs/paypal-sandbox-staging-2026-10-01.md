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
