# עמית פוטוס — Photography Portfolio

## סקירה
אתר פורטפוליו צילום עברי, רספונסיבי ומודרני עבור צלם ישראלי.
מציג תמונות מחולקות לקטגוריות, עמוד אודות, ועמוד צור קשר.
URL: `https://amitphotos.com`

---

## ארכיטקטורת גלריה — מקורות נתונים

הגלריה (`assets/js/gallery.js`) קוראת משני מקורות **במקביל**:

```js
fetch('data/photos.json')   // סטטי, ~1,226 רשומות (מתעדכן יומית מ-Drive)
fetch('/api/photos')        // D1 דרך Worker, ~1,225 רשומות published
```

(המספרים נכונים ל-3.7.2026 — נעים עם הזמן, הפער ביניהם הוא תמונות Drive חדשות שטרם נכנסו ל-D1)

### כלל מיזוג (חשוב!)

```js
// אם D1 יש נתונים — D1 primary, photos.json מעשיר
allPhotos = apiPhotos.map(p => {
  const j = jsonMap.get(p.id);  // מחפש לפי id
  // D1 WebP מנצח; photos.json הוא fallback רק אם ל-D1 אין WebP
  const thumb = p.thumbnail?.endsWith('.webp') ? p.thumbnail : (j?.thumbnail || p.thumbnail);
  const url   = p.url?.endsWith('.webp')       ? p.url       : (j?.url       || p.url);
  return j ? { ...j, ...p, thumbnail: thumb, url } : p;
});
// אם D1 ריק — photos.json בלבד
```

**כללים:**

- כשD1 יש נתונים — רק תמונות שב-D1 מוצגות
- תמונה שרק בphotos.json ולא ב-D1 — **לא מוצגת**
- `thumbnail`/`url` — **D1 מנצח אם הוא WebP**; photos.json הוא fallback רק כשל-D1 אין WebP (ראה [docs/gallery-merge-architecture.md](docs/gallery-merge-architecture.md))
- D1 מנצח על שאר השדות (title, category וכו')

---

## Cloudflare R2 — מבנה keys

Bucket: `amit-photos-images` | binding: `env.PHOTOS`
הגשה: `https://amitphotos.com/photos/{key}` (Worker → `servePhoto()`)

| סוג | key | הערה |
|-----|-----|------|
| JPG ישן (admin upload) | `{uuid}.jpg` | מה-upload endpoint |
| JPG thumb ישן | `thumb_{uuid}.jpg` | |
| WebP ממוצה (jpg→webp) | `{uuid}.webp` | אחרי `convert_r2_jpg_to_webp.py` |
| WebP thumb ממוצה | `thumb/{uuid}.webp` | |
| WebP Drive photo | `{drive_id}.webp` | Drive ID כ-key |
| WebP Drive thumb | `thumb/{drive_id}.webp` | |

---

## Auth

```js
async function checkAuth(request, env) {
  // 1. Session token (X-Session-Token header / cookie)
  // 2. X-Admin-Password header → env.ADMIN_PASSWORD → fallback D1 settings
}
```

- סקריפטים אוטומטיים: שולחים `X-Admin-Password: <password>`
- ADMIN_PASSWORD שמור ב-D1 settings (`key='admin_password'`)
- env.ADMIN_PASSWORD (Cloudflare secret) — לא תמיד מסונכרן, יש fallback ל-D1

---

## קבצים מרכזיים

| קובץ | תפקיד |
|------|-------|
| `index.html` | עמוד ראשי |
| `worker.js` | Cloudflare Worker — כל ה-API |
| `assets/js/gallery.js` | גלריה, פילטרים, לייטבוקס, מיזוג D1+JSON |
| `assets/js/i18n.js` | תרגום HE/EN, שפה ב-`_lang` (לא `currentLang`) |
| `assets/js/nav.js` | ניווט משותף לכל תת-עמוד |
| `data/photos.json` | ~1,226 תמונות (מגיע מDrive, מתעדכן יומי) |
| `wrangler.toml` | Cloudflare config — D1, R2, routes |

---

## Scripts מיגרציה (`src/`)

| script | מה עושה |
|--------|---------|
| `agent_photos.py` | **זה שרץ בפועל כל יום** ב-`update-photos.yml` ("הרצת Agent") — סורק Drive, מנתח תמונות עם Claude Vision, מייצר כותרות/קטגוריות עברית, מעדכן `data/photos.json` |
| `fetch_photos.py` | גרסה מקבילה/ישנה יותר עם לוגיקה כמעט זהה (כולל `find_folder`) — **לא רצה בשום workflow**, נשארה לריצה ידנית/`--list` |
| `auto_import_new_photos.py` | מזהה תמונות ב-`photos.json` שלא ב-D1 (לפי Drive ID), ממיר ל-WebP, מעלה ל-R2 ומכניס ל-D1 — **רץ אוטומטית כל יום** אחרי `agent_photos.py` (ראה למטה) |
| `migrate_to_r2.py` | העברת photos.json → D1 דרך `/api/upload` (יוצר UUID) |
| `fix_drive_in_d1.py` | מתקן Drive URLs ב-D1 → R2 WebP (שמר Drive ID כ-key) |
| `convert_r2_jpg_to_webp.py` | ממיר JPG ב-R2 ל-WebP, מעדכן D1 (89% חיסכון) |
| `migrate_gallery_to_r2.py` | מעדכן photos.json URLs ל-R2 (פחות רלוונטי כשD1 ראשי) |

שני הסקריפטים שסורקים את תיקיית `Portfolio` ב-Drive תומכים ב-`PORTFOLIO_FOLDER_ID` (env var) — עוקף לגמרי חיפוש לפי שם ומונע בחירה שרירותית אם יש כמה תיקיות באותו שם.

---

## GitHub Actions — עדכון תמונות

`update-photos.yml` רץ כל יום 06:00 UTC, כולל **ייבוא אוטומטי מלא ל-D1+R2**:

1. `agent_photos.py` — סורק Drive, מעדכן `data/photos.json`
2. `auto_import_new_photos.py` — כל תמונה חדשה ב-photos.json (Drive ID שלא ב-D1) מומרת ל-WebP, מועלית ל-R2 ומוכנסת ל-D1 (מייצא exit code שגיאה אם ייבוא כלשהו נכשל)
3. `generate_sitemap.py`, `bump_versions.py`
4. commit + push, deploy ל-Cloudflare, cache purge

**הערה:** תיעוד קודם כאן תיאר את שלב 2 כ-TODO פתוח — זה כבר לא נכון, השלב רץ בפועל מזה זמן.

---

## הוספת תמונות (כרגע)

**דרך Admin (`/admin`):** Upload → R2 + D1 עם UUID → מוצג מיד
**דרך Drive:** נכנס ל-D1+R2 אוטומטית תוך יום (ה-workflow היומי) — לא מיידי כמו Admin

---

## שפה ו-RTL

- ממשק HE ראשי, EN משני
- `data-i18n="key"` על אלמנטים
- `setLang('he'/'en')` ב-i18n.js, שפה ב-`_lang` (לא `currentLang`)
- כל עמוד ציבורי חדש חייב `data-he`/`data-en` + `setLang()` מהרגע הראשון

---

## SEO (עדכון 3.7.2026)

- sitemap: **דינמי מה-worker** (`handleSitemap`, ~1,100 URLs כולל דפי תמונות). הקובץ `sitemap.xml` המקומי הוא stub לא בשימוש — ה-worker תופס את הנתיב לפניו (`run_worker_first`)
- hreflang: he/en/x-default
- og:locale: he_IL + en_US alternate
- Article JSON-LD: כל 24 דפי /camera/ עם datePublished
- canonical: כל עמוד
- robots.txt: חוסם admin/api, מפנה לsitemap

---

## בית ספר לצילום — /camera/ (עדכון 2.7.2026)

24 מדריכים אינטראקטיביים תחת `/camera/`, כל אחד קובץ HTML עצמאי (ללא תלויות חיצוניות מעבר לפונטים/nav.js/share.js), בדוגמת `camera/exposure/index.html`.

**חדש:** `/camera/night/` — צילום לילה (מסלולי אור, ירח, Star Trails, Light Painting). סימולטור canvas עם סליידר משך חשיפה (1-30s) שמצייר מסלולי אור מכוניות + קשתות star-trail — סצנה וקטורית procedural (seeded RNG, ללא תמונות).

**כשמוסיפים מדריך /camera/ חדש** — ראה סקיל `add-camera-guide` (3 מקומות רישום + TODO ידוע).
