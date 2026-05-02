# Analyze Photo from Card — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 🔬 button to each photo card in admin.html that generates a Claude analysis for that specific photo, while keeping the existing automatic-random button unchanged.

**Architecture:** The backend `handleAnalysesGenerate` in worker.js is extended to read an optional `photo_id` from the POST body; if present it fetches that specific photo, otherwise falls back to the existing random logic. The frontend adds a new `analyzePhoto(photoId, btn)` function and a 🔬 button in each card's `.photo-actions` row.

**Tech Stack:** Cloudflare Worker (worker.js), Vanilla JS + HTML (admin.html), Cloudflare D1 (SQLite), Cloudflare R2, Anthropic Claude API

---

## File Map

| File | Change |
|------|--------|
| `worker.js` | Modify `handleAnalysesGenerate` (~line 2248) to support optional `photo_id` in POST body |
| `admin.html` | Add `analyzePhoto()` function (~line 3320 area) + add 🔬 button in card render (~line 1743) |

---

### Task 1: Backend — support `photo_id` in `handleAnalysesGenerate`

**Files:**
- Modify: `worker.js:2248-2292`

- [ ] **Step 1: Replace the photo-selection block at the top of `handleAnalysesGenerate`**

Find this block (lines 2248–2271 in worker.js):

```js
async function handleAnalysesGenerate(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== 'POST') return jsonRes({ error: 'POST only' }, 405, request);
  if (!env.ANTHROPIC_API_KEY) return jsonRes({ error: 'ANTHROPIC_API_KEY חסר' }, 500, request);

  // 1. Pick 5 candidates (unanalyzed, published)
  // Prefer photos with smaller dimensions (more likely to fit Claude's 5MB image limit)
  const { results: candidates } = await env.DB.prepare(`
    SELECT p.id, p.title, p.thumbnail, p.url, p.r2_key, p.description
    FROM photos p
    LEFT JOIN photo_analyses a ON a.photo_id = p.id
    WHERE a.photo_id IS NULL
      AND p.published = 1
      AND p.r2_key IS NOT NULL
      AND p.r2_key != ''
      AND p.width > 0
      AND p.width <= 2000
    ORDER BY RANDOM()
    LIMIT 5
  `).all();

  if (!candidates || candidates.length === 0) {
    return jsonRes({ error: 'אין תמונות זמינות לניתוח' }, 404, request);
  }
```

Replace with:

```js
async function handleAnalysesGenerate(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== 'POST') return jsonRes({ error: 'POST only' }, 405, request);
  if (!env.ANTHROPIC_API_KEY) return jsonRes({ error: 'ANTHROPIC_API_KEY חסר' }, 500, request);

  // Support optional photo_id in POST body for card-level analysis
  let requestedPhotoId = null;
  try {
    const body = await request.json().catch(() => ({}));
    requestedPhotoId = body?.photo_id || null;
  } catch (_) {}

  let candidates;
  if (requestedPhotoId) {
    // Specific photo requested — fetch it directly (re-analysis allowed)
    const { results } = await env.DB.prepare(`
      SELECT id, title, thumbnail, url, r2_key, description
      FROM photos
      WHERE id = ?
        AND r2_key IS NOT NULL
        AND r2_key != ''
    `).bind(requestedPhotoId).all();
    candidates = results;
    if (!candidates || candidates.length === 0) {
      return jsonRes({ error: 'תמונה לא נמצאה או חסר r2_key' }, 404, request);
    }
  } else {
    // 1. Pick 5 candidates (unanalyzed, published)
    // Prefer photos with smaller dimensions (more likely to fit Claude's 5MB image limit)
    const { results } = await env.DB.prepare(`
      SELECT p.id, p.title, p.thumbnail, p.url, p.r2_key, p.description
      FROM photos p
      LEFT JOIN photo_analyses a ON a.photo_id = p.id
      WHERE a.photo_id IS NULL
        AND p.published = 1
        AND p.r2_key IS NOT NULL
        AND r2_key != ''
        AND p.width > 0
        AND p.width <= 2000
      ORDER BY RANDOM()
      LIMIT 5
    `).all();
    candidates = results;
    if (!candidates || candidates.length === 0) {
      return jsonRes({ error: 'אין תמונות זמינות לניתוח' }, 404, request);
    }
  }
```

- [ ] **Step 2: Verify the rest of the function is untouched**

The code after `candidates` (R2 size check, Claude call, D1 insert, return) is identical for both paths — no further changes needed. Scroll through lines 2273–2390 and confirm no edits were made there.

- [ ] **Step 3: Commit**

```bash
git add worker.js
git commit -m "feat: support photo_id in analyses/generate endpoint"
```

---

### Task 2: Frontend — add `analyzePhoto()` function

**Files:**
- Modify: `admin.html` (just before the closing `</script>` tag around line 3344)

- [ ] **Step 1: Add the function**

Find this block near the bottom of the `<script>` section:

```js
document.addEventListener('DOMContentLoaded', () => {
  learnWireInputs();
});
```

Insert the new function immediately before it:

```js
async function analyzePhoto(photoId, btn) {
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = '⏳';
  try {
    const res = await fetch('/api/analyses/generate', {
      method: 'POST',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ photo_id: photoId })
    });
    const data = await res.json();
    if (data.photo_id) {
      toast('ניתוח נוצר: ' + (data.title || data.photo_id));
      loadLearn();
    } else {
      toast('שגיאה: ' + (data.error || JSON.stringify(data)), 'error');
    }
  } catch(e) {
    toast('שגיאה: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  learnWireInputs();
});
```

- [ ] **Step 2: Commit**

```bash
git add admin.html
git commit -m "feat: add analyzePhoto() frontend function"
```

---

### Task 3: Frontend — add 🔬 button to photo card

**Files:**
- Modify: `admin.html:1739` (inside the card render template, just before the delete button block)

- [ ] **Step 1: Add the button**

Find this line in the card render template (around line 1739):

```js
            ${p._source==='r2' ? `
            <button class="btn-icon danger" title="מחק" onclick="event.stopPropagation();Photos.confirmDelete('${p.id}')">
```

Insert the 🔬 button immediately before it:

```js
            <button class="btn-icon" title="ייצר ניתוח" onclick="event.stopPropagation();analyzePhoto('${p.id}',this)">🔬</button>
            ${p._source==='r2' ? `
            <button class="btn-icon danger" title="מחק" onclick="event.stopPropagation();Photos.confirmDelete('${p.id}')">
```

- [ ] **Step 2: Commit and push**

```bash
git add admin.html
git commit -m "feat: add analyze button to photo card"
git push
```

---

### Task 4: Manual verification

- [ ] **Step 1: Open admin, go to gallery section**

Navigate to the gallery section in admin. Each photo card should now show a 🔬 icon in the action row.

- [ ] **Step 2: Test automatic analysis (unchanged)**

Click "ייצר ניתוח חדש עכשיו" in the ניתוח תמונות section. Verify it still works as before (random unanalyzed photo).

- [ ] **Step 3: Test card-level analysis**

Click 🔬 on any photo card. The button should show ⏳ while processing (Claude takes ~10–20 seconds). On success: toast "ניתוח נוצר: [שם התמונה]" and the analyses table refreshes.

- [ ] **Step 4: Test re-analysis**

Click 🔬 on a photo that already has an analysis. It should succeed (INSERT OR REPLACE overwrites the existing record).

- [ ] **Step 5: Test error case**

Click 🔬 on a photo that has no R2 file (if any exist). Verify a Hebrew error toast appears and the button re-enables.
