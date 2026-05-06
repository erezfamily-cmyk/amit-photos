# Camera Education — דף עדשות (מהדורה ראשונה)

## סקירה

אזור חינוכי חדש באתר — Hub + דף עמוק לנושא הראשון: עדשות.
קהל יעד: כולם — מתחיל לגמרי ועד בעל מצלמה שרוצה להעמיק.

---

## ארכיטקטורה

| דף | נתיב | סוג |
|----|------|-----|
| Hub | `/camera/` | HTML סטטי |
| עדשות | `/camera/lenses/` | HTML סטטי + Vanilla JS |

שני קבצים חדשים: `camera/index.html`, `camera/lenses/index.html`.
ללא שינויים ב-worker.js או D1 — נתוני תמונות מגיעים מ-`/api/photos` הקיים.

---

## Hub — `/camera/`

עמוד כרטיסיות בסגנון `/games/index.html`:
- Header עם חזרה לגלריה
- Hero: "מצלמה — בית ספר לצילום"
- כרטיסייה אחת בשלב זה: "עדשות"
- עיצוב: `--bg: #0a0a0a`, `--accent: #c8a96e`, Heebo + Syne (כמו שאר האתר)

---

## דף עדשות — `/camera/lenses/`

### ניווט
- TOC דביק בראש הדף: מרחק מוקד | בוקה וצמצם | Wide vs Tele | אנטומיה
- קישור חזרה ל-`/camera/`

### חלק 1 — מרחק מוקד (סליידר)
- `<input type="range" min="18" max="200">` — CSS accent-color: `var(--accent)`
- תמונה: "שדה תירס בעמק הירדן" (ID: `1WYUZNgWTJ5m46zjVstal1kEfpQI_Nntb`)
- אפקט: CSS `transform: scale()` מגדיל את התמונה ככל שהמ"מ עולה
- תווית טקסט דינמית: 18mm="עדשה רחבה — נופים", 35mm="קרובה לעין", 50mm="נורמלי", 85mm="פורטרטים", 135mm+="טלפוטו"

### חלק 2 — בוקה וצמצם (סליידר)
- `<input type="range" min="1.8" max="16" step="0.5">`
- **לוגיקה:** `blur = ((16 - v) / 15) * 14` — f/1.8 = טשטוש מקסימלי (~14px), f/16 = 0
- תמונה נושא: "פרפר לבן על פרחים" (ID: `10D5va4MnAh7QpagtevvTqzipMA3cS_8c`)
- תמונה רקע: "שדה פרחים בשפע" (lh3: `1d8LFk1t2KZRu2o8VmgJxszQCFPbEW-lg`)
- אפקט רקע: `backdrop-filter: blur(Xpx)` על overlay שמכסה רק תמונת הרקע

### חלק 3 — Wide vs Telephoto (השוואה סטטית)
- grid שתי עמודות
- Wide: "הכותל המערבי" (ID: `1ShiRcz-EvlJu6CG55sxIKZiCoLHgTSnx`) — 18mm
- Tele: "ינשוף שלג מתבונן" (ID: `17RW9kh-Ry3KiqOj_yM3oCK8FPOC88_JN`) — 300mm+
- תווית + תיאור קצר לכל אחת

### חלק 4 — אנטומיה של עדשה (SVG אנימציה)
- SVG אינלייני: גוף עדשה, 3 אלמנטי זכוכית (ellipses), סנסור
- 3 קרני אור עם `stroke-dasharray` + `@keyframes` — זורמות משמאל לנקודת מיקוד בסנסור
- אנימציה אוטומטית, ללא קלט

### CTA בתחתית
- "עכשיו תראה את זה בתמונות אמיתיות" + כפתור לגלריה

---

## ניווט ראשי

ב-`index.html` — הוסף קישור "מצלמה" בניווט הראשי (ליד "אתגרים"):
```html
<a href="/camera/" data-i18n="nav.camera">מצלמה</a>
```
הוסף מפתח `nav.camera` / `nav.camera_en` ב-`assets/js/i18n.js`.

---

## עיצוב

- ירושת CSS variables מהאתר: `--bg`, `--surface`, `--border`, `--accent`, `--text`, `--muted`
- Fonts: Heebo (גוף) + Syne (כותרות) — כבר נטענות ב-Google Fonts
- RTL: `dir="rtl"` על `<html>`
- כל קלטי ה-range: `accent-color: var(--accent)`
- כרטיסי תוכן: `background: var(--surface); border: 1px solid var(--border); border-radius: 14px`

---

## קבצים שמשתנים

| קובץ | שינוי |
|------|-------|
| `camera/index.html` | חדש — Hub |
| `camera/lenses/index.html` | חדש — דף עדשות |
| `index.html` | הוסף nav link "מצלמה" |
| `assets/js/i18n.js` | הוסף `nav.camera` + `nav.camera_en` |

---

## לא בסקופ (גרסה ראשונה)

- נושאים נוספים (פילטרים, כפתורי מצלמה) — יתווספו כדפים ב-`/camera/`
- מיני קוויז / הנחה
- אנימציות scroll-triggered
