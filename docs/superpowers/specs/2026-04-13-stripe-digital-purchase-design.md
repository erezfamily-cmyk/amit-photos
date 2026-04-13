# עיצוב: רכישת תמונות דיגיטליות — Stripe
**תאריך:** 2026-04-13  
**סטטוס:** מאושר

---

## מטרה

הוספת אפשרות לרכישת תמונות דיגיטליות (קובץ JPG ברזולוציה מלאה מ-R2) ישירות מהאתר דרך Stripe Checkout. ההדפסות דרך Gelato+PayPal אינן משתנות.

---

## זרימת משתמש

```
לחיצה "רכוש תמונה" בלייטבוקס
  → POST /api/stripe/checkout  { photo_id }
  → redirect → Stripe Checkout (מחוץ לאתר)
  → תשלום מוצלח
  → Stripe webhook → POST /api/stripe/webhook
      → שמירת download token ב-D1 (תוקף 24 שעות, חד-פעמי)
  → redirect → /purchase-success?token=xxx
  → לחיצה "הורד תמונה"
  → GET /api/download/{token}
      → מאמת token, מסמן כנוצל
      → redirect → R2 URL לקובץ המלא
```

---

## מחיר

- **49₪** לתמונה (ברירת מחדל, ניתן לשינוי עתידי לפי תמונה)
- מטבע: ILS (שקל ישראלי — נתמך ב-Stripe)

---

## ארכיטקטורה

### D1 — טבלה חדשה: `download_tokens`

```sql
CREATE TABLE download_tokens (
  token      TEXT PRIMARY KEY,
  photo_id   TEXT NOT NULL,
  session_id TEXT NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
```

### Secrets חדשים ב-GitHub + Cloudflare Worker

| Secret | תיאור |
|--------|--------|
| `STRIPE_SECRET_KEY` | מ-Stripe Dashboard → Developers → API Keys (sk_live_...) |
| `STRIPE_WEBHOOK_SECRET` | מ-Stripe Dashboard → Webhooks → Signing secret (whsec_...) |
| `STRIPE_PUBLISHABLE_KEY` | מ-Stripe Dashboard (pk_live_...) — אופציונלי, לא נחוץ ל-Checkout |

### Worker — endpoints חדשים

#### `POST /api/stripe/checkout`
```
body: { photo_id: string }
→ מאמת שהתמונה קיימת ב-D1
→ יוצר Stripe Checkout Session:
   mode: payment
   line_items: [{ price_data: { currency: "ils", unit_amount: 4900, product_data: { name: photo.title } } }]
   success_url: /purchase-success?token={CHECKOUT_SESSION_ID}
   cancel_url: /#photo-{photo_id}
   metadata: { photo_id }
→ מחזיר { url: session.url }
```

#### `POST /api/stripe/webhook`
```
→ מאמת Stripe-Signature header (HMAC עם STRIPE_WEBHOOK_SECRET)
→ מטפל ב-event: checkout.session.completed
   → שולף photo_id מ-metadata
   → יוצר token: crypto.randomUUID()
   → שומר ב-download_tokens (expires = now + 86400s)
→ מחזיר 200
```

> **חשוב:** webhook חייב לאמת את ה-signature לפני כל פעולה. Stripe ידחה בקשות לא חתומות.

#### `GET /api/download/{token}`
```
→ שולף token מ-D1
→ בודק: קיים? לא נוצל? לא פג תוקף?
→ מסמן used = 1
→ שולף r2_key של התמונה מ-D1
→ redirect → /photos/{r2_key} (מ-R2 ישירות)
```

### Frontend — שינויים

**לייטבוקס** (`assets/js/gallery.js`):
- הוספת כפתור "רכוש תמונה 49₪" לצד כפתור ההדפסה הקיים
- לחיצה → `fetch('/api/stripe/checkout', { photo_id })` → `window.location = data.url`

**עמוד הצלחה** (`purchase-success.html` — קובץ חדש):
- קורא את ה-token מה-URL
- מציג כפתור "הורד תמונה" שמפנה ל-`/api/download/{token}`
- הסבר שהקישור תקף 24 שעות

---

## מה לא כלול (YAGNI)

- שליחת email עם קישור הורדה (אין תשתית email באתר)
- מחיר שונה לפי תמונה
- היסטוריית רכישות ב-admin
- רכישת מספר תמונות בבת אחת

---

## קבצים שמשתנים

| קובץ | שינוי |
|------|-------|
| `worker.js` | 3 endpoints חדשים + יצירת טבלה ב-D1 |
| `assets/js/gallery.js` | כפתור "רכוש תמונה" בלייטבוקס |
| `purchase-success.html` | עמוד חדש לאחר תשלום |

---

## Stripe Account Setup (ידני — לפני מימוש)

1. הרשמה ל-[stripe.com](https://stripe.com) (חשבון ישראלי)
2. Dashboard → Developers → API Keys → העתק `Secret key` + `Publishable key`
3. Dashboard → Developers → Webhooks → Add endpoint:
   - URL: `https://amitphotos.com/api/stripe/webhook`
   - Events: `checkout.session.completed`
   - העתק `Signing secret`
4. הוסף ל-GitHub Secrets: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
5. הוסף ל-Cloudflare Worker env vars: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
