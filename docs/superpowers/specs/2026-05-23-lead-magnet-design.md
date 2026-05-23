# Lead Magnet — PDF חינם לגיוס נרשמים
**תאריך:** 2026-05-23
**סטטוס:** מאושר

## בעיה
אין נרשמים לניוזלטר ואין תנועה שממירה. הבעיה אינה טכנית — "הישארו מעודכנים" אינו מניע אנשים לתת מייל. דרושה הצעת ערך מיידית ומוחשית.

## פתרון
PDF חינמי — "50 טיפים לצילום טוב יותר" (קיים כבר: `50tips-heb.pdf`, 15 עמ') — בתמורה למייל. מי שנותן מייל מקבל PDF מיידי ונכנס לרשימת הניוזלטר.

## פאנל
```
פייסבוק / אינסטגרם → /free-guide/ → POST /api/subscribers → מייל + PDF → ניוזלטר חודשי → מכירות
```

---

## קומפוננטות

### 1. PDF — אחסון
`50tips-heb.pdf` מחויב לריפו ומוגש כ-static asset ע"י Cloudflare (`wrangler.toml`: `[assets] directory = "."`).
URL: `https://amitphotos.com/50tips-heb.pdf`

### 2. דף נחיתה `/free-guide/`
נתיב חדש בworker.js: `GET /free-guide/` → HTML.

**Layout B (ספליט):**
```
┌─────────────────────────────────────────┐
│  תמונה מהגלריה    │  🎁 חינם לגמרי      │
│  (RANDOM, R2)      │  50 טיפים לצילום    │
│                    │  טוב יותר           │
│                    │  PDF · 15 עמ'        │
│                    │  ┌────────────────┐  │
│                    │  │ המייל שלך...   │  │
│                    │  └────────────────┘  │
│                    │  [שלח לי ←]         │
│                    │  קבלת PDF +         │
│                    │  ניוזלטר חודשי      │
│                    │  בטל בכל עת         │
└─────────────────────────────────────────┘
```

- תמונה: `SELECT id, r2_key, title FROM photos WHERE published=1 AND r2_key IS NOT NULL ORDER BY RANDOM() LIMIT 1`
- טופס: POST `/api/subscribers?source=lead_magnet`
- שפה: עברית + EN toggle (applyLang קיים)
- RTL, dark theme (`#111` / `#c8a96e`)
- redirect לאחר הגשה: הודעת הצלחה inline (לא redirect)

### 3. עדכון `handleSubscribers` (POST)
הוספות לפונקציה הקיימת:

**a. עמודת `source`** — migration (idempotent):
```sql
ALTER TABLE subscribers ADD COLUMN source TEXT DEFAULT 'website';
```

**b. קריאת source:**
```js
const source = new URL(request.url).searchParams.get('source') || 'website';
// שמור ב-INSERT
```

**c. מייל ברוכים הבאים — שני סוגים:**

אם `source === 'lead_magnet'` או `source === 'popup'`:
```
נושא: "הנה ה-PDF שלך — 50 טיפים לצילום"
תוכן:
  - כפתור: [הורד את ה-PDF →] → https://amitphotos.com/50tips-heb.pdf
  - פסקה: "...בנוסף, תקבל את הניוזלטר החודשי שלי עם תמונות, מקומות ומדריכים"
  - קישור לביטול (קיים)
```

אם `source === 'website'` (הרשמה רגילה מהomepage):
```
נושא קיים: "ברוך הבא לניוזלטר של עמית פוטוס!"
תוכן קיים — ללא שינוי
```

### 4. Exit-Intent Popup
קוד JS inline ב-`index.html` (ואחר כך `locations/spot/index.html` ודפי camera).

**Trigger logic:**
- Desktop: `document.addEventListener('mouseleave', ...)` — עכבר יוצא מחלון
- Mobile: `setTimeout(30000, show)` — אחרי 30 שניות
- Guard: `localStorage.getItem('pdfPopupSeen')` — מציג פעם אחת בלבד (לא per-session, לצמיתות)

**HTML:**
```html
<div id="pdf-popup" style="display:none;..."> <!-- overlay -->
  <div class="pdf-popup-inner">
    רגע לפני שאתה הולך...
    50 טיפים לצילום — חינם
    [input email] [שלח לי ←]
    "לא תודה" — סגירה
  </div>
</div>
```

POST לאותו `/api/subscribers?source=popup`.
עם הגשה: הודעת הצלחה + `localStorage.setItem('pdfPopupSeen','1')`.

**עיצוב:** overlay כהה + כרטיס מרכזי, אותה פלטת צבעים (`#1a1a1a`, `#c8a96e`).

### 5. הוספת שורת PDF לפוסטים אוטומטיים

**`src/instagram_post.py`** — בפונקציה `generate_caption`:
```python
# לפני return
PDF_FOOTER = "\n\n🎁 PDF חינם — 50 טיפים לצילום:\namitphotos.com/free-guide"
return f"{caption_text}{PDF_FOOTER}\n\n{hashtags}"
```

**`src/facebook_post.py`** — אותה הוספה בסוף ה-message/caption שנשלח.

### 6. טקסט לפוסטים ידניים בפייסבוק
לשימוש בקבוצות צילום ישראליות (לא להעתיק מילה במילה — לכתוב בטבעיות):

> צילמתי כבר למעלה מ-10 שנים ועשיתי הרבה טעויות בדרך 😅
> ריכזתי את **50 הטיפים שהכי שינו לי את התמונות** ב-PDF חינמי — מקומפוזיציה ועד עריכה.
> אם תרצו: **amitphotos.com/free-guide**

---

## קבצים שמשתנים

| קובץ | שינוי |
|------|-------|
| `worker.js` | נתיב `/free-guide/` חדש + עדכון `handleSubscribers` + migration |
| `50tips-heb.pdf` | commit לריפו (static asset) |
| `index.html` | exit-intent popup script |
| `locations/spot/index.html` | exit-intent popup script |
| `src/instagram_post.py` | PDF_FOOTER ב-`generate_caption` |
| `src/facebook_post.py` | PDF_FOOTER בפוסט |

---

## אין שינויים ב
- מסד הנתונים מלבד עמודת `source` (migration idempotent)
- עמודת הניוזלטר הקיימת ב-index.html — נשארת כמות שהיא
- עיצוב שאר האתר

---

## הגדרת הצלחה
- 10 נרשמים ראשונים תוך שבועיים מפרסום
- שיעור המרה בדף הנחיתה ≥ 20%
