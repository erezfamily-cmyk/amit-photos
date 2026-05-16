# Locations English — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add full English localization to the Locations section — index page, spot page, and admin editor — with AI-powered content generation.

**Architecture:** New `*_en` columns in D1 hold English content. A new `/api/admin/locations/[slug]/generate-en` endpoint calls Claude to generate content. The spot page and index read `localStorage.getItem('lang')` and re-render on language change. The admin editor gains a HE/EN tab with a Generate button.

**Tech Stack:** Cloudflare D1 (SQLite), Cloudflare Workers (worker.js monolith), Claude API (`claude-sonnet-4-6`), vanilla JS HTML pages

---

## Task 1: D1 Migration — Add 7 EN Columns

**Files:**
- Create: `src/migrate_locations_en.sql`

- [ ] **Step 1: Create migration SQL file**

```sql
ALTER TABLE locations ADD COLUMN title_en TEXT;
ALTER TABLE locations ADD COLUMN description_en TEXT;
ALTER TABLE locations ADD COLUMN best_time_en TEXT;
ALTER TABLE locations ADD COLUMN equipment_en TEXT;
ALTER TABLE locations ADD COLUMN my_tip_en TEXT;
ALTER TABLE locations ADD COLUMN when_to_visit_en TEXT;
ALTER TABLE locations ADD COLUMN recommended_gear_en TEXT;
```

- [ ] **Step 2: Run migration against remote D1**

```powershell
npx wrangler d1 execute amit-photos-db --remote --file src/migrate_locations_en.sql
```

Expected output: 7 lines each showing `{ success: true }`.

- [ ] **Step 3: Verify columns were added**

```powershell
npx wrangler d1 execute amit-photos-db --remote --command "PRAGMA table_info(locations)" --json
```

Expected: output includes `title_en`, `description_en`, `best_time_en`, `equipment_en`, `my_tip_en`, `when_to_visit_en`, `recommended_gear_en` in the column list.

- [ ] **Step 4: Commit**

```powershell
git add src/migrate_locations_en.sql
git commit -m "feat: add EN columns to locations D1 table"
```

---

## Task 2: Worker — Return EN Fields from GET Endpoints

**Files:**
- Modify: `worker.js` — functions `handleLocationsGet` (line ~3256) and `handleAdminLocationsGet` (line ~3497)

Both functions already use `SELECT *` so new columns are fetched automatically. We only need to parse the two JSON EN columns in the response.

- [ ] **Step 1: Extend `handleLocationsGet` response to parse EN JSON fields**

Find this block in `handleLocationsGet` (around line 3256):
```js
  return jsonRes({
    ...loc,
    related_guides: JSON.parse(loc.related_guides || '[]'),
    extra_links: JSON.parse(loc.extra_links || '[]'),
    when_to_visit: loc.when_to_visit ? JSON.parse(loc.when_to_visit) : null,
    recommended_gear: loc.recommended_gear ? JSON.parse(loc.recommended_gear) : null,
    nearby,
    photos: photos || []
  }, 200, request);
```

Replace with:
```js
  return jsonRes({
    ...loc,
    related_guides: JSON.parse(loc.related_guides || '[]'),
    extra_links: JSON.parse(loc.extra_links || '[]'),
    when_to_visit: loc.when_to_visit ? JSON.parse(loc.when_to_visit) : null,
    recommended_gear: loc.recommended_gear ? JSON.parse(loc.recommended_gear) : null,
    when_to_visit_en: loc.when_to_visit_en ? JSON.parse(loc.when_to_visit_en) : null,
    recommended_gear_en: loc.recommended_gear_en ? JSON.parse(loc.recommended_gear_en) : null,
    nearby,
    photos: photos || []
  }, 200, request);
```

- [ ] **Step 2: Extend `handleAdminLocationsGet` response similarly**

Find this line in `handleAdminLocationsGet` (around line 3504):
```js
  return jsonRes({ ...loc, related_guides: JSON.parse(loc.related_guides || '[]'), extra_links: JSON.parse(loc.extra_links || '[]'), photos: photos || [] }, 200, request);
```

Replace with:
```js
  return jsonRes({
    ...loc,
    related_guides: JSON.parse(loc.related_guides || '[]'),
    extra_links: JSON.parse(loc.extra_links || '[]'),
    when_to_visit: loc.when_to_visit ? JSON.parse(loc.when_to_visit) : null,
    recommended_gear: loc.recommended_gear ? JSON.parse(loc.recommended_gear) : null,
    when_to_visit_en: loc.when_to_visit_en ? JSON.parse(loc.when_to_visit_en) : null,
    recommended_gear_en: loc.recommended_gear_en ? JSON.parse(loc.recommended_gear_en) : null,
    photos: photos || []
  }, 200, request);
```

- [ ] **Step 3: Verify (after deploy in Task 4)**

```powershell
npx wrangler deploy
```

Then:
```powershell
curl "https://www.amitphotos.com/api/locations/roma" | python -m json.tool | findstr "_en"
```

Expected: keys `when_to_visit_en` and `recommended_gear_en` appear (as null for now).

- [ ] **Step 4: Commit**

```powershell
git add worker.js
git commit -m "feat: return EN fields from locations GET endpoints"
```

---

## Task 3: Worker — Accept EN Fields in PUT Handler

**Files:**
- Modify: `worker.js` — function `handleAdminLocationsUpdate` (line ~3407)

- [ ] **Step 1: Add EN scalar fields to the `fields` array**

Find this line in `handleAdminLocationsUpdate` (line ~3412):
```js
  const fields = ['title','region','description','best_time','equipment','my_tip','coordinates','published','when_to_visit','recommended_gear'];
```

Replace with:
```js
  const fields = [
    'title','region','description','best_time','equipment','my_tip','coordinates','published',
    'when_to_visit','recommended_gear',
    'title_en','description_en','best_time_en','equipment_en','my_tip_en'
  ];
```

- [ ] **Step 2: Add special handling for `when_to_visit_en` and `recommended_gear_en`**

Find this block after the `related_guides` handling (around line 3426):
```js
  if (body.extra_links !== undefined) {
    sets.push('extra_links = ?');
    vals.push(JSON.stringify(body.extra_links));
  }
```

Add after it:
```js
  if (body.when_to_visit_en !== undefined) {
    sets.push('when_to_visit_en = ?');
    vals.push(body.when_to_visit_en);
  }
  if (body.recommended_gear_en !== undefined) {
    sets.push('recommended_gear_en = ?');
    vals.push(body.recommended_gear_en);
  }
```

- [ ] **Step 3: Commit**

```powershell
git add worker.js
git commit -m "feat: PUT /api/admin/locations accepts EN fields"
```

---

## Task 4: Worker — Add Generate-EN Handler

**Files:**
- Modify: `worker.js` — add new function + route

- [ ] **Step 1: Add the handler function after `handleAdminLocationsEnrich` (after line ~3495)**

Insert this new function:

```js
async function handleAdminLocationsGenerateEn(request, env, slug) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== 'POST') return jsonRes({ error: 'POST only' }, 405, request);
  if (!env.ANTHROPIC_API_KEY) return jsonRes({ error: 'ANTHROPIC_API_KEY חסר' }, 500, request);

  const loc = await env.DB.prepare('SELECT * FROM locations WHERE id = ?').bind(slug).first();
  if (!loc) return jsonRes({ error: 'לא נמצא' }, 404, request);

  const prompt = `You are Amit Erez, an Israeli travel photographer writing for an international photography audience.
Translate and adapt the following Hebrew photography location data to English. Write in first person, personal and inspiring tone, as if you visited this place yourself and want to help other photographers get the best shots.

Location data:
Title: ${loc.title}
Region: ${loc.region}
Description: ${loc.description || ''}
Best time to visit: ${loc.best_time || ''}
Equipment: ${loc.equipment || ''}
My tip: ${loc.my_tip || ''}
When to visit (JSON): ${loc.when_to_visit || 'null'}
Recommended gear (JSON): ${loc.recommended_gear || 'null'}

Return ONLY valid JSON with these exact keys — no markdown, no explanation:
{
  "title_en": "English title",
  "description_en": "Full adapted English description (3-5 sentences, vivid and location-specific)",
  "best_time_en": "Best time in English",
  "equipment_en": "Equipment in English",
  "my_tip_en": "Personal shooting tip in English",
  "when_to_visit_en": {"summer":{"rating":"ok","note":"English note"},"fall":{"rating":"good","note":"English note"},"winter":{"rating":"ok","note":"English note"},"spring":{"rating":"good","note":"English note"}},
  "recommended_gear_en": [{"name":"English gear name","primary":true}]
}

Rules:
- For when_to_visit_en: keep the exact same "rating" values from the Hebrew input, translate only the "note" values.
- For recommended_gear_en: keep the exact same "primary" boolean values, translate gear names to standard English photography terminology (e.g. "עדשה רחבה 16-35mm" → "Wide-angle 16-35mm").
- If a field is empty or null in Hebrew, return an empty string for its English version.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!res.ok) return jsonRes({ error: 'Claude API נכשל', status: res.status }, 502, request);
  const data = await res.json();
  const text = (data.content?.[0]?.text || '').trim();

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return jsonRes({ error: 'JSON לא תקין מ-Claude' }, 500, request);
    try { parsed = JSON.parse(match[0]); } catch { return jsonRes({ error: 'JSON לא תקין מ-Claude' }, 500, request); }
  }

  return jsonRes({
    title_en: parsed.title_en || '',
    description_en: parsed.description_en || '',
    best_time_en: parsed.best_time_en || '',
    equipment_en: parsed.equipment_en || '',
    my_tip_en: parsed.my_tip_en || '',
    when_to_visit_en: typeof parsed.when_to_visit_en === 'object' ? JSON.stringify(parsed.when_to_visit_en) : (parsed.when_to_visit_en || ''),
    recommended_gear_en: Array.isArray(parsed.recommended_gear_en) ? JSON.stringify(parsed.recommended_gear_en) : (parsed.recommended_gear_en || '')
  }, 200, request);
}
```

- [ ] **Step 2: Add route in the dispatch section**

Find this line in the dispatch section (line ~4124):
```js
      if (parts[1] === 'enrich') return handleAdminLocationsEnrich(request, env, locSlug);
```

Add before it:
```js
      if (parts[1] === 'generate-en') return handleAdminLocationsGenerateEn(request, env, locSlug);
```

- [ ] **Step 3: Deploy and test**

```powershell
npx wrangler deploy
```

Test (replace with admin password):
```powershell
curl -X POST "https://www.amitphotos.com/api/admin/locations/roma/generate-en" -H "X-Admin-Password: YOUR_PASSWORD"
```

Expected: JSON with `title_en`, `description_en`, and other `*_en` fields populated in English.

- [ ] **Step 4: Commit**

```powershell
git add worker.js
git commit -m "feat: add /api/admin/locations/[slug]/generate-en worker endpoint"
```

---

## Task 5: Admin — EN Badge in Locations List

**Files:**
- Modify: `worker.js` — `handleAdminLocationsList` (line ~3352)
- Modify: `admin.html` — `loadLocationsList` (line ~4426)

- [ ] **Step 1: Include `title_en` in the admin list query**

Find in `handleAdminLocationsList` (line ~3354):
```js
    SELECT l.id, l.title, l.region, l.published,
           COUNT(lp.id) AS photo_count
    FROM locations l
```

Replace with:
```js
    SELECT l.id, l.title, l.title_en, l.region, l.published,
           COUNT(lp.id) AS photo_count
    FROM locations l
```

- [ ] **Step 2: Show EN badge in the table row in `loadLocationsList`**

Find in `admin.html` the table row template (line ~4438):
```js
          <tr style="border-top:1px solid #222">
            <td style="padding:.6rem">${escHtml(l.title)}</td>
            <td style="color:#888">${escHtml(l.region) || '—'}</td>
            <td style="color:#888">${l.photo_count || 0}</td>
            <td><span style="color:${l.published ? '#4caf7d' : '#888'}">${l.published ? 'פורסם' : 'טיוטה'}</span></td>
            <td><button onclick="editLocation('${escHtml(l.id)}')" style="background:transparent;border:1px solid #333;color:#ccc;padding:.3rem .75rem;border-radius:4px;cursor:pointer;font-size:.8rem">עריכה</button></td>
          </tr>
```

Replace with:
```js
          <tr style="border-top:1px solid #222">
            <td style="padding:.6rem">
              ${escHtml(l.title)}
              ${l.title_en ? '<span style="font-size:.68rem;background:#1a2a1a;border:1px solid #2a4a2a;border-radius:10px;padding:1px 6px;color:#4caf7d;margin-right:.4rem">EN</span>' : ''}
            </td>
            <td style="color:#888">${escHtml(l.region) || '—'}</td>
            <td style="color:#888">${l.photo_count || 0}</td>
            <td><span style="color:${l.published ? '#4caf7d' : '#888'}">${l.published ? 'פורסם' : 'טיוטה'}</span></td>
            <td><button onclick="editLocation('${escHtml(l.id)}')" style="background:transparent;border:1px solid #333;color:#ccc;padding:.3rem .75rem;border-radius:4px;cursor:pointer;font-size:.8rem">עריכה</button></td>
          </tr>
```

- [ ] **Step 3: Deploy and verify**

```powershell
npx wrangler deploy
```

Open admin → Locations section. Locations without English should show no badge; after generating English (Task 6) they should show a green "EN" badge.

- [ ] **Step 4: Commit**

```powershell
git add worker.js admin.html
git commit -m "feat: show EN badge on translated locations in admin list"
```

---

## Task 6: Admin — EN Tab in Location Editor

**Files:**
- Modify: `admin.html` — `renderEditor` function (~line 4462) and `bindEditorEvents` (~line 4878)

This is the largest change. We wrap the existing Hebrew fields in a `#loc-he-fields` div, add a tab bar, and add a mirrored `#loc-en-fields` div for English content.

- [ ] **Step 1: Add tab bar and wrap Hebrew fields in `renderEditor`**

In the `renderEditor` function, find the line that starts building `ed.innerHTML`:
```js
    ed.innerHTML = `
      <button id="btn-back-locations" ...>← חזרה לרשימה</button>
      <div style="display:flex;gap:.75rem;flex-wrap:wrap;margin-bottom:1.5rem">
        <button id="btn-save-location" ...>שמור</button>
```

After the action buttons div (after the `<a href="/locations/spot/...">` closing `</div>`) and before the first `<div style="display:grid...">`, insert the tab bar:

```js
      <div style="display:flex;gap:0;margin-bottom:1.5rem;border-bottom:1px solid #333">
        <button id="tab-he" style="background:none;border:none;border-bottom:2px solid var(--accent);color:var(--accent);padding:.5rem 1.25rem;cursor:pointer;font-family:'Heebo',sans-serif;font-size:.9rem;font-weight:700">עברית</button>
        <button id="tab-en" style="background:none;border:none;border-bottom:2px solid transparent;color:#888;padding:.5rem 1.25rem;cursor:pointer;font-family:'Heebo',sans-serif;font-size:.9rem">English</button>
      </div>
      <div id="loc-he-fields">
```

Then after the publish checkbox div (at the end, just before `<h3 style="font-family:'Syne'...">תמונות</h3>`), close the he-fields div and add the en-fields div:

```js
      </div><!-- end loc-he-fields -->
      <div id="loc-en-fields" style="display:none;direction:ltr">
        <div style="margin-bottom:1rem;padding:.75rem 1rem;background:#0d1a0d;border:1px solid #1a3a1a;border-radius:6px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.5rem">
          <span style="font-size:.85rem;color:#4caf7d">${loc.title_en ? '✓ English content exists — edit below or regenerate' : 'No English content yet — click Generate to create it'}</span>
          <button id="btn-generate-en" style="background:var(--accent);color:#0a0a0a;border:none;padding:.5rem 1.1rem;border-radius:4px;font-weight:700;cursor:pointer;font-size:.85rem">✨ Generate English</button>
        </div>
        <div style="margin-bottom:1rem">
          <label style="display:block;font-size:.8rem;color:#888;margin-bottom:.3rem">Title (English)</label>
          <input id="loc-title-en" value="${escHtml(loc.title_en || '')}" placeholder="English title" style="width:100%;background:#0a0a0a;border:1px solid #222;color:#f0ede8;padding:.6rem .8rem;border-radius:4px;font-family:system-ui,sans-serif;direction:ltr">
        </div>
        <div style="margin-bottom:1rem">
          <label style="display:block;font-size:.8rem;color:#888;margin-bottom:.3rem">Description (English)</label>
          <textarea id="loc-description-en" placeholder="English description..." style="width:100%;background:#0a0a0a;border:1px solid #222;color:#f0ede8;padding:.6rem .8rem;border-radius:4px;min-height:100px;font-family:system-ui,sans-serif;direction:ltr">${escHtml(loc.description_en || '')}</textarea>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem">
          <div>
            <label style="display:block;font-size:.8rem;color:#888;margin-bottom:.3rem">Best Time (English)</label>
            <input id="loc-best-time-en" value="${escHtml(loc.best_time_en || '')}" placeholder="Best time to visit..." style="width:100%;background:#0a0a0a;border:1px solid #222;color:#f0ede8;padding:.6rem .8rem;border-radius:4px;font-family:system-ui,sans-serif;direction:ltr">
          </div>
          <div>
            <label style="display:block;font-size:.8rem;color:#888;margin-bottom:.3rem">Equipment (English)</label>
            <input id="loc-equipment-en" value="${escHtml(loc.equipment_en || '')}" placeholder="Recommended equipment..." style="width:100%;background:#0a0a0a;border:1px solid #222;color:#f0ede8;padding:.6rem .8rem;border-radius:4px;font-family:system-ui,sans-serif;direction:ltr">
          </div>
        </div>
        <div style="margin-bottom:1rem">
          <label style="display:block;font-size:.8rem;color:#888;margin-bottom:.3rem">My Tip (English)</label>
          <textarea id="loc-tip-en" placeholder="Personal shooting tip..." style="width:100%;background:#0a0a0a;border:1px solid #222;color:#f0ede8;padding:.6rem .8rem;border-radius:4px;min-height:80px;font-family:system-ui,sans-serif;direction:ltr">${escHtml(loc.my_tip_en || '')}</textarea>
        </div>
        <div style="margin-bottom:1rem">
          <label style="display:block;font-size:.8rem;color:#888;margin-bottom:.3rem">When to Visit — JSON (English notes)</label>
          <textarea id="loc-when-to-visit-en" placeholder='{"summer":{"rating":"ok","note":"..."},...}' style="width:100%;background:#0a0a0a;border:1px solid #222;color:#f0ede8;padding:.6rem .8rem;border-radius:4px;min-height:70px;font-family:monospace;direction:ltr;font-size:.78rem">${escHtml(typeof loc.when_to_visit_en === 'string' ? loc.when_to_visit_en : (loc.when_to_visit_en ? JSON.stringify(loc.when_to_visit_en) : ''))}</textarea>
        </div>
        <div style="margin-bottom:1rem">
          <label style="display:block;font-size:.8rem;color:#888;margin-bottom:.3rem">Recommended Gear — JSON (English names)</label>
          <textarea id="loc-recommended-gear-en" placeholder='[{"name":"Wide-angle 16-35mm","primary":true},...]' style="width:100%;background:#0a0a0a;border:1px solid #222;color:#f0ede8;padding:.6rem .8rem;border-radius:4px;min-height:60px;font-family:monospace;direction:ltr;font-size:.78rem">${escHtml(typeof loc.recommended_gear_en === 'string' ? loc.recommended_gear_en : (loc.recommended_gear_en ? JSON.stringify(loc.recommended_gear_en) : ''))}</textarea>
        </div>
      </div><!-- end loc-en-fields -->
```

- [ ] **Step 2: Add tab-switching and Generate button in `bindEditorEvents`**

At the top of the `bindEditorEvents` function (after the back-button listener), add:

```js
    document.getElementById('tab-he').addEventListener('click', function() {
      this.style.cssText += ';border-bottom:2px solid var(--accent);color:var(--accent);font-weight:700';
      const tabEn = document.getElementById('tab-en');
      tabEn.style.cssText = tabEn.style.cssText.replace('border-bottom:2px solid var(--accent)', 'border-bottom:2px solid transparent');
      tabEn.style.color = '#888';
      tabEn.style.fontWeight = '';
      document.getElementById('loc-he-fields').style.display = 'block';
      document.getElementById('loc-en-fields').style.display = 'none';
    });
    document.getElementById('tab-en').addEventListener('click', function() {
      this.style.cssText += ';border-bottom:2px solid var(--accent);color:var(--accent);font-weight:700';
      const tabHe = document.getElementById('tab-he');
      tabHe.style.cssText = tabHe.style.cssText.replace('border-bottom:2px solid var(--accent)', 'border-bottom:2px solid transparent');
      tabHe.style.color = '#888';
      tabHe.style.fontWeight = '';
      document.getElementById('loc-en-fields').style.display = 'block';
      document.getElementById('loc-he-fields').style.display = 'none';
    });

    document.getElementById('btn-generate-en').addEventListener('click', async () => {
      const btn = document.getElementById('btn-generate-en');
      btn.disabled = true;
      btn.textContent = '⏳ Generating...';
      const res = await fetch(`/api/admin/locations/${locSlug}/generate-en`, {
        method: 'POST',
        headers: authHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        document.getElementById('loc-title-en').value = data.title_en || '';
        document.getElementById('loc-description-en').value = data.description_en || '';
        document.getElementById('loc-best-time-en').value = data.best_time_en || '';
        document.getElementById('loc-equipment-en').value = data.equipment_en || '';
        document.getElementById('loc-tip-en').value = data.my_tip_en || '';
        document.getElementById('loc-when-to-visit-en').value = data.when_to_visit_en || '';
        document.getElementById('loc-recommended-gear-en').value = data.recommended_gear_en || '';
      } else {
        alert('Error generating English content');
      }
      btn.disabled = false;
      btn.textContent = '✨ Generate English';
    });
```

- [ ] **Step 3: Include EN fields in the save body**

Find the save handler in `bindEditorEvents` that builds `const body = {`:

After `published: document.getElementById('loc-published').checked ? 1 : 0`, add:

```js
        title_en: document.getElementById('loc-title-en')?.value || null,
        description_en: document.getElementById('loc-description-en')?.value || null,
        best_time_en: document.getElementById('loc-best-time-en')?.value || null,
        equipment_en: document.getElementById('loc-equipment-en')?.value || null,
        my_tip_en: document.getElementById('loc-tip-en')?.value || null,
        when_to_visit_en: document.getElementById('loc-when-to-visit-en')?.value || null,
        recommended_gear_en: document.getElementById('loc-recommended-gear-en')?.value || null,
```

- [ ] **Step 4: Deploy and test in admin**

```powershell
npx wrangler deploy
```

Manual test:
1. Open admin → Locations → edit any location
2. Click "English" tab — see EN fields
3. Click "✨ Generate English" — fields fill in ~5 seconds
4. Click Save — data persists

- [ ] **Step 5: Commit**

```powershell
git add admin.html
git commit -m "feat: add EN tab with Generate button to admin location editor"
```

---

## Task 7: Spot Page — Bilingual Rendering

**Files:**
- Modify: `locations/spot/index.html`

- [ ] **Step 1: Add lang helpers and EN constants after line 149 (after the `escHtml`/`renderText` functions)**

Add after the `renderText` function:

```js
function getLang() { return localStorage.getItem('lang') || 'he'; }

const REGION_MAP_EN = {
  'ישראל': 'Israel', 'איטליה': 'Italy', 'יוון': 'Greece', 'צרפת': 'France',
  'ספרד': 'Spain', 'פורטוגל': 'Portugal', 'גרמניה': 'Germany',
  'הולנד': 'Netherlands', 'אנגליה': 'England', 'יפן': 'Japan',
  'ארה"ב': 'USA', 'קנדה': 'Canada', 'מרוקו': 'Morocco', 'טורקיה': 'Turkey',
  'קרואטיה': 'Croatia', 'צ\'כיה': 'Czech Republic', 'אוסטריה': 'Austria'
};

const GUIDE_LABELS_EN = {
  '/camera/filters/': 'Filters',
  '/camera/composition/': 'Composition',
  '/camera/exposure/': 'Exposure',
  '/camera/depth-of-field/': 'Depth of Field',
  '/camera/white-balance/': 'White Balance',
  '/camera/histogram/': 'Histogram',
  '/camera/light/': 'Light & Color',
  '/camera/dynamic-range/': 'Dynamic Range',
  '/camera/controls/': 'Camera Controls',
  '/camera/lenses/': 'Lenses',
  '/camera/types/': 'Camera Types'
};
```

- [ ] **Step 2: Modify `renderSeasons` to accept a `lang` parameter**

Replace the entire `renderSeasons` function with:

```js
function renderSeasons(wt, lang) {
  if (!wt) return '';
  const isEn = lang === 'en';
  const SEASONS = [
    { key: 'summer', label: isEn ? 'Summer' : 'קיץ',  emoji: '☀️' },
    { key: 'fall',   label: isEn ? 'Autumn' : 'סתיו', emoji: '🍂' },
    { key: 'winter', label: isEn ? 'Winter' : 'חורף', emoji: '❄️' },
    { key: 'spring', label: isEn ? 'Spring' : 'אביב', emoji: '🌸' }
  ];
  const heading = isEn ? 'When to Visit' : 'מתי לבוא';
  const cards = SEASONS.map(s => {
    const d = wt[s.key] || {};
    const cls = d.rating === 'good' ? 'good' : d.rating === 'bad' ? 'bad' : 'ok';
    return `<div class="season-card ${cls}">
      <div class="s-emoji">${s.emoji}</div>
      <div class="s-name">${s.label}</div>
      <div class="s-note">${escHtml(d.note || '')}</div>
    </div>`;
  }).join('');
  return `<div class="section"><h2>${heading}</h2><div class="seasons-grid">${cards}</div></div>`;
}
```

- [ ] **Step 3: Modify `renderGear` to accept a `lang` parameter**

Replace the entire `renderGear` function with:

```js
function renderGear(gear, lang) {
  if (!gear || !gear.length) return '';
  const heading = lang === 'en' ? 'Recommended Gear' : 'ציוד מומלץ';
  const chips = gear.map(g => {
    const cls = g.primary ? 'gear-chip primary' : 'gear-chip';
    return `<span class="${cls}">${escHtml(g.name)}</span>`;
  }).join('');
  return `<div class="section"><h2>${heading}</h2><div class="gear-chips">${chips}</div></div>`;
}
```

- [ ] **Step 4: Modify `loadSpot` to apply direction and re-render on lang change**

Replace the existing `loadSpot` function with:

```js
async function loadSpot() {
  const lang = getLang();
  const isEn = lang === 'en';
  document.documentElement.dir = isEn ? 'ltr' : 'rtl';
  document.documentElement.lang = lang;
  if (isEn) document.body.style.fontFamily = "'Inter', system-ui, sans-serif";
  else document.body.style.fontFamily = '';

  const backLink = document.querySelector('.back-link');
  if (backLink) backLink.textContent = isEn ? '← Back to Locations' : '← חזרה למקומות';
  const corrBtn = document.getElementById('btn-open-correction');
  if (corrBtn) corrBtn.textContent = isEn ? 'Have a tip or correction? Let me know' : 'יש לך טיפ או תיקון? שלח לי';

  try {
    const res = await fetch(`/api/locations/${slug}`);
    if (!res.ok) { location.href = '/locations/'; return; }
    const loc = await res.json();
    renderSpot(loc, lang);
    const coverUrl = (loc.photos && loc.photos.length) ? (loc.photos[0].url || '') : '';
    setLocationMeta(loc, coverUrl);
    setJsonLd(loc);
    loadNextLocation(slug, loc.region);
  } catch {
    document.getElementById('hero-content').innerHTML = '<p style="color:#888">שגיאה בטעינה.</p>';
  }
}

window.addEventListener('storage', (e) => {
  if (e.key === 'lang') loadSpot();
});
```

- [ ] **Step 5: Modify `renderSpot` to use lang-aware content**

Replace the entire `renderSpot` function with:

```js
function renderSpot(loc, lang) {
  const isEn = lang === 'en';

  function t(field) {
    const enVal = loc[field + '_en'];
    return (isEn && enVal) ? enVal : (loc[field] || '');
  }

  const title = t('title');
  const region = isEn ? (REGION_MAP_EN[loc.region] || loc.region || '') : (loc.region || '');
  const description = t('description');
  const best_time = t('best_time');
  const equipment = t('equipment');
  const my_tip = t('my_tip');
  const wt = (isEn && loc.when_to_visit_en) ? loc.when_to_visit_en : loc.when_to_visit;
  const gear = (isEn && loc.recommended_gear_en) ? loc.recommended_gear_en : loc.recommended_gear;
  const guideLabels = isEn ? GUIDE_LABELS_EN : GUIDE_LABELS;

  document.getElementById('hero-content').innerHTML = `
    <div class="badge">📍 ${escHtml(region || (isEn ? 'Photography Spot' : 'מקום צילום'))}</div>
    <h1>${escHtml(title)}</h1>
    <div class="region-time">${escHtml(region)}${best_time ? ' · ' + escHtml(best_time) : ''}</div>
    ${isEn && !loc.title_en ? '<div style="font-size:.75rem;color:#888;margin-top:.5rem;padding:.3rem .75rem;background:#1a1a1a;border-radius:4px;display:inline-block">🔜 English translation coming soon</div>' : ''}
  `;
  document.getElementById('share-row').style.display = 'flex';

  if (loc.coordinates) {
    const parts = loc.coordinates.split(',').map(s => s.trim());
    const [lat, lng] = parts;
    document.getElementById('map-section').innerHTML = `
      <div class="map-wrap">
        <iframe src="https://maps.google.com/maps?q=${encodeURIComponent(lat)},${encodeURIComponent(lng)}&z=14&output=embed" loading="lazy" allowfullscreen></iframe>
      </div>
    `;
    if (parts.length === 2) {
      document.getElementById('waze-link').href = `https://waze.com/ul?ll=${parts[0]},${parts[1]}&navigate=yes`;
      document.getElementById('waze-wrap').style.display = 'block';
      loadSunTimes(lat, lng);
      loadWeather(lat, lng);
    }
  }

  const specLabel = isEn ? 'Photography Specs' : 'מפרט צילום';
  const bestTimeLabel = isEn ? 'Best time:' : 'זמן מומלץ:';
  const equipLabel = isEn ? 'Equipment:' : 'ציוד:';
  const navLabel = isEn ? 'Navigate:' : 'ניווט:';
  const googleMapsLabel = isEn ? 'Open in Google Maps' : 'פתח במפות Google';
  const tipLabel = isEn ? 'My Tip' : 'הטיפ שלי';
  const extraLabel = isEn ? 'More Info' : 'מידע נוסף';
  const guidesLabel = isEn ? 'Related Guides' : 'מדריכים קשורים';
  const galleryLabel = isEn ? 'Gallery' : 'גלריה מהמקום';

  document.getElementById('details-section').innerHTML = `
    ${description ? `<div class="section"><p style="line-height:1.8;font-size:.95rem">${renderText(description)}</p></div>` : ''}
    ${renderSeasons(wt, lang)}
    ${renderGear(gear, lang)}
    ${my_tip ? `<div class="section"><h2>${tipLabel}</h2><div class="tip-box">${renderText(my_tip)}</div></div>` : ''}
    ${loc.extra_links && loc.extra_links.length ? `<div class="section"><h2>${extraLabel}</h2><ul class="specs-list">${loc.extra_links.map(lnk=>`<li><a href="${escHtml(lnk.url)}" target="_blank" rel="noopener" style="color:var(--accent)">${escHtml(lnk.label)}</a></li>`).join('')}</ul></div>` : ''}
    <div class="section">
      <h2>${specLabel}</h2>
      <ul class="specs-list">
        ${best_time ? `<li><strong>${bestTimeLabel}</strong> ${best_time}</li>` : ''}
        ${equipment ? `<li><strong>${equipLabel}</strong> ${equipment}</li>` : ''}
        ${loc.coordinates ? `<li><strong>${navLabel}</strong> <a href="https://www.google.com/maps/search/?api=1&query=${loc.coordinates}" target="_blank" style="color:var(--accent)">${googleMapsLabel}</a></li>` : ''}
      </ul>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:1rem;margin:1rem 0">
        <div id="sun-widget" style="display:none;background:#111;border:1px solid #222;border-radius:8px;padding:1rem 1.25rem">
          <div style="font-size:.75rem;color:#666;margin-bottom:.6rem;font-family:'Heebo',sans-serif">${isEn ? "Today's shooting times" : 'זמני צילום היום'}</div>
          <div style="display:flex;gap:1.5rem;flex-wrap:wrap">
            <div><span style="font-size:1.1rem">🌅</span><span style="font-size:.85rem;color:#c8a96e;font-weight:700" id="sun-rise">--:--</span><div style="font-size:.7rem;color:#666">${isEn ? 'Sunrise' : 'זריחה'}</div></div>
            <div><span style="font-size:1.1rem">🌇</span><span style="font-size:.85rem;color:#c8a96e;font-weight:700" id="sun-set">--:--</span><div style="font-size:.7rem;color:#666">${isEn ? 'Sunset' : 'שקיעה'}</div></div>
            <div><span style="font-size:1.1rem">✨</span><span style="font-size:.85rem;color:#c8a96e;font-weight:700" id="golden-hour">--:--</span><div style="font-size:.7rem;color:#666">${isEn ? 'Golden Hour' : 'שעת זהב'}</div></div>
          </div>
        </div>
        <div id="weather-widget" style="display:none;background:#111;border:1px solid #222;border-radius:8px;padding:1rem 1.25rem">
          <div style="font-size:.75rem;color:#666;margin-bottom:.6rem;font-family:'Heebo',sans-serif">${isEn ? 'Current weather' : 'מזג אוויר עכשווי'}</div>
          <div style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap">
            <div style="font-size:2rem" id="weather-icon">—</div>
            <div><div style="font-size:1.4rem;font-weight:700;color:#f0ede8" id="weather-temp">--°</div><div style="font-size:.75rem;color:#888" id="weather-desc">--</div></div>
            <div style="font-size:.8rem;color:#666" id="weather-wind"></div>
          </div>
        </div>
      </div>
    </div>
    ${loc.related_guides && loc.related_guides.length ? `
    <div class="section">
      <h2>${guidesLabel}</h2>
      <div class="guides-row">
        ${loc.related_guides.map(g => `<a class="guide-chip" href="${g}">${guideLabels[g] || g}</a>`).join('')}
      </div>
    </div>` : ''}
  `;

  if (loc.photos && loc.photos.length) {
    const toGalleryLabel = isEn ? 'Gallery' : 'לגלריה';
    const buyLabel = isEn ? 'Buy' : 'לרכישה';
    document.getElementById('gallery-section').innerHTML = `
      <div class="section">
        <h2>${galleryLabel}</h2>
        <div class="gallery-grid">
          ${loc.photos.map((p, i) => `
            <div class="gallery-item">
              <div class="photo-wrap">
                <img src="${imgSrc(p.thumbnail || p.url, 400)}" alt="${escHtml(title)} — photo ${i+1}" loading="lazy">
              </div>
              <div class="photo-btns">
                ${p.photo_id ? `<a class="btn-gallery" href="/?photo=${escHtml(p.photo_id)}" target="_blank">${toGalleryLabel}</a>` : ''}
                ${p.for_sale && p.photo_id ? `<a class="btn-sale" href="/?photo=${escHtml(p.photo_id)}" target="_blank">${buyLabel}</a>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }
  document.getElementById('nearby-section').innerHTML = renderNearby(loc.nearby, lang);
}
```

- [ ] **Step 6: Modify `renderNearby` to accept `lang`**

Replace `renderNearby`:

```js
function renderNearby(nearby, lang) {
  if (!nearby || !nearby.length) return '';
  const heading = lang === 'en' ? 'Nearby Spots' : 'מקומות קרובים';
  const kmLabel = lang === 'en' ? 'km →' : 'ק"מ →';
  const items = nearby.map(n =>
    `<a class="nearby-item" href="/locations/spot/?slug=${encodeURIComponent(n.id)}">
      <span class="nearby-name">${escHtml(n.title)}</span>
      <span class="nearby-dist">${n.km} ${kmLabel}</span>
    </a>`
  ).join('');
  return `<div class="section"><h2>${heading}</h2><div class="nearby-list">${items}</div></div>`;
}
```

- [ ] **Step 7: Update `loadNextLocation` to use correct lang title**

Find `loadNextLocation` and update the text assignment to use `title_en` when available:

```js
async function loadNextLocation(currentSlug, currentRegion) {
  try {
    const res = await fetch('/api/locations');
    const all = await res.json();
    const sameRegion = (Array.isArray(all) ? all : all.locations || [])
      .filter(l => l.region === currentRegion && l.id !== currentSlug);
    if (!sameRegion.length) return;
    const next = sameRegion[0];
    const lang = getLang();
    const nextTitle = (lang === 'en' && next.title_en) ? next.title_en : next.title;
    document.getElementById('next-loc-title').textContent = nextTitle;
    document.getElementById('next-loc-link').href = '/locations/spot/?slug=' + encodeURIComponent(next.id);
    document.getElementById('next-loc-nav').style.display = 'block';
  } catch(e) {}
}
```

Note: `handleLocationsList` needs to return `title_en` for this to work — add it in Task 8 Step 1.

- [ ] **Step 8: Deploy and verify**

```powershell
npx wrangler deploy
```

Open `https://www.amitphotos.com/locations/spot/?slug=roma`:
- With HE: Hebrew content, RTL
- Switch to EN in nav: page reloads in LTR English (initially shows "coming soon" badge since no EN content yet)
- Generate English via admin (Task 6), then refresh — page shows English content

- [ ] **Step 9: Commit**

```powershell
git add locations/spot/index.html
git commit -m "feat: bilingual rendering on spot page — EN/HE via localStorage lang"
```

---

## Task 8: Locations Index — Bilingual Cards

**Files:**
- Modify: `locations/index.html`
- Modify: `worker.js` — `handleLocationsList` (line ~3205)

- [ ] **Step 1: Include `title_en` in the public locations list**

Find `handleLocationsList` (around line 3209):
```js
    FROM locations l
    LEFT JOIN location_photos lp ON lp.location_id = l.id
```

Find the SELECT columns and add `l.title_en`:
```js
    SELECT l.id, l.title, l.title_en, l.region, l.published, l.coordinates, l.best_time,
```

(Check the exact SELECT columns in that function and add `l.title_en` to the list.)

- [ ] **Step 2: Add lang helper, REGION_MAP, and LABELS to `locations/index.html` script**

After `function escHtml(s) {...}` (line ~124 of the script section), add:

```js
function getLang() { return localStorage.getItem('lang') || 'he'; }

const REGION_MAP_EN = {
  'ישראל': 'Israel', 'איטליה': 'Italy', 'יוון': 'Greece', 'צרפת': 'France',
  'ספרד': 'Spain', 'פורטוגל': 'Portugal', 'גרמניה': 'Germany',
  'הולנד': 'Netherlands', 'אנגליה': 'England', 'יפן': 'Japan'
};

const LABELS = {
  he: {
    badge: '📍 מקומות לצילום',
    title: 'מקומות לצילום',
    subtitle: 'מקומות מומלצים לצילום — טיפים, ציוד, שעות מומלצות וגלריה מכל מקום.',
    suggest: 'הצע מקום +',
    empty: 'אין מקומות עדיין.',
    photos: (n) => `${n} תמונות`,
  },
  en: {
    badge: '📍 Photography Locations',
    title: 'Photography Locations',
    subtitle: 'Recommended photography spots — tips, gear, best times, and a gallery from each location.',
    suggest: 'Suggest a Spot +',
    empty: 'No locations yet.',
    photos: (n) => `${n} photos`,
  }
};

function applyLang() {
  const lang = getLang();
  const L = LABELS[lang] || LABELS.he;
  const isEn = lang === 'en';
  document.documentElement.dir = isEn ? 'ltr' : 'rtl';
  document.documentElement.lang = lang;
  const badge = document.querySelector('.badge');
  if (badge) badge.textContent = L.badge;
  const h1 = document.querySelector('.page-hero h1');
  if (h1) h1.textContent = L.title;
  const sub = document.querySelector('.page-hero p');
  if (sub) sub.textContent = L.subtitle;
  const suggestBtn = document.getElementById('btn-open-suggest');
  if (suggestBtn) suggestBtn.textContent = L.suggest;
  renderGrid();
}

window.addEventListener('storage', (e) => {
  if (e.key === 'lang') applyLang();
});
```

- [ ] **Step 3: Update `renderGrid` to use lang-aware title/region**

In `renderGrid`, replace the card template:

```js
  const lang = getLang();
  const isEn = lang === 'en';
  const L = LABELS[lang] || LABELS.he;

  grid.innerHTML = sorted.map(l => {
    const displayTitle = (isEn && l.title_en) ? l.title_en : l.title;
    const displayRegion = isEn ? (REGION_MAP_EN[l.region] || l.region || '') : (l.region || '');
    const photoCount = l.photo_count > 0 ? `<span style="font-size:.68rem;background:#1a1a1a;border:1px solid #333;border-radius:10px;padding:1px 7px;color:#888">${L.photos(l.photo_count)}</span>` : '';
    return `
    <a class="card" href="/locations/spot/?slug=${escHtml(l.id)}">
      <img class="card-img" src="${escHtml(l.cover_thumb || l.cover_url || '')}" alt="${escHtml(displayTitle)}" loading="lazy" onerror="this.style.display='none'">
      <div class="card-body">
        <div class="card-title">${escHtml(displayTitle)}</div>
        <div class="card-meta" style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap">
          <span>${escHtml(displayRegion)}</span>
          ${photoCount}
        </div>
        ${l.best_time ? `<div style="font-size:.72rem;color:#888;margin-top:.3rem;display:flex;align-items:center;gap:.25rem"><span style="color:#c8a96e">◷</span><span>${escHtml(l.best_time)}</span></div>` : ''}
      </div>
    </a>`;
  }).join('');
```

- [ ] **Step 4: Call `applyLang()` on initial load instead of `renderGrid()`**

Find `loadLocations()` function, and change the end of it from:
```js
    allLocations = await res.json();
    renderGrid();
```
to:
```js
    allLocations = await res.json();
    applyLang();
```

- [ ] **Step 5: Deploy and verify**

```powershell
npx wrangler deploy
```

Open `https://www.amitphotos.com/locations/`:
- Switch to EN in nav: title, subtitle, suggest button all switch to English
- Cards show English titles for translated locations (after admin generates them)

- [ ] **Step 6: Commit**

```powershell
git add locations/index.html worker.js
git commit -m "feat: bilingual rendering on locations index page"
git push
```

---

## Task 9: Generate English for All Existing Locations

This is an operational task — no code changes needed.

- [ ] **Step 1: Open admin at `https://www.amitphotos.com/admin.html`**

- [ ] **Step 2: For each published location:**
  1. Click "עריכה"
  2. Click "English" tab
  3. Click "✨ Generate English"
  4. Wait ~5 seconds for content to populate
  5. Review the generated content (edit if needed)
  6. Click "שמור"
  7. Verify green "EN" badge appears on the list

- [ ] **Step 3: Verify spot pages in English**

For each location, open `/locations/spot/?slug=[slug]` with nav set to EN and confirm English content renders correctly.

---

## Self-Review

**Spec coverage check:**
- ✅ D1 migration with 7 EN columns (Task 1)
- ✅ Public GET returns EN fields (Task 2)
- ✅ Admin PUT accepts EN fields (Task 3)
- ✅ Generate-EN worker endpoint (Task 4)
- ✅ Admin EN badge on list (Task 5)
- ✅ Admin EN tab + Generate button + save (Task 6)
- ✅ Spot page bilingual with lang switch + fallback badge (Task 7)
- ✅ Locations index bilingual cards (Task 8)
- ✅ REGION_MAP client-side (Tasks 7 & 8)

**Type consistency check:**
- `handleAdminLocationsGenerateEn` returns `when_to_visit_en` as a JSON string → admin stores it as string → `handleLocationsGet` parses it to object → `renderSpot` uses it as object ✅
- `recommended_gear_en` follows same pattern ✅
- Tab IDs: `tab-he`, `tab-en`, `loc-he-fields`, `loc-en-fields` consistent across renderEditor and bindEditorEvents ✅
- Field IDs: `loc-title-en`, `loc-description-en`, `loc-best-time-en`, `loc-equipment-en`, `loc-tip-en`, `loc-when-to-visit-en`, `loc-recommended-gear-en` consistent across renderEditor HTML and save body ✅

**One note on Task 8 Step 1:** Before editing `handleLocationsList`, check the exact SELECT statement at line ~3209 to add `l.title_en` to the right place in the column list.
