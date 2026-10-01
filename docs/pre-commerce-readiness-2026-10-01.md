# Pre-Commerce Readiness Plan — Amit Photos

עודכן: 1.10.2026  
מצב תשלומים: `PAYMENTS_ENABLED=false` — אין לפתוח רכישות אמיתיות בלי החלטה מפורשת נפרדת.

## מטרה

להגיע למצב שבו פתיחת רכישות היא החלטת Go/No-Go מבוססת:
1. אבטחת PayPal ו-fulfillment.
2. Sandbox E2E מבודד.
3. Webhook מאומת חתימה.
4. Orders v2 גם לדיגיטלי וגם להדפסות.
5. UX/רישוי/תנאי רכישה ברורים.
6. ארגון גלריה המבוסס על נתוני אמת ולא על ניחוש.
7. baseline אנליטי של לפחות 14 יום משינויי 26.9.2026.

## Gate 0 — מצב בטוח נוכחי

- [x] `PAYMENTS_ENABLED=false`.
- [x] PR #76 Draft ולא ממוזג.
- [x] PayPal credentials הם Sandbox בלבד.
- [x] D1 migration ל-`paypal_orders` ול-`paypal_webhook_events` הוחל ואומת.
- [x] Full Node suite: 318/318.
- [x] אין PayPal Live.
- [x] אין Webhook פעיל.
- [x] אין checkout ציבורי חדש.

## Phase 1 — Security Audit ל-PR #76

### כבר תקין
- [x] מחיר דיגיטלי מחושב בשרת מ-D1/settings; client amount נזרק.
- [x] SKU מוגבל ל-small/medium/large.
- [x] currency מוגבל ל-ILS/USD.
- [x] capture מתבצע server-to-server.
- [x] capture חייב להיות COMPLETED.
- [x] amount ו-currency חייבים להתאים בדיוק ל-`amount_expected`.
- [x] `PayPal-Request-Id` יציב ל-capture.
- [x] duplicate callback אחרי COMPLETED מחזיר fulfillment קיים.
- [x] public endpoints fail-closed כש-`PAYMENTS_ENABLED=false`.
- [x] admin Sandbox endpoints דורשים admin session.
- [x] secrets אינם ב-Git.

### ממצאים לתיקון לפני merge
- [x] **S1 — fulfillment persistence:** אחרי `INSERT OR IGNORE` ל-`download_tokens`, לאמת שה-token קיים לפני סימון order כ-COMPLETED.
- [x] **S2 — capture identity binding:** לאמת שגם `capturedOrder.id === paypalOrderId` וש-`purchase_units[0].custom_id === order.id`.
- [x] **S3 — failure recovery:** לכסות מקרה PayPal capture הצליח אבל כתיבת D1 נכשלה; retry חייב להתאושש בלי חיוב כפול.
- [x] **S4 — rate limiting:** לפני public go-live להוסיף rate limit ל-create-order ול-capture-order.
- [x] **S5 — create idempotency:** להוסיף idempotency key יציב מה-client/session כדי retry של create-order לא ייצור orders מיותרים.
- [ ] **S6 — Sandbox isolation:** לא לבצע E2E מול production D1; להקים staging/preview D1 נפרד.
- [x] **S7 — legacy payment removal:** לפני `PAYMENTS_ENABLED=true`, להסיר/לנתק את `handleVerifyPayment` ו-`handlePrintOrderComplete` מה-public router.
- [x] **S8 — webhook:** להוסיף אימות חתימה מול PayPal + dedup לפי `event_id`.
- [x] **S9 — logging:** לוודא שאין access token, Client Secret, buyer data או full PayPal payload רגיש בלוגים.
- [x] **S10 — CORS/CSRF:** לבצע בדיקות negative בפועל למסלולי admin וה-public checkout.

### Audit checkpoint — 1.10.2026

- S1/S2/S3 תוקנו בקוד ונוספו להם regression tests.
- Full Node suite אחרי התיקונים: **321/321 pass, 0 fail**.
- PayPal recovery מתייחס מפורשות ל-`ORDER_ALREADY_CAPTURED` וקורא את מצב ה-order מ-PayPal במקום לבצע חיוב נוסף.
- עדיין לא לבצע merge: S4/S5/S6–S10 פתוחים.

### Audit checkpoint 2 — 1.10.2026

- S4 rate limiting הוסף בצד שרת לפי SHA-256 של IP (ללא שמירת IP גולמי).
- S5 create-order idempotency הוסף עם `Idempotency-Key` + `PayPal-Request-Id` יציב.
- נוספה migration נפרדת `0002_paypal_security_hardening.sql` — עדיין לא הורצה בפרודקשן.
- Full Node suite: **323/323 pass, 0 fail**.
- השלב הבא: S6 staging isolation. אין לבצע Sandbox E2E מול production D1.

### Audit checkpoint 3 — 1.10.2026

- שני legacy public payment endpoints מחזירים כעת 410 תמיד; הם אינם תלויים יותר ב-`PAYMENTS_ENABLED`.
- סריקת diff: אין PayPal Live API, אין literal secret, ואין logging של access token/order payload.
- CORS אינו משקף origin זר; `Idempotency-Key` נוסף ל-allow headers ונוסף regression test.
- Full Node suite: **325/325 pass, 0 fail**.
- פתוחים לפני E2E/merge: S6 staging isolation ו-S8 webhook verified-signature.

### Audit checkpoint 4 — 1.10.2026

- S8 webhook implemented with PayPal postback signature verification against Sandbox.
- `PAYMENT.CAPTURE.COMPLETED` is cross-checked against the authoritative PayPal order, local `custom_id`, amount and currency before fulfillment.
- `event_id` dedup + concurrent-delivery serialization added.
- Unknown/foreign PayPal orders are acknowledged but never fulfilled.
- Full Node suite: **329/329 pass, 0 fail**.
- Code-level security audit S1–S5, S7–S10 is now closed. Remaining pre-E2E blocker is S6 staging isolation.
- Go-Live webhook gate remains open until real Sandbox webhook delivery is verified in isolated staging.

### Audit checkpoint 4 — 1.10.2026

- S8 webhook הושלם ברמת קוד עם verify-webhook-signature מול PayPal Sandbox.
- נוספו event dedup, identity/amount reconciliation מול Orders API, ו-processing lease עם stale recovery.
- delivery מקביל בזמן processing מחזיר non-2xx כדי ש-PayPal תנסה שוב; lease תקוע ניתן לתפיסה מחדש אחרי timeout.
- כשל processing מחזיר את האירוע ל-pending; hard crash מכוסה ע"י stale lease recovery.
- Full Node suite: **331/331 pass, 0 fail**.
- כל S1–S10 סגורים ברמת קוד למעט S6 staging isolation בפועל.

## Phase 2 — Staging מבודד

- [ ] Worker/preview נפרד.
- [ ] D1 test DB נפרד עם schema זהה.
- [ ] Sandbox secrets בלבד.
- [ ] `PAYMENTS_ENABLED=false` בפרודקשן נשאר ללא שינוי.
- [ ] נתוני test מסומנים ולא נכנסים לדוחות revenue/production.

## Phase 3 — Sandbox E2E דיגיטלי

- [ ] create → approve → capture → download.
- [ ] buyer cancel.
- [ ] decline / negative testing.
- [ ] refresh/back/retry.
- [ ] duplicate capture.
- [ ] שתי קריאות capture מקבילות.
- [ ] timeout אחרי PayPal capture ולפני fulfillment.
- [ ] DB failure simulation.
- [ ] download token קיים, חד-פעמי ובתוקף.
- [ ] סכום/מטבע/תמונה/גודל תואמים לרשומה המקומית.

## Phase 4 — Webhook

- [ ] `PAYMENT.CAPTURE.COMPLETED`.
- [ ] verify-webhook-signature מול PayPal.
- [ ] event_id dedup.
- [ ] reconciliation ל-order שכבר COMPLETED.
- [ ] recovery כש-browser נסגר אחרי תשלום.
- [ ] payload לא מהימן לא יוצר fulfillment לפני verification.

## Phase 5 — Print / Gelato

- [ ] price מקור אמין בצד שרת.
- [ ] address נשמר בזמן create-order.
- [ ] capture מאומת לפני Gelato.
- [ ] idempotency להזמנת Gelato.
- [ ] webhook Gelato + escaping.
- [ ] כשל Gelato אחרי חיוב: מצב recoverable + התראה למנהל.
- [ ] Sandbox/Mock E2E למסלולי success/failure.

## Phase 6 — Checkout / Legal / License

- [ ] להפריד בין גודל קובץ לבין סוג רישיון.
- [ ] להחליט Personal / Commercial policy.
- [ ] להסיר סתירה קיימת בין “שימוש מסחרי/כל הזכויות” לבין טקסטים שמפנים לרישיון מסחרי נפרד.
- [ ] תנאי רכישה.
- [ ] מדיניות ביטולים/החזרים.
- [ ] תנאי הדפסות ומשלוח.
- [ ] מה בדיוק מקבלים בכל מוצר דיגיטלי.
- [ ] HE/EN מלאים.

## Phase 7 — Gallery & Commerce UX

לא מוחקים את קטלוג התמונות. משנים את שכבת ה-discovery.

### מבנה מוצע
Collections ראשיות:
- טבע ונוף
- בעלי חיים
- מאקרו ופרחים
- מסעות בעולם
- ישראל
- אורבני ואמנות רחוב
- שחור-לבן
- מופשט וטבע דומם

מדינות הופכות לתת-collections תחת “מסעות בעולם”, במקום להתחרות כולן ברמת הניווט הראשית.

### בתוך Collection
- 24–36 תמונות חזקות תחילה.
- “בחירת הצלם”.
- “חדשות”.
- “הצג עוד”.
- בהמשך “פופולריות” ו-“מבוקשות” על בסיס data.

## Phase 8 — Data-Driven Photo Ranking

אין לבחור “תמונות חזקות” רק לפי טעם חזותי.

מקורות נתונים:
- GA4: `photo_view`, landing page, engagement, contact/purchase intent.
- D1 funnel events: views/intents/purchases לפי `photo_id`.
- Facebook/Instagram/social reports: clicks, reactions/engagement אם קיימים לפי post/photo.
- Pinterest/Redbubble/Zazzle כאשר יש mapping אמין לתמונה.

### Score ראשוני מוצע
לא להפעיל אוטומטית לפני שיש מספיק data:
- 35% photo views normalized.
- 25% high-intent actions: contact/purchase/print intent.
- 20% social click-through/engagement.
- 10% repeat interest / direct landing.
- 10% recency correction כדי לא לקבור תמונות חדשות.

כל score חייב לשמור גם sample size. תמונה עם 2 צפיות ו-click אחד לא תדורג מעל תמונה עם 200 צפיות ו-30 פעולות רק בגלל conversion rate.

## Phase 9 — Analytics Decision Window

המדידה החדשה עלתה ב-26.9.2026.

- checkpoint ראשון: סביב 10.10.2026 (14 יום).
- checkpoint מועדף: סביב 24.10.2026 (28 יום).

להשוות:
- `hero_gallery_click / sessions`
- `photo_view / sessions`
- `gallery_filter / sessions`
- `scroll_50`, `scroll_90`
- `photo_contact_click`
- `contact_form_success`
- mobile vs desktop
- landing pages
- source/medium
- strongest photos/collections

## Go-Live Gate

לא לשנות `PAYMENTS_ENABLED=true` עד שכל אלה מתקיימים:
- [ ] Security audit ללא Critical/High פתוח.
- [ ] Digital Sandbox E2E מלא.
- [ ] Webhook verified.
- [ ] Print E2E מלא או print נשאר מושבת במפורש.
- [ ] Legacy insecure endpoints אינם public.
- [ ] Legal/license copy סגור.
- [ ] Checkout QA ב-mobile + desktop + HE/EN.
- [ ] Analytics checkpoint נבדק.
- [ ] אישור מפורש של בעל הפרויקט לפתיחת רכישות אמיתיות.
