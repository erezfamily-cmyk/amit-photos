# עמית פוטוס — Photography Portfolio

## סקירה
אתר פורטפוליו צילום עברי, רספונסיבי ומודרני עבור צלם ישראלי.
מציג תמונות מחולקות לקטגוריות, עמוד אודות, ועמוד צור קשר.
URL: `https://amitphotos.com`

---

## טכנולוגיה

- HTML5 / CSS3 / Vanilla JS — ללא frameworks
- Google Fonts: Syne (כותרות) + Heebo (עברית)
- **Cloudflare Worker** (`worker.js`) — API, auth, הגשת R2
- **Cloudflare D1** (`amit-photos-db`) — מסד נתונים תמונות + settings + sessions
- **Cloudflare R2** (`amit-photos-images`) — אחסון תמונות WebP
- **GitHub Pages** — static assets (HTML/CSS/JS/photos.json)

---

## ארכיטקטורת גלריה — מקורות נתונים

הגלריה (`assets/js/gallery.js`) קוראת משני מקורות **במקביל**:

```js
fetch('data/photos.json')   // סטטי, GitHub Pages, 1,151 רשומות
fetch('/api/photos')        // D1 דרך Worker, 1,230 רשומות
```

### כלל מיזוג (חשוב!)

```js
// אם D1 יש נתונים — D1 primary, photos.json מעשיר
allPhotos = apiPhotos.map(p => {
  const j = jsonMap.get(p.id);  // מחפש לפי id
  return j
    ? { ...j, ...p, thumbnail: j.thumbnail || p.thumbnail, url: j.url || p.url }
    : p;
});
// אם D1 ריק — photos.json בלבד
```

**כללים:**

- כשD1 יש נתונים — רק תמונות שב-D1 מוצגות
- תמונה שרק בphotos.json ולא ב-D1 — **לא מוצגת**
- `thumbnail`/`url` — **photos.json מנצח** על D1 (אם קיים ב-JSON)
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

## Endpoints מרכזיים (Worker)

| method | path | מה עושה |
|--------|------|---------|
| GET | `/api/photos` | כל תמונות D1 published |
| POST | `/api/upload` | מעלה קובץ ל-R2 + מוסיף ל-D1 עם UUID חדש |
| PATCH | `/api/photos` | מעדכן שדות ב-D1 (title/category/url/thumbnail/r2_key/published) |
| DELETE | `/api/photos?id=` | מוחק מ-D1 + R2 |
| POST | `/api/repair-r2` | מעלה קובץ ל-R2 עם key מוגדר — **לא** נוגע ב-D1 |
| GET | `/photos/{key}` | מגיש תמונה מ-R2 (תומך בresize `?w=N`) |

---

## קבצים מרכזיים

| קובץ | תפקיד |
|------|-------|
| `index.html` | עמוד ראשי |
| `worker.js` | Cloudflare Worker — כל ה-API |
| `assets/js/gallery.js` | גלריה, פילטרים, לייטבוקס, מיזוג D1+JSON |
| `assets/js/i18n.js` | תרגום HE/EN, שפה ב-`_lang` (לא `currentLang`) |
| `assets/js/nav.js` | ניווט משותף לכל תת-עמוד |
| `data/photos.json` | 1,151 תמונות (מגיע מDrive, מתעדכן יומי) |
| `wrangler.toml` | Cloudflare config — D1, R2, routes |

---

## Scripts מיגרציה (`src/`)

| script | מה עושה |
|--------|---------|
| `fetch_photos.py` | סנכרון Drive → photos.json (יומי דרך GitHub Actions) |
| `migrate_to_r2.py` | העברת photos.json → D1 דרך `/api/upload` (יוצר UUID) |
| `fix_drive_in_d1.py` | מתקן Drive URLs ב-D1 → R2 WebP (שמר Drive ID כ-key) |
| `convert_r2_jpg_to_webp.py` | ממיר JPG ב-R2 ל-WebP, מעדכן D1 (89% חיסכון) |
| `migrate_gallery_to_r2.py` | מעדכן photos.json URLs ל-R2 (פחות רלוונטי כשD1 ראשי) |

---

## מבנה data/photos.json

```json
{
  "id": "drive-file-id או uuid",
  "title": "כותרת",
  "category": "טבע | פורטרט | עירוני | אירועים | טנזניה | ...",
  "parent_category": "קטגוריה-אב",
  "url": "/photos/{key}.webp",
  "thumbnail": "/photos/thumb/{key}.webp",
  "description": "תיאור",
  "filename": "שם קובץ מקורי",
  "width": 4580,
  "height": 3053,
  "exif": {},
  "added_at": "2026-01-01"
}
```

---

## GitHub Actions — עדכון תמונות

`update-photos.yml` רץ כל יום 06:00 UTC:

1. `fetch_photos.py` — מסנכרן Drive → photos.json
2. commit + push אם יש שינויים

**בעיה ידועה:** תמונות חדשות מ-Drive נכנסות לphotos.json אבל לא ל-D1 — לא יוצגו בגלריה.
**TODO:** להוסיף שלב שמכניס תמונות חדשות ל-D1 + R2 כ-WebP.

---

## הוספת תמונות (כרגע)

**דרך Admin (`/admin`):** Upload → R2 + D1 עם UUID → מוצג מיד
**דרך Drive:** Drive → photos.json (יומי) → לא נכנס ל-D1 → לא מוצג

---

## שפה ו-RTL

- ממשק HE ראשי, EN משני
- `data-i18n="key"` על אלמנטים
- `setLang('he'/'en')` ב-i18n.js, שפה ב-`_lang` (לא `currentLang`)
- כל עמוד ציבורי חדש חייב `data-he`/`data-en` + `setLang()` מהרגע הראשון

---

## SEO (26.6.2026)

- sitemap.xml: 36 דפים
- hreflang: he/en/x-default
- Article JSON-LD: כל 24 דפי /camera/ עם datePublished
- canonical: כל עמוד
- robots.txt: חוסם admin/api, מפנה לsitemap
