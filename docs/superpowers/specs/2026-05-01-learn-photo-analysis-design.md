# "בית ספר לצילום" — Photo Analysis Section Design

## Goal

A `/learn/` section on amitphotos.com that automatically publishes a new photo analysis every 2 days — AI-generated, editable via admin, and published to Facebook + Instagram. Analyses accumulate into a library of educational photography breakdowns.

## Architecture

Cloudflare Worker handles all routes dynamically from D1. No static HTML files generated. GitHub Actions workflow runs every 2 days to generate new analyses using Claude API, then posts to social media.

## Tech Stack

- Cloudflare Workers + D1 (existing)
- Claude API (claude-haiku-4-5 for scoring, claude-sonnet-4-6 for full analysis)
- GitHub Actions (existing cron infrastructure)
- Facebook Graph API + Instagram Graph API (existing)

---

## Data Model

New D1 table: `photo_analyses`

```sql
CREATE TABLE IF NOT EXISTS photo_analyses (
  photo_id TEXT PRIMARY KEY,
  composition_rule TEXT NOT NULL,
  annotations_json TEXT NOT NULL,
  camera_json TEXT NOT NULL,
  composition_html TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  title TEXT NOT NULL,
  published_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### `composition_rule` values
`rule_of_thirds` | `symmetry` | `leading_lines` | `golden_ratio` | `framing` | `negative_space`

### `annotations_json` structure
```json
[
  {
    "x_pct": 33,
    "y_pct": 33,
    "label": "נקודת מיקוד\nציר השליש",
    "anchor": "left"
  },
  {
    "x_pct": 78,
    "y_pct": 18,
    "label": "בוקה — f/9\nרקע מטושטש",
    "anchor": "right"
  }
]
```

`anchor` = `left` | `right` | `top` | `bottom` — which side the label box appears relative to the dot.

### `camera_json` structure
```json
{
  "aperture": { "value": "f/9", "explanation": "סגור — כדי שכל הפנים יהיו חדים" },
  "shutter":  { "value": "1/320s", "explanation": "מהיר — מונע טשטוש תנועה" },
  "iso":      { "value": "100", "explanation": "הכי נמוך אפשרי — תמונה נקייה" },
  "focal":    { "value": "200mm", "explanation": "טלה — מרחק בטוח מהחיה, רקע מוחץ" }
}
```

### `tags_json` structure
```json
["חוק השליש", "בוקה מכוון", "טלה", "אור טבעי"]
```

---

## GitHub Actions Workflow: `learn-generate.yml`

Runs every 2 days at 10:00 UTC (cron: `0 10 */2 * *`). Also triggerable manually via `workflow_dispatch`.

### Steps

1. **Select photo candidate**
   - Query: `SELECT p.* FROM photos p LEFT JOIN photo_analyses a ON p.id = a.photo_id WHERE a.photo_id IS NULL AND p.exif IS NOT NULL`
   - For each candidate, call Claude API (haiku) with photo URL + EXIF → score 0–10 for "how clearly does this photo demonstrate a photographic rule"
   - Pick the highest-scoring photo (minimum score: 7)

2. **Generate full analysis**
   - Call Claude API (sonnet) with photo URL + EXIF + photo title/description
   - Prompt instructs Claude to return strict JSON: `{composition_rule, annotations, camera, composition_html, tags}`
   - Validate JSON structure before saving

3. **Save to D1**
   - `INSERT INTO photo_analyses` with all fields + `published_at = now()`

4. **Post to Facebook**
   - Message: photo title + 2-line teaser from composition_html + link to `/learn/[photo_id]`
   - Image: photo thumbnail URL

5. **Post to Instagram**
   - Caption: same teaser + hashtags from tags + link in bio note

---

## Worker Routes (new)

All routes added to existing `worker.js`:

| Route | Description |
|-------|-------------|
| `GET /learn/` | Index page — grid of all analyses |
| `GET /learn/:photoId` | Individual analysis page |
| `GET /api/analyses` | JSON list for admin |
| `GET /api/analyses/:photoId` | Single analysis JSON for admin |
| `PUT /api/analyses/:photoId` | Update analysis fields (admin edit) |
| `POST /api/analyses/generate` | Trigger manual generation (admin) |

---

## `/learn/` Index Page

- Dark theme, RTL Hebrew — matches site style
- Grid of cards: photo thumbnail + title + composition_rule label (e.g. "חוק השליש") + published date
- Each card links to `/learn/[photo_id]`
- Nav link: "בית ספר לצילום" added to main nav in `index.html` (alongside "אתגרים")

---

## `/learn/:photoId` Analysis Page

Structure mirrors the demo (`c:/tmp/photo-analysis-demo.html`):

1. **Header** — photo title + "רכוש תמונה זו →" link to `/?photo=[id]`
2. **Photo + SVG overlay** — photo image with:
   - Composition rule grid (rule of thirds: dashed lines + intersection dots; symmetry: center axis; leading lines: directional arrows)
   - Annotation dots with label boxes (positioned from `annotations_json`)
3. **Camera settings cards** — 4 cards: aperture, shutter, ISO, focal length (from `camera_json`)
4. **Bokeh diagram** — SVG diagram (static, always shown, explains depth of field visually)
5. **Composition analysis** — `composition_html` rendered directly
6. **Tags** — colored tag pills from `tags_json`

All rendered server-side in the Worker as a full HTML page string.

---

## Admin Integration

New section in `admin.html`: **"בית ספר לצילום"**

- Table listing all analyses: photo title | composition rule | published date | Edit button
- Edit modal (or inline): editable textareas for each field:
  - `composition_html` (textarea)
  - Per camera field explanations (4 text inputs)
  - `tags_json` (comma-separated text input, parsed to array on save)
  - Annotation labels (list of text inputs, one per annotation)
- Save → `PUT /api/analyses/:photoId`
- "ייצר ניתוח חדש עכשיו" button → `POST /api/analyses/generate`

---

## Composition Rule Overlays

Each rule renders a different SVG overlay on the photo:

| Rule | Overlay |
|------|---------|
| `rule_of_thirds` | 2 vertical + 2 horizontal dashed lines, dots at 4 intersections |
| `symmetry` | Single center line (vertical or horizontal) |
| `leading_lines` | Arrows from `annotations` pointing toward subject |
| `golden_ratio` | Golden spiral SVG (approximated with arcs) |
| `framing` | Rectangle inset from edges showing the frame-within-frame |
| `negative_space` | Shaded overlay on the "empty" side |

---

## i18n

Hebrew only for now. English keys can be added later when the site's i18n system is extended to cover dynamic Worker-rendered pages.

---

## Implementation Notes (בוצע 2026-05-01)

### שינויים מהדיזיין המקורי

**Claude API — שיחה אחת בלבד:**
הדיזיין המקורי תכנן שני שלבים: haiku לבחירת תמונה (ציון 0-10) + sonnet לניתוח מלא.
במימוש: שיחה אחת לsonnet — בחירת חוק הקומפוזיציה + ניתוח מלא ביחד.
ה-`LIMIT 5` של SQL מחזיר מועמדים רנדומליים, הסונט בוחר ומנתח את הראשון.

**הגבלת גודל תמונה:**
Anthropic API מקבל מקסימום ~5MB base64. תמונות full-res מהגלריה גדולות מדי (7-9MB).
פתרון: `WHERE p.width <= 2000` — כ-50 תמונות קטנות מספיק.
CF Image Resizing לא זמין בפלאן הנוכחי.

**R2 ישיר (לא HTTP):**
Worker לא יכול לבצע HTTP request לדומיין שלו (522 timeout).
פתרון: `env.PHOTOS.get(r2_key)` — קריאה ישירה מ-R2 binding.

**base64 encoding:**
`btoa(String.fromCharCode(...new Uint8Array(buf)))` — spread operator קורס על קבצים גדולים (stack overflow).
פתרון: לולאה מפורשת:

```javascript
const bytes = new Uint8Array(buf);
let binary = '';
for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
return btoa(binary);
```

**Auth בסקריפט Python:**
`learn_social_post.py` משתמש ב-`X-Admin-Password` (לא `X-Session-Token` — session tokens הם client-side only).

**URLs מוחלטים לסושיאל:**
Worker מחזיר thumbnail כ-`/photos/...` (relative). Python מוסיף `https://www.amitphotos.com` לפני פרסום.

### קולומנים קיימים בטבלת photos

`exif` — **לא קיים** בטבלה. אין לכלול בשאילתות.
`width`, `height` — קיימים, שימושיים לסינון גודל תמונה.
`r2_key` — מפתח ב-R2 bucket. חלק מהתמונות ריקות/null.

### Workflow — learn-generate.yml

אין צורך ב-`ANTHROPIC_API_KEY` ב-GitHub Secrets — קריאות Claude מתבצעות server-side בWorker.
הWorkflow מריץ `src/learn_social_post.py` שמזמין את `POST /api/analyses/generate` בלבד.

---

## Facebook / Instagram Post Format

**Facebook:**
```
📸 [photo title]

[First sentence of composition_html, stripped of HTML tags]

👉 ניתוח מלא: https://amitphotos.com/learn/[photo_id]

#צילום #[tag1] #[tag2]
```

**Instagram:**
- Image: photo thumbnail URL (same as Facebook)
- Caption:
```
📸 [photo title]

[First sentence] — [composition_rule label in Hebrew]

#צילום #[tag1] #[tag2] #amitphotos #photography
```

---

## Files Created / Modified

| File | Action |
|------|--------|
| `worker.js` | Add `/learn/`, `/learn/:id`, `/api/analyses*` routes |
| `admin.html` | Add "בית ספר לצילום" section |
| `index.html` | Add nav link "בית ספר לצילום" |
| `assets/js/i18n.js` | Add `nav.learn` key |
| `.github/workflows/learn-generate.yml` | New workflow |
| `scripts/generate-analysis.js` | Node.js script called by workflow |
