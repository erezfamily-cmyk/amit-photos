# CHANGELOG — amitphotos.com

רישום כרונולוגי של שינויים משמעותיים באתר.

---

## 2026-05-17

### אנליטיקס — שדרוג משמעותי

**Worker (`worker.js`):**

- `trackPageView(env, request, page)` — הורחבה עם פרמטר `page` אופציונלי
- טבלת `analytics_pages` נוצרת אוטומטית (date, page, views)
- Router מעביר `page` לכל נקודת כניסה: `home`, `photo`, `category`, `learn`, `learn_detail`, `location`, `camera`, `games`, `sale`
- `handleAnalytics` מחזיר עכשיו: `daily`, `countries`, `pages`, `weekTotal`, `prevWeekTotal`

**Admin (`admin.html`):**

- KPI cards חדשות: צפיות השבוע + Δ% שבועי, מדינה מובילה, דף פופולרי
- גרף Top Pages אופקי (10 סוגי דפים)
- עמודת "% כוונה" בפאנל ההמרה (כוונת רכישה ÷ צפיות)

### עורך ניתוח תמונה — תמיכה אנגלית מלאה

**Admin (`admin.html`):**

- כפתור 🌍 בכל שורת ניתוח — קריאה ל-`/api/analyses/{id}/generate-en`
- Badge **EN✓** מוצג לצד ניתוח שכבר תורגם
- Accordion "תוכן אנגלי (EN)" בתוך העורך:
  - כותרות קומפוזיציה (3 פסקאות)
  - הסברי מצלמה (aperture, shutter, ISO, focal)
  - תגיות באנגלית (`tags_json_en`)
  - תוויות annotations באנגלית (`label_en` לכל annotation)
- `learnGenerateEn()`, `annEnRender()`, `annUpdateEn()`, `buildCompHtmlEn()` — פונקציות חדשות
- `learnSave()` + `learnEdit()` מעודכנים לכלול שדות EN

### תיקון קריסת Worker — עמודי מקומות

**Worker (`worker.js`):**

- `safeJson(s, fallback)` — helper שעוטף JSON.parse ב-try/catch
- מוחל בכל 4 handlers של locations: `handleAdminLocationsGet`, `handleLocationsGet`, `handleAdminLocationsCreate`, `handleAdminLocationsUpdate`
- שדות מוגנים: `related_guides`, `extra_links`, `when_to_visit`, `recommended_gear`, `when_to_visit_en`, `recommended_gear_en`
- תיקן 500 errors על טוסה דה מאר + אנדורה

### מקומות חדשים

- **טוסה דה מאר (ספרד)** — נוצר, הועשר, תורגם לאנגלית
- **אנדורה** — נוצר, הועשר, תורגם לאנגלית
- סה"כ מקומות: **15**

### שיפורי המרה — 4 תכונות חדשות

**Lightbox — רמז מחיר:**

- כפתור "רכישה" מציג עכשיו "— החל מ-₪X" עם המחיר בפועל של התמונה
- מחושב ב-`openLightbox()` דרך `getEffectivePrice(photo.id, 'small')`

**מחירי USD (אנגלית בלבד):**

- בסקשן מחירים בדף הבית, מתחת לכל מחיר: `~$5 / ~$16 / ~$35`
- מוצג רק כש-`html[lang="en"]` (CSS selector)

**Explore Strip — דף הבית:**

- סקשן חדש בין `#awards` ל-`#platforms`
- 3 כרטיסיות: 📷 למד לצלם, 🔍 ניתוח תמונות, 📍 מקומות לצילום
- מפנה ל-`/camera/`, `/learn/`, `/locations/`
- דו-לשוני מלא (מפתחות `explore.*` ב-i18n.js)

**קוויז — קופסת הנחה עם ספירה לאחור:**

- כשמנצחים (6+ נכון): מופיעה קופסה עם "🎁 20% הנחה על כל הגלריה!"
- טיימר חי של 30 דקות (`setInterval` כל שנייה)
- מסתיר אוטומטית בתחילת משחק חדש

---

## 2026-05-16

### לוקליזציה — מקומות לצילום

- עמוד מקום בודד (`/locations/spot/`) — תמיכה מלאה EN/HE
- שדות `when_to_visit_en`, `recommended_gear_en` ב-D1
- Admin: לשונית אנגלית בעורך מקום עם Generate EN

### פרסום סושיאל — מקומות

- Workflow `location-social-post.yml` — פרסום round-robin ל-4 רשתות

---

## 2026-05-14

### הרחבת מקומות

- locations expansion — הוספת מקומות ממדינות שונות
- Enrichment אוטומטי עם Claude בזמן יצירה

---

## 2026-05-10

### מקומות לצילום — `/locations/` (השקה)

- D1: טבלאות `locations` + `location_photos`
- Worker: 9 routes (public + admin)
- `/locations/index.html` — Hub עם פילטר אזורים + מפה Leaflet
- `/locations/spot/index.html` — עמוד מקום מלא: גלריה, מפה, מדריכים קשורים
- Admin tab ניהול מקומות עם עורך מלא + ניהול תמונות

---

## 2026-05-08

### בית ספר לצילום — עמודים נוספים

- `/camera/dynamic-range/` — טווח דינמי
- איקונים SVG Gold Outline

---

## 2026-05-06

### בית ספר לצילום — `/camera/` (השקה)

- Hub עם 16 נושאים
- עמודים: exposure, composition, lenses, depth-of-field, light, white-balance, histogram, filters, macro, sports, editing, types, software, visual-language, controls

---

## 2026-05-01

### ניתוח תמונות — `/learn/` (השקה)

- D1: טבלת `photo_analyses`
- עמוד ניתוח: SVG overlay, annotations, נתוני מצלמה, בוקה, קומפוזיציה
- Admin: טבלה + edit modal + "ייצר ניתוח"
- GitHub Actions: `learn-generate.yml` (כל יומיים)

### עמוד אתגרים — `/games/`

- Hub עם כרטיסיות לקוויז ופאזל

---

## 2026-04-30

### קוויז — "מאיפה הצילום?" (השקה)

- 10 שאלות, 15 שניות לשאלה, win=6/10
- 20% הנחה על כל הגלריה למנצחים
- Workflow פרסום דו-שבועי

---

## 2026-04-29

### פאזל הזזה — `/puzzle/` (השקה)

- 3×3 ו-4×4, טיימר, שיתוף WhatsApp
- 20% הנחה על התמונה הספציפית שפוצלה

---

## 2026-04-20

### מבצע שבועי — `/sale/`

- 50 תמונות, countdown timer, החלפה אוטומטית שבת 21:00 UTC
- Badge "מבצע", פילטר בגלריה, מחיר מוזל

### תמונת השבוע — Strip בגלריה

- סטריפ מעל הגלריה + badge ⭐ + כפתור "רכוש עכשיו"

---

## 2026-04-18

### שיפורי גלריה

- תגי "חדש", מחירים מיוחדים לתמונה (price_overrides)
- URL Hash Filters, www redirect, CDN Cache

---

## 2026-04-13

### i18n — תמיכה דו-לשונית עברית/אנגלית

- `assets/js/i18n.js` — קובץ תרגומים מרכזי
- `data-i18n` על כל אלמנטי UI
- כל מחרוזות עברית קשיחות הוחלפו ב-`t()`

---

## 2026-04-11

### GitHub Actions — אוטומציות

- Instagram / Facebook / Pinterest / Threads
- Update photos daily, Token refresh

---

## 2026-04-08

### חנות הדפסות — Gelato

- פוסטר / קנבס / מתכת + PayPal + Webhook
- Crop tool, בדיקת רזולוציה, מייל אישור

---

*מסמך זה מתעדכן עם כל שינוי משמעותי באתר.*
