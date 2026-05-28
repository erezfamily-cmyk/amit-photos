# Admin EN Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three focused improvements to the analyses (learn) section in admin: fix "צפה" link, auto-generate EN before publishing, and add a batch "Generate missing EN" button.

**Architecture:** All changes are in `admin.html` only — no worker changes needed. The `/api/analyses/{id}/generate-en` endpoint already exists. Changes are: one link fix, one function modification, one new function + button.

**Tech Stack:** Vanilla JS, existing admin fetch patterns, existing `authHeaders()` + `toast()` utilities.

---

### Task 1: Fix "צפה" link to point to analysis page

**Files:**
- Modify: `admin.html:4028`

The existing "צפה" link points to `/photo/${a.photo_id}` (the gallery photo page). It should point to `/learn/${a.photo_id}` (the analysis page).

- [ ] **Step 1: Find and fix the link**

In `admin.html` at line 4028, find:
```js
${a.published_at ? `<a href="/photo/${a.photo_id}" target="_blank" class="btn btn-ghost btn-sm" title="פתח דף מפורסם" style="text-decoration:none;display:inline-flex;align-items:center;gap:.25rem"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>צפה</a>` : ''}
```

Replace with:
```js
${a.published_at ? `<a href="/learn/${a.photo_id}" target="_blank" class="btn btn-ghost btn-sm" title="פתח דף ניתוח" style="text-decoration:none;display:inline-flex;align-items:center;gap:.25rem"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>צפה</a>` : ''}
```

- [ ] **Step 2: Verify manually**

Open admin, go to ניתוח תמונות section, click "צפה" on a published analysis — confirm it opens `/learn/...` not `/photo/...`.

- [ ] **Step 3: Commit**

```bash
git add admin.html
git commit -m "fix: analyses 'צפה' button links to /learn/ instead of /photo/"
```

---

### Task 2: Auto-generate EN before publishing

**Files:**
- Modify: `admin.html:4246-4255` (the `learnPublish` function)

When publishing an analysis that has no `title_en`, call `generate-en` first, then publish.

The current `learnPublish` function (lines 4246–4255):
```js
async function learnPublish(photoId) {
  const res = await fetch('/api/analyses/' + photoId, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ published_at: new Date().toISOString() })
  });
  if (!res.ok) { toast('שגיאה בפרסום', 'error'); return; }
  toast('✓ ניתוח פורסם');
  loadLearn();
}
```

- [ ] **Step 1: Replace `learnPublish` with EN-aware version**

Replace the entire function with:
```js
async function learnPublish(photoId) {
  // Check if EN content exists — if not, generate it first
  try {
    const check = await fetch('/api/analyses/' + photoId, { headers: authHeaders() });
    if (check.ok) {
      const data = await check.json();
      if (!data.title_en) {
        toast('מייצר תרגום אנגלי לפני פרסום...');
        const genRes = await fetch(`/api/analyses/${photoId}/generate-en`, { method: 'POST', headers: authHeaders() });
        if (!genRes.ok) { toast('שגיאה בייצור תרגום', 'error'); return; }
      }
    }
  } catch (_) {}

  const res = await fetch('/api/analyses/' + photoId, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({ published_at: new Date().toISOString() })
  });
  if (!res.ok) { toast('שגיאה בפרסום', 'error'); return; }
  toast('✓ ניתוח פורסם');
  loadLearn();
}
```

- [ ] **Step 2: Verify manually**

In admin, find an analysis without EN✓ badge. Click "פרסם" — confirm toast shows "מייצר תרגום אנגלי..." then "✓ ניתוח פורסם", and EN✓ badge appears on the row.

- [ ] **Step 3: Commit**

```bash
git add admin.html
git commit -m "feat: auto-generate EN before publishing analysis"
```

---

### Task 3: Batch "Generate all missing EN" button

**Files:**
- Modify: `admin.html:1124-1128` (section-actions div), add new function near `learnGenerateEn`

Adds a button that fetches all analyses, filters those without `title_en`, and calls generate-en on each sequentially with a running counter.

- [ ] **Step 1: Add the button to section-actions (line 1124–1128)**

Find:
```html
        <div class="section-actions">
          <button type="button" class="btn btn-ghost btn-sm" onclick="learnPublishAll()">עדכן הכל</button>
          <button type="button" class="btn btn-ghost btn-sm" id="learn-dedup-btn" onclick="learnDedup()">נקה כפולות</button>
          <button type="button" class="btn btn-primary btn-sm" id="learn-generate-btn" onclick="learnGenerate()">ייצר ניתוח חדש עכשיו</button>
        </div>
```

Replace with:
```html
        <div class="section-actions">
          <button type="button" class="btn btn-ghost btn-sm" onclick="learnPublishAll()">עדכן הכל</button>
          <button type="button" class="btn btn-ghost btn-sm" id="learn-dedup-btn" onclick="learnDedup()">נקה כפולות</button>
          <button type="button" class="btn btn-ghost btn-sm" id="learn-gen-missing-en-btn" onclick="learnGenerateMissingEn(this)">🌍 ייצר EN חסר</button>
          <button type="button" class="btn btn-primary btn-sm" id="learn-generate-btn" onclick="learnGenerate()">ייצר ניתוח חדש עכשיו</button>
        </div>
```

- [ ] **Step 2: Add `learnGenerateMissingEn` function**

Add this function immediately after the existing `learnGenerateEn` function (after line 4392):
```js
async function learnGenerateMissingEn(btn) {
  btn.disabled = true;
  const orig = btn.textContent;
  try {
    const res = await fetch('/api/analyses', { headers: authHeaders() });
    if (!res.ok) throw new Error(await res.text());
    const all = await res.json();
    const missing = all.filter(a => !a.title_en);
    if (!missing.length) { toast('כל הניתוחים כבר יש להם תרגום אנגלי ✓'); return; }
    let done = 0;
    for (const a of missing) {
      btn.textContent = `🌍 ${done}/${missing.length}`;
      const r = await fetch(`/api/analyses/${a.photo_id}/generate-en`, { method: 'POST', headers: authHeaders() });
      if (r.ok) done++;
    }
    toast(`✓ נוצרו ${done} תרגומים אנגליים`);
    loadLearn();
  } catch(e) {
    toast('שגיאה: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
}
```

- [ ] **Step 3: Verify manually**

In admin, click "🌍 ייצר EN חסר" — confirm button shows `🌍 0/N` counter during run, then toast shows "✓ נוצרו X תרגומים אנגליים", and EN✓ badges appear on previously-missing rows.

- [ ] **Step 4: Deploy worker (not needed — admin.html only) and commit**

```bash
git add admin.html
git commit -m "feat: batch generate-EN button for analyses missing translation"
git push origin main
```

---

### Task 4: Deploy

- [ ] **Step 1: Push all commits**

```bash
git push origin main
```

`admin.html` is served as a static asset by Cloudflare via the `ASSETS` binding — no worker deploy needed.
