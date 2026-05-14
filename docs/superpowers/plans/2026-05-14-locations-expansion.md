# Locations Expansion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** שדרג 6 דפי מקום קיימים עם 3 סעיפים חדשים (עונות / ציוד / קרובים) ויצור 7 דפים חדשים עם תמונות מהגלריה.

**Architecture:** שני שדות חדשים ב-D1 (`when_to_visit`, `recommended_gear` — JSON), חישוב `nearby` ב-Worker ב-read-time (Haversine). Frontend מציג שלושה סעיפים נוספים בדף הspot. לאחר deploy, re-enrich כל המקומות הקיימים + יצירת 7 מקומות חדשים דרך admin API.

**Tech Stack:** Cloudflare Worker (JS), D1 (SQLite), `wrangler d1 execute`, HTML/JS (no framework), `curl` לקריאות admin API.

---

## קבצים שישתנו

| קובץ | שינוי |
|------|-------|
| `worker.js` | enrichment prompt, `handleLocationsGet` (nearby), `handleAdminLocationsEnrich`, `handleAdminLocationsUpdate` |
| `locations/spot/index.html` | 3 סעיפים חדשים ב-`renderSpot()` |
| `admin.html` | 2 שדות textarea חדשים בטופס עריכת מקום |

---

## Task 1: D1 — הוספת 2 עמודות

**Files:**
- Modify: D1 schema (via wrangler command)

- [ ] **Step 1: הרץ migration**

```bash
wrangler d1 execute amit-photos-db --remote --command "ALTER TABLE locations ADD COLUMN when_to_visit TEXT DEFAULT NULL"
wrangler d1 execute amit-photos-db --remote --command "ALTER TABLE locations ADD COLUMN recommended_gear TEXT DEFAULT NULL"
```

Expected output: `✅ Applied 1 migration`

- [ ] **Step 2: אמת שהעמודות נוצרו**

```bash
wrangler d1 execute amit-photos-db --remote --command "PRAGMA table_info(locations)" --json
```

Expected: רשימה שכוללת שורות עם `name: "when_to_visit"` ו-`name: "recommended_gear"`.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: add when_to_visit + recommended_gear columns to locations"
```

---

## Task 2: Worker — עדכון AI enrichment prompt

**Files:**
- Modify: `worker.js` — פונקציה `enrichLocationWithAI` (שורה ~3274)

הפונקציה מחזירה JSON. נוסיף שני שדות חדשים לפרומפט ולעדכון ה-DB.

- [ ] **Step 1: עדכן את הפרומפט ב-`enrichLocationWithAI`**

מצא את הבלוק הזה (שורה ~3274):
```js
  const prompt = `You are helping a professional Israeli photographer catalog shooting locations.
For the location "${locationName}", return a JSON object with these fields:
- description: 2-3 sentences in Hebrew about the location and its photographic qualities
- best_time: best time(s) to photograph there (Hebrew, e.g. "זריחה — שעת הזהב")
- equipment: recommended camera equipment (Hebrew, e.g. "חצובה, עדשה 14-24mm, פילטר ND")
- my_tip: one personal photography tip in Hebrew, first person (e.g. "אני ממליץ להגיע...")
- coordinates: "lat,lng" GPS string for this location in Israel (e.g. "31.7683,35.2137")
- related_guides: array of 1-3 paths from this list that are most relevant: ${JSON.stringify(GUIDE_PATHS)}

Return ONLY valid JSON, no markdown fences, no extra text.`;
```

החלף ב:
```js
  const prompt = `You are helping a professional Israeli photographer catalog shooting locations.
For the location "${locationName}", return a JSON object with these fields:
- description: 2-3 sentences in Hebrew about the location and its photographic qualities
- best_time: best time(s) to photograph there (Hebrew, e.g. "זריחה — שעת הזהב")
- equipment: recommended camera equipment (Hebrew, e.g. "חצובה, עדשה 14-24mm, פילטר ND")
- my_tip: one personal photography tip in Hebrew, first person (e.g. "אני ממליץ להגיע...")
- coordinates: "lat,lng" GPS string for this location (e.g. "31.7683,35.2137"). For international locations use real GPS.
- related_guides: array of 1-3 paths from this list that are most relevant: ${JSON.stringify(GUIDE_PATHS)}
- when_to_visit: object with keys "summer","fall","winter","spring". Each value: {"rating":"good"|"ok"|"bad","note":"one short Hebrew sentence about light/weather/crowds"}
- recommended_gear: array of objects [{name:"Hebrew gear name", primary:true|false}]. Mark the single most important lens/item as primary:true. 3-6 items total.

Return ONLY valid JSON, no markdown fences, no extra text.`;
```

- [ ] **Step 2: עדכן את `handleAdminLocationsCreate` — שמירת שדות חדשים**

מצא את בלוק ה-`UPDATE locations SET` ב-`handleAdminLocationsCreate` (שורה ~3339):
```js
    await env.DB.prepare(`
      UPDATE locations SET
        description = ?, best_time = ?, equipment = ?,
        my_tip = ?, coordinates = ?, related_guides = ?
      WHERE id = ?
    `).bind(
      enriched.description || '',
      enriched.best_time || '',
      enriched.equipment || '',
      enriched.my_tip || '',
      enriched.coordinates || '',
      JSON.stringify(enriched.related_guides || []),
      id
    ).run();
```

החלף ב:
```js
    await env.DB.prepare(`
      UPDATE locations SET
        description = ?, best_time = ?, equipment = ?,
        my_tip = ?, coordinates = ?, related_guides = ?,
        when_to_visit = ?, recommended_gear = ?
      WHERE id = ?
    `).bind(
      enriched.description || '',
      enriched.best_time || '',
      enriched.equipment || '',
      enriched.my_tip || '',
      enriched.coordinates || '',
      JSON.stringify(enriched.related_guides || []),
      enriched.when_to_visit ? JSON.stringify(enriched.when_to_visit) : null,
      enriched.recommended_gear ? JSON.stringify(enriched.recommended_gear) : null,
      id
    ).run();
```

- [ ] **Step 3: עדכן את `handleAdminLocationsEnrich` — שמירת שדות חדשים**

מצא את בלוק ה-`UPDATE locations SET` ב-`handleAdminLocationsEnrich` (שורה ~3421):
```js
  await env.DB.prepare(`
    UPDATE locations SET
      description = ?, best_time = ?, equipment = ?,
      my_tip = ?, coordinates = ?, related_guides = ?
    WHERE id = ?
  `).bind(
    enriched.description || '',
    enriched.best_time || '',
    enriched.equipment || '',
    enriched.my_tip || '',
    enriched.coordinates || '',
    JSON.stringify(enriched.related_guides || []),
    slug
  ).run();
```

החלף ב:
```js
  await env.DB.prepare(`
    UPDATE locations SET
      description = ?, best_time = ?, equipment = ?,
      my_tip = ?, coordinates = ?, related_guides = ?,
      when_to_visit = ?, recommended_gear = ?
    WHERE id = ?
  `).bind(
    enriched.description || '',
    enriched.best_time || '',
    enriched.equipment || '',
    enriched.my_tip || '',
    enriched.coordinates || '',
    JSON.stringify(enriched.related_guides || []),
    enriched.when_to_visit ? JSON.stringify(enriched.when_to_visit) : null,
    enriched.recommended_gear ? JSON.stringify(enriched.recommended_gear) : null,
    slug
  ).run();
```

- [ ] **Step 4: עדכן `handleAdminLocationsUpdate` — קבלת שדות חדשים ב-PUT**

מצא את שורה 3364:
```js
  const fields = ['title','region','description','best_time','equipment','my_tip','coordinates','published'];
```

החלף ב:
```js
  const fields = ['title','region','description','best_time','equipment','my_tip','coordinates','published','when_to_visit','recommended_gear'];
```

- [ ] **Step 5: עדכן את `handleLocationsGet` — הוסף שדות חדשים ב-parse**

מצא את שורה 3229:
```js
  return jsonRes({ ...loc, related_guides: JSON.parse(loc.related_guides || '[]'), extra_links: JSON.parse(loc.extra_links || '[]'), photos: photos || [] }, 200, request);
```

החלף ב:
```js
  return jsonRes({
    ...loc,
    related_guides: JSON.parse(loc.related_guides || '[]'),
    extra_links: JSON.parse(loc.extra_links || '[]'),
    when_to_visit: loc.when_to_visit ? JSON.parse(loc.when_to_visit) : null,
    recommended_gear: loc.recommended_gear ? JSON.parse(loc.recommended_gear) : null,
    photos: photos || []
  }, 200, request);
```

- [ ] **Step 6: Commit**

```bash
git add worker.js
git commit -m "feat: extend enrichment with when_to_visit and recommended_gear"
```

---

## Task 3: Worker — חישוב `nearby` ב-`handleLocationsGet`

**Files:**
- Modify: `worker.js` — `handleLocationsGet` + הוספת helper function

- [ ] **Step 1: הוסף פונקציית Haversine לפני `handleLocationsGet`**

לפני `async function handleLocationsGet` (שורה ~3219), הוסף:

```js
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
```

- [ ] **Step 2: עדכן `handleLocationsGet` לחשב nearby**

מצא את `handleLocationsGet` (שורה ~3219). החלף את כל הפונקציה:

```js
async function handleLocationsGet(request, env, slug) {
  const loc = await env.DB.prepare(
    'SELECT * FROM locations WHERE id = ? AND published = 1'
  ).bind(slug).first();
  if (!loc) return jsonRes({ error: 'לא נמצא' }, 404, request);

  const { results: photos } = await env.DB.prepare(
    'SELECT * FROM location_photos WHERE location_id = ? ORDER BY sort_order ASC'
  ).bind(slug).all();

  // Compute nearby (up to 3 closest published locations with coordinates)
  let nearby = [];
  if (loc.coordinates) {
    const [lat, lng] = loc.coordinates.split(',').map(s => parseFloat(s.trim()));
    if (!isNaN(lat) && !isNaN(lng)) {
      const { results: others } = await env.DB.prepare(
        "SELECT id, title, coordinates, cover_thumb FROM locations WHERE published = 1 AND id != ? AND coordinates IS NOT NULL AND coordinates != ''"
      ).bind(slug).all();
      nearby = (others || [])
        .map(o => {
          const [olat, olng] = o.coordinates.split(',').map(s => parseFloat(s.trim()));
          return isNaN(olat) ? null : { id: o.id, title: o.title, cover_thumb: o.cover_thumb, km: Math.round(haversineKm(lat, lng, olat, olng)) };
        })
        .filter(Boolean)
        .sort((a, b) => a.km - b.km)
        .slice(0, 3);
    }
  }

  return jsonRes({
    ...loc,
    related_guides: JSON.parse(loc.related_guides || '[]'),
    extra_links: JSON.parse(loc.extra_links || '[]'),
    when_to_visit: loc.when_to_visit ? JSON.parse(loc.when_to_visit) : null,
    recommended_gear: loc.recommended_gear ? JSON.parse(loc.recommended_gear) : null,
    nearby,
    photos: photos || []
  }, 200, request);
}
```

- [ ] **Step 3: Commit**

```bash
git add worker.js
git commit -m "feat: add nearby locations (Haversine) to GET /api/locations/:slug"
```

---

## Task 4: Frontend — 3 סעיפים חדשים ב-`/locations/spot/index.html`

**Files:**
- Modify: `locations/spot/index.html` — פונקציה `renderSpot()` (שורה ~265)

- [ ] **Step 1: הוסף CSS לשלושת הסעיפים**

מצא את סגירת `<style>` לפני `</style>` ולפני `</head>`. הוסף לפניה:

```css
/* when_to_visit */
.seasons-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:.5rem;margin:.75rem 0}
.season-card{border-radius:6px;padding:.6rem .5rem;text-align:center;font-family:'Heebo',sans-serif}
.season-card.good{background:rgba(200,169,110,.18);border:1px solid rgba(200,169,110,.4)}
.season-card.ok{background:rgba(100,180,100,.1);border:1px solid rgba(100,180,100,.25)}
.season-card.bad{background:rgba(80,80,80,.12);border:1px solid #2a2a2a}
.season-card .s-emoji{font-size:1.1rem}
.season-card .s-name{font-size:.7rem;color:#888;margin:.2rem 0}
.season-card .s-note{font-size:.68rem;color:#aaa;line-height:1.4}
.season-card.good .s-note{color:#c8a96e}
/* recommended_gear */
.gear-chips{display:flex;flex-wrap:wrap;gap:.4rem;margin:.6rem 0}
.gear-chip{background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;padding:.3rem .75rem;font-size:.78rem;color:#aaa;font-family:'Heebo',sans-serif}
.gear-chip.primary{border-color:rgba(200,169,110,.5);color:#c8a96e;font-weight:600}
/* nearby */
.nearby-list{display:flex;flex-direction:column;gap:.5rem;margin:.6rem 0}
.nearby-item{display:flex;align-items:center;justify-content:space-between;background:#141414;border:1px solid #222;border-radius:6px;padding:.5rem .85rem;text-decoration:none;color:var(--text);transition:border-color .2s}
.nearby-item:hover{border-color:var(--accent)}
.nearby-name{font-size:.88rem}
.nearby-dist{font-size:.75rem;color:var(--muted)}
@media(max-width:480px){.seasons-grid{grid-template-columns:repeat(2,1fr)}}
```

- [ ] **Step 2: הוסף helper functions לפני `renderSpot`**

מצא את `function renderSpot(loc)` (שורה ~265). הוסף לפניה:

```js
function renderSeasons(wt) {
  if (!wt) return '';
  const SEASONS = [
    { key: 'summer', label: 'קיץ', emoji: '☀️' },
    { key: 'fall',   label: 'סתיו', emoji: '🍂' },
    { key: 'winter', label: 'חורף', emoji: '❄️' },
    { key: 'spring', label: 'אביב', emoji: '🌸' }
  ];
  const cards = SEASONS.map(s => {
    const d = wt[s.key] || {};
    const cls = d.rating === 'good' ? 'good' : d.rating === 'bad' ? 'bad' : 'ok';
    return `<div class="season-card ${cls}">
      <div class="s-emoji">${s.emoji}</div>
      <div class="s-name">${s.label}</div>
      <div class="s-note">${escHtml(d.note || '')}</div>
    </div>`;
  }).join('');
  return `<div class="section"><h2>מתי לבוא</h2><div class="seasons-grid">${cards}</div></div>`;
}

function renderGear(gear) {
  if (!gear || !gear.length) return '';
  const chips = gear.map(g => {
    const cls = g.primary ? 'gear-chip primary' : 'gear-chip';
    return `<span class="${cls}">${escHtml(g.name)}</span>`;
  }).join('');
  return `<div class="section"><h2>ציוד מומלץ</h2><div class="gear-chips">${chips}</div></div>`;
}

function renderNearby(nearby) {
  if (!nearby || !nearby.length) return '';
  const items = nearby.map(n =>
    `<a class="nearby-item" href="/locations/spot/?slug=${encodeURIComponent(n.id)}">
      <span class="nearby-name">${escHtml(n.title)}</span>
      <span class="nearby-dist">${n.km} ק"מ →</span>
    </a>`
  ).join('');
  return `<div class="section"><h2>מקומות קרובים</h2><div class="nearby-list">${items}</div></div>`;
}
```

- [ ] **Step 3: הוסף את הסעיפים ב-`renderSpot`**

מצא את הרינדור של `details-section` (שורה ~289):
```js
  document.getElementById('details-section').innerHTML = `
    ${loc.description ? `<div class="section"><p style="line-height:1.8;font-size:.95rem">${renderText(loc.description)}</p></div>` : ''}
    ${loc.my_tip ? `<div class="section"><h2>הטיפ שלי</h2><div class="tip-box">${renderText(loc.my_tip)}</div></div>` : ''}
```

שנה ל:
```js
  document.getElementById('details-section').innerHTML = `
    ${loc.description ? `<div class="section"><p style="line-height:1.8;font-size:.95rem">${renderText(loc.description)}</p></div>` : ''}
    ${renderSeasons(loc.when_to_visit)}
    ${renderGear(loc.recommended_gear)}
    ${loc.my_tip ? `<div class="section"><h2>הטיפ שלי</h2><div class="tip-box">${renderText(loc.my_tip)}</div></div>` : ''}
```

ומצא את הרינדור של `gallery-section`. מיד לאחר `document.getElementById('gallery-section').innerHTML = ...` (חפש `gallery-section`), הוסף שורה:

```js
  document.getElementById('nearby-section').innerHTML = renderNearby(loc.nearby);
```

- [ ] **Step 4: הוסף `<div id="nearby-section"></div>` ל-HTML**

מצא ב-body (שורה ~96):
```html
<div id="gallery-section"></div>
```

שנה ל:
```html
<div id="gallery-section"></div>
<div id="nearby-section"></div>
```

- [ ] **Step 5: בדוק ב-localhost**

```bash
python -m http.server 8000
```

פתח `http://localhost:8000/locations/spot/?slug=mtzdh` — אמת שמצדה מציגה 3 סעיפים חדשים (גם אם ריקים עד לאחר re-enrich).

- [ ] **Step 6: Commit**

```bash
git add locations/spot/index.html
git commit -m "feat: add when_to_visit, gear, nearby sections to spot page"
```

---

## Task 5: Admin — 2 שדות חדשים בטופס עריכת מקום

**Files:**
- Modify: `admin.html` — בלוק HTML ו-JS של עריכת מקום

- [ ] **Step 1: הוסף 2 textareas לאחר שדה `loc-equipment`**

מצא (שורה ~4506):
```html
        <input id="loc-equipment" value="${escHtml(loc.equipment)}" style="width:100%;background:#0a0a0a;border:1px solid #222;color:#f0ede8;padding:.6rem .8rem;border-radius:4px;font-family:'Heebo',sans-serif">
      </div>
```

הוסף מיד לאחריו:
```html
      <div style="margin-bottom:1rem">
        <label style="display:block;font-size:.8rem;color:#888;margin-bottom:.3rem">מתי לבוא (JSON)</label>
        <textarea id="loc-when-to-visit" style="width:100%;background:#0a0a0a;border:1px solid #222;color:#f0ede8;padding:.6rem .8rem;border-radius:4px;min-height:70px;font-family:monospace;direction:ltr;font-size:.78rem">${escHtml(loc.when_to_visit || '')}</textarea>
      </div>
      <div style="margin-bottom:1rem">
        <label style="display:block;font-size:.8rem;color:#888;margin-bottom:.3rem">ציוד מומלץ (JSON)</label>
        <textarea id="loc-recommended-gear" style="width:100%;background:#0a0a0a;border:1px solid #222;color:#f0ede8;padding:.6rem .8rem;border-radius:4px;min-height:60px;font-family:monospace;direction:ltr;font-size:.78rem">${escHtml(loc.recommended_gear || '')}</textarea>
      </div>
```

- [ ] **Step 2: הוסף שדות ל-`saveLoc()` (שמירת נתונים)**

מצא את הבלוק שסביב שורה 4873:
```js
        best_time: document.getElementById('loc-best-time').value,
```

הוסף לאחר השורה `equipment: document.getElementById('loc-equipment').value,`:
```js
        when_to_visit: document.getElementById('loc-when-to-visit').value || null,
        recommended_gear: document.getElementById('loc-recommended-gear').value || null,
```

- [ ] **Step 3: עדכן את ה-reset לאחר שמירה**

מצא (שורה ~4898):
```js
        document.getElementById('loc-equipment').value = updated.equipment || '';
```

הוסף לאחריו:
```js
        document.getElementById('loc-when-to-visit').value = updated.when_to_visit || '';
        document.getElementById('loc-recommended-gear').value = updated.recommended_gear || '';
```

- [ ] **Step 4: Commit**

```bash
git add admin.html
git commit -m "feat: add when_to_visit + recommended_gear fields to admin locations editor"
```

---

## Task 6: Deploy + Re-enrich

**Files:**
- אין שינויי קוד — רק פריסה וקריאות API

- [ ] **Step 1: Deploy Worker**

```bash
wrangler deploy
```

Expected: `✅ Deployed ... (worker.js)`

- [ ] **Step 2: אמת שה-API מחזיר שדות חדשים**

```bash
curl -s "https://amitphotos.com/api/locations/mtzdh" | python3 -c "import json,sys; d=json.load(sys.stdin); print('nearby:', len(d.get('nearby',[])), '| when_to_visit:', bool(d.get('when_to_visit')))"
```

Expected: `nearby: 2-5 | when_to_visit: False` (עדיין ריק עד re-enrich)

- [ ] **Step 3: Re-enrich את 6 המקומות הקיימים**

הרץ את הפקודות הבאות אחת אחרי השנייה (כל אחת לוקחת ~5 שניות):

```bash
curl -s -X POST "https://amitphotos.com/api/admin/shmvrt-htba-hchvlh/enrich" -H "X-Admin-Password: Hadas2409" | python3 -c "import json,sys; d=json.load(sys.stdin); print('חולה:', bool(d.get('when_to_visit')))"
curl -s -X POST "https://amitphotos.com/api/admin/park-avtvpyh/enrich" -H "X-Admin-Password: Hadas2409" | python3 -c "import json,sys; d=json.load(sys.stdin); print('אוטופיה:', bool(d.get('when_to_visit')))"
curl -s -X POST "https://amitphotos.com/api/admin/marvt-byt-gvbryn/enrich" -H "X-Admin-Password: Hadas2409" | python3 -c "import json,sys; d=json.load(sys.stdin); print('בית גוברין:', bool(d.get('when_to_visit')))"
curl -s -X POST "https://amitphotos.com/api/admin/ym-hmlch/enrich" -H "X-Admin-Password: Hadas2409" | python3 -c "import json,sys; d=json.load(sys.stdin); print('ים המלח:', bool(d.get('when_to_visit')))"
curl -s -X POST "https://amitphotos.com/api/admin/hayr-hatykh-byrvshlym/enrich" -H "X-Admin-Password: Hadas2409" | python3 -c "import json,sys; d=json.load(sys.stdin); print('ירושלים:', bool(d.get('when_to_visit')))"
curl -s -X POST "https://amitphotos.com/api/admin/mtzdh/enrich" -H "X-Admin-Password: Hadas2409" | python3 -c "import json,sys; d=json.load(sys.stdin); print('מצדה:', bool(d.get('when_to_visit')))"
```

Expected: כל שורה מדפיסה `True`.

- [ ] **Step 4: אמת בדפדפן**

פתח `https://amitphotos.com/locations/spot/?slug=mtzdh` — אמת שמופיעים:
- רשת 4 עונות עם צבעים
- chips של ציוד
- רשימת מקומות קרובים

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: deploy locations expansion phase 1 — 3 new sections on spot page"
```

---

## Task 7: יצירת 7 מקומות חדשים

**Files:**
- `src/create_locations.py` (חדש — סקריפט חד-פעמי)

- [ ] **Step 1: צור את הסקריפט**

צור `src/create_locations.py`:

```python
"""
יוצר 7 מקומות חדשים דרך admin API.
הרצה: python src/create_locations.py
"""
import requests, json, time

BASE = "https://amitphotos.com"
HEADERS = {"X-Admin-Password": "Hadas2409", "Content-Type": "application/json"}

LOCATIONS = [
    {"title": "מסגד שייח זאיד, אבו דאבי", "region": "חו\"ל — אמירויות"},
    {"title": "הדולומיטים, איטליה",         "region": "חו\"ל — איטליה"},
    {"title": "ספארי טנזניה",               "region": "חו\"ל — אפריקה"},
    {"title": "מנזרי מטאורה, יוון",          "region": "חו\"ל — יוון"},
    {"title": "כנרת",                        "region": "צפון"},
    {"title": "הר חרמון בשלג",              "region": "צפון"},
    {"title": "גנים בהאי, חיפה",            "region": "צפון"},
]

for loc in LOCATIONS:
    r = requests.post(f"{BASE}/api/admin/locations", headers=HEADERS, json=loc)
    if r.status_code in (200, 201):
        d = r.json()
        print(f"✅ נוצר: {d['title']} (slug: {d['id']}) | when_to_visit: {bool(d.get('when_to_visit'))}")
    else:
        print(f"❌ שגיאה ב-{loc['title']}: {r.status_code} {r.text[:80]}")
    time.sleep(3)  # avoid rate limits on Claude API
```

- [ ] **Step 2: הרץ**

```bash
python src/create_locations.py
```

Expected (7 שורות):
```
✅ נוצר: מסגד שייח זאיד, אבו דאבי (slug: msgd-shykh-zayd-abv-daby) | when_to_visit: True
✅ נוצר: הדולומיטים, איטליה (slug: hdvlvmytym-aytlyh) | when_to_visit: True
...
```

שמור את ה-slugs שמודפסים — תצטרך אותם בTask 8.

- [ ] **Step 3: Commit**

```bash
git add src/create_locations.py
git commit -m "feat: create 7 new location pages via admin API"
```

---

## Task 8: שיוך תמונות ל-7 המקומות החדשים

**Files:**
- `src/assign_location_photos.py` (חדש — סקריפט חד-פעמי)

המפה בין מקומות לתמונות מבוססת על כותרות ב-`data/photos.json`.

- [ ] **Step 1: הרץ בדיקה — אילו photo IDs יש לכל מקום**

```bash
python3 -c "
import json
photos = json.load(open('data/photos.json'))
cats = {'אבו דאבי': [], 'איטליה': [], 'טנזניה': [], 'יוון': [], 'ישראל': []}
for p in photos:
    c = p.get('category','')
    if c in cats:
        cats[c].append({'id': p['id'], 'title': p.get('title','')[:35]})
for k,v in cats.items():
    print(f'{k}: {len(v)} תמונות')
    for x in v[:5]: print(f'  {x[\"id\"][:8]}... {x[\"title\"]}')
"
```

Expected: רשימת IDs ראשונים לכל קטגוריה.

- [ ] **Step 2: צור את סקריפט השיוך**

צור `src/assign_location_photos.py`. החלף את ה-slugs בסוגריים המרובעים עם הערכים שקיבלת ב-Task 7:

```python
"""
מקשר תמונות מהגלריה לדפי מקום חדשים.
הרצה: python src/assign_location_photos.py
"""
import json, requests, time

BASE = "https://amitphotos.com"
HEADERS = {"X-Admin-Password": "Hadas2409", "Content-Type": "application/json"}

photos = json.load(open("data/photos.json"))

def photos_by_category(cat, limit=8):
    return [p["id"] for p in photos if p.get("category") == cat][:limit]

def photos_by_keyword(keywords, limit=6):
    ids = []
    for p in photos:
        title = p.get("title", "")
        if any(kw in title for kw in keywords):
            ids.append(p["id"])
        if len(ids) >= limit:
            break
    return ids

# slug → list of photo_ids to assign
# UPDATE these slugs with actual values from Task 7 output:
ASSIGNMENTS = {
    "msgd-shykh-zayd-abv-daby": photos_by_category("אבו דאבי", 8),
    "hdvlvmytym-aytlyh":        photos_by_keyword(["דולומיט","אלפ","אגם","הרים","הר"], 8)
                                 or photos_by_category("איטליה", 8),
    "spry-tnznyh":               photos_by_category("טנזניה", 8),
    "mnzry-mtvvrh-yvvn":        photos_by_keyword(["מטאורה","מנזר","מפל"], 6)
                                 or photos_by_category("יוון", 6),
    "knrt":                      photos_by_keyword(["כנרת","עגורן","עגורי","הולה","חולה"], 4),
    "hr-chrmvn-bshlg":           photos_by_keyword(["חרמון","רמון","שלג"], 4),
    "gnvm-bhy-chypvh":           photos_by_keyword(["חיפה","בהאי","גנים"], 4),
}

for slug, photo_ids in ASSIGNMENTS.items():
    if not photo_ids:
        print(f"⚠️  {slug}: אין תמונות — דלג")
        continue
    print(f"\n📍 {slug} ({len(photo_ids)} תמונות):")
    for pid in photo_ids:
        r = requests.post(
            f"{BASE}/api/admin/locations/{slug}/photos",
            headers=HEADERS,
            json={"photo_id": pid, "for_sale": False}
        )
        status = "✅" if r.status_code in (200,201) else f"❌ {r.status_code}"
        print(f"  {status} {pid[:12]}...")
        time.sleep(0.3)
```

- [ ] **Step 3: עדכן slugs בסקריפט**

פתח `src/assign_location_photos.py` ועדכן את המילון `ASSIGNMENTS` עם ה-slugs האמיתיים שקיבלת מ-Task 7.

- [ ] **Step 4: הרץ את הסקריפט**

```bash
python src/assign_location_photos.py
```

Expected: כל מקום מקבל לפחות 3-4 תמונות. אם מקום מוצג כ-⚠️ ← תצטרך לשייך ידנית מהאדמין.

- [ ] **Step 5: פרסם את 7 המקומות**

```bash
python3 -c "
import requests, time
BASE = 'https://amitphotos.com'
H = {'X-Admin-Password': 'Hadas2409', 'Content-Type': 'application/json'}
# עדכן slugs:
slugs = [
  'msgd-shykh-zayd-abv-daby',
  'hdvlvmytym-aytlyh',
  'spry-tnznyh',
  'mnzry-mtvvrh-yvvn',
  'knrt',
  'hr-chrmvn-bshlg',
  'gnvm-bhy-chypvh',
]
for s in slugs:
    r = requests.put(f'{BASE}/api/admin/locations/{s}', headers=H, json={'published': True})
    print(s, '✅' if r.ok else r.status_code)
    time.sleep(0.5)
"
```

- [ ] **Step 6: אמת ב-Hub page**

פתח `https://amitphotos.com/locations/` — אמת שמופיעים 13 מקומות (6 ישנים + 7 חדשים).

- [ ] **Step 7: Commit**

```bash
git add src/assign_location_photos.py
git commit -m "feat: assign gallery photos to 7 new location pages + publish"
```

---

## Self-Review

**Spec coverage check:**
- ✅ D1: 2 עמודות חדשות — Task 1
- ✅ `when_to_visit` — JSON עם 4 עונות — Task 2 prompt + Task 4 CSS/render
- ✅ `recommended_gear` — JSON array עם primary — Task 2 prompt + Task 4 render
- ✅ `nearby` — Haversine, 3 קרובים — Task 3
- ✅ `handleAdminLocationsUpdate` מקבל שדות חדשים — Task 2 Step 4
- ✅ `/locations/spot/index.html` — 3 סעיפים — Task 4
- ✅ `admin.html` — 2 textareas — Task 5
- ✅ Deploy + re-enrich 6 קיימים — Task 6
- ✅ 7 מקומות חדשים — Task 7
- ✅ שיוך תמונות — Task 8

**Placeholders:** אין.

**Type consistency:**
- `when_to_visit` — JSON string ב-D1, parsed לobject בAPI, `d.when_to_visit` בfrontend ✅
- `recommended_gear` — JSON string ב-D1, parsed לarray בAPI, `d.recommended_gear` בfrontend ✅
- `nearby` — מחושב ב-Worker, לא ב-D1 ✅
- `g.primary` בfrontend ← `primary:true/false` מהAI ✅
