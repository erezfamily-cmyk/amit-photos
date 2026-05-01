# "בית ספר לצילום" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an auto-publishing photo analysis section at `/learn/` — AI picks a photo every 2 days, generates a full educational breakdown (composition rule, annotations, camera analysis), saves to D1, renders as a dynamic page, and posts to Facebook + Instagram.

**Architecture:** Cloudflare Worker handles all `/learn/` routes and `/api/analyses` CRUD, rendering full HTML from D1 data. Generation happens entirely in the Worker via Claude API (triggered by GitHub Actions cron). GitHub Actions only calls the generation endpoint + handles social posting.

**Tech Stack:** Cloudflare Workers, D1 SQLite, Claude API (sonnet-4-6 + haiku-4-5), GitHub Actions, Facebook Graph API, Instagram Graph API, Python (social scripts), Vanilla JS/HTML (admin)

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `worker.js` | Modify | Add migration endpoint, `/api/analyses` CRUD, `/learn/` + `/learn/:id` routes |
| `admin.html` | Modify | Add "בית ספר לצילום" section with list + edit modal |
| `index.html` | Modify | Add "בית ספר לצילום" nav link |
| `assets/js/i18n.js` | Modify | Add `nav.learn` key HE+EN |
| `.github/workflows/learn-generate.yml` | Create | Cron every 2 days: call generate endpoint + post to social |
| `src/learn_social_post.py` | Create | Python script: POST to generate endpoint, then FB + IG |

---

## Task 1: D1 Schema Migration

**Files:**
- Modify: `worker.js` (add migration handler + route ~line 2220)

- [ ] **Step 1: Add the migration handler function**

Add this function to `worker.js` before the MAIN ROUTER section:

```javascript
async function handleMigrateAnalyses(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== 'POST') return jsonRes({ error: 'POST only' }, 405, request);
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS photo_analyses (
        photo_id TEXT PRIMARY KEY,
        composition_rule TEXT NOT NULL,
        annotations_json TEXT NOT NULL DEFAULT '[]',
        camera_json TEXT NOT NULL DEFAULT '{}',
        composition_html TEXT NOT NULL DEFAULT '',
        tags_json TEXT NOT NULL DEFAULT '[]',
        title TEXT NOT NULL DEFAULT '',
        published_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();
    return jsonRes({ ok: true, message: 'photo_analyses table ready' }, 200, request);
  } catch (e) {
    return jsonRes({ error: String(e) }, 500, request);
  }
}
```

- [ ] **Step 2: Add route in the MAIN ROUTER**

In `worker.js`, find the block of `if (path === '/api/admin/migrate-...')` entries (~line 2220) and add:

```javascript
if (path === '/api/admin/migrate-analyses' && request.method === 'POST') return handleMigrateAnalyses(request, env);
```

- [ ] **Step 3: Deploy and run migration**

```bash
npx wrangler deploy
curl -X POST https://amitphotos.com/api/admin/migrate-analyses \
  -H "X-Admin-Password: YOUR_ADMIN_PASSWORD"
```

Expected response: `{"ok":true,"message":"photo_analyses table ready"}`

- [ ] **Step 4: Commit**

```bash
git add worker.js
git commit -m "feat: add photo_analyses D1 table migration"
git push
```

---

## Task 2: Worker API Routes — `/api/analyses`

**Files:**
- Modify: `worker.js` (add 4 handler functions + 4 routes)

This is the largest task. Add 4 functions: list, get, update, and generate.

- [ ] **Step 1: Add `handleAnalysesList` (GET /api/analyses)**

```javascript
async function handleAnalysesList(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  try {
    const { results } = await env.DB.prepare(
      `SELECT a.photo_id, a.title, a.composition_rule, a.published_at,
              p.thumbnail
       FROM photo_analyses a
       LEFT JOIN photos p ON p.id = a.photo_id
       ORDER BY a.published_at DESC`
    ).all();
    return jsonRes(results || [], 200, request);
  } catch (e) {
    return jsonRes({ error: String(e) }, 500, request);
  }
}
```

- [ ] **Step 2: Add `handleAnalysesGet` (GET /api/analyses/:photoId)**

```javascript
async function handleAnalysesGet(request, env, photoId) {
  if (!await checkAuth(request, env)) return unauth(request);
  try {
    const row = await env.DB.prepare(
      'SELECT * FROM photo_analyses WHERE photo_id = ?'
    ).bind(photoId).first();
    if (!row) return jsonRes({ error: 'לא נמצא' }, 404, request);
    return jsonRes({
      ...row,
      annotations: JSON.parse(row.annotations_json || '[]'),
      camera: JSON.parse(row.camera_json || '{}'),
      tags: JSON.parse(row.tags_json || '[]'),
    }, 200, request);
  } catch (e) {
    return jsonRes({ error: String(e) }, 500, request);
  }
}
```

- [ ] **Step 3: Add `handleAnalysesUpdate` (PUT /api/analyses/:photoId)**

```javascript
async function handleAnalysesUpdate(request, env, photoId) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== 'PUT') return jsonRes({ error: 'PUT only' }, 405, request);
  const body = await request.json().catch(() => ({}));
  const fields = [];
  const values = [];
  if (body.composition_html !== undefined) { fields.push('composition_html = ?'); values.push(body.composition_html); }
  if (body.tags_json !== undefined)        { fields.push('tags_json = ?');        values.push(body.tags_json); }
  if (body.camera_json !== undefined)      { fields.push('camera_json = ?');      values.push(body.camera_json); }
  if (body.annotations_json !== undefined) { fields.push('annotations_json = ?'); values.push(body.annotations_json); }
  if (body.title !== undefined)            { fields.push('title = ?');            values.push(body.title); }
  if (!fields.length) return jsonRes({ error: 'אין שדות לעדכון' }, 400, request);
  values.push(photoId);
  await env.DB.prepare(`UPDATE photo_analyses SET ${fields.join(', ')} WHERE photo_id = ?`).bind(...values).run();
  return jsonRes({ ok: true }, 200, request);
}
```

- [ ] **Step 4: Add `handleAnalysesGenerate` (POST /api/analyses/generate)**

This function:
1. Picks 5 unanalyzed photos with EXIF
2. Sends them to Claude haiku to pick the best one + identify composition rule
3. Calls Claude sonnet for full analysis JSON
4. Saves to D1
5. Returns the full analysis

```javascript
async function handleAnalysesGenerate(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== 'POST') return jsonRes({ error: 'POST only' }, 405, request);
  if (!env.ANTHROPIC_API_KEY) return jsonRes({ error: 'ANTHROPIC_API_KEY חסר' }, 500, request);

  // 1. Pick 5 candidates (unanalyzed, have EXIF, published)
  const { results: candidates } = await env.DB.prepare(`
    SELECT p.id, p.title, p.thumbnail, p.url, p.exif, p.description
    FROM photos p
    LEFT JOIN photo_analyses a ON a.photo_id = p.id
    WHERE a.photo_id IS NULL
      AND p.exif IS NOT NULL
      AND p.published = 1
    ORDER BY RANDOM()
    LIMIT 5
  `).all();

  if (!candidates || candidates.length === 0) {
    return jsonRes({ error: 'אין תמונות זמינות לניתוח' }, 404, request);
  }

  // 2. Ask Claude haiku to pick the best photo for educational analysis
  const pickContent = [
    {
      type: 'text',
      text: `אתה מורה לצילום. מוצגות לך ${candidates.length} תמונות. בחר אחת שמדגימה חוק צילום בצורה הכי ברורה לצלמן מתחיל.

חוקים אפשריים: rule_of_thirds, symmetry, leading_lines, golden_ratio, framing, negative_space

החזר JSON בלבד (ללא markdown):
{"index": 0-${candidates.length - 1}, "rule": "שם_החוק", "reason": "משפט אחד בעברית"}`
    },
    ...candidates.map((c, i) => ({
      type: 'image',
      source: { type: 'url', url: c.thumbnail || c.url }
    }))
  ];

  const pickRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{ role: 'user', content: pickContent }]
    })
  });
  if (!pickRes.ok) return jsonRes({ error: 'Claude API error (pick)' }, 502, request);

  let pickData;
  try {
    const pickJson = await pickRes.json();
    const raw = pickJson.content?.[0]?.text?.trim() || '{}';
    pickData = JSON.parse(raw.replace(/```json\n?|\n?```/g, ''));
  } catch {
    pickData = { index: 0, rule: 'rule_of_thirds' };
  }

  const chosen = candidates[pickData.index] || candidates[0];
  const rule = pickData.rule || 'rule_of_thirds';
  const exif = JSON.parse(chosen.exif || '{}');
  const focalVal = exif.focal || '?';
  const apertureVal = exif.aperture || '?';
  const shutterVal = exif.shutter ? `1/${Math.round(1 / exif.shutter)}` : '?';
  const isoVal = exif.iso || '?';
  const cameraVal = exif.camera || '';

  // 3. Ask Claude sonnet for full analysis
  const analysisRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'url', url: chosen.thumbnail || chosen.url } },
          { type: 'text', text: `אתה מורה לצילום כותב מדריך לצלמן מתחיל על התמונה הזו.

נתוני מצלמה:
- כותרת: ${chosen.title || ''}
- תיאור: ${chosen.description || ''}
- מצלמה: ${cameraVal}
- מרחק מוקד: ${focalVal}mm
- צמצם: f/${apertureVal}
- תריס: ${shutterVal}s
- ISO: ${isoVal}
- חוק צילום לנתח: ${rule}

החזר JSON בלבד (ללא markdown), בדיוק במבנה הזה:
{
  "annotations": [
    {"x_pct": 0-100, "y_pct": 0-100, "label": "שורה1\\nשורה2", "anchor": "left|right|top|bottom"}
  ],
  "camera_analysis": {
    "aperture": {"value": "f/${apertureVal}", "explanation": "הסבר קצר בעברית"},
    "shutter":  {"value": "${shutterVal}s",   "explanation": "הסבר קצר בעברית"},
    "iso":      {"value": "${isoVal}",        "explanation": "הסבר קצר בעברית"},
    "focal":    {"value": "${focalVal}mm",    "explanation": "הסבר קצר בעברית"}
  },
  "composition_html": "<p><strong>כותרת:</strong> טקסט ראשון...</p><p><strong>כותרת:</strong> טקסט שני...</p><p><strong>כותרת:</strong> טקסט שלישי...</p>",
  "tags": ["תג1", "תג2", "תג3", "תג4"]
}

חוקים:
- annotations: 3-5 נקודות, בפיזור על התמונה
- composition_html: בדיוק 3 פסקאות עם <strong> בתחילת כל אחת
- tags: 4-6 מילים קצרות בעברית
- הכל בעברית` }
        ]
      }]
    })
  });
  if (!analysisRes.ok) return jsonRes({ error: 'Claude API error (analysis)' }, 502, request);

  let analysis;
  try {
    const analysisJson = await analysisRes.json();
    const raw = analysisJson.content?.[0]?.text?.trim() || '{}';
    analysis = JSON.parse(raw.replace(/```json\n?|\n?```/g, ''));
  } catch (e) {
    return jsonRes({ error: 'Failed to parse Claude response: ' + String(e) }, 502, request);
  }

  // 4. Save to D1
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT OR REPLACE INTO photo_analyses
      (photo_id, composition_rule, annotations_json, camera_json, composition_html, tags_json, title, published_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    chosen.id,
    rule,
    JSON.stringify(analysis.annotations || []),
    JSON.stringify(analysis.camera_analysis || {}),
    analysis.composition_html || '',
    JSON.stringify(analysis.tags || []),
    chosen.title || '',
    now
  ).run();

  // 5. Return for social posting
  return jsonRes({
    ok: true,
    photo_id: chosen.id,
    title: chosen.title,
    thumbnail: chosen.thumbnail || chosen.url,
    composition_rule: rule,
    tags: analysis.tags || [],
    composition_html: analysis.composition_html || '',
    learn_url: `https://amitphotos.com/learn/${chosen.id}`,
  }, 200, request);
}
```

- [ ] **Step 5: Add all 4 routes in MAIN ROUTER**

In `worker.js`, in the MAIN ROUTER section, add these lines (after the existing `/api/admin/` routes block):

```javascript
if (path === '/api/analyses' && request.method === 'GET')                    return handleAnalysesList(request, env);
if (path === '/api/analyses/generate' && request.method === 'POST')          return handleAnalysesGenerate(request, env);
if (path.startsWith('/api/analyses/') && request.method === 'GET')           return handleAnalysesGet(request, env, path.slice('/api/analyses/'.length));
if (path.startsWith('/api/analyses/') && request.method === 'PUT')           return handleAnalysesUpdate(request, env, path.slice('/api/analyses/'.length));
```

**Important:** the `/api/analyses/generate` route must come BEFORE the generic `/api/analyses/:id` route.

- [ ] **Step 6: Deploy and test**

```bash
npx wrangler deploy
# Test generate (use real admin password):
curl -X POST https://amitphotos.com/api/analyses/generate \
  -H "X-Admin-Password: YOUR_ADMIN_PASSWORD"
```

Expected: JSON with `ok: true`, `photo_id`, `title`, `learn_url`.

```bash
# Test list:
curl https://amitphotos.com/api/analyses \
  -H "X-Admin-Password: YOUR_ADMIN_PASSWORD"
```

Expected: JSON array with the generated analysis.

- [ ] **Step 7: Commit**

```bash
git add worker.js
git commit -m "feat: add /api/analyses CRUD + generate endpoint"
git push
```

---

## Task 3: Worker — `/learn/` Index Page

**Files:**
- Modify: `worker.js` (add `handleLearnIndex` function + route)

- [ ] **Step 1: Add `handleLearnIndex` function**

Add before the MAIN ROUTER section:

```javascript
const RULE_LABELS = {
  rule_of_thirds: 'חוק השליש',
  symmetry: 'סימטריה',
  leading_lines: 'קווים מובילים',
  golden_ratio: 'יחס הזהב',
  framing: 'מסגור',
  negative_space: 'מרחב שלילי',
};

async function handleLearnIndex(env) {
  const { results: analyses } = await env.DB.prepare(
    `SELECT a.photo_id, a.title, a.composition_rule, a.tags_json, a.published_at,
            p.thumbnail
     FROM photo_analyses a
     LEFT JOIN photos p ON p.id = a.photo_id
     ORDER BY a.published_at DESC`
  ).all().catch(() => ({ results: [] }));

  const cards = (analyses || []).map(a => {
    const thumb = a.thumbnail || '';
    const ruleLabel = RULE_LABELS[a.composition_rule] || a.composition_rule;
    const tags = JSON.parse(a.tags_json || '[]').slice(0, 3).map(t => `<span class="tag">${escXml(t)}</span>`).join('');
    const date = a.published_at ? a.published_at.slice(0, 10) : '';
    return `<a class="learn-card" href="/learn/${escXml(a.photo_id)}">
      <img src="${escXml(thumb)}" alt="${escXml(a.title)}" loading="lazy">
      <div class="learn-card-body">
        <div class="learn-card-rule">${escXml(ruleLabel)}</div>
        <div class="learn-card-title">${escXml(a.title)}</div>
        <div class="learn-card-tags">${tags}</div>
        <div class="learn-card-date">${escXml(date)}</div>
      </div>
    </a>`;
  }).join('\n');

  const empty = analyses.length === 0
    ? '<p style="text-align:center;color:#888;padding:4rem">הניתוח הראשון יפורסם בקרוב — חזרו מחר!</p>'
    : '';

  const html = `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>בית ספר לצילום — Amit Photos</title>
<meta name="description" content="ניתוח צילומי מעמיק של תמונות אמנות — חוק השליש, בוקה, קומפוזיציה. מדריך לצלמן מתחיל.">
<meta property="og:title" content="📸 בית ספר לצילום | Amit Photos">
<meta property="og:description" content="ניתוח צילומי מעמיק — חוקי קומפוזיציה, הגדרות מצלמה, ופירוש כל בחירה של הצלם.">
<meta property="og:type" content="website">
<meta property="og:url" content="https://amitphotos.com/learn/">
<meta property="og:locale" content="he_IL">
<link rel="canonical" href="https://amitphotos.com/learn/">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;600;700&family=Syne:wght@700&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0a0a0a;--surface:#111;--border:#222;--accent:#c8a96e;--text:#f0ede8;--muted:#888}
body{font-family:'Heebo',sans-serif;background:var(--bg);color:var(--text);direction:rtl;min-height:100vh;padding:0 0 4rem}
.site-header{display:flex;align-items:center;justify-content:space-between;padding:1rem 1.25rem;border-bottom:1px solid var(--border)}
.site-title{font-family:'Syne',sans-serif;font-size:1.1rem;color:var(--accent);text-decoration:none}
.page-hero{text-align:center;padding:2.5rem 1.25rem 1.5rem}
.page-hero h1{font-family:'Syne',sans-serif;font-size:1.8rem;color:var(--accent);margin-bottom:.5rem}
.page-hero p{color:var(--muted);font-size:.9rem;max-width:380px;margin:0 auto}
.grid{display:grid;grid-template-columns:1fr;gap:1rem;padding:1.25rem;max-width:900px;margin:0 auto}
@media(min-width:520px){.grid{grid-template-columns:1fr 1fr}}
@media(min-width:800px){.grid{grid-template-columns:1fr 1fr 1fr}}
.learn-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden;text-decoration:none;color:inherit;transition:border-color .2s,transform .15s;display:flex;flex-direction:column}
.learn-card:hover{border-color:var(--accent);transform:translateY(-3px)}
.learn-card img{width:100%;aspect-ratio:4/3;object-fit:cover;background:#1a1a1a}
.learn-card-body{padding:.75rem}
.learn-card-rule{font-size:.7rem;color:var(--accent);background:rgba(200,169,110,.1);border:1px solid rgba(200,169,110,.25);border-radius:4px;display:inline-block;padding:2px 7px;margin-bottom:.4rem}
.learn-card-title{font-family:'Syne',sans-serif;font-size:.95rem;color:var(--text);margin-bottom:.4rem}
.learn-card-tags{display:flex;flex-wrap:wrap;gap:3px;margin-bottom:.3rem}
.tag{font-size:.65rem;color:var(--muted);background:#1a1a1a;border:1px solid var(--border);border-radius:4px;padding:1px 5px}
.learn-card-date{font-size:.65rem;color:#555}
.back-link{text-align:center;padding:1rem}
.back-link a{color:var(--accent);font-size:.85rem;text-decoration:none}
</style>
</head>
<body>
<header class="site-header">
  <a class="site-title" href="https://amitphotos.com">Amit Photos</a>
  <span style="color:var(--muted);font-size:.8rem">📸 בית ספר לצילום</span>
</header>
<div class="page-hero">
  <h1>📸 בית ספר לצילום</h1>
  <p>ניתוח צילומי מעמיק — חוקי קומפוזיציה, הגדרות מצלמה, ומה הצלם חשב</p>
</div>
<div class="grid">${cards}${empty}</div>
<div class="back-link"><a href="https://amitphotos.com">← לגלריה המלאה</a></div>
</body>
</html>`;

  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
```

- [ ] **Step 2: Add route in MAIN ROUTER**

```javascript
if (path === '/learn' || path === '/learn/')   return handleLearnIndex(env);
```

- [ ] **Step 3: Deploy and verify**

```bash
npx wrangler deploy
```

Open `https://amitphotos.com/learn/` in browser — should show the grid (or "יפורסם בקרוב" if no analyses yet).

- [ ] **Step 4: Commit**

```bash
git add worker.js
git commit -m "feat: add /learn/ index page"
git push
```

---

## Task 4: Worker — `/learn/:photoId` Analysis Page

**Files:**
- Modify: `worker.js` (add `handleLearnAnalysis` + `RULE_LABELS` already added in Task 3)

This is the complex rendering task. The page shows: photo + SVG overlay + annotation dots + camera cards + bokeh diagram + composition text.

- [ ] **Step 1: Add the composition overlay helper**

Add this helper before `handleLearnAnalysis`:

```javascript
function buildRuleOverlay(rule) {
  const gold = 'rgba(200,169,110,0.55)';
  const dash = '6,4';
  if (rule === 'rule_of_thirds') return `
    <line x1="33.3%" y1="0" x2="33.3%" y2="100%" stroke="${gold}" stroke-width="1.5" stroke-dasharray="${dash}"/>
    <line x1="66.6%" y1="0" x2="66.6%" y2="100%" stroke="${gold}" stroke-width="1.5" stroke-dasharray="${dash}"/>
    <line x1="0" y1="33.3%" x2="100%" y2="33.3%" stroke="${gold}" stroke-width="1.5" stroke-dasharray="${dash}"/>
    <line x1="0" y1="66.6%" x2="100%" y2="66.6%" stroke="${gold}" stroke-width="1.5" stroke-dasharray="${dash}"/>
    <circle cx="33.3%" cy="33.3%" r="5" fill="${gold}"/>
    <circle cx="66.6%" cy="33.3%" r="5" fill="${gold}"/>
    <circle cx="33.3%" cy="66.6%" r="5" fill="${gold}"/>
    <circle cx="66.6%" cy="66.6%" r="5" fill="${gold}"/>`;
  if (rule === 'symmetry') return `
    <line x1="50%" y1="0" x2="50%" y2="100%" stroke="${gold}" stroke-width="2" stroke-dasharray="${dash}"/>`;
  if (rule === 'leading_lines') return `
    <line x1="0" y1="100%" x2="60%" y2="30%" stroke="${gold}" stroke-width="2" stroke-dasharray="${dash}"/>
    <polygon points="60%,25% 57%,35% 63%,35%" fill="${gold}"/>`;
  if (rule === 'framing') return `
    <rect x="10%" y="10%" width="80%" height="80%" fill="none" stroke="${gold}" stroke-width="2" stroke-dasharray="${dash}"/>`;
  if (rule === 'negative_space') return `
    <rect x="0" y="0" width="40%" height="100%" fill="rgba(200,169,110,0.08)"/>`;
  if (rule === 'golden_ratio') return `
    <rect x="0" y="0" width="61.8%" height="100%" fill="none" stroke="${gold}" stroke-width="1.5" stroke-dasharray="${dash}"/>
    <line x1="61.8%" y1="0" x2="61.8%" y2="100%" stroke="${gold}" stroke-width="2"/>`;
  return '';
}
```

- [ ] **Step 2: Add the annotation renderer helper**

```javascript
function buildAnnotations(annotations) {
  return annotations.map(ann => {
    const labelLines = (ann.label || '').split('\\n').map(l => escXml(l)).join('<br>');
    const anchorClass = `ann-${ann.anchor || 'right'}`;
    return `<div class="ann" style="left:${ann.x_pct}%;top:${ann.y_pct}%">
      <div class="ann-dot"></div>
      <div class="ann-label ${anchorClass}">${labelLines}</div>
    </div>`;
  }).join('\n');
}
```

- [ ] **Step 3: Add `handleLearnAnalysis` function**

```javascript
async function handleLearnAnalysis(env, photoId) {
  const row = await env.DB.prepare(
    'SELECT * FROM photo_analyses WHERE photo_id = ?'
  ).bind(photoId).first().catch(() => null);

  if (!row) return Response.redirect('https://amitphotos.com/learn/', 302);

  const photo = await env.DB.prepare(
    'SELECT id, title, thumbnail, url, exif FROM photos WHERE id = ?'
  ).bind(photoId).first().catch(() => null);

  if (!photo) return Response.redirect('https://amitphotos.com/learn/', 302);

  const annotations = JSON.parse(row.annotations_json || '[]');
  const camera = JSON.parse(row.camera_json || '{}');
  const tags = JSON.parse(row.tags_json || '[]');
  const ruleLabel = RULE_LABELS[row.composition_rule] || row.composition_rule;
  const imgUrl = (photo.thumbnail || photo.url || '') + '?w=900';
  const buyUrl = `https://amitphotos.com/?photo=${encodeURIComponent(photoId)}`;

  const cameraCards = ['aperture', 'shutter', 'iso', 'focal'].map(key => {
    const c = camera[key] || {};
    const labels = { aperture: 'צמצם', shutter: 'מהירות תריס', iso: 'ISO', focal: 'מרחק מוקד' };
    return `<div class="cam-card">
      <div class="cam-label">${labels[key]}</div>
      <div class="cam-value">${escXml(c.value || '—')}</div>
      <div class="cam-desc">${escXml(c.explanation || '')}</div>
    </div>`;
  }).join('\n');

  const tagPills = tags.map(t => `<span class="tag">${escXml(t)}</span>`).join('');

  const html = `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escXml(row.title)} — ניתוח צילום | Amit Photos</title>
<meta name="description" content="ניתוח צילומי של "${escXml(row.title)}" — ${escXml(ruleLabel)}, הגדרות מצלמה, ופירוש הקומפוזיציה.">
<meta property="og:title" content="📸 ${escXml(row.title)} | ניתוח צילום">
<meta property="og:description" content="ניתוח ${escXml(ruleLabel)} — הגדרות מצלמה ופירוש הקומפוזיציה. מדריך לצלמן מתחיל.">
<meta property="og:image" content="${escXml(photo.thumbnail || photo.url || '')}">
<meta property="og:type" content="article">
<meta property="og:url" content="https://amitphotos.com/learn/${escXml(photoId)}">
<meta property="og:locale" content="he_IL">
<link rel="canonical" href="https://amitphotos.com/learn/${escXml(photoId)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;600;700&family=Syne:wght@700&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0a0a0a;--surface:#111;--border:#222;--accent:#c8a96e;--text:#f0ede8;--muted:#888}
body{font-family:'Heebo',sans-serif;background:var(--bg);color:var(--text);direction:rtl;min-height:100vh;padding:0 0 4rem}
.site-header{display:flex;align-items:center;justify-content:space-between;padding:1rem 1.25rem;border-bottom:1px solid var(--border)}
.site-title{font-family:'Syne',sans-serif;font-size:1.1rem;color:var(--accent);text-decoration:none}
.page-header{padding:1.5rem 1.25rem .5rem;max-width:900px;margin:0 auto;display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:.5rem}
.page-title{font-family:'Syne',sans-serif;font-size:1.4rem;color:var(--text)}
.rule-badge{font-size:.72rem;color:var(--accent);background:rgba(200,169,110,.1);border:1px solid rgba(200,169,110,.25);border-radius:4px;padding:3px 9px;margin-top:.3rem;display:inline-block}
.buy-btn{background:var(--accent);color:#000;font-weight:700;font-size:.82rem;border-radius:8px;padding:.5rem 1rem;text-decoration:none;white-space:nowrap;flex-shrink:0}
.photo-wrap{position:relative;max-width:900px;margin:0 auto 1.5rem;padding:0 .75rem}
.photo-wrap img{width:100%;border-radius:10px;display:block}
.rule-overlay{position:absolute;top:.75rem;left:.75rem;right:.75rem;bottom:0;width:calc(100% - 1.5rem);height:100%;pointer-events:none}
.ann{position:absolute;transform:translate(-50%,-50%);pointer-events:none}
.ann-dot{width:10px;height:10px;border-radius:50%;background:var(--accent);border:2px solid #000;position:relative;z-index:2}
.ann-label{position:absolute;background:rgba(0,0,0,.85);border:1px solid var(--accent);border-radius:7px;padding:.3rem .55rem;font-size:.68rem;color:var(--text);line-height:1.45;white-space:nowrap;z-index:3}
.ann-right{left:16px;top:-10px}
.ann-left{right:16px;top:-10px}
.ann-bottom{top:16px;left:50%;transform:translateX(-50%)}
.ann-top{bottom:16px;left:50%;transform:translateX(-50%)}
.cam-cards{display:grid;grid-template-columns:1fr 1fr;gap:.75rem;padding:0 .75rem;max-width:900px;margin:0 auto 1.5rem}
@media(min-width:600px){.cam-cards{grid-template-columns:repeat(4,1fr)}}
.cam-card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:.85rem}
.cam-label{font-size:.7rem;color:var(--muted);margin-bottom:.25rem}
.cam-value{font-family:'Syne',sans-serif;font-size:1.05rem;color:var(--accent)}
.cam-desc{font-size:.7rem;color:var(--muted);margin-top:.3rem;line-height:1.4}
.section{max-width:900px;margin:0 auto 1.5rem;padding:0 .75rem}
.section h2{font-family:'Syne',sans-serif;color:var(--accent);font-size:1.05rem;margin-bottom:.75rem}
.bokeh-box{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:1.25rem}
.comp-box{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:1.1rem;font-size:.85rem;color:var(--muted);line-height:1.75}
.comp-box p{margin-bottom:.7rem}
.comp-box p:last-child{margin-bottom:0}
.comp-box strong{color:var(--text)}
.tags-row{display:flex;flex-wrap:wrap;gap:.3rem;margin-top:.75rem}
.tag{font-size:.72rem;color:var(--accent);background:rgba(200,169,110,.1);border:1px solid rgba(200,169,110,.25);border-radius:5px;padding:2px 8px}
.nav-row{text-align:center;padding:1rem}
.nav-row a{color:var(--accent);font-size:.85rem;text-decoration:none;margin:0 .75rem}
</style>
</head>
<body>
<header class="site-header">
  <a class="site-title" href="https://amitphotos.com">Amit Photos</a>
  <a href="/learn/" style="color:var(--muted);font-size:.8rem;text-decoration:none">📸 בית ספר לצילום</a>
</header>

<div class="page-header">
  <div>
    <h1 class="page-title">${escXml(row.title)}</h1>
    <span class="rule-badge">${escXml(ruleLabel)}</span>
  </div>
  <a class="buy-btn" href="${buyUrl}">רכוש תמונה זו ←</a>
</div>

<div class="photo-wrap">
  <img src="${escXml(imgUrl)}" alt="${escXml(row.title)}">
  <svg class="rule-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
    ${buildRuleOverlay(row.composition_rule)}
  </svg>
  ${buildAnnotations(annotations)}
</div>

<div class="cam-cards">${cameraCards}</div>

<div class="section">
  <h2>📊 איך נוצר הבוקה</h2>
  <div class="bokeh-box">
    <svg viewBox="0 0 500 180" style="width:100%;max-width:500px;display:block;margin:0 auto">
      <rect x="20" y="65" width="55" height="50" rx="5" fill="#1a1a1a" stroke="#c8a96e" stroke-width="1.5"/>
      <text x="47" y="95" text-anchor="middle" fill="#c8a96e" font-size="10" font-family="Heebo">מצלמה</text>
      <ellipse cx="75" cy="90" rx="9" ry="20" fill="#222" stroke="#c8a96e" stroke-width="1.5"/>
      <line x1="84" y1="72" x2="210" y2="90" stroke="rgba(200,169,110,.7)" stroke-width="1"/>
      <line x1="84" y1="90" x2="210" y2="90" stroke="rgba(200,169,110,.7)" stroke-width="1"/>
      <line x1="84" y1="108" x2="210" y2="90" stroke="rgba(200,169,110,.7)" stroke-width="1"/>
      <line x1="210" y1="0" x2="210" y2="180" stroke="#4ade80" stroke-width="2" stroke-dasharray="4,3"/>
      <text x="214" y="20" fill="#4ade80" font-size="10" font-family="Heebo">נושא (חד)</text>
      <circle cx="210" cy="90" r="5" fill="#4ade80"/>
      <line x1="210" y1="90" x2="410" y2="50" stroke="rgba(136,136,136,.5)" stroke-width="1"/>
      <line x1="210" y1="90" x2="410" y2="90" stroke="rgba(136,136,136,.5)" stroke-width="1"/>
      <line x1="210" y1="90" x2="410" y2="130" stroke="rgba(136,136,136,.5)" stroke-width="1"/>
      <line x1="410" y1="0" x2="410" y2="180" stroke="#888" stroke-width="1.5" stroke-dasharray="4,3"/>
      <text x="414" y="20" fill="#888" font-size="10" font-family="Heebo">רקע (מטושטש)</text>
      <circle cx="410" cy="50" r="16" fill="none" stroke="rgba(200,169,110,.4)" stroke-width="1.5"/>
      <circle cx="410" cy="90" r="16" fill="none" stroke="rgba(200,169,110,.4)" stroke-width="1.5"/>
      <circle cx="410" cy="130" r="16" fill="none" stroke="rgba(200,169,110,.4)" stroke-width="1.5"/>
      <text x="75" y="145" text-anchor="middle" fill="#c8a96e" font-size="9" font-family="Heebo">פתח עדשה = עומק שדה</text>
    </svg>
  </div>
</div>

<div class="section">
  <h2>🎨 ניתוח קומפוזיציה</h2>
  <div class="comp-box">
    ${row.composition_html || ''}
    <div class="tags-row">${tagPills}</div>
  </div>
</div>

<div class="nav-row">
  <a href="/learn/">← כל הניתוחים</a>
  <a href="${buyUrl}">רכוש תמונה זו</a>
  <a href="https://amitphotos.com">לגלריה</a>
</div>
</body>
</html>`;

  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
```

- [ ] **Step 4: Add route in MAIN ROUTER**

```javascript
if (path.startsWith('/learn/') && path.length > '/learn/'.length)  return handleLearnAnalysis(env, decodeURIComponent(path.slice('/learn/'.length)));
```

Add this line BEFORE the `/learn/` index route added in Task 3.

- [ ] **Step 5: Deploy and test**

```bash
npx wrangler deploy
```

1. Run `POST /api/analyses/generate` (from Task 2) to create at least one analysis.
2. Open `https://amitphotos.com/learn/` — should show the card.
3. Click the card — should open the full analysis page.
4. Verify: photo loads, SVG overlay visible, annotation dots appear, camera cards show, composition text renders.

- [ ] **Step 6: Commit**

```bash
git add worker.js
git commit -m "feat: add /learn/:photoId analysis page renderer"
git push
```

---

## Task 5: Nav Link + i18n

**Files:**
- Modify: `index.html`
- Modify: `assets/js/i18n.js`

- [ ] **Step 1: Add i18n keys**

In `assets/js/i18n.js`, find the `he` object and add `nav.learn`:

```javascript
'nav.learn': 'בית ספר לצילום',
```

In the `en` object add:

```javascript
'nav.learn': 'Photo School',
```

- [ ] **Step 2: Add nav link in index.html**

Find the nav list containing `nav.challenges` (added in a previous session, around the `<li>` with `data-i18n="nav.challenges"`). Add a new `<li>` next to it:

```html
<li><a href="/learn/" data-i18n="nav.learn">בית ספר לצילום</a></li>
```

- [ ] **Step 3: Verify**

Open `https://amitphotos.com` and confirm "בית ספר לצילום" appears in the nav. Switch to English — confirm it shows "Photo School". Click it — loads `/learn/`.

- [ ] **Step 4: Commit**

```bash
git add index.html assets/js/i18n.js
git commit -m "feat: add 'בית ספר לצילום' nav link + i18n"
git push
```

---

## Task 6: Admin Section — "בית ספר לצילום"

**Files:**
- Modify: `admin.html`

- [ ] **Step 1: Add nav item**

Find the `<div class="nav-item" data-section="social">` line in `admin.html`. Add after it:

```html
<div class="nav-item" data-section="learn">
  📸
  בית ספר לצילום
</div>
```

- [ ] **Step 2: Add section HTML**

Find the last `</section>` before `</div><!-- /admin-ui -->` and add a new section after it:

```html
<section class="section" id="section-learn">
  <div class="section-header">
    <h1 class="section-title">📸 בית ספר לצילום</h1>
    <div class="section-actions">
      <button class="btn btn-primary" onclick="learnGenerate()">ייצר ניתוח חדש</button>
    </div>
  </div>
  <div id="learn-status" style="padding:.5rem;color:#888;font-size:.82rem"></div>
  <div class="table-wrap" style="margin-top:1rem">
    <table id="learn-table">
      <thead><tr>
        <th>תמונה</th><th>כותרת</th><th>חוק</th><th>תאריך</th><th>עריכה</th>
      </tr></thead>
      <tbody id="learn-tbody"></tbody>
    </table>
  </div>

  <!-- Edit modal -->
  <div id="learn-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:1000;overflow-y:auto;padding:2rem 1rem">
    <div style="background:#111;border:1px solid #333;border-radius:12px;max-width:640px;margin:0 auto;padding:1.5rem">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
        <h2 id="learn-modal-title" style="font-size:1.1rem;color:#c8a96e">עריכת ניתוח</h2>
        <button onclick="document.getElementById('learn-modal').style.display='none'" style="background:none;border:none;color:#888;font-size:1.2rem;cursor:pointer">✕</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:.75rem">
        <label style="font-size:.8rem;color:#888">ניתוח קומפוזיציה (HTML)</label>
        <textarea id="le-comp" rows="6" style="background:#0a0a0a;border:1px solid #333;color:#f0ede8;border-radius:6px;padding:.5rem;font-size:.8rem;font-family:monospace;resize:vertical"></textarea>
        <label style="font-size:.8rem;color:#888">תגיות (מופרדות בפסיק)</label>
        <input id="le-tags" type="text" style="background:#0a0a0a;border:1px solid #333;color:#f0ede8;border-radius:6px;padding:.5rem;font-size:.8rem">
        <label style="font-size:.8rem;color:#888">הסבר צמצם</label>
        <input id="le-ap" type="text" style="background:#0a0a0a;border:1px solid #333;color:#f0ede8;border-radius:6px;padding:.5rem;font-size:.8rem">
        <label style="font-size:.8rem;color:#888">הסבר תריס</label>
        <input id="le-sh" type="text" style="background:#0a0a0a;border:1px solid #333;color:#f0ede8;border-radius:6px;padding:.5rem;font-size:.8rem">
        <label style="font-size:.8rem;color:#888">הסבר ISO</label>
        <input id="le-iso" type="text" style="background:#0a0a0a;border:1px solid #333;color:#f0ede8;border-radius:6px;padding:.5rem;font-size:.8rem">
        <label style="font-size:.8rem;color:#888">הסבר מרחק מוקד</label>
        <input id="le-focal" type="text" style="background:#0a0a0a;border:1px solid #333;color:#f0ede8;border-radius:6px;padding:.5rem;font-size:.8rem">
        <div style="display:flex;gap:.5rem;margin-top:.5rem">
          <button class="btn btn-primary" onclick="learnSave()" style="flex:1">שמור</button>
          <a id="le-preview" href="#" target="_blank" class="btn" style="flex:1;text-align:center;text-decoration:none">תצוגה מקדימה ↗</a>
        </div>
      </div>
    </div>
  </div>
</section>
```

- [ ] **Step 3: Add JavaScript functions**

Find the `<script>` block in `admin.html` and add these functions:

```javascript
let learnCurrentId = null;

async function loadLearn() {
  const r = await apiFetch('/api/analyses');
  if (!r.ok) return;
  const rows = await r.json();
  const tbody = document.getElementById('learn-tbody');
  const ruleLabels = {
    rule_of_thirds:'חוק השליש', symmetry:'סימטריה',
    leading_lines:'קווים מובילים', golden_ratio:'יחס הזהב',
    framing:'מסגור', negative_space:'מרחב שלילי'
  };
  tbody.innerHTML = rows.map(a => `<tr>
    <td><img src="${a.thumbnail||''}" style="width:50px;height:38px;object-fit:cover;border-radius:4px"></td>
    <td>${a.title||''}</td>
    <td>${ruleLabels[a.composition_rule]||a.composition_rule}</td>
    <td>${(a.published_at||'').slice(0,10)}</td>
    <td><button class="btn btn-sm" onclick="learnEdit('${a.photo_id}')">עריכה</button>
        <a href="/learn/${a.photo_id}" target="_blank" class="btn btn-sm">צפה</a></td>
  </tr>`).join('');
}

async function learnEdit(photoId) {
  const r = await apiFetch(`/api/analyses/${photoId}`);
  if (!r.ok) return;
  const d = await r.json();
  learnCurrentId = photoId;
  document.getElementById('learn-modal-title').textContent = d.title || 'עריכת ניתוח';
  document.getElementById('le-comp').value = d.composition_html || '';
  document.getElementById('le-tags').value = (d.tags || []).join(', ');
  document.getElementById('le-ap').value = d.camera?.aperture?.explanation || '';
  document.getElementById('le-sh').value = d.camera?.shutter?.explanation || '';
  document.getElementById('le-iso').value = d.camera?.iso?.explanation || '';
  document.getElementById('le-focal').value = d.camera?.focal?.explanation || '';
  document.getElementById('le-preview').href = `/learn/${photoId}`;
  document.getElementById('learn-modal').style.display = 'block';
}

async function learnSave() {
  if (!learnCurrentId) return;
  const r = await apiFetch(`/api/analyses/${learnCurrentId}`);
  const existing = r.ok ? await r.json() : {};
  const cam = existing.camera || {};
  if (cam.aperture) cam.aperture.explanation = document.getElementById('le-ap').value;
  if (cam.shutter)  cam.shutter.explanation  = document.getElementById('le-sh').value;
  if (cam.iso)      cam.iso.explanation      = document.getElementById('le-iso').value;
  if (cam.focal)    cam.focal.explanation    = document.getElementById('le-focal').value;
  const tags = document.getElementById('le-tags').value.split(',').map(t=>t.trim()).filter(Boolean);
  await apiFetch(`/api/analyses/${learnCurrentId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      composition_html: document.getElementById('le-comp').value,
      tags_json: JSON.stringify(tags),
      camera_json: JSON.stringify(cam),
    })
  });
  document.getElementById('learn-modal').style.display = 'none';
  loadLearn();
}

async function learnGenerate() {
  const status = document.getElementById('learn-status');
  status.textContent = 'מייצר ניתוח... (עד 30 שניות)';
  const r = await apiFetch('/api/analyses/generate', { method: 'POST' });
  if (r.ok) {
    const d = await r.json();
    status.textContent = `✅ נוצר ניתוח: "${d.title}"`;
    loadLearn();
  } else {
    status.textContent = '❌ שגיאה ביצירת הניתוח';
  }
}
```

- [ ] **Step 4: Wire `loadLearn` to section activation**

Find the section-switching logic in `admin.html` (the click handler on `.nav-item`). It likely calls `loadSection(section)` or similar. Add `learn` to the map:

```javascript
// In the section load dispatcher, add:
case 'learn': loadLearn(); break;
```

If the admin uses a generic `fetch`-on-click pattern, find where other sections load data (e.g., `loadPhotos`, `loadAnalytics`) and add `if (section === 'learn') loadLearn();` in the same place.

- [ ] **Step 5: Deploy and test**

```bash
npx wrangler deploy
```

1. Log into admin, click "בית ספר לצילום" in nav.
2. Should see the table with any existing analyses.
3. Click "עריכה" on a row — modal opens with pre-filled fields.
4. Edit a field, click "שמור" — verify change reflected on `/learn/:id`.
5. Click "ייצר ניתוח חדש" — waits ~20s, shows success message, new row appears.

- [ ] **Step 6: Commit**

```bash
git add admin.html
git commit -m "feat: add admin 'בית ספר לצילום' section with edit modal"
git push
```

---

## Task 7: GitHub Actions Workflow

**Files:**
- Create: `.github/workflows/learn-generate.yml`
- Create: `src/learn_social_post.py`

- [ ] **Step 1: Create `src/learn_social_post.py`**

```python
#!/usr/bin/env python3
"""
Calls /api/analyses/generate, then posts to Facebook and Instagram.
"""
import os
import sys
import requests

SITE_URL = 'https://amitphotos.com'
ADMIN_PASSWORD = os.environ['ADMIN_PASSWORD']
FB_PAGE_ID = os.environ.get('FACEBOOK_PAGE_ID', '')
FB_TOKEN = os.environ.get('FACEBOOK_PAGE_TOKEN', '')
IG_USER_ID = os.environ.get('INSTAGRAM_USER_ID', '')
IG_TOKEN = os.environ.get('INSTAGRAM_ACCESS_TOKEN', '')


def generate_analysis():
    print("מייצר ניתוח חדש...")
    r = requests.post(
        f'{SITE_URL}/api/analyses/generate',
        headers={'X-Admin-Password': ADMIN_PASSWORD},
        timeout=90
    )
    r.raise_for_status()
    data = r.json()
    if not data.get('ok'):
        print(f"שגיאה: {data}")
        sys.exit(1)
    print(f"✅ ניתוח נוצר: {data['title']}")
    return data


def strip_html(html):
    import re
    text = re.sub(r'<[^>]+>', '', html or '')
    text = re.sub(r'\s+', ' ', text).strip()
    return text[:200]


def post_facebook(data):
    if not FB_PAGE_ID or not FB_TOKEN:
        print("פייסבוק: אין credentials — מדלג")
        return
    tags = ' '.join(f'#{t.replace(" ","")}' for t in (data.get('tags') or [])[:4])
    teaser = strip_html(data.get('composition_html', ''))
    msg = f"📸 {data['title']}\n\n{teaser}\n\n👉 ניתוח מלא: {data['learn_url']}\n\n#צילום {tags} #amitphotos"
    r = requests.post(
        f'https://graph.facebook.com/v19.0/{FB_PAGE_ID}/photos',
        data={
            'url': data['thumbnail'],
            'caption': msg,
            'access_token': FB_TOKEN,
        },
        timeout=30
    )
    if r.ok:
        print(f"✅ פורסם בפייסבוק: {r.json().get('id')}")
    else:
        print(f"⚠️ פייסבוק: {r.status_code} {r.text[:200]}")


def post_instagram(data):
    if not IG_USER_ID or not IG_TOKEN:
        print("אינסטגרם: אין credentials — מדלג")
        return
    tags = ' '.join(f'#{t.replace(" ","")}' for t in (data.get('tags') or [])[:4])
    teaser = strip_html(data.get('composition_html', ''))
    caption = f"📸 {data['title']}\n\n{teaser}\n\n#צילום {tags} #amitphotos #photography #learnphotography"
    # Step 1: Create container
    r1 = requests.post(
        f'https://graph.facebook.com/v19.0/{IG_USER_ID}/media',
        data={
            'image_url': data['thumbnail'],
            'caption': caption,
            'access_token': IG_TOKEN,
        },
        timeout=30
    )
    if not r1.ok:
        print(f"⚠️ אינסטגרם container: {r1.status_code} {r1.text[:200]}")
        return
    container_id = r1.json().get('id')
    # Step 2: Publish
    r2 = requests.post(
        f'https://graph.facebook.com/v19.0/{IG_USER_ID}/media_publish',
        data={'creation_id': container_id, 'access_token': IG_TOKEN},
        timeout=30
    )
    if r2.ok:
        print(f"✅ פורסם באינסטגרם: {r2.json().get('id')}")
    else:
        print(f"⚠️ אינסטגרם publish: {r2.status_code} {r2.text[:200]}")


if __name__ == '__main__':
    data = generate_analysis()
    post_facebook(data)
    post_instagram(data)
    print("✅ הכל הושלם")
```

- [ ] **Step 2: Create `.github/workflows/learn-generate.yml`**

```yaml
name: בית ספר לצילום — ניתוח אוטומטי

on:
  schedule:
    - cron: '0 10 */2 * *'   # כל יומיים ב-10:00 UTC = 13:00 ישראל
  workflow_dispatch:

jobs:
  generate-and-post:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Python setup
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: התקנת חבילות
        run: pip install requests

      - name: ייצור ניתוח ופרסום
        env:
          ADMIN_PASSWORD:          ${{ secrets.ADMIN_PASSWORD }}
          FACEBOOK_PAGE_ID:        ${{ secrets.FACEBOOK_PAGE_ID }}
          FACEBOOK_PAGE_TOKEN:     ${{ secrets.FACEBOOK_PAGE_TOKEN }}
          INSTAGRAM_USER_ID:       ${{ secrets.INSTAGRAM_USER_ID }}
          INSTAGRAM_ACCESS_TOKEN:  ${{ secrets.INSTAGRAM_ACCESS_TOKEN }}
        run: |
          for attempt in 1 2 3; do
            python src/learn_social_post.py && break
            if [ $attempt -lt 3 ]; then
              echo "ניסיון $attempt נכשל — ממתין 60 שניות..."
              sleep 60
            else
              echo "כל הניסיונות נכשלו"
              exit 1
            fi
          done
```

- [ ] **Step 3: Verify ADMIN_PASSWORD secret exists**

The workflow uses `secrets.ADMIN_PASSWORD`. Verify this secret is set in GitHub → Settings → Secrets. If the secret is named differently (e.g., `AMIT_ADMIN_PASSWORD`), update the workflow accordingly.

Run: `gh secret list` to see existing secrets.

- [ ] **Step 4: Test workflow manually**

```bash
git add .github/workflows/learn-generate.yml src/learn_social_post.py
git commit -m "feat: add learn-generate workflow + social post script"
git push
```

Then in GitHub UI: Actions → "בית ספר לצילום" → Run workflow.

Expected output:
```
✅ ניתוח נוצר: [photo title]
✅ פורסם בפייסבוק: ...
✅ פורסם באינסטגרם: ...
✅ הכל הושלם
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered in |
|-----------------|------------|
| D1 table `photo_analyses` | Task 1 |
| GET/PUT/POST /api/analyses | Task 2 |
| Claude haiku scoring + sonnet full analysis | Task 2, handleAnalysesGenerate |
| /learn/ index page | Task 3 |
| /learn/:photoId analysis page | Task 4 |
| Composition rule overlays (6 rules) | Task 4, buildRuleOverlay |
| Annotation dots with label boxes | Task 4, buildAnnotations |
| Camera cards (4 fields) | Task 4 |
| Bokeh diagram SVG | Task 4 |
| Nav link + i18n | Task 5 |
| Admin list + edit modal | Task 6 |
| Admin "ייצר ניתוח חדש" button | Task 6 |
| GitHub Actions cron every 2 days | Task 7 |
| Facebook posting | Task 7, learn_social_post.py |
| Instagram posting | Task 7, learn_social_post.py |

**No placeholders found.**

**Type consistency:** `annotations_json`, `camera_json`, `tags_json`, `composition_html` are used consistently across Tasks 1-6. `RULE_LABELS` object defined once in Task 3 and used in Tasks 3, 4, 6.
