# מעבר ל-PayPal Orders API v2 — מסמך תכנון (30.9.2026)

> נכתב כהכנה לפגישת עבודה שמתחילה מחר בבוקר. **אין כאן קוד עדיין** — זהו מסמך עיצוב לאישור
> לפני שמתחילים לכתוב אינטגרציה בפועל. `PAYMENTS_ENABLED` נשאר `false` עד תום התהליך המלא
> (ראה "תנאי הפעלה" בסוף).

---

## 1. הבעיה — למה בכלל צריך מעבר

הזרימה הקיימת (PayPal Payments Standard, מתועדת ב-`docs/paypal-flow.md`) עובדת כך: הדפדפן של
הלקוח מנותב ישירות ל-PayPal עם המחיר ב-URL, ו-PayPal מנתב אותו בחזרה לאתר עם תוצאת התשלום
**כפרמטרים ב-URL** (`payment_status`, `receiver_id`, `mc_currency` וכו', דרך `rm=2`).
`handleVerifyPayment` וגם `handlePrintOrderComplete` (וורקר) **בודקים רק את הפרמטרים האלה** —
אין שום קריאה שרת-לשרת ל-PayPal לאמת שהתשלום באמת קרה.

**המשמעות בפועל:** מי שיודע לבנות URL עם `payment_status=Completed` והפרמטרים הנכונים, מקבל
טוקן הורדה או הזמנת הדפסה אמיתית (Gelato) **בלי לשלם בכלל**. זה נכון גם לרכישות דיגיטליות וגם
להדפסות — שתיהן עוברות דרך אותה שיטת אימות פגיעה. זו הסיבה המרכזית (לצד רה-ארגון UX) שהתשלומים
כבויים כרגע.

---

## 2. הפתרון — עקרון העל

**המחיר וסטטוס התשלום נקבעים אך ורק בצד שרת, דרך קריאות API ישירות ל-PayPal — לעולם לא דרך
פרמטר שחוזר מהדפדפן.**

זרימה (PayPal Smart Buttons — התבנית הרשמית המומלצת של PayPal ל-Orders API v2):

1. לקוח לוחץ על כפתור PayPal (JS SDK, לא redirect) → קורא ל-`POST /api/paypal/create-order`.
2. השרת שולף את המחיר **האמיתי** מ-D1 (לפי `photo_id`+גודל, או SKU הדפסה) ובונה הזמנה אצל
   PayPal (`POST /v2/checkout/orders`, OAuth2 client-credentials). שומר רשומת `paypal_orders`
   מקומית עם `status='CREATED'`. מחזיר ל-client רק את `paypal_order_id`.
3. הלקוח מאשר תשלום בחלון PayPal (popup — לא עוזב את האתר).
4. הכפתור קורא ל-`POST /api/paypal/capture-order` עם ה-`paypal_order_id` → השרת מבצע capture
   מול PayPal שרת-לשרת (`POST /v2/checkout/orders/{id}/capture`), מוודא `status==='COMPLETED'`
   **וגם** שהסכום שחזר מ-PayPal תואם למה שהשרת עצמו ציפה (הגנה כפולה). רק אז — יצירת טוקן הורדה
   (דיגיטלי) או הזמנת Gelato (הדפסה), בדיוק כמו היום אבל מאחורי אימות אמיתי.
5. **רשת ביטחון:** webhook נפרד (`POST /api/paypal/webhook`) עם אימות חתימה קריפטוגרפית
   (`POST /v1/notifications/verify-webhook-signature`), מאזין ל-`PAYMENT.CAPTURE.COMPLETED`.
   מתעד כל אירוע ומתאם מול D1 — למקרה שהלקוח סגר את הדפדפן בין שלב 3 לשלב 4 (תשלום בוצע,
   אבל קריאת ה-capture מה-client לא הספיקה לרוץ).

---

## 3. שינויים ב-D1

### טבלה חדשה: `paypal_orders`
```sql
CREATE TABLE paypal_orders (
  id TEXT PRIMARY KEY,                 -- ה-UUID שלנו
  paypal_order_id TEXT UNIQUE NOT NULL,-- המזהה שחוזר מ-PayPal ביצירת ההזמנה
  order_type TEXT NOT NULL,            -- 'digital' | 'print'
  photo_id TEXT NOT NULL,
  sku TEXT,                            -- גודל דיגיטלי / SKU הדפסה
  amount_expected INTEGER NOT NULL,    -- באגורות/סנטים — לעולם לא float
  currency TEXT NOT NULL,              -- 'ILS' לדיגיטלי, 'USD' להדפסה (משמר את ההתנהגות הקיימת)
  status TEXT NOT NULL DEFAULT 'CREATED', -- CREATED -> APPROVED -> COMPLETED | FAILED
  print_address_json TEXT,             -- רק להדפסות — נשמר בזמן create-order, לא מגיע שוב ב-capture
  created_at TEXT NOT NULL,
  completed_at TEXT
);
```
**אינדקס ייחודי על `paypal_order_id`** — זו נקודת האכיפה המרכזית ל-idempotency (capture כפול על
אותה הזמנה פשוט מוצא רשומה שכבר `COMPLETED` ומחזיר את התוצאה הקיימת, בלי ליצור טוקן/הזמנת
Gelato כפולה).

### טבלה חדשה: `paypal_webhook_events`
```sql
CREATE TABLE paypal_webhook_events (
  event_id TEXT PRIMARY KEY,  -- מזהה האירוע מ-PayPal עצמו — מונע עיבוד כפול של אותה התראה
  event_type TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processed INTEGER NOT NULL DEFAULT 0
);
```

### `print_orders` — ללא שינוי במבנה
ה-`paypal_tx` הקיים יוצא משימוש עבור הזמנות חדשות (מוחלף ב-`paypal_orders.id`), אך העמודה
נשארת לתאימות עם הזמנות היסטוריות. אין צורך במיגרציה של נתונים ישנים.

---

## 4. Endpoints חדשים (worker.js)

| Endpoint | מה עושה |
|---|---|
| `POST /api/paypal/create-order` | קלט: `{type, photoId, sku, printAddress?}`. שולף מחיר אמיתי מ-D1, יוצר הזמנה אצל PayPal, שומר `paypal_orders` (`CREATED`). מחזיר `{paypalOrderId}` בלבד — אף פעם לא מחזיר/מקבל סכום מה-client. |
| `POST /api/paypal/capture-order` | קלט: `{paypalOrderId}`. capture שרת-לשרת, בדיקת סכום כפולה, fulfillment (טוקן הורדה / הזמנת Gelato — לוגיקת ה-Gelato מ-`handlePrintOrderComplete` הקיים מנוצלת מחדש, לא משוכפלת). |
| `POST /api/paypal/webhook` | אימות חתימה, dedup לפי `event_id`, תיאום מול `paypal_orders` שלא הושלמו. |

`handleVerifyPayment` ו-`handlePrintOrderComplete` הישנים **מוסרים לגמרי** באותו PR שמפעיל את
הזרימה החדשה — לא משאירים שתי מערכות תשלום מקבילות. עד אז הם ממשיכים להיות מגודרים מאחורי
`PAYMENTS_ENABLED=false` כמו היום, כך שאין סיכון בשלב הפיתוח.

---

## 5. Secrets נדרשים (Cloudflare)

| שם | שימוש | מקור |
|---|---|---|
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` | OAuth2 client-credentials מול PayPal | Sandbox App ב-developer.paypal.com (מחר) → מוחלף בפרודקשן רק לקראת ההפעלה בפועל |
| `PAYPAL_API_BASE` | `https://api-m.sandbox.paypal.com` בפיתוח, `https://api-m.paypal.com` בפרודקשן | קבוע בקוד לפי env, לא סוד |
| `PAYPAL_WEBHOOK_ID` | נדרש לאימות חתימת webhook | נוצר כשמגדירים Webhook URL בדשבורד של PayPal |

טוקן ה-OAuth2 (`POST /v1/oauth2/token`) נשלף מחדש בכל קריאה בשלב הראשון — פשוט ונכון,
אופטימיזציה (caching) רק אם באמת תהיה בעיית latency/rate בפועל, לא מראש.

---

## 6. Checklist אבטחה — כל סעיף = דרישת קבלה, לא הצעה

- [ ] מחיר נשלף מ-D1 בצד שרת בלבד, לעולם לא מתקבל/נשלח מה-client ב-`create-order`.
- [ ] `capture-order` בודק שהסכום שחוזר מ-PayPal תואם ל-`amount_expected` השמור — לא רק שה-status הוא `COMPLETED`.
- [ ] webhook signature מאומת דרך קריאת API ל-PayPal (`verify-webhook-signature`) — לא רק "הגיע לנתיב הנכון".
- [ ] Idempotency: אינדקס ייחודי על `paypal_order_id`, ו-`event_id` ל-webhooks — capture/webhook כפול לא יוצר טוקן/הזמנת Gelato כפולה.
- [ ] כל שדה שמגיע מ-PayPal/מהלקוח לתוך HTML (מיילים, admin) עובר `escXml()` — תואם לתיקון האבטחה מ-PR #65.
- [ ] `PAYPAL_CLIENT_SECRET`/`PAYPAL_WEBHOOK_ID` ב-Cloudflare secrets בלבד, לא בקוד, לא ב-`wrangler.toml`.
- [ ] בדיקת `security-auditor` על כל הקוד לפני מיזוג ל-`main` (בנוסף לטסטים הרגילים).
- [ ] כל הפיתוח/בדיקות מול PayPal **Sandbox** בלבד — אפס עסקאות production עד ההפעלה הרשמית.

---

## 7. שינויים בצד לקוח (`assets/js/gallery.js`)

- הסרת `redirectToPayPal()` וקוד ה-`URLSearchParams` שבונה את בקשת ה-`_xclick` (כולל הסרת המחיר
  מהקוד שרץ בדפדפן — הוא כבר לא רלוונטי שם).
- טעינת PayPal JS SDK (`<script src="https://www.paypal.com/sdk/js?client-id=...">`), רינדור
  `paypal.Buttons()` בתוך מודל הרכישה הקיים (`openBuyModal`) במקום כפתור ה-submit הישן.
  `createOrder`/`onApprove` קוראים ל-endpoints החדשים בלבד.
- מסך "מבצע השבוע" ומודל ההדפסה (`print-complete.html`) עוברים לאותו דפוס.

---

## 8. תוכנית בדיקות

1. **טסטים אוטומטיים (Node)** — לוגיקת `create-order`/`capture-order` עם PayPal API מדומה
   (mock fetch): מחיר תמיד נלקח מ-D1, capture עם סכום לא תואם נדחה, capture כפול על אותה הזמנה
   לא יוצר fulfillment כפול, webhook בלי חתימה תקינה נדחה.
2. **בדיקת אבטחה** — `security-auditor` agent על כל ה-diff לפני מיזוג.
3. **E2E מול Sandbox** — רכישת-בדיקה אמיתית (חשבון קונה-Sandbox) דרך דפדפן אוטומטי, לתמונה
   דיגיטלית ולהדפסה, כולל מסלול כשל (ביטול תשלום, כרטיס-בדיקה שנדחה).
4. רק אחרי ששלושת אלה עוברים — שיקול הפעלה.

---

## 9. מה נשאר מחוץ לסקופ (v1) — בכוונה

- **עגלה/רכישה מרובה** — v1 תומך ברכישה בודדת בלבד (החלטה מפורשת, 30.9.2026). אפשר להוסיף
  בהמשך כשכבת נוספת מעל אותו core, בלי לשנות את `create-order`/`capture-order` באופן מהותי.
- שינוי מטבע — נשמרת ההתנהגות הקיימת (ILS לדיגיטלי, USD להדפסה), לא מאוחד.
- שמירת אמצעי תשלום / חיוב חוזר — לא רלוונטי למוצר הנוכחי.

---

## 10. תנאי הפעלה בפועל — שני תנאים, שניהם נדרשים

1. **חלון הבייסליין האנליטי מסתיים** (14–28 יום מ-26.9.2026 — ראה `docs/analytics-driven-ux-plan-2026-09-26.md`).
2. **הקוד עבר את כל שלבי "תוכנית הבדיקות" למעלה**, כולל בדיקת אבטחה.

עד שני התנאים מתקיימים, `PAYMENTS_ENABLED` נשאר `false` — כל העבודה בסעיף הזה יכולה (ואמורה)
להתקדם במקביל לחלון ההמתנה, לא לחכות לו.

## 11. מה עמית צריך להכין מחר בבוקר (חד-פעמי)

1. כניסה ל-developer.paypal.com עם חשבון ה-PayPal העסקי הקיים.
2. יצירת Sandbox App → קבלת `Client ID` + `Secret` (Sandbox, לא production).
3. יצירת חשבון קונה-Sandbox אחד לבדיקות (נוצר מאותו דשבורד).
4. שליחת שלושתם (Client ID / Secret / פרטי חשבון הקונה) — ומשם העבודה יכולה להתקדם באופן עצמאי.
