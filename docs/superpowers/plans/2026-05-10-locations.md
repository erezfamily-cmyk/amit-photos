# Locations — Photography Spots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "מקומות לצילום" section — rich location pages with AI-enriched data, mixed gallery, admin management, and community suggestion forms.

**Architecture:** D1 stores location metadata + junction table for photos; Cloudflare Worker handles all API routes; frontend pages are static HTML that fetch from the API on load. AI enrichment uses the existing `ANTHROPIC_API_KEY` env var via a Claude API call inside the Worker, same pattern as `handleAnalysesGenerate`.

**Tech Stack:** Cloudflare Worker (JS), D1 (SQLite), R2 (image storage), Claude claude-haiku-4-5-20251001 for AI enrichment, Vanilla JS + HTML/CSS (no frameworks), Resend for suggestion emails.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `worker.js` | Modify | Add `handleLocations*` functions + 10 new routes |
| `schema.sql` | Modify | Document new tables as ALTER TABLE comments |
| `locations/index.html` | Create | Hub page — grid of location cards + suggest modal |
| `locations/spot/index.html` | Create | Dynamic spot page — reads slug from URL, fetches API |
| `admin.html` | Modify | Add "מקומות" tab with list + editor + photo management |
| `assets/js/nav.js` | Modify | Add "מקומות" nav link + i18n translations |

> **Note on `locations/spot/`:** A single template page at `/locations/spot/` reads `?slug=nahal-nefatim` from the URL query string. This avoids needing dynamic path routing on static GitHub Pages.

---

## Task 1: D1 Migration — Create Tables

**Files:**
- Modify: `schema.sql`
- Run SQL via Cloudflare Dashboard → D1 → amit-photos-db → Console

- [ ] **Step 1: Add migration comments to schema.sql**

In `schema.sql`, append after the last comment block:

```sql
-- ===== LOCATIONS (added 2026-05-10) =====
-- Run these in D1 Console:
--
-- CREATE TABLE IF NOT EXISTS locations (
--   id           TEXT PRIMARY KEY,
--   title        TEXT NOT NULL,
--   region       TEXT NOT NULL DEFAULT '',
--   description  TEXT NOT NULL DEFAULT '',
--   best_time    TEXT NOT NULL DEFAULT '',
--   equipment    TEXT NOT NULL DEFAULT '',
--   my_tip       TEXT NOT NULL DEFAULT '',
--   coordinates  TEXT NOT NULL DEFAULT '',
--   related_guides TEXT NOT NULL DEFAULT '[]',
--   published    INTEGER NOT NULL DEFAULT 0,
--   created_at   TEXT NOT NULL
-- );
--
-- CREATE TABLE IF NOT EXISTS location_photos (
--   id           TEXT PRIMARY KEY,
--   location_id  TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
--   type         TEXT NOT NULL DEFAULT 'gallery',
--   photo_id     TEXT,
--   r2_key       TEXT,
--   url          TEXT NOT NULL DEFAULT '',
--   thumbnail    TEXT NOT NULL DEFAULT '',
--   sort_order   INTEGER NOT NULL DEFAULT 0,
--   for_sale     INTEGER NOT NULL DEFAULT 0
-- );
```

- [ ] **Step 2: Run in D1 Console**

Open Cloudflare Dashboard → D1 → amit-photos-db → Console and run:

```sql
CREATE TABLE IF NOT EXISTS locations (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  region       TEXT NOT NULL DEFAULT '',
  description  TEXT NOT NULL DEFAULT '',
  best_time    TEXT NOT NULL DEFAULT '',
  equipment    TEXT NOT NULL DEFAULT '',
  my_tip       TEXT NOT NULL DEFAULT '',
  coordinates  TEXT NOT NULL DEFAULT '',
  related_guides TEXT NOT NULL DEFAULT '[]',
  published    INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS location_photos (
  id           TEXT PRIMARY KEY,
  location_id  TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  type         TEXT NOT NULL DEFAULT 'gallery',
  photo_id     TEXT,
  r2_key       TEXT,
  url          TEXT NOT NULL DEFAULT '',
  thumbnail    TEXT NOT NULL DEFAULT '',
  sort_order   INTEGER NOT NULL DEFAULT 0,
  for_sale     INTEGER NOT NULL DEFAULT 0
);
```

Expected: "Query executed successfully."

- [ ] **Step 3: Verify tables exist**

Run in D1 Console:
```sql
SELECT name FROM sqlite_master WHERE type='table' AND name IN ('locations','location_photos');
```
Expected: 2 rows returned.

- [ ] **Step 4: Commit schema.sql**

```bash
git add schema.sql
git commit -m "docs: add locations + location_photos schema comments"
```

---

## Task 2: Worker — Helper Function `slugify`

**Files:**
- Modify: `worker.js` — add `slugify` helper near top (after `unauth` function, ~line 28)

- [ ] **Step 1: Add `slugify` function to worker.js**

Insert after the `unauth` function (~line 28):

```js
function slugify(text) {
  const map = {
    'א':'a','ב':'b','ג':'g','ד':'d','ה':'h','ו':'v','ז':'z','ח':'ch','ט':'t',
    'י':'y','כ':'k','ך':'k','ל':'l','מ':'m','ם':'m','נ':'n','ן':'n','ס':'s',
    'ע':'a','פ':'p','ף':'p','צ':'tz','ץ':'tz','ק':'k','ר':'r','ש':'sh','ת':'t'
  };
  return text
    .split('').map(c => map[c] || c).join('')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
```

- [ ] **Step 2: Commit**

```bash
git add worker.js
git commit -m "feat: add slugify helper to worker"
```

---

## Task 3: Worker — Public Locations API

**Files:**
- Modify: `worker.js` — add `handleLocationsList`, `handleLocationsGet`, `handleLocationsSuggest` functions

- [ ] **Step 1: Add `handleLocationsList` after `slugify`**

```js
async function handleLocationsList(request, env) {
  const { results } = await env.DB.prepare(`
    SELECT l.id, l.title, l.region, l.best_time, l.coordinates,
           lp.url AS cover_url, lp.thumbnail AS cover_thumb
    FROM locations l
    LEFT JOIN location_photos lp ON lp.location_id = l.id AND lp.sort_order = (
      SELECT MIN(sort_order) FROM location_photos WHERE location_id = l.id
    )
    WHERE l.published = 1
    ORDER BY l.created_at DESC
  `).all();
  return jsonRes(results || [], 200, request);
}
```

- [ ] **Step 2: Add `handleLocationsGet`**

```js
async function handleLocationsGet(request, env, slug) {
  const loc = await env.DB.prepare(
    'SELECT * FROM locations WHERE id = ? AND published = 1'
  ).bind(slug).first();
  if (!loc) return jsonRes({ error: 'לא נמצא' }, 404, request);

  const { results: photos } = await env.DB.prepare(
    'SELECT * FROM location_photos WHERE location_id = ? ORDER BY sort_order ASC'
  ).bind(slug).all();

  return jsonRes({ ...loc, related_guides: JSON.parse(loc.related_guides || '[]'), photos: photos || [] }, 200, request);
}
```

- [ ] **Step 3: Add `handleLocationsSuggest`**

```js
async function handleLocationsSuggest(request, env) {
  if (request.method !== 'POST') return jsonRes({ error: 'POST only' }, 405, request);
  if (!env.RESEND_API_KEY) return jsonRes({ error: 'RESEND_API_KEY חסר' }, 500, request);

  const { type, location_slug, sender_name, message } = await request.json().catch(() => ({}));
  if (!message || !message.trim()) return jsonRes({ error: 'הודעה ריקה' }, 400, request);

  const isNew = type === 'new';
  const subject = isNew
    ? `הצעת מקום חדש${sender_name ? ` מ-${sender_name}` : ''}`
    : `תיקון למקום: ${location_slug}${sender_name ? ` מ-${sender_name}` : ''}`;

  const html = `<div dir="rtl" style="font-family:Arial,sans-serif;max-width:520px;margin:auto">
    <h2 style="color:#c8a96e">${subject}</h2>
    ${sender_name ? `<p><strong>שם:</strong> ${sender_name}</p>` : ''}
    ${!isNew ? `<p><strong>מקום:</strong> ${location_slug}</p>` : ''}
    <p><strong>הודעה:</strong></p>
    <p style="background:#111;padding:1rem;border-radius:4px;white-space:pre-wrap">${message}</p>
  </div>`;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'Amit Photos <onboarding@resend.dev>', to: ['erez.family@gmail.com'], subject, html })
  });

  return jsonRes({ ok: true }, 200, request);
}
```

- [ ] **Step 4: Register routes in the main fetch handler**

In `worker.js`, in the route block (around line 3025), add before the final 404 handler:

```js
if (path === '/api/locations' && request.method === 'GET')         return handleLocationsList(request, env);
if (path === '/api/locations/suggest' && request.method === 'POST') return handleLocationsSuggest(request, env);
if (path.startsWith('/api/locations/') && request.method === 'GET') return handleLocationsGet(request, env, path.slice('/api/locations/'.length));
```

- [ ] **Step 5: Deploy and test**

```bash
npx wrangler deploy
```

Test with curl (replace URL with your worker URL):
```bash
curl https://amitphotos.com/api/locations
```
Expected: `[]` (empty array, no locations yet)

- [ ] **Step 6: Commit**

```bash
git add worker.js
git commit -m "feat: add public locations API (list, get, suggest)"
```

---

## Task 4: Worker — Admin Locations CRUD + AI Enrich

**Files:**
- Modify: `worker.js` — add `handleAdminLocationsList`, `handleAdminLocationsCreate`, `handleAdminLocationsUpdate`, `handleAdminLocationsDelete`, `handleAdminLocationsEnrich`

- [ ] **Step 1: Add `handleAdminLocationsList`**

```js
async function handleAdminLocationsList(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  const { results } = await env.DB.prepare(`
    SELECT l.id, l.title, l.region, l.published,
           COUNT(lp.id) AS photo_count
    FROM locations l
    LEFT JOIN location_photos lp ON lp.location_id = l.id
    GROUP BY l.id
    ORDER BY l.created_at DESC
  `).all();
  return jsonRes(results || [], 200, request);
}
```

- [ ] **Step 2: Add `handleAdminLocationsCreate` with AI enrich**

```js
async function handleAdminLocationsCreate(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== 'POST') return jsonRes({ error: 'POST only' }, 405, request);

  const { title, region } = await request.json().catch(() => ({}));
  if (!title || !title.trim()) return jsonRes({ error: 'כותרת חסרה' }, 400, request);

  const id = slugify(title);
  const now = new Date().toISOString();

  // Check slug uniqueness
  const existing = await env.DB.prepare('SELECT id FROM locations WHERE id = ?').bind(id).first();
  if (existing) return jsonRes({ error: `slug "${id}" כבר קיים` }, 409, request);

  await env.DB.prepare(
    'INSERT INTO locations (id, title, region, published, created_at) VALUES (?,?,?,0,?)'
  ).bind(id, title.trim(), region || '', now).run();

  // AI Enrich
  const enriched = await enrichLocationWithAI(title, env);
  if (enriched) {
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
  }

  const loc = await env.DB.prepare('SELECT * FROM locations WHERE id = ?').bind(id).first();
  return jsonRes({ ...loc, related_guides: JSON.parse(loc.related_guides || '[]') }, 201, request);
}
```

- [ ] **Step 3: Add `enrichLocationWithAI` helper**

```js
async function enrichLocationWithAI(locationName, env) {
  if (!env.ANTHROPIC_API_KEY) return null;

  const GUIDE_PATHS = [
    '/camera/filters/', '/camera/composition/', '/camera/exposure/',
    '/camera/depth-of-field/', '/camera/white-balance/', '/camera/histogram/',
    '/camera/light/', '/camera/dynamic-range/', '/camera/controls/',
    '/camera/lenses/', '/camera/types/'
  ];

  const prompt = `You are helping a professional Israeli photographer catalog shooting locations.
For the location "${locationName}", return a JSON object with these fields:
- description: 2-3 sentences in Hebrew about the location and its photographic qualities
- best_time: best time(s) to photograph there (Hebrew, e.g. "זריחה — שעת הזהב")
- equipment: recommended camera equipment (Hebrew, e.g. "חצובה, עדשה 14-24mm, פילטר ND")
- my_tip: one personal photography tip in Hebrew, first person (e.g. "אני ממליץ להגיע...")
- coordinates: "lat,lng" GPS string for this location in Israel (e.g. "31.7683,35.2137")
- related_guides: array of 1-3 paths from this list that are most relevant: ${JSON.stringify(GUIDE_PATHS)}

Return ONLY valid JSON, no markdown fences, no extra text.`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 800,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await res.json();
    const text = data?.content?.[0]?.text || '';
    return JSON.parse(text);
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Add `handleAdminLocationsUpdate`**

```js
async function handleAdminLocationsUpdate(request, env, slug) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== 'PUT') return jsonRes({ error: 'PUT only' }, 405, request);

  const body = await request.json().catch(() => ({}));
  const fields = ['title','region','description','best_time','equipment','my_tip','coordinates','published'];
  const sets = [];
  const vals = [];

  for (const f of fields) {
    if (body[f] !== undefined) {
      sets.push(`${f} = ?`);
      vals.push(f === 'published' ? (body[f] ? 1 : 0) : body[f]);
    }
  }
  if (body.related_guides !== undefined) {
    sets.push('related_guides = ?');
    vals.push(JSON.stringify(body.related_guides));
  }

  if (sets.length === 0) return jsonRes({ error: 'אין שדות לעדכון' }, 400, request);
  vals.push(slug);

  await env.DB.prepare(`UPDATE locations SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  const loc = await env.DB.prepare('SELECT * FROM locations WHERE id = ?').bind(slug).first();
  if (!loc) return jsonRes({ error: 'לא נמצא' }, 404, request);
  return jsonRes({ ...loc, related_guides: JSON.parse(loc.related_guides || '[]') }, 200, request);
}
```

- [ ] **Step 5: Add `handleAdminLocationsDelete`**

```js
async function handleAdminLocationsDelete(request, env, slug) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== 'DELETE') return jsonRes({ error: 'DELETE only' }, 405, request);

  // Delete exclusive R2 images first
  const { results: exclusivePhotos } = await env.DB.prepare(
    "SELECT r2_key FROM location_photos WHERE location_id = ? AND type = 'exclusive' AND r2_key IS NOT NULL"
  ).bind(slug).all();
  for (const p of exclusivePhotos || []) {
    await env.PHOTOS.delete(p.r2_key).catch(() => {});
  }

  await env.DB.prepare('DELETE FROM locations WHERE id = ?').bind(slug).run();
  return jsonRes({ ok: true }, 200, request);
}
```

- [ ] **Step 6: Add `handleAdminLocationsEnrich`**

```js
async function handleAdminLocationsEnrich(request, env, slug) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== 'POST') return jsonRes({ error: 'POST only' }, 405, request);

  const loc = await env.DB.prepare('SELECT title FROM locations WHERE id = ?').bind(slug).first();
  if (!loc) return jsonRes({ error: 'לא נמצא' }, 404, request);

  const enriched = await enrichLocationWithAI(loc.title, env);
  if (!enriched) return jsonRes({ error: 'AI enrich נכשל' }, 500, request);

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

  const updated = await env.DB.prepare('SELECT * FROM locations WHERE id = ?').bind(slug).first();
  return jsonRes({ ...updated, related_guides: JSON.parse(updated.related_guides || '[]') }, 200, request);
}
```

- [ ] **Step 7: Register admin routes in main fetch handler**

Add after the public location routes:

```js
if (path === '/api/admin/locations' && request.method === 'GET')    return handleAdminLocationsList(request, env);
if (path === '/api/admin/locations' && request.method === 'POST')   return handleAdminLocationsCreate(request, env);
if (path.startsWith('/api/admin/locations/') && request.method === 'PUT') {
  const slug = path.slice('/api/admin/locations/'.length).split('/')[0];
  const rest = path.slice('/api/admin/locations/'.length + slug.length);
  if (rest === '/enrich') return handleAdminLocationsEnrich(request, env, slug);
  return handleAdminLocationsUpdate(request, env, slug);
}
if (path.startsWith('/api/admin/locations/') && request.method === 'DELETE')
  return handleAdminLocationsDelete(request, env, path.slice('/api/admin/locations/'.length));
```

- [ ] **Step 8: Deploy and smoke-test**

```bash
npx wrangler deploy
```

Create a test location via curl (replace `YOUR_SESSION_TOKEN`):
```bash
curl -X POST https://amitphotos.com/api/admin/locations \
  -H "Content-Type: application/json" \
  -H "X-Session-Token: YOUR_SESSION_TOKEN" \
  -d '{"title":"נחל נטפים","region":"הרי אילת"}'
```
Expected: 201 JSON with `id: "nahal-nefatim"` and AI-enriched fields.

- [ ] **Step 9: Commit**

```bash
git add worker.js
git commit -m "feat: add admin locations CRUD + AI enrich"
```

---

## Task 5: Worker — Location Photos Management

**Files:**
- Modify: `worker.js` — add `handleAdminLocationPhotosAdd`, `handleAdminLocationPhotosDelete`, `handleAdminLocationPhotosReorder`

- [ ] **Step 1: Add `handleAdminLocationPhotosAdd`**

```js
async function handleAdminLocationPhotosAdd(request, env, slug) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== 'POST') return jsonRes({ error: 'POST only' }, 405, request);

  const loc = await env.DB.prepare('SELECT id FROM locations WHERE id = ?').bind(slug).first();
  if (!loc) return jsonRes({ error: 'מקום לא נמצא' }, 404, request);

  const contentType = request.headers.get('content-type') || '';

  if (contentType.includes('multipart/form-data')) {
    // Exclusive photo upload
    const formData = await request.formData();
    const file = formData.get('file');
    const forSale = formData.get('for_sale') === '1' ? 1 : 0;
    if (!file) return jsonRes({ error: 'קובץ חסר' }, 400, request);

    const ext = file.name.split('.').pop().toLowerCase() || 'jpg';
    const uuid = crypto.randomUUID();
    const r2Key = `locations/${slug}/${uuid}.${ext}`;
    const buf = await file.arrayBuffer();
    await env.PHOTOS.put(r2Key, buf, { httpMetadata: { contentType: file.type || 'image/jpeg' } });

    const url = `https://photos.amitphotos.com/${r2Key}`;
    const { results: maxSort } = await env.DB.prepare(
      'SELECT MAX(sort_order) AS m FROM location_photos WHERE location_id = ?'
    ).bind(slug).all();
    const nextSort = (maxSort?.[0]?.m ?? -1) + 1;

    const id = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO location_photos (id, location_id, type, r2_key, url, thumbnail, sort_order, for_sale) VALUES (?,?,?,?,?,?,?,?)'
    ).bind(id, slug, 'exclusive', r2Key, url, url, nextSort, forSale).run();

    return jsonRes({ id, type: 'exclusive', url, thumbnail: url, sort_order: nextSort, for_sale: forSale }, 201, request);

  } else {
    // Gallery photo link
    const { photo_id, for_sale } = await request.json().catch(() => ({}));
    if (!photo_id) return jsonRes({ error: 'photo_id חסר' }, 400, request);

    const photo = await env.DB.prepare('SELECT url, thumbnail FROM photos WHERE id = ?').bind(photo_id).first();
    if (!photo) return jsonRes({ error: 'תמונה לא נמצאה' }, 404, request);

    const { results: maxSort } = await env.DB.prepare(
      'SELECT MAX(sort_order) AS m FROM location_photos WHERE location_id = ?'
    ).bind(slug).all();
    const nextSort = (maxSort?.[0]?.m ?? -1) + 1;

    const id = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO location_photos (id, location_id, type, photo_id, url, thumbnail, sort_order, for_sale) VALUES (?,?,?,?,?,?,?,?)'
    ).bind(id, slug, 'gallery', photo_id, photo.url, photo.thumbnail, nextSort, for_sale ? 1 : 0).run();

    return jsonRes({ id, type: 'gallery', photo_id, url: photo.url, thumbnail: photo.thumbnail, sort_order: nextSort, for_sale: for_sale ? 1 : 0 }, 201, request);
  }
}
```

- [ ] **Step 2: Add `handleAdminLocationPhotosDelete`**

```js
async function handleAdminLocationPhotosDelete(request, env, slug, photoEntryId) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== 'DELETE') return jsonRes({ error: 'DELETE only' }, 405, request);

  const entry = await env.DB.prepare(
    "SELECT type, r2_key FROM location_photos WHERE id = ? AND location_id = ?"
  ).bind(photoEntryId, slug).first();
  if (!entry) return jsonRes({ error: 'לא נמצא' }, 404, request);

  if (entry.type === 'exclusive' && entry.r2_key) {
    await env.PHOTOS.delete(entry.r2_key).catch(() => {});
  }

  await env.DB.prepare('DELETE FROM location_photos WHERE id = ?').bind(photoEntryId).run();
  return jsonRes({ ok: true }, 200, request);
}
```

- [ ] **Step 3: Add `handleAdminLocationPhotosReorder`**

```js
async function handleAdminLocationPhotosReorder(request, env, slug) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== 'POST') return jsonRes({ error: 'POST only' }, 405, request);

  const { order } = await request.json().catch(() => ({}));
  if (!Array.isArray(order)) return jsonRes({ error: 'order חסר' }, 400, request);

  for (let i = 0; i < order.length; i++) {
    await env.DB.prepare(
      'UPDATE location_photos SET sort_order = ? WHERE id = ? AND location_id = ?'
    ).bind(i, order[i], slug).run();
  }
  return jsonRes({ ok: true }, 200, request);
}
```

- [ ] **Step 4: Register photo routes in main fetch handler**

Add after the admin locations routes:

```js
if (path.startsWith('/api/admin/locations/') && request.method === 'POST') {
  const afterPrefix = path.slice('/api/admin/locations/'.length);
  const parts = afterPrefix.split('/');
  const locSlug = parts[0];
  if (parts[1] === 'photos') {
    if (parts[2] === 'reorder') return handleAdminLocationPhotosReorder(request, env, locSlug);
    return handleAdminLocationPhotosAdd(request, env, locSlug);
  }
}
if (path.startsWith('/api/admin/locations/') && request.method === 'DELETE') {
  const afterPrefix = path.slice('/api/admin/locations/'.length);
  const parts = afterPrefix.split('/');
  if (parts[1] === 'photos' && parts[2]) {
    return handleAdminLocationPhotosDelete(request, env, parts[0], parts[2]);
  }
  return handleAdminLocationsDelete(request, env, parts[0]);
}
```

> **Note:** Replace the DELETE route registered in Task 4 Step 7 with this more specific version.

- [ ] **Step 5: Deploy**

```bash
npx wrangler deploy
```

- [ ] **Step 6: Commit**

```bash
git add worker.js
git commit -m "feat: add location photos CRUD (gallery link + exclusive upload)"
```

---

## Task 6: Frontend — Hub Page `/locations/index.html`

**Files:**
- Create: `locations/index.html`

- [ ] **Step 1: Create `locations/index.html`**

```html
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>מקומות לצילום — Amit Photos</title>
<meta name="description" content="מקומות מומלצים לצילום בישראל — טיפים, ציוד, שעות מומלצות וגלריה מכל מקום.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;600;700&family=Syne:wght@700&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0a0a0a;--surface:#111;--border:#222;--accent:#c8a96e;--text:#f0ede8;--muted:#888;}
body{font-family:'Heebo',sans-serif;background:var(--bg);color:var(--text);direction:rtl;min-height:100vh;padding:0 0 4rem}
.page-hero{text-align:center;padding:2.5rem 1.25rem 1.5rem}
.badge{display:inline-block;font-size:.72rem;background:rgba(200,169,110,.12);border:1px solid rgba(200,169,110,.3);color:var(--accent);border-radius:20px;padding:.3rem .8rem;margin-bottom:.75rem}
.page-hero h1{font-family:'Syne',sans-serif;font-size:2rem;color:var(--accent);margin-bottom:.5rem}
.page-hero p{color:var(--muted);font-size:.9rem;max-width:420px;margin:0 auto 1.25rem}
.btn-suggest{background:var(--accent);color:#0a0a0a;border:none;padding:.65rem 1.5rem;border-radius:4px;font-weight:700;font-size:.9rem;cursor:pointer;transition:background .2s}
.btn-suggest:hover{background:#e0c080}
.filters{display:flex;flex-wrap:wrap;gap:.5rem;justify-content:center;padding:.75rem 1.25rem 1.25rem}
.filter-btn{background:transparent;border:1px solid var(--border);color:var(--muted);padding:.4rem .9rem;border-radius:20px;font-size:.8rem;cursor:pointer;transition:all .2s;font-family:'Heebo',sans-serif}
.filter-btn.active,.filter-btn:hover{border-color:var(--accent);color:var(--accent)}
.grid{display:grid;grid-template-columns:1fr;gap:1.25rem;padding:0 1.25rem;max-width:1100px;margin:0 auto}
@media(min-width:520px){.grid{grid-template-columns:1fr 1fr}}
@media(min-width:900px){.grid{grid-template-columns:repeat(3,1fr)}}
.card{background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden;text-decoration:none;color:inherit;transition:border-color .2s,transform .15s;display:block}
.card:hover{border-color:var(--accent);transform:translateY(-2px)}
.card-img{width:100%;aspect-ratio:3/2;object-fit:cover;background:#1a1a1a;display:block}
.card-body{padding:1rem}
.card-title{font-family:'Syne',sans-serif;font-size:1rem;margin-bottom:.3rem}
.card-meta{font-size:.8rem;color:var(--muted)}
.empty{text-align:center;color:var(--muted);padding:3rem 1.25rem;font-size:.9rem}

/* Modal */
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:2000;display:none;align-items:center;justify-content:center;padding:1.25rem}
.modal-overlay.open{display:flex}
.modal{background:#111;border:1px solid #333;border-radius:12px;padding:2rem;width:100%;max-width:460px}
.modal h2{font-family:'Syne',sans-serif;color:var(--accent);margin-bottom:1.25rem}
.modal label{display:block;font-size:.85rem;color:var(--muted);margin-bottom:.3rem}
.modal input,.modal textarea,.modal select{width:100%;background:#0a0a0a;border:1px solid var(--border);color:var(--text);padding:.65rem .9rem;border-radius:4px;font-size:.9rem;font-family:'Heebo',sans-serif;direction:rtl;margin-bottom:1rem;outline:none}
.modal input:focus,.modal textarea:focus{border-color:var(--accent)}
.modal textarea{min-height:100px;resize:vertical}
.modal-actions{display:flex;gap:.75rem;justify-content:flex-end;margin-top:.5rem}
.btn-cancel{background:transparent;border:1px solid var(--border);color:var(--muted);padding:.6rem 1.25rem;border-radius:4px;font-size:.85rem;cursor:pointer}
.btn-submit{background:var(--accent);color:#0a0a0a;border:none;padding:.6rem 1.5rem;border-radius:4px;font-weight:700;font-size:.85rem;cursor:pointer}
</style>
</head>
<body>
<script src="/assets/js/nav.js"></script>

<div class="page-hero">
  <div class="badge">📍 מקומות לצילום</div>
  <h1>מקומות שווים בישראל</h1>
  <p>מדריך צילום לוקיישנים — טיפים, ציוד, שעות מומלצות וגלריה מכל מקום.</p>
  <button class="btn-suggest" id="btn-open-suggest">הצע מקום חדש</button>
</div>

<div class="filters" id="filters">
  <button class="filter-btn active" data-region="">הכל</button>
  <button class="filter-btn" data-region="צפון">צפון</button>
  <button class="filter-btn" data-region="מרכז">מרכז</button>
  <button class="filter-btn" data-region="ירושלים">ירושלים</button>
  <button class="filter-btn" data-region="דרום">דרום</button>
  <button class="filter-btn" data-region="נגב">נגב</button>
  <button class="filter-btn" data-region="הרי אילת">הרי אילת</button>
</div>

<div class="grid" id="grid"></div>

<!-- Suggest Modal -->
<div class="modal-overlay" id="suggest-modal">
  <div class="modal">
    <h2>הצע מקום לצילום</h2>
    <label>שמך (אופציונלי)</label>
    <input type="text" id="suggest-name" placeholder="שם">
    <label>שם המקום</label>
    <input type="text" id="suggest-location" placeholder="למשל: נחל נטפים">
    <label>אזור</label>
    <select id="suggest-region">
      <option value="">בחר אזור</option>
      <option>צפון</option><option>מרכז</option><option>ירושלים</option>
      <option>דרום</option><option>נגב</option><option>הרי אילת</option>
    </select>
    <label>תיאור / טיפ</label>
    <textarea id="suggest-message" placeholder="ספר על המקום..."></textarea>
    <div class="modal-actions">
      <button class="btn-cancel" id="btn-cancel-suggest">ביטול</button>
      <button class="btn-submit" id="btn-send-suggest">שלח</button>
    </div>
  </div>
</div>

<script>
let allLocations = [];
let activeRegion = '';

async function loadLocations() {
  const grid = document.getElementById('grid');
  try {
    const res = await fetch('/api/locations');
    allLocations = await res.json();
    renderGrid();
  } catch {
    grid.innerHTML = '<p class="empty">שגיאה בטעינת המקומות.</p>';
  }
}

function renderGrid() {
  const grid = document.getElementById('grid');
  const filtered = activeRegion
    ? allLocations.filter(l => l.region === activeRegion)
    : allLocations;

  if (!filtered.length) {
    grid.innerHTML = '<p class="empty">אין מקומות עדיין.</p>';
    return;
  }

  grid.innerHTML = filtered.map(l => `
    <a class="card" href="/locations/spot/?slug=${l.id}">
      <img class="card-img" src="${l.cover_thumb || l.cover_url || ''}" alt="${l.title}" loading="lazy" onerror="this.style.display='none'">
      <div class="card-body">
        <div class="card-title">${l.title}</div>
        <div class="card-meta">${l.region || ''}${l.best_time ? ' · ' + l.best_time : ''}</div>
      </div>
    </a>
  `).join('');
}

document.getElementById('filters').addEventListener('click', e => {
  const btn = e.target.closest('.filter-btn');
  if (!btn) return;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  activeRegion = btn.dataset.region;
  renderGrid();
});

// Suggest modal
document.getElementById('btn-open-suggest').addEventListener('click', () => {
  document.getElementById('suggest-modal').classList.add('open');
});
document.getElementById('btn-cancel-suggest').addEventListener('click', () => {
  document.getElementById('suggest-modal').classList.remove('open');
});
document.getElementById('btn-send-suggest').addEventListener('click', async () => {
  const name = document.getElementById('suggest-name').value.trim();
  const location = document.getElementById('suggest-location').value.trim();
  const region = document.getElementById('suggest-region').value;
  const message = document.getElementById('suggest-message').value.trim();

  if (!location || !message) { alert('נא למלא שם מקום ותיאור.'); return; }

  const btn = document.getElementById('btn-send-suggest');
  btn.disabled = true; btn.textContent = 'שולח...';

  await fetch('/api/locations/suggest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'new', sender_name: name, message: `${location}${region ? ' (' + region + ')' : ''}\n\n${message}` })
  });

  btn.textContent = 'נשלח!';
  setTimeout(() => { document.getElementById('suggest-modal').classList.remove('open'); btn.disabled = false; btn.textContent = 'שלח'; }, 1500);
});

loadLocations();
</script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add locations/index.html
git commit -m "feat: add locations hub page"
```

---

## Task 7: Frontend — Spot Page `/locations/spot/index.html`

**Files:**
- Create: `locations/spot/index.html`

- [ ] **Step 1: Create `locations/spot/index.html`**

```html
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>מקום צילום — Amit Photos</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;600;700&family=Syne:wght@700&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0a0a0a;--surface:#111;--border:#222;--accent:#c8a96e;--text:#f0ede8;--muted:#888;}
body{font-family:'Heebo',sans-serif;background:var(--bg);color:var(--text);direction:rtl;min-height:100vh;padding:0 0 4rem}
.spot-hero{padding:2.5rem 1.25rem 1.5rem;max-width:800px;margin:0 auto}
.back-link{font-size:.85rem;color:var(--muted);text-decoration:none;display:inline-flex;align-items:center;gap:.4rem;margin-bottom:1.5rem;transition:color .2s}
.back-link:hover{color:var(--accent)}
.badge{display:inline-block;font-size:.72rem;background:rgba(200,169,110,.12);border:1px solid rgba(200,169,110,.3);color:var(--accent);border-radius:20px;padding:.3rem .8rem;margin-bottom:.75rem}
h1{font-family:'Syne',sans-serif;font-size:2rem;color:var(--accent);margin-bottom:.5rem}
.region-time{color:var(--muted);font-size:.9rem;margin-bottom:1.5rem}

.map-wrap{margin:0 auto 2rem;max-width:800px;padding:0 1.25rem}
.map-wrap iframe{width:100%;height:300px;border:0;border-radius:8px}

.section{max-width:800px;margin:0 auto 2rem;padding:0 1.25rem}
.section h2{font-family:'Syne',sans-serif;font-size:1.1rem;color:var(--accent);margin-bottom:.75rem}
.tip-box{background:#141414;border:1px solid rgba(200,169,110,.2);border-radius:8px;padding:1.25rem;font-size:.9rem;line-height:1.7;color:var(--text)}
.specs-list{list-style:none;display:flex;flex-direction:column;gap:.5rem}
.specs-list li{font-size:.9rem;color:var(--muted)}
.specs-list li strong{color:var(--text)}

.guides-row{display:flex;flex-wrap:wrap;gap:.5rem}
.guide-chip{background:#141414;border:1px solid var(--border);border-radius:20px;padding:.35rem .9rem;font-size:.8rem;color:var(--muted);text-decoration:none;transition:all .2s}
.guide-chip:hover{border-color:var(--accent);color:var(--accent)}

.gallery-grid{display:grid;grid-template-columns:1fr 1fr;gap:.75rem}
@media(min-width:600px){.gallery-grid{grid-template-columns:repeat(3,1fr)}}
.gallery-item{position:relative;aspect-ratio:3/2;overflow:hidden;border-radius:6px;cursor:pointer}
.gallery-item img{width:100%;height:100%;object-fit:cover;transition:transform .3s}
.gallery-item:hover img{transform:scale(1.04)}
.for-sale-btn{position:absolute;bottom:.5rem;left:.5rem;background:var(--accent);color:#0a0a0a;border:none;border-radius:4px;padding:.3rem .7rem;font-size:.75rem;font-weight:700;cursor:pointer;text-decoration:none}

/* Lightbox */
.lb{position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:3000;display:none;align-items:center;justify-content:center}
.lb.open{display:flex}
.lb img{max-width:90vw;max-height:88vh;border-radius:4px;object-fit:contain}
.lb-close{position:absolute;top:1rem;left:1rem;background:none;border:none;color:#fff;font-size:1.5rem;cursor:pointer;padding:.5rem}

.suggest-link{text-align:center;padding:1.5rem;color:var(--muted);font-size:.85rem}
.suggest-link button{background:none;border:none;color:var(--accent);cursor:pointer;font-size:.85rem;text-decoration:underline;font-family:'Heebo',sans-serif}

/* Correction modal */
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:2000;display:none;align-items:center;justify-content:center;padding:1.25rem}
.modal-overlay.open{display:flex}
.modal{background:#111;border:1px solid #333;border-radius:12px;padding:2rem;width:100%;max-width:460px}
.modal h2{font-family:'Syne',sans-serif;color:var(--accent);margin-bottom:1.25rem}
.modal label{display:block;font-size:.85rem;color:var(--muted);margin-bottom:.3rem}
.modal input,.modal textarea{width:100%;background:#0a0a0a;border:1px solid var(--border);color:var(--text);padding:.65rem .9rem;border-radius:4px;font-size:.9rem;font-family:'Heebo',sans-serif;direction:rtl;margin-bottom:1rem;outline:none}
.modal input:focus,.modal textarea:focus{border-color:var(--accent)}
.modal textarea{min-height:100px;resize:vertical}
.modal-actions{display:flex;gap:.75rem;justify-content:flex-end}
.btn-cancel{background:transparent;border:1px solid var(--border);color:var(--muted);padding:.6rem 1.25rem;border-radius:4px;font-size:.85rem;cursor:pointer}
.btn-submit{background:var(--accent);color:#0a0a0a;border:none;padding:.6rem 1.5rem;border-radius:4px;font-weight:700;font-size:.85rem;cursor:pointer}
</style>
</head>
<body>
<script src="/assets/js/nav.js"></script>

<div class="spot-hero" id="spot-hero">
  <a class="back-link" href="/locations/">← חזרה למקומות</a>
  <div id="hero-content"><p style="color:var(--muted)">טוען...</p></div>
</div>

<div id="map-section"></div>
<div id="details-section"></div>
<div id="gallery-section"></div>

<div class="suggest-link">
  <button id="btn-open-correction">יש לך טיפ או תיקון? שלח לי</button>
</div>

<!-- Lightbox -->
<div class="lb" id="lb">
  <button class="lb-close" id="lb-close">✕</button>
  <img id="lb-img" src="" alt="">
</div>

<!-- Correction modal -->
<div class="modal-overlay" id="correction-modal">
  <div class="modal">
    <h2>שלח תיקון / טיפ</h2>
    <label>שמך (אופציונלי)</label>
    <input type="text" id="corr-name" placeholder="שם">
    <label>הטיפ / התיקון שלך</label>
    <textarea id="corr-message" placeholder="מה תרצה לשתף?"></textarea>
    <div class="modal-actions">
      <button class="btn-cancel" id="btn-cancel-corr">ביטול</button>
      <button class="btn-submit" id="btn-send-corr">שלח</button>
    </div>
  </div>
</div>

<script>
const GUIDE_LABELS = {
  '/camera/filters/': 'פילטרים',
  '/camera/composition/': 'קומפוזיציה',
  '/camera/exposure/': 'חשיפה',
  '/camera/depth-of-field/': 'עומק שדה',
  '/camera/white-balance/': 'איזון לבן',
  '/camera/histogram/': 'היסטוגרם',
  '/camera/light/': 'אור',
  '/camera/dynamic-range/': 'דינמיק ריינג',
  '/camera/controls/': 'בקרות מצלמה',
  '/camera/lenses/': 'עדשות',
  '/camera/types/': 'סוגי מצלמות'
};

const params = new URLSearchParams(location.search);
const slug = params.get('slug');

if (!slug) { location.href = '/locations/'; }

async function loadSpot() {
  try {
    const res = await fetch(`/api/locations/${slug}`);
    if (!res.ok) { location.href = '/locations/'; return; }
    const loc = await res.json();
    renderSpot(loc);
    document.title = `${loc.title} — Amit Photos`;
  } catch {
    document.getElementById('hero-content').innerHTML = '<p style="color:#888">שגיאה בטעינה.</p>';
  }
}

function renderSpot(loc) {
  document.getElementById('hero-content').innerHTML = `
    <div class="badge">📍 ${loc.region || 'מקום צילום'}</div>
    <h1>${loc.title}</h1>
    <div class="region-time">${loc.region || ''}${loc.best_time ? ' · ' + loc.best_time : ''}</div>
  `;

  if (loc.coordinates) {
    const [lat, lng] = loc.coordinates.split(',');
    document.getElementById('map-section').innerHTML = `
      <div class="map-wrap">
        <iframe src="https://maps.google.com/maps?q=${lat},${lng}&z=14&output=embed" loading="lazy" allowfullscreen></iframe>
      </div>
    `;
  }

  document.getElementById('details-section').innerHTML = `
    ${loc.description ? `<div class="section"><p style="line-height:1.8;font-size:.95rem">${loc.description}</p></div>` : ''}
    ${loc.my_tip ? `<div class="section"><h2>הטיפ שלי</h2><div class="tip-box">${loc.my_tip}</div></div>` : ''}
    <div class="section">
      <h2>מפרט צילום</h2>
      <ul class="specs-list">
        ${loc.best_time ? `<li><strong>זמן מומלץ:</strong> ${loc.best_time}</li>` : ''}
        ${loc.equipment ? `<li><strong>ציוד:</strong> ${loc.equipment}</li>` : ''}
        ${loc.coordinates ? `<li><strong>ניווט:</strong> <a href="https://www.google.com/maps/search/?api=1&query=${loc.coordinates}" target="_blank" style="color:var(--accent)">פתח במפות Google</a></li>` : ''}
      </ul>
    </div>
    ${loc.related_guides && loc.related_guides.length ? `
    <div class="section">
      <h2>מדריכים קשורים</h2>
      <div class="guides-row">
        ${loc.related_guides.map(g => `<a class="guide-chip" href="${g}">${GUIDE_LABELS[g] || g}</a>`).join('')}
      </div>
    </div>` : ''}
  `;

  if (loc.photos && loc.photos.length) {
    document.getElementById('gallery-section').innerHTML = `
      <div class="section">
        <h2>גלריה מהמקום</h2>
        <div class="gallery-grid">
          ${loc.photos.map(p => `
            <div class="gallery-item" data-url="${p.url}">
              <img src="${p.thumbnail || p.url}" alt="${loc.title}" loading="lazy">
              ${p.for_sale ? `<a class="for-sale-btn" href="/?photo=${p.photo_id || ''}" target="_blank">לרכישה</a>` : ''}
            </div>
          `).join('')}
        </div>
      </div>
    `;
    document.querySelectorAll('.gallery-item').forEach(item => {
      item.addEventListener('click', e => {
        if (e.target.classList.contains('for-sale-btn')) return;
        document.getElementById('lb-img').src = item.dataset.url;
        document.getElementById('lb').classList.add('open');
      });
    });
  }
}

document.getElementById('lb-close').addEventListener('click', () => document.getElementById('lb').classList.remove('open'));
document.getElementById('lb').addEventListener('click', e => { if (e.target === document.getElementById('lb')) document.getElementById('lb').classList.remove('open'); });

document.getElementById('btn-open-correction').addEventListener('click', () => document.getElementById('correction-modal').classList.add('open'));
document.getElementById('btn-cancel-corr').addEventListener('click', () => document.getElementById('correction-modal').classList.remove('open'));
document.getElementById('btn-send-corr').addEventListener('click', async () => {
  const name = document.getElementById('corr-name').value.trim();
  const message = document.getElementById('corr-message').value.trim();
  if (!message) { alert('נא למלא הודעה.'); return; }
  const btn = document.getElementById('btn-send-corr');
  btn.disabled = true; btn.textContent = 'שולח...';
  await fetch('/api/locations/suggest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'correction', location_slug: slug, sender_name: name, message })
  });
  btn.textContent = 'נשלח!';
  setTimeout(() => { document.getElementById('correction-modal').classList.remove('open'); btn.disabled = false; btn.textContent = 'שלח'; }, 1500);
});

loadSpot();
</script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add locations/spot/index.html
git commit -m "feat: add location spot page with map, gallery, correction modal"
```

---

## Task 8: nav.js — Add "מקומות" Link

**Files:**
- Modify: `assets/js/nav.js`

- [ ] **Step 1: Add translations**

In `NAV_T.he` object, add:
```js
locations: 'מקומות',
```
In `NAV_T.en` object, add:
```js
locations: 'Locations',
```

- [ ] **Step 2: Add to `map` in `applyNavLang`**

In the `map` object inside `applyNavLang`, add:
```js
'nav.locations': t.locations,
```

- [ ] **Step 3: Add nav link in HTML**

In the `nav.innerHTML` `<ul>` block, add after the `/camera/` link:
```html
<li><a href="/locations/" data-i18n="nav.locations">מקומות</a></li>
```

- [ ] **Step 4: Commit and push**

```bash
git add assets/js/nav.js
git commit -m "feat: add locations link to nav"
git push origin main
```

---

## Task 9: Admin Panel — Locations Tab

**Files:**
- Modify: `admin.html`

- [ ] **Step 1: Find the tabs bar in admin.html**

Search for the existing tab buttons (look for the pattern of the sidebar or tab navigation). Add a "מקומות" tab button alongside the existing tabs.

In the admin sidebar or tab list, add:
```html
<button class="tab-btn" data-tab="locations">מקומות</button>
```

- [ ] **Step 2: Add the locations tab panel HTML**

After the last existing tab panel `</div>`, add:

```html
<div id="tab-locations" class="tab-panel" style="display:none">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem">
    <h2 style="font-family:'Syne',sans-serif;color:var(--accent)">מקומות לצילום</h2>
    <button id="btn-new-location" style="background:var(--accent);color:#0a0a0a;border:none;padding:.6rem 1.25rem;border-radius:4px;font-weight:700;cursor:pointer">+ מקום חדש</button>
  </div>
  <div id="locations-list"></div>
  <div id="location-editor" style="display:none"></div>
</div>
```

- [ ] **Step 3: Add Locations JS at the bottom of admin.html (before `</body>`)**

```html
<script>
// ===== LOCATIONS ADMIN =====
(function() {
  let locSlug = null;
  let locPhotos = [];

  async function loadLocationsList() {
    const res = await fetch('/api/admin/locations', { headers: { 'X-Session-Token': getToken() } });
    const list = await res.json();
    const el = document.getElementById('locations-list');
    if (!list.length) { el.innerHTML = '<p style="color:#888">אין מקומות עדיין.</p>'; return; }
    el.innerHTML = `<table style="width:100%;border-collapse:collapse">
      <thead><tr style="color:#888;font-size:.8rem;text-align:right">
        <th style="padding:.5rem">שם</th><th>אזור</th><th>תמונות</th><th>סטטוס</th><th></th>
      </tr></thead>
      <tbody>${list.map(l => `
        <tr style="border-top:1px solid #222">
          <td style="padding:.6rem">${l.title}</td>
          <td style="color:#888">${l.region || '—'}</td>
          <td style="color:#888">${l.photo_count || 0}</td>
          <td><span style="color:${l.published ? '#4caf7d' : '#888'}">${l.published ? 'פורסם' : 'טיוטה'}</span></td>
          <td><button onclick="editLocation('${l.id}')" style="background:transparent;border:1px solid #333;color:#ccc;padding:.3rem .75rem;border-radius:4px;cursor:pointer;font-size:.8rem">עריכה</button></td>
        </tr>`).join('')}
      </tbody></table>`;
  }

  window.editLocation = async function(slug) {
    locSlug = slug;
    const res = await fetch(`/api/admin/locations/${slug}`, {
      headers: { 'X-Session-Token': getToken() }
    });
    if (!res.ok) { alert('שגיאה בטעינת המקום'); return; }
    const loc = await res.json();
    locPhotos = loc.photos || [];
    renderEditor(loc);
  };

  function renderEditor(loc) {
    document.getElementById('locations-list').style.display = 'none';
    document.getElementById('btn-new-location').style.display = 'none';
    const ed = document.getElementById('location-editor');
    ed.style.display = 'block';
    const GUIDES = [
      ['/camera/filters/','פילטרים'],['/camera/composition/','קומפוזיציה'],
      ['/camera/exposure/','חשיפה'],['/camera/depth-of-field/','עומק שדה'],
      ['/camera/white-balance/','איזון לבן'],['/camera/histogram/','היסטוגרם'],
      ['/camera/light/','אור'],['/camera/dynamic-range/','דינמיק ריינג'],
      ['/camera/controls/','בקרות'],['/camera/lenses/','עדשות'],['/camera/types/','סוגי מצלמות']
    ];
    const relGuides = loc.related_guides || [];
    ed.innerHTML = `
      <button id="btn-back-locations" style="background:transparent;border:none;color:#888;cursor:pointer;margin-bottom:1.5rem;font-size:.85rem">← חזרה לרשימה</button>
      <div style="display:flex;gap:.75rem;flex-wrap:wrap;margin-bottom:1.5rem">
        <button id="btn-save-location" style="background:var(--accent);color:#0a0a0a;border:none;padding:.6rem 1.25rem;border-radius:4px;font-weight:700;cursor:pointer">שמור</button>
        <button id="btn-enrich-location" style="background:transparent;border:1px solid var(--accent);color:var(--accent);padding:.6rem 1.25rem;border-radius:4px;cursor:pointer">✨ העשר מ-AI</button>
        <button id="btn-delete-location" style="background:transparent;border:1px solid #e05555;color:#e05555;padding:.6rem 1.25rem;border-radius:4px;cursor:pointer">מחק</button>
        <a href="/locations/spot/?slug=${loc.id}" target="_blank" style="background:transparent;border:1px solid #333;color:#888;padding:.6rem 1.25rem;border-radius:4px;font-size:.85rem;text-decoration:none">צפה בדף</a>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem">
        <div>
          <label style="display:block;font-size:.8rem;color:#888;margin-bottom:.3rem">כותרת</label>
          <input id="loc-title" value="${loc.title || ''}" style="width:100%;background:#0a0a0a;border:1px solid #222;color:#f0ede8;padding:.6rem .8rem;border-radius:4px;font-family:'Heebo',sans-serif">
        </div>
        <div>
          <label style="display:block;font-size:.8rem;color:#888;margin-bottom:.3rem">אזור</label>
          <select id="loc-region" style="width:100%;background:#0a0a0a;border:1px solid #222;color:#f0ede8;padding:.6rem .8rem;border-radius:4px;font-family:'Heebo',sans-serif">
            ${['','צפון','מרכז','ירושלים','דרום','נגב','הרי אילת'].map(r => `<option ${loc.region===r?'selected':''}>${r}</option>`).join('')}
          </select>
        </div>
      </div>

      <div style="margin-bottom:1rem">
        <label style="display:block;font-size:.8rem;color:#888;margin-bottom:.3rem">תיאור</label>
        <textarea id="loc-description" style="width:100%;background:#0a0a0a;border:1px solid #222;color:#f0ede8;padding:.6rem .8rem;border-radius:4px;min-height:80px;font-family:'Heebo',sans-serif;direction:rtl">${loc.description || ''}</textarea>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem">
        <div>
          <label style="display:block;font-size:.8rem;color:#888;margin-bottom:.3rem">זמן מומלץ</label>
          <input id="loc-best-time" value="${loc.best_time || ''}" style="width:100%;background:#0a0a0a;border:1px solid #222;color:#f0ede8;padding:.6rem .8rem;border-radius:4px;font-family:'Heebo',sans-serif">
        </div>
        <div>
          <label style="display:block;font-size:.8rem;color:#888;margin-bottom:.3rem">קואורדינטות (lat,lng)</label>
          <input id="loc-coords" value="${loc.coordinates || ''}" style="width:100%;background:#0a0a0a;border:1px solid #222;color:#f0ede8;padding:.6rem .8rem;border-radius:4px;font-family:'Heebo',sans-serif">
        </div>
      </div>
      <div style="margin-bottom:1rem">
        <label style="display:block;font-size:.8rem;color:#888;margin-bottom:.3rem">ציוד מומלץ</label>
        <input id="loc-equipment" value="${loc.equipment || ''}" style="width:100%;background:#0a0a0a;border:1px solid #222;color:#f0ede8;padding:.6rem .8rem;border-radius:4px;font-family:'Heebo',sans-serif">
      </div>
      <div style="margin-bottom:1rem">
        <label style="display:block;font-size:.8rem;color:#888;margin-bottom:.3rem">הטיפ שלי</label>
        <textarea id="loc-tip" style="width:100%;background:#0a0a0a;border:1px solid #222;color:#f0ede8;padding:.6rem .8rem;border-radius:4px;min-height:70px;font-family:'Heebo',sans-serif;direction:rtl">${loc.my_tip || ''}</textarea>
      </div>
      <div style="margin-bottom:1.5rem">
        <label style="display:block;font-size:.8rem;color:#888;margin-bottom:.5rem">מדריכים קשורים</label>
        <div style="display:flex;flex-wrap:wrap;gap:.5rem">
          ${GUIDES.map(([path, label]) => `
            <label style="display:flex;align-items:center;gap:.35rem;background:#141414;border:1px solid #222;border-radius:20px;padding:.3rem .75rem;cursor:pointer;font-size:.8rem">
              <input type="checkbox" value="${path}" ${relGuides.includes(path)?'checked':''} style="accent-color:var(--accent)">
              ${label}
            </label>`).join('')}
        </div>
      </div>

      <div style="display:flex;align-items:center;gap:.75rem;margin-bottom:2rem">
        <label style="font-size:.85rem;color:#888">פרסום:</label>
        <input type="checkbox" id="loc-published" ${loc.published ? 'checked' : ''} style="accent-color:var(--accent);width:18px;height:18px">
        <label for="loc-published" style="font-size:.85rem">מפורסם</label>
      </div>

      <h3 style="font-family:'Syne',sans-serif;font-size:1rem;margin-bottom:1rem">תמונות</h3>
      <div id="loc-photos-panel"></div>
    `;

    renderPhotosPanel();
    bindEditorEvents(loc);
  }

  function renderPhotosPanel() {
    const panel = document.getElementById('loc-photos-panel');
    panel.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;margin-bottom:1.5rem">
        <div>
          <div style="font-size:.85rem;color:#888;margin-bottom:.5rem">קשר מהגלריה</div>
          <input id="gallery-search" placeholder="חפש תמונה לפי כותרת..." style="width:100%;background:#0a0a0a;border:1px solid #222;color:#f0ede8;padding:.55rem .8rem;border-radius:4px;font-family:'Heebo',sans-serif;margin-bottom:.5rem">
          <div id="gallery-search-results" style="max-height:200px;overflow-y:auto;border:1px solid #222;border-radius:4px"></div>
        </div>
        <div>
          <div style="font-size:.85rem;color:#888;margin-bottom:.5rem">העלה תמונה בלעדית</div>
          <input type="file" id="exclusive-upload" accept="image/*" style="font-size:.8rem;color:#888;margin-bottom:.5rem">
          <label style="display:flex;align-items:center;gap:.4rem;font-size:.8rem;color:#888">
            <input type="checkbox" id="exclusive-for-sale" style="accent-color:var(--accent)"> להציע בחנות
          </label>
          <button id="btn-upload-exclusive" style="margin-top:.75rem;background:var(--accent);color:#0a0a0a;border:none;padding:.5rem 1rem;border-radius:4px;font-weight:700;cursor:pointer;font-size:.8rem">העלה</button>
        </div>
      </div>
      <div id="loc-photos-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:.75rem"></div>
    `;

    renderLocPhotosGrid();
    bindPhotosPanelEvents();
  }

  function renderLocPhotosGrid() {
    const grid = document.getElementById('loc-photos-grid');
    if (!locPhotos.length) { grid.innerHTML = '<p style="color:#888;font-size:.85rem">אין תמונות עדיין.</p>'; return; }
    grid.innerHTML = locPhotos.map(p => `
      <div style="position:relative;border:1px solid #222;border-radius:6px;overflow:hidden" data-photo-id="${p.id}">
        <img src="${p.thumbnail || p.url}" style="width:100%;aspect-ratio:1;object-fit:cover;display:block">
        <div style="position:absolute;top:.25rem;right:.25rem;background:rgba(0,0,0,.7);border-radius:3px;padding:.15rem .35rem;font-size:.65rem;color:#888">${p.type === 'exclusive' ? '★' : '◈'}</div>
        <button onclick="removeLocPhoto('${p.id}')" style="position:absolute;top:.25rem;left:.25rem;background:rgba(200,0,0,.8);border:none;color:#fff;border-radius:3px;padding:.15rem .4rem;cursor:pointer;font-size:.7rem">✕</button>
      </div>
    `).join('');
  }

  function bindPhotosPanelEvents() {
    let searchTimeout;
    document.getElementById('gallery-search').addEventListener('input', function() {
      clearTimeout(searchTimeout);
      const q = this.value.trim();
      if (!q) { document.getElementById('gallery-search-results').innerHTML = ''; return; }
      searchTimeout = setTimeout(() => searchGalleryPhotos(q), 300);
    });

    document.getElementById('btn-upload-exclusive').addEventListener('click', async () => {
      const file = document.getElementById('exclusive-upload').files[0];
      if (!file) return;
      const forSale = document.getElementById('exclusive-for-sale').checked ? '1' : '0';
      const fd = new FormData();
      fd.append('file', file);
      fd.append('for_sale', forSale);
      const btn = document.getElementById('btn-upload-exclusive');
      btn.disabled = true; btn.textContent = 'מעלה...';
      const res = await fetch(`/api/admin/locations/${locSlug}/photos`, {
        method: 'POST',
        headers: { 'X-Session-Token': getToken() },
        body: fd
      });
      if (res.ok) {
        const p = await res.json();
        locPhotos.push(p);
        renderLocPhotosGrid();
      } else { alert('שגיאה בהעלאה'); }
      btn.disabled = false; btn.textContent = 'העלה';
    });
  }

  async function searchGalleryPhotos(q) {
    const res = await fetch(`/api/photos?q=${encodeURIComponent(q)}&limit=10`, {
      headers: { 'X-Session-Token': getToken() }
    });
    const data = await res.json();
    const photos = data.photos || data || [];
    const results = document.getElementById('gallery-search-results');
    if (!photos.length) { results.innerHTML = '<p style="padding:.5rem;font-size:.8rem;color:#888">אין תוצאות</p>'; return; }
    results.innerHTML = photos.map(p => `
      <div style="display:flex;align-items:center;gap:.5rem;padding:.4rem .6rem;border-bottom:1px solid #1a1a1a;cursor:pointer" onclick="addGalleryPhoto('${p.id}')">
        <img src="${p.thumbnail}" style="width:36px;height:36px;object-fit:cover;border-radius:3px">
        <span style="font-size:.8rem">${p.title || p.id}</span>
      </div>
    `).join('');
  }

  window.addGalleryPhoto = async function(photoId) {
    const res = await fetch(`/api/admin/locations/${locSlug}/photos`, {
      method: 'POST',
      headers: { 'X-Session-Token': getToken(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ photo_id: photoId, for_sale: 1 })
    });
    if (res.ok) {
      const p = await res.json();
      locPhotos.push(p);
      renderLocPhotosGrid();
      document.getElementById('gallery-search').value = '';
      document.getElementById('gallery-search-results').innerHTML = '';
    }
  };

  window.removeLocPhoto = async function(photoEntryId) {
    if (!confirm('להסיר תמונה זו מהמקום?')) return;
    const res = await fetch(`/api/admin/locations/${locSlug}/photos/${photoEntryId}`, {
      method: 'DELETE',
      headers: { 'X-Session-Token': getToken() }
    });
    if (res.ok) {
      locPhotos = locPhotos.filter(p => p.id !== photoEntryId);
      renderLocPhotosGrid();
    }
  };

  function bindEditorEvents(loc) {
    document.getElementById('btn-back-locations').addEventListener('click', () => {
      document.getElementById('location-editor').style.display = 'none';
      document.getElementById('locations-list').style.display = 'block';
      document.getElementById('btn-new-location').style.display = '';
      locSlug = null;
    });

    document.getElementById('btn-save-location').addEventListener('click', async () => {
      const body = {
        title: document.getElementById('loc-title').value,
        region: document.getElementById('loc-region').value,
        description: document.getElementById('loc-description').value,
        best_time: document.getElementById('loc-best-time').value,
        coordinates: document.getElementById('loc-coords').value,
        equipment: document.getElementById('loc-equipment').value,
        my_tip: document.getElementById('loc-tip').value,
        related_guides: Array.from(document.querySelectorAll('#location-editor input[type=checkbox][value]')).filter(c => c.checked).map(c => c.value),
        published: document.getElementById('loc-published').checked ? 1 : 0
      };
      const res = await fetch(`/api/admin/locations/${locSlug}`, {
        method: 'PUT',
        headers: { 'X-Session-Token': getToken(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (res.ok) { alert('נשמר!'); } else { alert('שגיאה בשמירה'); }
    });

    document.getElementById('btn-enrich-location').addEventListener('click', async () => {
      const btn = document.getElementById('btn-enrich-location');
      btn.disabled = true; btn.textContent = '✨ מעשיר...';
      const res = await fetch(`/api/admin/locations/${locSlug}/enrich`, {
        method: 'POST',
        headers: { 'X-Session-Token': getToken() }
      });
      if (res.ok) {
        const updated = await res.json();
        document.getElementById('loc-description').value = updated.description || '';
        document.getElementById('loc-best-time').value = updated.best_time || '';
        document.getElementById('loc-equipment').value = updated.equipment || '';
        document.getElementById('loc-tip').value = updated.my_tip || '';
        document.getElementById('loc-coords').value = updated.coordinates || '';
        const guides = updated.related_guides || [];
        document.querySelectorAll('#location-editor input[type=checkbox][value]').forEach(cb => {
          cb.checked = guides.includes(cb.value);
        });
        alert('הושלם! בדוק ועדכן לפי הצורך.');
      } else { alert('שגיאה ב-AI enrich'); }
      btn.disabled = false; btn.textContent = '✨ העשר מ-AI';
    });

    document.getElementById('btn-delete-location').addEventListener('click', async () => {
      if (!confirm(`למחוק את "${loc.title}"? הפעולה בלתי הפיכה.`)) return;
      const res = await fetch(`/api/admin/locations/${locSlug}`, {
        method: 'DELETE',
        headers: { 'X-Session-Token': getToken() }
      });
      if (res.ok) {
        document.getElementById('location-editor').style.display = 'none';
        document.getElementById('locations-list').style.display = 'block';
        document.getElementById('btn-new-location').style.display = '';
        locSlug = null;
        loadLocationsList();
      }
    });
  }

  document.getElementById('btn-new-location').addEventListener('click', async () => {
    const title = prompt('שם המקום:');
    if (!title || !title.trim()) return;
    const region = prompt('אזור (צפון / מרכז / ירושלים / דרום / נגב / הרי אילת):') || '';
    const btn = document.getElementById('btn-new-location');
    btn.disabled = true; btn.textContent = '⏳ יוצר ומעשיר...';
    const res = await fetch('/api/admin/locations', {
      method: 'POST',
      headers: { 'X-Session-Token': getToken(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title.trim(), region })
    });
    btn.disabled = false; btn.textContent = '+ מקום חדש';
    if (res.ok) {
      const loc = await res.json();
      await editLocation(loc.id);
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.error || 'שגיאה ביצירה');
    }
  });

  // Wire up tab activation
  document.addEventListener('tabchange', function(e) {
    if (e.detail === 'locations') loadLocationsList();
  });

  // Also load if tab is already active on page load
  if (document.getElementById('tab-locations') && document.getElementById('tab-locations').style.display !== 'none') {
    loadLocationsList();
  }
})();
</script>
```

> **Note:** `getToken()` is the existing helper in admin.html that returns the session token from localStorage. Verify its exact name by searching for `localStorage.getItem` or `sessionToken` in admin.html before pasting.

- [ ] **Step 3: Wire tab switching**

Find the existing tab-switching logic in admin.html. Add `locations` to it, following the same pattern as other tabs. Make sure clicking the "מקומות" tab button dispatches or triggers `loadLocationsList()`. Also dispatch a custom `tabchange` event with `detail: 'locations'` when the tab is selected — the script above listens for it.

- [ ] **Step 4: Add admin API GET single location route to worker**

The admin editor calls `GET /api/admin/locations/:slug` to load a single location for editing. Add this route in `worker.js`:

```js
if (path.startsWith('/api/admin/locations/') && request.method === 'GET') {
  const slug = path.slice('/api/admin/locations/'.length).split('/')[0];
  if (!await checkAuth(request, env)) return unauth(request);
  const loc = await env.DB.prepare('SELECT * FROM locations WHERE id = ?').bind(slug).first();
  if (!loc) return jsonRes({ error: 'לא נמצא' }, 404, request);
  const { results: photos } = await env.DB.prepare(
    'SELECT * FROM location_photos WHERE location_id = ? ORDER BY sort_order ASC'
  ).bind(slug).all();
  return jsonRes({ ...loc, related_guides: JSON.parse(loc.related_guides || '[]'), photos: photos || [] }, 200, request);
}
```

- [ ] **Step 5: Deploy and end-to-end test**

```bash
npx wrangler deploy
```

Test flow:
1. Login to admin → click "מקומות" tab
2. Click "+ מקום חדש" → enter name (e.g. "מצדה") + region
3. Wait ~3s for AI enrich → editor opens with pre-filled fields
4. Check fields look correct, adjust if needed
5. Click "שמור" → no error
6. Toggle published → save
7. Open `/locations/` → card appears
8. Click card → `/locations/spot/?slug=matzada` → full page with map

- [ ] **Step 6: Commit and push**

```bash
git add admin.html worker.js
git commit -m "feat: add locations admin tab with editor and photo management"
git push origin main
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] D1 schema (Task 1)
- [x] Public API: list, get, suggest (Task 3)
- [x] Admin API: CRUD + enrich (Task 4)
- [x] Admin API: photo add/delete/reorder (Task 5)
- [x] Hub page with filter + suggest modal (Task 6)
- [x] Spot page with map, gallery, lightbox, correction modal (Task 7)
- [x] Nav link (Task 8)
- [x] Admin tab with editor + photo management (Task 9)
- [x] AI enrich on creation + manual re-enrich (Tasks 4, 9)
- [x] Gallery photos (link existing) + exclusive photos (upload to R2) (Task 5)
- [x] for_sale flag + "לרכישה" button on spot page (Tasks 5, 7)
- [x] Slug immutable after creation (enforced by no slug field in PUT handler)
- [x] Cascade delete of R2 exclusive images on location delete (Task 4 Step 5)

**Notes:**
- The `getToken()` call in admin.html JS assumes this helper exists — verify name before running Task 9.
- `/api/photos?q=` search endpoint — verify it supports `?q=` query param in existing worker; if not, use `/api/photos` and filter client-side.
