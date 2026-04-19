# Photo of the Week Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "תמונת השבוע" feature — admin selects one photo (with auto-suggestion) that shows a 25% badge in the gallery and discounted prices in the buy modal.

**Architecture:** Two new settings keys (`photo_of_week_id`, `photo_of_week_discount`) drive everything. `GET /api/photos` exposes `is_week_photo` and `week_photo_discount` on each photo. Two new POST endpoints handle suggestion and setting. Client-side logic (gallery.js) reads these flags for badge display and price calculation. Admin UI is a self-contained section using `Photos.getData()`.

**Tech Stack:** Cloudflare Worker, D1 settings table, Vanilla JS (admin.html, gallery.js), CSS (style.css)

---

## File Map

- Modify: `worker.js` — `handlePhotos` GET + 2 new handlers + 2 new routes
- Modify: `assets/js/gallery.js` — `isWeekPhoto`, badge in card, `getEffectivePrice`, buy modal badge text, `loadPhotos` merge
- Modify: `assets/css/style.css` — add `.gallery-week-badge` rule
- Modify: `admin.html` — HTML section + `WeekPhoto` JS module + update `showAdmin`

---

## Task 1: Worker — GET /api/photos adds week photo flags

**Files:**
- Modify: `worker.js:266-276`

- [ ] **Step 1: Replace the GET handler's return in `handlePhotos`**

Find this block in `handlePhotos` (around line 266):

```js
    const { results } = await env.DB.prepare(sql).all();
    return jsonRes(results);
```

Replace with:

```js
    const { results } = await env.DB.prepare(sql).all();
    const weekRow = await env.DB.prepare("SELECT value FROM settings WHERE key='photo_of_week_id'").first();
    const discountRow = await env.DB.prepare("SELECT value FROM settings WHERE key='photo_of_week_discount'").first();
    const weekPhotoId = weekRow?.value || '';
    const weekDiscount = parseFloat(discountRow?.value || '0.25');
    const photos = results.map(p => ({
      ...p,
      is_week_photo: !!(weekPhotoId && p.id === weekPhotoId),
      week_photo_discount: (weekPhotoId && p.id === weekPhotoId) ? weekDiscount : 0,
    }));
    return jsonRes(photos);
```

- [ ] **Step 2: Deploy and verify**

```bash
npx wrangler deploy
```

Then open browser console on https://amitphotos.com and run:
```js
fetch('/api/photos').then(r=>r.json()).then(d=>console.log(d[0]))
```
Expected: photo objects now have `is_week_photo: false` and `week_photo_discount: 0` fields.

- [ ] **Step 3: Commit**

```bash
git add worker.js
git commit -m "feat: GET /api/photos exposes is_week_photo and week_photo_discount flags"
```

---

## Task 2: Worker — suggest + set endpoints

**Files:**
- Modify: `worker.js` — add 2 functions before the `fetch` export, add 2 routes inside `fetch`

- [ ] **Step 1: Add `handlePhotoOfWeekSuggest` function**

Add this function in `worker.js` just before the `async function handleAdminPrices` block (search for `handleAdminPrices` to find the right place):

```js
async function handlePhotoOfWeekSuggest(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  const { results } = await env.DB.prepare(`
    SELECT p.id, p.title, p.thumbnail,
           COUNT(t.token) as purchase_count
    FROM photos p
    LEFT JOIN download_tokens t ON json_extract(t.photo_ids, '$[0]') = p.id
    WHERE p.published = 1
    GROUP BY p.id
    ORDER BY purchase_count ASC
  `).all();
  if (!results.length) return jsonRes({ error: 'אין תמונות זמינות' }, 404, request);
  const bottomCount = Math.max(1, Math.floor(results.length * 0.2));
  const candidates = results.slice(0, bottomCount);
  const photo = candidates[Math.floor(Math.random() * candidates.length)];
  return jsonRes({ photo: { id: photo.id, title: photo.title, thumbnail: photo.thumbnail } }, 200, request);
}

async function handlePhotoOfWeekSet(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  const { photo_id } = await request.json().catch(() => ({}));
  if (!photo_id) return jsonRes({ error: 'photo_id required' }, 400, request);
  await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('photo_of_week_id', ?)").bind(photo_id).run();
  await env.DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('photo_of_week_discount', '0.25')").run();
  return jsonRes({ ok: true }, 200, request);
}
```

- [ ] **Step 2: Register the two routes**

Find the existing route for `handlePhotosReorder`:
```js
    if (path === '/api/photos/reorder' && request.method === 'POST') return handlePhotosReorder(request, env);
```

Add directly after it:
```js
    if (path === '/api/admin/photo-of-week/suggest' && request.method === 'POST') return handlePhotoOfWeekSuggest(request, env);
    if (path === '/api/admin/photo-of-week/set' && request.method === 'POST') return handlePhotoOfWeekSet(request, env);
```

- [ ] **Step 3: Deploy and verify suggest endpoint**

```bash
npx wrangler deploy
```

Then test in browser console (must be logged into admin first so session token exists — copy it from sessionStorage):
```js
fetch('/api/admin/photo-of-week/suggest', {
  method: 'POST',
  headers: { 'X-Session-Token': sessionStorage.getItem('admin_session') }
}).then(r=>r.json()).then(console.log)
```
Expected: `{ photo: { id: "...", title: "...", thumbnail: "..." } }`

- [ ] **Step 4: Commit**

```bash
git add worker.js
git commit -m "feat: add photo-of-week suggest and set API endpoints"
```

---

## Task 3: Gallery display — badge + discount

**Files:**
- Modify: `assets/js/gallery.js`
- Modify: `assets/css/style.css`

- [ ] **Step 1: Add `isWeekPhoto` function in gallery.js**

Find `function isNew(photo)` (around line 17). Add directly after the `isOnSale` function (which ends around line 15):

```js
function isWeekPhoto(photo) {
  return !!photo.is_week_photo;
}
```

- [ ] **Step 2: Merge `is_week_photo` and `week_photo_discount` in `loadPhotos`**

Find this line in gallery.js (around line 173):
```js
        return a ? { ...p, is_new: a.is_new, added_at: a.added_at, price_overrides: a.price_overrides } : p;
```

Replace with:
```js
        return a ? { ...p, is_new: a.is_new, added_at: a.added_at, price_overrides: a.price_overrides, is_week_photo: a.is_week_photo, week_photo_discount: a.week_photo_discount } : p;
```

- [ ] **Step 3: Add week badge to photo card template**

Find this line in gallery.js (around line 261):
```js
      ${isOnSale(photo) ? '<div class="gallery-sale-badge">🏷 מבצע</div>' : ''}
```

Add the week badge line directly after it:
```js
      ${isWeekPhoto(photo) ? '<div class="gallery-week-badge">⭐ תמונת השבוע</div>' : ''}
```

- [ ] **Step 4: Modify `getEffectivePrice` to apply week photo discount**

Find `function getEffectivePrice(photoId, size)` (around line 1044). Replace the entire function with:

```js
function getEffectivePrice(photoId, size) {
  const photo = allPhotos.find(p => p.id === photoId);
  if (photo?.price_overrides) {
    try {
      const ov = typeof photo.price_overrides === 'string' ? JSON.parse(photo.price_overrides) : photo.price_overrides;
      if (ov[size] != null) return ov[size];
    } catch {}
  }
  if (photo?.is_week_photo && photo?.week_photo_discount) {
    return Math.round(globalPrices[size] * (1 - photo.week_photo_discount));
  }
  return globalPrices[size];
}
```

- [ ] **Step 5: Update buy modal sale badge text for week photos**

In `openBuyModal` (around line 1127), find:
```js
      badge.textContent = '🏷 מבצע';
```

Replace with:
```js
      badge.textContent = photo.is_week_photo ? '⭐ תמונת השבוע' : '🏷 מבצע';
```

- [ ] **Step 6: Add `.gallery-week-badge` CSS**

In `assets/css/style.css`, find `.gallery-sale-badge` (around line 701). Add directly after its closing `}`:

```css
.gallery-week-badge {
  position: absolute; bottom: 10px; left: 10px; z-index: 5;
  background: #c9a84c; color: #fff;
  font-size: .65rem; font-weight: 700; letter-spacing: .5px;
  padding: .2rem .5rem; border-radius: 3px;
  pointer-events: none;
}
```

- [ ] **Step 7: Verify visually**

Deploy and visit https://amitphotos.com. Temporarily test by calling from browser console:
```js
// Fake a week photo on the first loaded photo to check badge
allPhotos[0].is_week_photo = true;
allPhotos[0].week_photo_discount = 0.25;
renderGallery();
```
Expected: first photo card shows "⭐ תמונת השבוע" badge at bottom-left.
Then click the photo → buy modal → prices show strikethrough + 25% off.

- [ ] **Step 8: Commit**

```bash
git add assets/js/gallery.js assets/css/style.css
git commit -m "feat: gallery shows week photo badge and 25% discount in buy modal"
```

---

## Task 4: Admin UI — week photo section

**Files:**
- Modify: `admin.html`

- [ ] **Step 1: Add the week photo HTML section**

In `admin.html`, find the new-badge settings div closing tag:
```html
        <span id="new-badge-days-status" style="color:var(--text-muted);font-size:.8rem"></span>
      </div>
```

Add the following HTML directly after that `</div>`:

```html

      <!-- Week Photo Section -->
      <div id="week-photo-box" style="display:flex;flex-direction:column;gap:.6rem;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:.75rem 1rem;margin-bottom:1rem;font-size:.85rem">
        <div style="display:flex;align-items:center;gap:.75rem;flex-wrap:wrap">
          <span style="font-weight:600">⭐ תמונת השבוע</span>
          <div id="week-photo-current" style="flex:1;color:var(--text-muted)">טוען…</div>
          <button type="button" class="btn-accent btn-sm" id="week-suggest-btn">הצע תמונה</button>
          <button type="button" class="btn-accent btn-sm hidden" id="week-confirm-btn">קבע</button>
          <button type="button" class="btn btn-ghost btn-sm hidden" id="week-resuggest-btn">הצע אחרת</button>
          <span id="week-photo-status" style="color:var(--text-muted);font-size:.8rem"></span>
        </div>
        <div id="week-photo-preview" class="hidden" style="display:flex;align-items:center;gap:.75rem">
          <img id="week-preview-img" style="width:48px;height:48px;object-fit:cover;border-radius:4px;border:1px solid var(--border)" alt="">
          <span id="week-preview-title" style="color:var(--text)"></span>
          <span style="color:var(--text-muted)">— 25% הנחה על כל הגדלים</span>
        </div>
      </div>
```

- [ ] **Step 2: Add `WeekPhoto` JS module**

Add the following after the closing `})();` of the `Photos` IIFE (around line 2129, just before `</script>` at the end):

```js

// ===== WEEK PHOTO =====
const WeekPhoto = (() => {
  let _suggestion = null;

  function init(photos) {
    const weekPhoto = (photos || []).find(p => p.is_week_photo);
    const currentDiv = $('week-photo-current');
    if (weekPhoto) {
      currentDiv.innerHTML = `<img src="${weekPhoto.thumbnail || weekPhoto.url}" style="width:28px;height:28px;object-fit:cover;border-radius:3px;border:1px solid var(--border);vertical-align:middle;margin-left:.4rem" alt=""> ${weekPhoto.title}`;
      $('week-suggest-btn').textContent = 'החלף';
    } else {
      currentDiv.innerHTML = '<span>לא נבחרה תמונת שבוע</span>';
      $('week-suggest-btn').textContent = 'הצע תמונה';
    }
    $('week-confirm-btn').classList.add('hidden');
    $('week-resuggest-btn').classList.add('hidden');
    $('week-photo-preview').classList.add('hidden');
    _suggestion = null;
  }

  $('week-suggest-btn').addEventListener('click', async () => {
    $('week-photo-status').textContent = 'טוען…';
    const r = await fetch('/api/admin/photo-of-week/suggest', {
      method: 'POST', headers: authHeaders()
    }).catch(() => null);
    if (!r?.ok) {
      const err = await r?.json().catch(() => ({}));
      $('week-photo-status').textContent = err?.error || 'שגיאה';
      return;
    }
    const { photo } = await r.json();
    _suggestion = photo;
    $('week-preview-img').src = photo.thumbnail || '';
    $('week-preview-title').textContent = photo.title;
    $('week-photo-preview').classList.remove('hidden');
    $('week-confirm-btn').classList.remove('hidden');
    $('week-resuggest-btn').classList.remove('hidden');
    $('week-photo-status').textContent = '';
  });

  $('week-confirm-btn').addEventListener('click', async () => {
    if (!_suggestion) return;
    $('week-photo-status').textContent = 'שומר…';
    const r = await fetch('/api/admin/photo-of-week/set', {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({ photo_id: _suggestion.id })
    }).catch(() => null);
    if (!r?.ok) { $('week-photo-status').textContent = 'שגיאה'; return; }
    $('week-photo-status').textContent = '✓ נשמר';
    setTimeout(() => { $('week-photo-status').textContent = ''; }, 2000);
    await Photos.init();
    init(Photos.getData());
  });

  $('week-resuggest-btn').addEventListener('click', () => $('week-suggest-btn').click());

  return { init };
})();
```

- [ ] **Step 3: Call `WeekPhoto.init()` from `showAdmin`**

Find:
```js
  async function showAdmin() {
    $('admin-ui').classList.add('visible');
    await Promise.all([Photos.init(), Subscribers.load(), Customers.load()]);
    Dashboard.init(Photos.getData(), Subscribers.getData(), Customers.getData());
    Dashboard.loadAnalytics();
  }
```

Replace with:
```js
  async function showAdmin() {
    $('admin-ui').classList.add('visible');
    await Promise.all([Photos.init(), Subscribers.load(), Customers.load()]);
    Dashboard.init(Photos.getData(), Subscribers.getData(), Customers.getData());
    Dashboard.loadAnalytics();
    WeekPhoto.init(Photos.getData());
  }
```

- [ ] **Step 4: Deploy and test the full flow**

```bash
npx wrangler deploy
```

Open https://amitphotos.com/admin.html, log in, navigate to "תמונות" section.

Expected:
1. "⭐ תמונת השבוע" box visible above photos grid, showing "לא נבחרה תמונת שבוע"
2. Click "הצע תמונה" → preview appears with thumbnail + title + "25% הנחה על כל הגדלים"
3. Click "קבע" → shows "✓ נשמר", current section updates to show that photo
4. Open the public site → that photo card shows "⭐ תמונת השבוע" badge
5. Click that photo → buy modal → prices show strikethrough + discounted amounts

- [ ] **Step 5: Commit and push**

```bash
git add admin.html
git commit -m "feat: admin photo of the week section with auto-suggest and confirm flow"
git push
```
