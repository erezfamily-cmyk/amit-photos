# Locations — Photography Spots Section
**תאריך:** 2026-05-10  
**סטטוס:** מאושר לפיתוח

---

## סקירה

הוספת אזור "מקומות לצילום" לאתר amitphotos.com — דפים עשירים לכל מקום שצולם בו, עם מידע מועשר מ-AI (תיאור, מפה, טיפים, ציוד, קישורי מדריך), גלריה משולבת (תמונות מהחנות + בלעדיות), וטפסי קהילה להצעות ותיקונים.

---

## 1. D1 Schema

### טבלת `locations`
```sql
CREATE TABLE locations (
  id          TEXT PRIMARY KEY,        -- slug: "nahal-nefatim"
  title       TEXT NOT NULL,           -- "נחל נטפים"
  region      TEXT NOT NULL DEFAULT '', -- "הרי אילת" | "גליל" | "מרכז" | "ירושלים" | "נגב"
  description TEXT NOT NULL DEFAULT '',
  best_time   TEXT NOT NULL DEFAULT '', -- "זריחה — שעת הזהב"
  equipment   TEXT NOT NULL DEFAULT '', -- "חצובה, עדשה 14-24mm, פילטר ND"
  my_tip      TEXT NOT NULL DEFAULT '', -- טיפ אישי של עמית
  coordinates TEXT NOT NULL DEFAULT '', -- "29.5936,34.8916"
  related_guides TEXT NOT NULL DEFAULT '', -- JSON array: ["/camera/filters/", "/camera/composition/"]
  published   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);
```

### טבלת `location_photos` (junction)
```sql
CREATE TABLE location_photos (
  id           TEXT PRIMARY KEY,
  location_id  TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  type         TEXT NOT NULL DEFAULT 'gallery', -- 'gallery' | 'exclusive'
  photo_id     TEXT,           -- אם type='gallery': FK לטבלת photos
  r2_key       TEXT,           -- אם type='exclusive': key ב-R2 (prefix: locations/)
  url          TEXT NOT NULL DEFAULT '',
  thumbnail    TEXT NOT NULL DEFAULT '',
  sort_order   INTEGER NOT NULL DEFAULT 0,
  for_sale     INTEGER NOT NULL DEFAULT 0  -- האם להציג כפתור רכישה מדף המקום
);
```

---

## 2. Worker API Routes

### Public (ללא auth)
```
GET  /api/locations              — רשימת מקומות (published=1 בלבד), עם תמונה ראשית
GET  /api/locations/:slug        — מקום מלא: נתונים + כל תמונות מסודרות לפי sort_order
POST /api/locations/suggest      — הצעת מקום חדש או תיקון (שולח מייל דרך Resend)
```

### Admin (דורש auth)
```
GET  /api/admin/locations                          — רשימה כולל drafts
POST /api/admin/locations                          — צור מקום + AI enrich אוטומטי
PUT  /api/admin/locations/:slug                    — עדכן שדות
DELETE /api/admin/locations/:slug                  — מחק (cascade לתמונות)
POST /api/admin/locations/:slug/enrich             — הפעל AI enrich מחדש
POST /api/admin/locations/:slug/photos             — הוסף תמונה (gallery/exclusive)
DELETE /api/admin/locations/:slug/photos/:id       — הסר תמונה
POST /api/admin/locations/:slug/photos/reorder     — עדכן sort_order
```

### AI Enrich Flow
כאשר יוצרים מקום חדש (`POST /api/admin/locations`):
1. שמור רשומה ב-D1 עם `published=0`
2. קרא ל-Claude API עם prompt: שם המקום + בקשה להחזיר JSON עם: `description`, `best_time`, `equipment`, `my_tip`, `coordinates`, `related_guides` (מתוך רשימה קבועה של דפי המדריך הקיימים)
3. עדכן הרשומה ב-D1 עם התוצאות
4. החזר את המקום המועשר — האדמין רואה ומעדכן לפי הצורך

**Prompt structure לClaude:**
```
You are helping a professional Israeli photographer catalog shooting locations.
For the location "${name}", return a JSON object with:
- description: 2-3 sentences in Hebrew about the location and its photographic qualities
- best_time: best time(s) to photograph there (Hebrew)
- equipment: recommended camera equipment (Hebrew)
- my_tip: one personal photography tip for this location (Hebrew, first person "אני ממליץ...")
- coordinates: "lat,lng" string (GPS coordinates)
- related_guides: array of paths from this list that are relevant: 
  ["/camera/filters/", "/camera/composition/", "/camera/exposure/", 
   "/camera/depth-of-field/", "/camera/white-balance/", "/camera/histogram/",
   "/camera/light/", "/camera/dynamic-range/", "/camera/controls/"]

Return ONLY valid JSON, no markdown.
```

### `/api/locations/suggest` payload
```json
{
  "type": "new",           // "new" | "correction"
  "location_slug": "",     // רק ל-correction
  "sender_name": "",       // אופציונלי
  "message": ""
}
```
שולח מייל דרך Resend לכתובת הקיימת (erez.family@gmail.com) עם נושא:
- `"הצעת מקום חדש: [שם]"` / `"תיקון למקום: [שם]"`

---

## 3. Frontend Pages

### `/locations/index.html` — Hub
- כותרת: "מקומות לצילום"
- פילטר אזורים (כפתורי toggle): הכל / צפון / מרכז / ירושלים / דרום / נגב / הרי אילת
- גריד כרטיסים: תמונה ראשית + שם + אזור + אייקון best_time
- כפתור "הצע מקום" → מודל עם טופס (שם אופציונלי, שם מקום, אזור, תיאור/טיפ)
- JS טוען מ-`/api/locations`

### `/locations/[slug]/index.html` — דף מקום
מבנה הדף (מלמעלה למטה):
1. **Header** — כותרת גדולה + אזור + best_time badge
2. **מפה** — Google Maps embed לפי coordinates (iframe עם zoom=14)
3. **תיאור** + **הטיפ שלי** (בלוק מסוגנן נפרד)
4. **מפרט צילום** — ציוד מומלץ + best_time מפורט
5. **מדריכים קשורים** — כרטיסיות קטנות לדפי `/camera/*` הרלוונטיים
6. **גלריה** — גריד תמונות (gallery + exclusive ביחד, sort_order), לחיצה פותחת lightbox. תמונות עם `for_sale=1` — כפתור "לרכישה" מעל
7. **Footer** — קישור דיסקרטי "יש לך טיפ או תיקון?" → מודל תיקון

JS טוען מ-`/api/locations/:slug`. אם slug לא קיים → redirect ל-404.

### nav.js
הוספת כפתור "מקומות" לניווט הקיים (בין הגלריה לחנות).

---

## 4. Admin Tab

טאב חדש "מקומות" ב-`admin.html`:

### תצוגת רשימה
- טבלה: שם | אזור | מספר תמונות | סטטוס (draft/published) | פעולות
- כפתור "מקום חדש" → פותח עורך עם שדה שם בלבד, שאר השדות ממלא ה-AI

### עורך מקום
שדות עריכה (כולם pre-filled מה-AI, ניתנים לשינוי):
- שם, אזור (dropdown), תיאור, best_time, ציוד, הטיפ שלי, קואורדינטות
- related_guides — checkboxes לדפי המדריך הקיימים
- published toggle
- כפתור "העשר מחדש מ-AI"

### ניהול תמונות (בתוך העורך)
שתי עמודות:
- **מהגלריה** — search/pick מהגלריה הקיימת, checkbox for_sale
- **בלעדיות** — upload ישיר ל-R2 (prefix `locations/`), checkbox for_sale
- Drag-and-drop לסדר תמונות (sort_order)
- כפתור הסרה לכל תמונה

---

## 5. Community Input

### טופס "הצע מקום" (Hub)
מודל עם שדות: שם (אופציונלי), שם מקום, אזור, תיאור/טיפ.  
`POST /api/locations/suggest` עם `type: "new"`.

### טופס "שלח תיקון" (דף מקום)
מודל עם שדות: שם (אופציונלי), ההצעה/התיקון.  
`POST /api/locations/suggest` עם `type: "correction"` + `location_slug`.

---

## 6. קבצים חדשים / קבצים שמשתנים

| קובץ | שינוי |
|------|-------|
| `schema.sql` | הוספת 2 טבלאות (`ALTER TABLE` comments) |
| `worker.js` | הוספת ~9 routes + `handleLocations*` functions |
| `locations/index.html` | **חדש** — Hub page |
| `locations/[slug]/index.html` | **חדש** — template דינמי בJS |
| `admin.html` | הוספת טאב "מקומות" |
| `assets/js/nav.js` | הוספת כפתור "מקומות" |

---

## 7. דגשים טכניים

- **slug generation:** מהשם העברי → transliterate ל-ASCII + hyphens (נחל נטפים → `nahal-nefatim`). Worker מייצר. **ה-slug לא ניתן לשינוי לאחר יצירה** (כדי לא לשבור URLs).
- **Google Maps embed:** iframe חינמי, לא דורש API key. `https://maps.google.com/maps?q={lat},{lng}&z=14&output=embed`
- **R2 prefix לתמונות בלעדיות:** `locations/{slug}/{uuid}.jpg` — מבודל מהגלריה הכללית.
- **Claude API call:** נעשה ב-Worker (server-side) עם `env.ANTHROPIC_API_KEY`. model: `claude-haiku-4-5-20251001` (מהיר וזול לenrichment).
- **Cascade delete:** `ON DELETE CASCADE` ב-location_photos מבטיח ניקוי תמונות בעת מחיקת מקום.
