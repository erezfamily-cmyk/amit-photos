# Photo Price Override Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow the admin to set per-photo download prices (small/medium/large) via a popup on each photo card, with global defaults editable from the top of the Photos tab.

**Architecture:** A `price_overrides TEXT` column (JSON) on the `photos` D1 table stores per-photo size prices. The worker reads these at checkout time, preferring the photo override over the global `settings.prices` value. The admin UI shows a floating popup with 3 inputs when the ₪ button is clicked; the button turns light blue when an override exists.

**Tech Stack:** Cloudflare Workers, D1 (SQLite), Vanilla JS, admin.html

---

## Files Changed

- `worker.js` lines ~685-688 — update verify-payment to use `price_overrides` TEXT column
- `worker.js` lines ~1581-1589 — fix `handleAdminPhotoPrice` to write `price_overrides` column
- `admin.html` lines ~648-655 — fix backslash URL bug in global prices section
- `admin.html` lines ~1478-1480 — update ₪ button to read `price_overrides`
- `admin.html` lines ~1839-1847 — fix backslash URL bug in `loadPriceSettings`
- `admin.html` lines ~1857-1862 — fix backslash URL bug in `prices-save` handler
- `admin.html` lines ~1875-1892 — replace `setPhotoPrice` with popup-based implementation
- `admin.html` (CSS section) — add `.btn-icon.price-active` light blue + popup styles
- `admin.html` (body) — add popup HTML element (`#price-popup`)

---

## Task 1: D1 Migration — add `price_overrides TEXT` column

**Files:**
- D1 database `802379c7-97cf-4262-93b8-da81c5c3c07d` (via Cloudflare MCP)

- [ ] **Step 1: Add the column**

Run via Cloudflare D1 MCP:
```sql
ALTER TABLE photos ADD COLUMN price_overrides TEXT
```
Expected: `success: true`, `changes: 0`

- [ ] **Step 2: Verify**

```sql
SELECT sql FROM sqlite_master WHERE type='table' AND name='photos'
```
Expected: column `price_overrides TEXT` appears in the CREATE TABLE statement.

- [ ] **Step 3: Commit note**
```bash
git commit --allow-empty -m "chore: add price_overrides TEXT column to D1 photos table"
```

---

## Task 2: Fix worker.js — verify-payment reads `price_overrides` JSON

**Files:**
- Modify: `worker.js` ~lines 685-688

Current code (wrong — reads REAL column, ignores size):
```js
const photoRow = await env.DB.prepare("SELECT price_override FROM photos WHERE id = ?").bind(photoIds[0]).first();
if (photoRow?.price_override != null) unitPrice = photoRow.price_override;
```

- [ ] **Step 1: Replace the per-photo lookup block**

Replace those two lines with:
```js
const photoRow = await env.DB.prepare("SELECT price_overrides FROM photos WHERE id = ?").bind(photoIds[0]).first();
if (photoRow?.price_overrides) {
  try {
    const ov = JSON.parse(photoRow.price_overrides);
    if (ov[size] != null) unitPrice = ov[size];
  } catch {}
}
```

- [ ] **Step 2: Verify locally**

Open `worker.js` and confirm the block now reads `price_overrides` and parses JSON before using `ov[size]`.

---

## Task 3: Fix worker.js — `handleAdminPhotoPrice` writes `price_overrides`

**Files:**
- Modify: `worker.js` ~lines 1581-1589

Current code (wrong column name):
```js
await env.DB.prepare("UPDATE photos SET price_override = ? WHERE id = ?").bind(val, photo_id).run();
```

- [ ] **Step 1: Update the UPDATE query**

Change the entire `handleAdminPhotoPrice` function to:
```js
async function handleAdminPhotoPrice(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  const { photo_id, price_override } = await request.json().catch(() => ({}));
  if (!photo_id) return jsonRes({ error: 'photo_id required' }, 400, request);
  const val = price_override === null ? null : JSON.stringify(price_override);
  await env.DB.prepare("UPDATE photos SET price_overrides = ? WHERE id = ?").bind(val, photo_id).run();
  return jsonRes({ ok: true }, 200, request);
}
```

- [ ] **Step 2: Deploy worker**

```bash
npx wrangler deploy
```
Expected: `Deployed amit-photos triggers`

- [ ] **Step 3: Commit**
```bash
git add worker.js
git commit -m "fix: price override uses price_overrides TEXT column with per-size JSON"
```

---

## Task 4: Fix admin.html — URL backslash bugs

**Files:**
- Modify: `admin.html` ~lines 1840, 1861

The fetch calls use `'\api\admin\prices'` which in JS evaluates to `'apiadminprices'` (backslashes before non-escape chars are dropped, but `\a` → `a`, and `\n` in `\admin` is a newline). Both must be forward slashes.

- [ ] **Step 1: Fix `loadPriceSettings`**

Find:
```js
const r = await fetch('\api\admin\prices', { headers: authHeaders() }).catch(() => null);
```
Replace with:
```js
const r = await fetch('/api/admin/prices', { headers: authHeaders() }).catch(() => null);
```

- [ ] **Step 2: Fix `prices-save` handler**

Find:
```js
const r = await fetch('\api\admin\prices', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ small, medium, large }) });
```
Replace with:
```js
const r = await fetch('/api/admin/prices', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ small, medium, large }) });
```

---

## Task 5: Add popup HTML + CSS to admin.html

**Files:**
- Modify: `admin.html` — add popup element near end of `<body>`, add CSS

- [ ] **Step 1: Add popup HTML**

Find the closing `</body>` tag and insert before it:
```html
<!-- Price override popup -->
<div id="price-popup" style="display:none;position:fixed;z-index:9999;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:1rem;min-width:220px;box-shadow:0 4px 20px rgba(0,0,0,.5)">
  <div style="font-size:.85rem;font-weight:600;margin-bottom:.75rem;color:var(--text)">מחיר מיוחד לתמונה זו (₪)</div>
  <div style="display:flex;flex-direction:column;gap:.5rem;margin-bottom:.75rem">
    <label style="display:flex;justify-content:space-between;align-items:center;font-size:.82rem">קטנה <input type="number" id="popup-price-small" class="input-sm" style="width:70px" min="0" step="1"></label>
    <label style="display:flex;justify-content:space-between;align-items:center;font-size:.82rem">בינונית <input type="number" id="popup-price-medium" class="input-sm" style="width:70px" min="0" step="1"></label>
    <label style="display:flex;justify-content:space-between;align-items:center;font-size:.82rem">גדולה <input type="number" id="popup-price-large" class="input-sm" style="width:70px" min="0" step="1"></label>
  </div>
  <div style="display:flex;gap:.5rem">
    <button type="button" class="btn-accent btn-sm" id="popup-save-btn" style="flex:1">עדכן מחירים</button>
    <button type="button" class="btn-sm" id="popup-reset-btn" style="background:var(--bg);border:1px solid var(--border);color:var(--text-muted);border-radius:4px;cursor:pointer;padding:.25rem .6rem;font-size:.8rem">אפס</button>
  </div>
</div>
```

- [ ] **Step 2: Add CSS for the light-blue active button state**

Find the existing CSS rule for `.btn-icon.active` (gold color) and add after it:
```css
.btn-icon.price-active { color: #60a5fa; }
.btn-icon.price-active svg { stroke: #60a5fa; fill: #60a5fa; }
```

---

## Task 6: Replace `setPhotoPrice` with popup implementation

**Files:**
- Modify: `admin.html` — `setPhotoPrice` function + photo card button template

- [ ] **Step 1: Update the ₪ button in `renderGrid`**

Find the current button:
```js
<button class="btn-icon${p.price_override != null ? ' active' : ''}" title="${p.price_override != null ? 'מחיר: ₪'+p.price_override+' — לחץ לניקוי' : 'קבע מחיר מיוחד'}" onclick="event.stopPropagation();Photos.setPhotoPrice('${p.id}', ${p.price_override ?? 'null'})">
  <svg width="13" height="13" fill="${p.price_override != null ? 'currentColor' : 'none'}" viewBox="0 0 24 24" stroke="currentColor"><circle cx="12" cy="12" r="10" stroke-width="2"/><line x1="12" y1="8" x2="12" y2="12" stroke-width="2"/><line x1="12" y1="16" x2="12.01" y2="16" stroke-width="2"/></svg>
</button>
```

Replace with:
```js
<button class="btn-icon${p.price_overrides ? ' price-active' : ''}" title="${p.price_overrides ? 'מחיר מיוחד מוגדר' : 'קבע מחיר מיוחד'}" onclick="event.stopPropagation();Photos.setPhotoPrice(event, '${p.id}')">
  <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor"><circle cx="12" cy="12" r="10" stroke-width="2"/><line x1="12" y1="8" x2="12" y2="12" stroke-width="2"/><line x1="12" y1="16" x2="12.01" y2="16" stroke-width="2"/></svg>
</button>
```

- [ ] **Step 2: Replace `setPhotoPrice` function**

Find and replace the entire `setPhotoPrice` function:
```js
async function setPhotoPrice(id, currentOverride) {
  // ... old prompt-based implementation
}
```

Replace with:
```js
let _pricepopupPhotoId = null;

async function setPhotoPrice(e, id) {
  const popup = document.getElementById('price-popup');
  // Close if clicking same button while open
  if (_pricepopupPhotoId === id && popup.style.display !== 'none') {
    popup.style.display = 'none';
    _pricepopupPhotoId = null;
    return;
  }
  _pricepopupPhotoId = id;

  // Load global prices as defaults
  const globalPrices = { small: parseFloat($('price-small').value)||19, medium: parseFloat($('price-medium').value)||59, large: parseFloat($('price-large').value)||129 };
  const photo = data.find(p => p.id === id);
  let overrides = null;
  if (photo?.price_overrides) {
    try { overrides = JSON.parse(photo.price_overrides); } catch {}
  }
  $('popup-price-small').value = overrides?.small ?? globalPrices.small;
  $('popup-price-medium').value = overrides?.medium ?? globalPrices.medium;
  $('popup-price-large').value = overrides?.large ?? globalPrices.large;

  // Position popup near the clicked button
  const rect = e.currentTarget.getBoundingClientRect();
  popup.style.display = 'block';
  const popupW = 230;
  let left = rect.left - popupW + rect.width;
  if (left < 8) left = 8;
  let top = rect.bottom + 6 + window.scrollY;
  popup.style.left = left + 'px';
  popup.style.top = top + 'px';

  // Save handler
  document.getElementById('popup-save-btn').onclick = async () => {
    const small = parseFloat($('popup-price-small').value);
    const medium = parseFloat($('popup-price-medium').value);
    const large = parseFloat($('popup-price-large').value);
    if ([small, medium, large].some(isNaN)) { toast('מחיר לא תקין', 'error'); return; }
    const r = await fetch('/api/admin/photo-price', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ photo_id: id, price_override: { small, medium, large } }) });
    if (!r.ok) { toast('שגיאה בשמירה', 'error'); return; }
    const idx = data.findIndex(p => p.id === id);
    if (idx >= 0) { data[idx].price_overrides = JSON.stringify({ small, medium, large }); render(); }
    popup.style.display = 'none';
    _pricepopupPhotoId = null;
    toast('מחיר מיוחד נשמר');
  };

  // Reset handler
  document.getElementById('popup-reset-btn').onclick = async () => {
    if (!confirm('לאפס את המחיר המיוחד לברירת המחדל?')) return;
    await fetch('/api/admin/photo-price', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ photo_id: id, price_override: null }) });
    const idx = data.findIndex(p => p.id === id);
    if (idx >= 0) { data[idx].price_overrides = null; render(); }
    popup.style.display = 'none';
    _pricepopupPhotoId = null;
    toast('מחיר אופס לברירת מחדל');
  };
}
```

- [ ] **Step 3: Add outside-click listener to close popup**

Find the `return { init: ...` line and add before it:
```js
document.addEventListener('click', (e) => {
  const popup = document.getElementById('price-popup');
  if (popup && popup.style.display !== 'none' && !popup.contains(e.target) && !e.target.closest('.btn-icon')) {
    popup.style.display = 'none';
    _pricepopupPhotoId = null;
  }
});
```

- [ ] **Step 4: Update the `return` line to expose updated function**

Find:
```js
return { init: async () => { await init(); loadNewBadgeSettings(); loadPriceSettings(); }, openEdit, openEditById, confirmDelete, cardClick, toggleSelect, toggleNew, setPhotoPrice, filterByChip, getData: () => data };
```
This line already exposes `setPhotoPrice` — no change needed.

---

## Task 7: Deploy + smoke test

**Files:**
- `worker.js`, `admin.html` (already modified)

- [ ] **Step 1: Deploy**
```bash
npx wrangler deploy
```
Expected: `Deployed amit-photos triggers`

- [ ] **Step 2: Open admin, check global prices load**

Navigate to `https://amitphotos.com/admin` → Photos tab.
Expected: קטנה=19, בינונית=59, גדולה=129 pre-filled.

- [ ] **Step 3: Test global price save**

Change קטנה to 25, click שמור.
Expected: ✓ נשמר appears. Reload page — should still show 25.

- [ ] **Step 4: Test per-photo override**

Click ₪ on any photo → popup opens with default values.
Enter small=1, medium=1, large=1. Click עדכן מחירים.
Expected: button turns light blue, toast "מחיר מיוחד נשמר".

- [ ] **Step 5: Verify D1 saved**

Query D1:
```sql
SELECT id, price_overrides FROM photos WHERE price_overrides IS NOT NULL LIMIT 3
```
Expected: rows with JSON like `{"small":1,"medium":1,"large":1}`

- [ ] **Step 6: Test reset**

Click ₪ on the same photo → popup opens with 1/1/1.
Click אפס → confirm → button returns to normal color.

- [ ] **Step 7: Commit**
```bash
git add admin.html worker.js
git commit -m "feat: per-photo price override popup with global defaults in admin"
git push
```
