# Admin Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three admin features: (1) revenue stats by size + 30-day chart, (2) bulk category-change and bulk price-set, (3) manual sort_order for gallery ordering with drag & drop.

**Architecture:** All changes are in `worker.js` (Cloudflare Worker backend) and `admin.html` (single-file admin SPA). Gallery ordering also touches `assets/js/gallery.js`. No new files are created — all additions are in-place edits. D1 migration adds one column.

**Tech Stack:** Cloudflare D1 (SQLite), Cloudflare Worker (JS), Vanilla JS, HTML5 Drag & Drop API, inline SVG for chart.

---

## File Map

| File | Change |
|------|--------|
| `worker.js` | Add `revenue_by_size` + `daily_revenue_30d` to stats query; add `POST /api/photos/reorder`; update GET order query |
| `admin.html` | Expand stats section; add bulk-category/price buttons + handlers; add drag handles + drag logic |
| `assets/js/gallery.js` | Sort photos by `sort_order ASC NULLS LAST` in `loadPhotos` |

---

## Task 1: D1 Migration — Add sort_order Column

**Files:**
- Modify: `worker.js` (GET /api/photos query, lines 271–273)

- [ ] **Step 1: Run migration on remote D1**

```bash
npx wrangler d1 execute DB --remote --command="ALTER TABLE photos ADD COLUMN sort_order INTEGER"
```

Expected: `✅ Success` (no output on success). If column already exists you'll get an error — that's fine, skip.

- [ ] **Step 2: Update GET /api/photos to order by sort_order**

In `worker.js`, find lines 271–273:
```js
const sql = adminAll
  ? 'SELECT * FROM photos ORDER BY created_at DESC'
  : 'SELECT * FROM photos WHERE published=1 ORDER BY created_at DESC';
```

Replace with:
```js
const sql = adminAll
  ? 'SELECT * FROM photos ORDER BY CASE WHEN sort_order IS NULL THEN 1 ELSE 0 END, sort_order ASC, created_at DESC'
  : 'SELECT * FROM photos WHERE published=1 ORDER BY CASE WHEN sort_order IS NULL THEN 1 ELSE 0 END, sort_order ASC, created_at DESC';
```

- [ ] **Step 3: Verify in browser**

Open `https://amitphotos.com/api/photos` — confirm photos still load (JSON array). Photos without sort_order should appear last.

- [ ] **Step 4: Commit**

```bash
git add worker.js
git commit -m "feat: add sort_order column to photos, order by sort_order"
```

---

## Task 2: Worker API — Reorder Endpoint

**Files:**
- Modify: `worker.js` — add function `handlePhotosReorder` and route

- [ ] **Step 1: Add handler function**

Find the line `async function handleAdminPhotoPrice` (~line 1586) and add this function BEFORE it:

```js
async function handlePhotosReorder(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  const orders = await request.json().catch(() => null);
  if (!Array.isArray(orders)) return jsonRes({ error: 'expected array [{id, sort_order}]' }, 400, request);
  for (const { id, sort_order } of orders) {
    await env.DB.prepare('UPDATE photos SET sort_order=? WHERE id=?').bind(sort_order, id).run();
  }
  return jsonRes({ ok: true, updated: orders.length }, 200, request);
}
```

- [ ] **Step 2: Add route**

Find the router section (~line 1711):
```js
if (path === '/api/admin/photo-price' && request.method === 'POST') return handleAdminPhotoPrice(request, env);
```

Add immediately after:
```js
if (path === '/api/photos/reorder' && request.method === 'POST') return handlePhotosReorder(request, env);
```

- [ ] **Step 3: Deploy and verify**

```bash
npx wrangler deploy
```

Test with curl:
```bash
curl -X POST https://amitphotos.com/api/photos/reorder \
  -H "Content-Type: application/json" \
  -H "x-admin-password: YOUR_PASS" \
  -d '[{"id":"test-id","sort_order":1}]'
```

Expected: `{"ok":true,"updated":1}`

- [ ] **Step 4: Commit**

```bash
git add worker.js
git commit -m "feat: add POST /api/photos/reorder endpoint"
```

---

## Task 3: Stats — Revenue by Size + 30-Day Chart

**Files:**
- Modify: `worker.js` — `handleAdminPurchases` stats query (~line 1634)
- Modify: `admin.html` — stats section (~lines 809–823) + JS in `loadPurchases` (~line 2469)

### 3a: Backend — add revenue_by_size and daily_revenue_30d

- [ ] **Step 1: Extend stats query in worker.js**

Find in `handleAdminPurchases` (~line 1634):
```js
const stats = await env.DB.prepare(`
    SELECT
      COALESCE(SUM(amount), 0) as total_revenue,
      COUNT(*) as total_purchases,
      SUM(CASE WHEN created_at >= ${now - 30*86400} THEN 1 ELSE 0 END) as this_month
    FROM download_tokens
  `).first();
```

Replace with:
```js
const stats = await env.DB.prepare(`
    SELECT
      COALESCE(SUM(amount), 0) as total_revenue,
      COUNT(*) as total_purchases,
      SUM(CASE WHEN created_at >= ${now - 30*86400} THEN 1 ELSE 0 END) as this_month,
      COALESCE(SUM(CASE WHEN size='small' THEN amount ELSE 0 END), 0) as rev_small,
      COALESCE(SUM(CASE WHEN size='medium' THEN amount ELSE 0 END), 0) as rev_medium,
      COALESCE(SUM(CASE WHEN size='large' THEN amount ELSE 0 END), 0) as rev_large
    FROM download_tokens
  `).first();
```

- [ ] **Step 2: Add daily breakdown query**

After the `topPhotos` query (~line 1650), add:

```js
const dailyRev = await env.DB.prepare(`
    SELECT
      strftime('%Y-%m-%d', datetime(created_at, 'unixepoch')) as day,
      COALESCE(SUM(amount), 0) as revenue
    FROM download_tokens
    WHERE created_at >= ${now - 30*86400}
    GROUP BY day
    ORDER BY day ASC
  `).all();
```

- [ ] **Step 3: Include in response**

Find the return statement (~line 1652):
```js
return jsonRes({
    tokens: rows.results,
    stats: { ...stats, top_photos: topPhotos.results }
  }, 200, request);
```

Replace with:
```js
return jsonRes({
    tokens: rows.results,
    stats: { ...stats, top_photos: topPhotos.results, daily_revenue: dailyRev.results }
  }, 200, request);
```

- [ ] **Step 4: Deploy**

```bash
npx wrangler deploy
```

Verify: `GET https://amitphotos.com/api/admin/purchases?filter=all` (with auth header) returns `stats.rev_small`, `stats.rev_medium`, `stats.rev_large`, `stats.daily_revenue`.

### 3b: Admin UI — stats display + chart

- [ ] **Step 5: Replace stats section HTML**

Find the stats-grid div in `admin.html` (~lines 810–823):
```html
      <!-- Stats -->
      <div class="stats-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;margin-bottom:1.5rem">
        <div class="stat-card" style="background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:1.25rem;text-align:center">
          <div class="stat-val" id="pur-total-revenue" style="font-size:1.75rem;font-weight:700;color:var(--accent)">—</div>
          <div style="color:var(--text-muted);font-size:.8rem;margin-top:.25rem">סה"כ הכנסות</div>
        </div>
        <div class="stat-card" style="background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:1.25rem;text-align:center">
          <div class="stat-val" id="pur-this-month" style="font-size:1.75rem;font-weight:700;color:var(--accent)">—</div>
          <div style="color:var(--text-muted);font-size:.8rem;margin-top:.25rem">30 ימים אחרונים</div>
        </div>
        <div class="stat-card" style="background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:1.25rem;text-align:center">
          <div id="pur-top-photos" style="font-size:.85rem;color:var(--text-muted);line-height:1.8">—</div>
          <div style="color:var(--text-muted);font-size:.8rem;margin-top:.25rem">פופולריות</div>
        </div>
      </div>
```

Replace with:
```html
      <!-- Stats -->
      <div class="stats-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;margin-bottom:1.5rem">
        <div class="stat-card" style="background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:1.25rem;text-align:center">
          <div class="stat-val" id="pur-total-revenue" style="font-size:1.75rem;font-weight:700;color:var(--accent)">—</div>
          <div style="color:var(--text-muted);font-size:.8rem;margin-top:.25rem">סה"כ הכנסות</div>
          <div id="pur-rev-by-size" style="margin-top:.6rem;font-size:.75rem;color:var(--text-muted);line-height:1.7"></div>
        </div>
        <div class="stat-card" style="background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:1.25rem;text-align:center">
          <div class="stat-val" id="pur-this-month" style="font-size:1.75rem;font-weight:700;color:var(--accent)">—</div>
          <div style="color:var(--text-muted);font-size:.8rem;margin-top:.25rem">30 ימים אחרונים — מכירות</div>
        </div>
        <div class="stat-card" style="background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:1.25rem;text-align:center">
          <div id="pur-top-photos" style="font-size:.85rem;color:var(--text-muted);line-height:1.8">—</div>
          <div style="color:var(--text-muted);font-size:.8rem;margin-top:.25rem">פופולריות</div>
        </div>
      </div>

      <!-- 30-day revenue chart -->
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:1rem;margin-bottom:1.5rem">
        <div style="font-size:.8rem;color:var(--text-muted);margin-bottom:.5rem">הכנסות — 30 ימים אחרונים</div>
        <div id="pur-chart" style="height:80px;display:flex;align-items:flex-end;gap:2px;overflow:hidden"></div>
      </div>
```

- [ ] **Step 6: Update JS in loadPurchases to render new stats**

Find in admin.html JS (~line 2474):
```js
    $('pur-total-revenue').textContent = `₪${Math.round(data.stats.total_revenue || 0)}`;
    $('pur-this-month').textContent = data.stats.this_month || 0;
    $('pur-top-photos').innerHTML = (data.stats.top_photos || [])
      .map(p => `${p.title} (${p.cnt})`).join('<br>') || '—';
```

Replace with:
```js
    const s = data.stats;
    $('pur-total-revenue').textContent = `₪${Math.round(s.total_revenue || 0)}`;
    $('pur-rev-by-size').innerHTML = [
      `רשת: ₪${Math.round(s.rev_small||0)}`,
      `הדפסה: ₪${Math.round(s.rev_medium||0)}`,
      `מלא: ₪${Math.round(s.rev_large||0)}`
    ].join('<br>');
    $('pur-this-month').textContent = s.this_month || 0;
    $('pur-top-photos').innerHTML = (s.top_photos || [])
      .map(p => `${p.title} (${p.cnt})`).join('<br>') || '—';

    // 30-day bar chart
    const daily = s.daily_revenue || [];
    const maxRev = Math.max(...daily.map(d => d.revenue), 1);
    $('pur-chart').innerHTML = daily.length
      ? daily.map(d => {
          const pct = Math.round((d.revenue / maxRev) * 100);
          const label = d.day.slice(5); // MM-DD
          return `<div title="${label}: ₪${Math.round(d.revenue)}" style="flex:1;min-width:4px;background:var(--accent);opacity:.7;height:${pct}%;border-radius:2px 2px 0 0"></div>`;
        }).join('')
      : '<div style="color:var(--text-muted);font-size:.8rem;padding:.5rem">אין נתונים</div>';
```

- [ ] **Step 7: Verify in browser**

Open Admin → רכישות tab. Confirm:
- Total revenue shows with breakdown by size below it
- 30-day chart renders as bars
- Count of last 30 days still shows

- [ ] **Step 8: Commit**

```bash
git add worker.js admin.html
git commit -m "feat: revenue by size breakdown and 30-day chart in purchases stats"
```

---

## Task 4: Bulk Operations — Category Change + Price Set

**Files:**
- Modify: `admin.html` — bulk-bar HTML (~line 682) + JS handlers (~line 1747)

### 4a: HTML — add buttons to bulk-bar

- [ ] **Step 1: Add buttons to bulk-bar**

Find (~line 682–686):
```html
      <div class="bulk-bar" id="bulk-bar">
        <span class="bulk-count" id="bulk-count">0 נבחרו</span>
        <button class="btn btn-danger btn-sm" id="bulk-delete-btn">מחק נבחרים</button>
        <button class="btn btn-ghost btn-sm" id="bulk-cancel-btn">ביטול</button>
      </div>
```

Replace with:
```html
      <div class="bulk-bar" id="bulk-bar">
        <span class="bulk-count" id="bulk-count">0 נבחרו</span>
        <button class="btn btn-sm" style="background:var(--accent-dim);color:var(--accent);border:1px solid var(--accent)" id="bulk-cat-btn">קטגוריה</button>
        <button class="btn btn-sm" style="background:var(--accent-dim);color:var(--accent);border:1px solid var(--accent)" id="bulk-price-btn">מחיר</button>
        <button class="btn btn-danger btn-sm" id="bulk-delete-btn">מחק</button>
        <button class="btn btn-ghost btn-sm" id="bulk-cancel-btn">ביטול</button>
      </div>

      <!-- Bulk category panel -->
      <div id="bulk-cat-panel" style="display:none;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:.75rem;margin-bottom:.75rem;display:none;align-items:center;gap:.75rem">
        <select id="bulk-cat-select" class="input-sm">
          <option value="">-- בחר קטגוריה --</option>
          <option value="טבע">טבע</option>
          <option value="פורטרט">פורטרט</option>
          <option value="עירוני">עירוני</option>
          <option value="אירועים">אירועים</option>
        </select>
        <button class="btn btn-accent btn-sm" id="bulk-cat-save">שמור</button>
        <button class="btn btn-ghost btn-sm" id="bulk-cat-cancel">ביטול</button>
      </div>

      <!-- Bulk price panel -->
      <div id="bulk-price-panel" style="display:none;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:.75rem;margin-bottom:.75rem">
        <div style="display:flex;gap:.75rem;align-items:center;flex-wrap:wrap">
          <label style="font-size:.8rem;color:var(--text-muted)">רשת ₪<input id="bulk-p-small" type="number" class="input-sm" style="width:60px;margin-right:.25rem" min="0"></label>
          <label style="font-size:.8rem;color:var(--text-muted)">הדפסה ₪<input id="bulk-p-medium" type="number" class="input-sm" style="width:60px;margin-right:.25rem" min="0"></label>
          <label style="font-size:.8rem;color:var(--text-muted)">מלא ₪<input id="bulk-p-large" type="number" class="input-sm" style="width:60px;margin-right:.25rem" min="0"></label>
          <button class="btn btn-accent btn-sm" id="bulk-price-save">שמור</button>
          <button class="btn btn-ghost btn-sm" id="bulk-price-cancel">ביטול</button>
          <button class="btn btn-ghost btn-sm" id="bulk-price-reset" style="color:var(--text-muted)">אפס מחירים</button>
        </div>
      </div>
```

### 4b: JS — handlers

- [ ] **Step 2: Add JS handlers after the bulk-delete handler (~line 1760)**

Find the end of the bulk-delete handler:
```js
    toast(`נמחקו ${count} תמונות`);
  });
```

Add after:
```js
  // Bulk category
  $('bulk-cat-btn').addEventListener('click', () => {
    $('bulk-cat-panel').style.display = 'flex';
    $('bulk-price-panel').style.display = 'none';
  });
  $('bulk-cat-cancel').addEventListener('click', () => { $('bulk-cat-panel').style.display = 'none'; });
  $('bulk-cat-save').addEventListener('click', async () => {
    const cat = $('bulk-cat-select').value;
    if (!cat) return toast('בחר קטגוריה');
    const ids = [...selected];
    for (const id of ids) {
      const photo = data.find(p => p.id === id);
      await fetch('/api/photos', {
        method: 'PATCH',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, category: cat, title: photo?.title || '', description: photo?.description || '' })
      });
      const idx = data.findIndex(p => p.id === id);
      if (idx >= 0) data[idx] = { ...data[idx], category: cat };
    }
    $('bulk-cat-panel').style.display = 'none';
    selected.clear(); selectMode = false;
    $('select-mode-btn').textContent = 'בחר';
    $('bulk-bar').classList.remove('show');
    renderGrid();
    toast(`עודכנה קטגוריה ל-${ids.length} תמונות`);
  });

  // Bulk price
  $('bulk-price-btn').addEventListener('click', () => {
    $('bulk-price-panel').style.display = 'block';
    $('bulk-cat-panel').style.display = 'none';
  });
  $('bulk-price-cancel').addEventListener('click', () => { $('bulk-price-panel').style.display = 'none'; });
  $('bulk-price-reset').addEventListener('click', async () => {
    if (!confirm(`לאפס מחירי override ל-${selected.size} תמונות?`)) return;
    for (const id of [...selected]) {
      await fetch('/api/admin/photo-price', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ photo_id: id, price_override: null })
      });
      const idx = data.findIndex(p => p.id === id);
      if (idx >= 0) data[idx] = { ...data[idx], price_overrides: null };
    }
    $('bulk-price-panel').style.display = 'none';
    selected.clear(); selectMode = false;
    $('select-mode-btn').textContent = 'בחר';
    $('bulk-bar').classList.remove('show');
    renderGrid();
    toast('אופסו מחירי override');
  });
  $('bulk-price-save').addEventListener('click', async () => {
    const small  = parseFloat($('bulk-p-small').value);
    const medium = parseFloat($('bulk-p-medium').value);
    const large  = parseFloat($('bulk-p-large').value);
    if ([small, medium, large].some(isNaN)) return toast('מלא את כל המחירים');
    const override = { small, medium, large };
    const ids = [...selected];
    for (const id of ids) {
      await fetch('/api/admin/photo-price', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ photo_id: id, price_override: override })
      });
      const idx = data.findIndex(p => p.id === id);
      if (idx >= 0) data[idx] = { ...data[idx], price_overrides: JSON.stringify(override) };
    }
    $('bulk-price-panel').style.display = 'none';
    selected.clear(); selectMode = false;
    $('select-mode-btn').textContent = 'בחר';
    $('bulk-bar').classList.remove('show');
    renderGrid();
    toast(`עודכן מחיר ל-${ids.length} תמונות`);
  });
```

- [ ] **Step 3: Verify in browser**

Open Admin → תמונות. Click "בחר", select 2-3 photos.
- Click "קטגוריה" — panel opens with dropdown. Select "טבע", click "שמור" → toast appears, cards update.
- Select more photos, click "מחיר" — panel opens with 3 number inputs. Enter prices, click "שמור" → price overrides saved.

- [ ] **Step 4: Commit**

```bash
git add admin.html
git commit -m "feat: bulk category change and bulk price override"
```

---

## Task 5: Manual Sort Order — Drag & Drop in Admin

**Files:**
- Modify: `admin.html` — photo card rendering + drag & drop JS

### 5a: Add sort indicator and drag handle to photo cards

- [ ] **Step 1: Add CSS for drag handle**

Find the `/* ===== BULK =====*/` CSS section (~line 342) and add after it:

```css
/* ===== DRAG & DROP ===== */
.drag-handle{cursor:grab;padding:.2rem .35rem;color:var(--text-muted);font-size:1rem;user-select:none;line-height:1}
.drag-handle:active{cursor:grabbing}
.photo-card.drag-over{outline:2px solid var(--accent);outline-offset:2px}
.photo-card.dragging{opacity:.4}
```

- [ ] **Step 2: Add drag handle to card rendering**

Find in `renderGrid()` (~line 1488, inside the photo card HTML), find the action buttons area:
```js
      <div class="card-actions">
```

Add the drag handle as the first item inside `.photo-actions` (the icon buttons row). First find the exact line that renders action buttons in the card. Look for `card-actions` and add before the first button:

In the card template (inside `renderGrid`), find:
```js
      <div class="card-actions">
```

The card HTML ends around the `cb-wrap` div. Inside the card, find the line with action buttons and add a drag handle span at the start:

```js
<span class="drag-handle" draggable="false" title="גרור לסדר">⠿</span>
```

**Note:** The drag handle must be inside the card div. Find the exact `innerHTML` template string in `renderGrid()` and prepend `<span class="drag-handle">⠿</span>` to the `card-actions` div.

To locate: search for `card-actions` in admin.html, find the one inside the `renderGrid` function (~line 1488), and add the handle as the first child.

- [ ] **Step 3: Make photo cards draggable**

In `renderGrid()`, find where each card div is created. After calling `card.innerHTML = ...`, add:

```js
card.setAttribute('draggable', 'true');
card.dataset.photoId = p.id;
```

### 5b: Drag & drop JS logic

- [ ] **Step 4: Add drag & drop state and event handlers**

Find the line where `let selectMode = false;` is declared (top of the JS section) and add:

```js
let dragSrcId = null;
```

Then add these event handlers after the `renderGrid` function definition (or at the end of the photos section, before `loadPhotos` call):

```js
  const photosGrid = $('photos-grid');

  photosGrid.addEventListener('dragstart', e => {
    const card = e.target.closest('.photo-card');
    if (!card) return;
    dragSrcId = card.dataset.photoId;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  photosGrid.addEventListener('dragend', e => {
    const card = e.target.closest('.photo-card');
    if (card) card.classList.remove('dragging');
    document.querySelectorAll('.photo-card.drag-over').forEach(c => c.classList.remove('drag-over'));
  });

  photosGrid.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const card = e.target.closest('.photo-card');
    document.querySelectorAll('.photo-card.drag-over').forEach(c => c.classList.remove('drag-over'));
    if (card && card.dataset.photoId !== dragSrcId) card.classList.add('drag-over');
  });

  photosGrid.addEventListener('drop', async e => {
    e.preventDefault();
    const targetCard = e.target.closest('.photo-card');
    if (!targetCard || !dragSrcId || targetCard.dataset.photoId === dragSrcId) return;
    targetCard.classList.remove('drag-over');

    const targetId = targetCard.dataset.photoId;
    const srcIdx  = data.findIndex(p => p.id === dragSrcId);
    const tgtIdx  = data.findIndex(p => p.id === targetId);
    if (srcIdx < 0 || tgtIdx < 0) return;

    // reorder in-memory array
    const [moved] = data.splice(srcIdx, 1);
    data.splice(tgtIdx, 0, moved);

    // assign sort_order values 1..n
    const orders = data.map((p, i) => ({ id: p.id, sort_order: i + 1 }));
    data.forEach((p, i) => { p.sort_order = i + 1; });

    renderGrid();

    // persist to server
    const res = await fetch('/api/photos/reorder', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(orders)
    });
    if (!res.ok) {
      toast('שגיאה בשמירת הסדר');
    } else {
      toast('סדר הגלריה עודכן');
    }
  });
```

- [ ] **Step 5: Verify in browser**

Open Admin → תמונות. Drag a photo card to a new position — the card should highlight on hover, and after drop, a toast "סדר הגלריה עודכן" should appear. Refresh the page and confirm photos load in the new order.

- [ ] **Step 6: Commit**

```bash
git add admin.html
git commit -m "feat: drag & drop manual sort order for gallery"
```

---

## Task 6: Public Gallery — Respect sort_order

**Files:**
- Modify: `assets/js/gallery.js` — `loadPhotos` function

- [ ] **Step 1: Update loadPhotos to sort by sort_order**

In `assets/js/gallery.js`, find the `loadPhotos` function (~line 154). Find the line that applies random shuffle:

```js
[...allPhotos].sort(() => Math.random() - 0.5)
```

This is used in `applyFilters`. Find in `applyFilters` (~line 349) the line:

```js
filtered.sort(() => Math.random() - 0.5);
```

Replace with:

```js
// Photos with sort_order come first (ascending), then the rest in random order
const withOrder = filtered.filter(p => p.sort_order != null).sort((a,b) => a.sort_order - b.sort_order);
const withoutOrder = filtered.filter(p => p.sort_order == null).sort(() => Math.random() - 0.5);
filtered = [...withOrder, ...withoutOrder];
```

**Note:** `filtered` must be a `let` (not `const`) for reassignment — check if it is. If it's `const filtered = ...`, change to `let filtered = ...` on the same line.

- [ ] **Step 2: Verify in browser**

Open `https://amitphotos.com` (public gallery). Photos that were reordered in admin should appear first, in the correct order. Unordered photos appear randomly after them.

- [ ] **Step 3: Commit**

```bash
git add assets/js/gallery.js
git commit -m "feat: public gallery respects sort_order, unordered photos after"
```

---

## Task 7: Deploy + Smoke Test

- [ ] **Step 1: Deploy worker**

```bash
npx wrangler deploy
```

- [ ] **Step 2: Full smoke test**

1. Open admin → רכישות: confirm stats show 3 sizes + chart
2. Open admin → תמונות: select photos, use קטגוריה bulk op
3. Open admin → תמונות: select photos, use מחיר bulk op
4. Drag a photo card to a new position, confirm toast and reload
5. Open public gallery — confirm sort order is visible

- [ ] **Step 3: Final commit**

```bash
git add .
git commit -m "feat: admin improvements — stats chart, bulk ops, manual sort order"
git push
```
