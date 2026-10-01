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
