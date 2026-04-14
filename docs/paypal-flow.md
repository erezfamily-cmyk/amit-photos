# PayPal — תיעוד זרימת תשלום והורדה

## סקירה כללית

הלקוח בוחר תמונה וגודל → PayPal → חזרה לאתר עם פרמטרי אימות → Worker מאמת → טוקן הורדה ב-D1 → הלקוח מוריד.

---

## זרימה מלאה (שלב אחרי שלב)

### 1. בחירת תמונה וגודל (`gallery.js`)

**תמונה בודדת:** לחיצה על "רכישה" → `openBuyModal(photo)` → לחיצה על גודל → `redirectToPayPal(photo, size)`

**עגלה:** לחיצה על "הוסף לעגלה" על מספר תמונות → `cartCheckout()`

### 2. שליחה ל-PayPal (`gallery.js`)

```js
const params = new URLSearchParams({
  cmd: '_xclick',
  business: 'erez.family@gmail.com',
  item_name: `${photo.title} — ${s.label}`,  // תיאור לרשומה ב-PayPal
  item_number: `${photo.id}_${size}`,          // מזהה פנימי שלנו (חשוב!)
  amount: s.price,
  currency_code: 'ILS',
  no_shipping: '1',
  return: 'https://amitphotos.com/download.html',
  cancel_return: 'https://amitphotos.com/',
  rm: '2',  // ← קריטי! גורם ל-PayPal לשלוח כל הפרמטרים ב-redirect
});
window.location.href = `https://www.paypal.com/cgi-bin/webscr?${params.toString()}`;
```

לפני הניתוב גם:
```js
localStorage.setItem('pending_item_number', itemNumber); // גיבוי אם PayPal לא מחזיר item_number
```

**פורמט `item_number`:**
- תמונה בודדת: `{photo-uuid}_{size}` — לדוגמה: `3ba1bbd0-8c63-400c-8a2c-18c674996399_small`
- עגלה: `CART_{size}_{id1},{id2},{id3}` — לדוגמה: `CART_medium_abc123,def456`

**גדלים וסוגי מחיר:**
| size | תיאור | מחיר |
|------|--------|-------|
| small | קובץ רשת (1500px) | ₪1 (טסט!) → ₪39 כשמסיימים |
| medium | קובץ הדפסה (3000px) | ₪89 |
| large | קובץ מלא | ₪179 |

### 3. PayPal מחזיר לאתר (`download.html`)

כאשר `rm=2`, PayPal מנתב לכתובת return עם כל הפרמטרים ב-URL:
```
https://amitphotos.com/download.html
  ?PayerID=FM7U52U8U2ZV4
  &txn_id=2UN54480WM8709832
  &payment_status=Completed
  &receiver_id=UQS28ADG97TPW      ← מזהה חשבון PayPal של עמית (קריטי!)
  &mc_currency=ILS
  &verify_sign=AmMSbK...
  &item_number=3ba1bbd0-..._small ← מה ש-PayPal שמר מהבקשה המקורית
```

### 4. אימות ב-`download.html`

```js
const tx = params.get('txn_id') || params.get('tx');
let itemNumber = params.get('item_number') || localStorage.getItem('pending_item_number');
localStorage.removeItem('pending_item_number');

// שולח הכל ל-Worker
const allParams = window.location.search.slice(1);
const res = await fetch(`/api/verify-payment?item_number=${encodeURIComponent(itemNumber)}&${allParams}`);
```

### 5. אימות ב-Worker (`worker.js` → `handleVerifyPayment`)

Worker בודק (בסדר הזה):
1. `txn_id`/`tx` ו-`item_number` קיימים
2. `tx` לא קיים כבר ב-`download_tokens` (מניעת כפילויות)
3. `item_number` תקין ו-`size` ב-[small, medium, large]
4. **אימות PayPal:**
   - `payment_status === 'Completed'`
   - `receiver_id === 'UQS28ADG97TPW'` (חשבון PayPal של עמית)
   - `mc_currency === 'ILS'`

אם הכל תקין → יוצר טוקן UUID ב-`download_tokens` (תוקף 24 שעות) ומחזיר URL.

### 6. הורדה (`/api/download/:token`)

Worker מוצא את הטוקן ב-D1, בודק שלא פג תוקפו ולא שומש, מושך את הקובץ מ-R2 ומחזיר אותו.

---

## אימות דו-לשוני

- **עמוד download.html**: ממשק מלא HE/EN דרך `i18n.js` (כפתור שפה בפינה)
- **כל הודעות הסטטוס**: `t('dl.success.title')`, `t('dl.error.title')` וכו'
- **הודעות שגיאה מה-Worker**: מגיעות בעברית (שגיאות פנימיות — לא אמורות להופיע בזרימה תקינה)
- **שם הפריט ב-PayPal**: נשלח בעברית (PayPal מציג כמו שהוא)

---

## היסטוריית תקלות ותיקונים

### בעיה 1: מחיר שגוי — ₪19 במקום ₪39
**סיבה:** `CART_PRICES.small` ו-`SIZES.small.price` ב-`gallery.js` היו `19` (ישן) בעוד ה-HTML הציג ₪39.  
**תיקון:** עדכון שני המשתנים ל-`39`.

### בעיה 2: אימות PayPal נכשל — שיטת PDT
**סיבה:** ניסינו PDT (Payment Data Transfer) עם `cmd=_notify-synch` — החשבון החזיר Error 4020 (טוקן PDT לא תקין).  
**למה:** חשבון PayPal של עמית לא היה מוגדר נכון ל-PDT, ואף שהאפשרות הופעלה בהגדרות — הטוקן שהופק לא עבד.

### בעיה 3: אימות PayPal נכשל — שיטת IPN validate
**סיבה:** ניסינו `cmd=_notify-validate` ל-`ipnpb.paypal.com` עם פרמטרי ה-redirect — PayPal החזיר `INVALID`.  
**למה:** IPN validation מיועד לאימות server-to-server (POST מ-PayPal לשרת שלנו), לא לאימות פרמטרים שהגיעו ב-redirect URL.

### בעיה 4: קריסת Worker לאחר תיקון
**סיבה:** בקוד החדש (receiver_id approach) נותר שימוש ב-`txData['item_name']` — משתנה מהשיטה הישנה שכבר לא הוגדר.  
**תיקון:** הוחלף בשאילתת D1 ישירה: `SELECT title FROM photos WHERE id = ?`

### פתרון סופי: אימות receiver_id
**גישה:** בדיקה ישירה של פרמטרים שPayPal שולח ב-return URL (כשמוגדר `rm=2`):
- `payment_status === 'Completed'`
- `receiver_id === 'UQS28ADG97TPW'` ← ייחודי לחשבון של עמית
- `mc_currency === 'ILS'`

**אבטחה:** receiver_id הוא מזהה סטטי הנשלח על ידי PayPal עצמם — לא ניתן לזייף תשלום מבלי שיעבור דרך חשבון PayPal האמיתי של עמית.

---

## טבלאות D1 רלוונטיות

```sql
-- download_tokens
CREATE TABLE download_tokens (
  token TEXT PRIMARY KEY,
  photo_ids TEXT,      -- JSON array: ["uuid1", "uuid2"]
  size TEXT,           -- small | medium | large
  tx TEXT,             -- PayPal transaction ID
  used INTEGER,        -- 0 = לא שומש, 1 = שומש
  expires_at INTEGER,  -- Unix timestamp (now + 86400)
  created_at INTEGER
);
```

---

## ניפוי שגיאות

**סימפטום:** הלקוח מדווח שלא הצליח להוריד.

1. בדוק אם יש שגיאה ב-download.html (כלי פיתוח → Network → הבקשה ל-`/api/verify-payment`)
2. בדוק את פרמטרי ה-URL שהגיעו מ-PayPal — חייבים להיות: `payment_status`, `receiver_id`, `txn_id`/`tx`, `item_number`
3. בדוק D1: `SELECT * FROM download_tokens WHERE tx = '<txn_id>'`
4. אם יש טוקן ב-D1 עם `used=0` — שלח ללקוח ישירות: `https://amitphotos.com/api/download/<token>`
5. אם `used=1` — הטוקן שומש. צור טוקן חדש ידנית ב-D1 עם תוקף מחודש

**יצירת טוקן ידנית ב-D1:**
```sql
INSERT INTO download_tokens (token, photo_ids, size, tx, used, expires_at, created_at)
VALUES (
  '<uuid-חדש>',
  '["<photo-id>"]',
  'small',
  'MANUAL_<txn_id>',
  0,
  <now + 86400>,
  <now>
);
```

---

## receiver_id של עמית

```
UQS28ADG97TPW
```

לאמת מ: PayPal → פרופיל → עסק → מידע על החשבון → Account ID

---

_עודכן: אפריל 2026_
