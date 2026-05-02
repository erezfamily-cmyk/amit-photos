# Admin Analysis Editor — Split-Pane with Live Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the admin analysis edit dialog with a split-pane editor: plain-text composition fields on the right, live client-side preview on the left.

**Architecture:** Widen `learn-edit-dialog` to 1200px; right column = form (380px fixed), left column = preview rendered purely in JS. `updatePreview()` rebuilds the preview DOM on every input event. Composition HTML is edited as 3 plain-text label+body pairs and reconstructed to `<p><strong>…</strong></p>` on save. worker.js gets one small change to return the photo thumbnail from `handleAnalysesGet`.

**Tech Stack:** Vanilla JS, HTML, CSS — no frameworks. Cloudflare Worker (worker.js) for the API fix.

---

## File Map

| File | Change |
|------|--------|
| `worker.js` | `handleAnalysesGet`: JOIN photos table, return `photo_thumbnail` + `photo_url` |
| `admin.html` | Dialog HTML, CSS, `parseCompHtml`, `buildCompHtml`, `updatePreview`, update `learnEdit`, update `learnSave`, input event wiring, mobile toggle |

---

## Task 1: Update handleAnalysesGet to return photo thumbnail

**Files:**
- Modify: `worker.js` — `handleAnalysesGet` function (~line 2210)

- [ ] **Step 1: Find the current handleAnalysesGet query**

  Current code at ~line 2213:
  ```js
  const row = await env.DB.prepare(
    'SELECT * FROM photo_analyses WHERE photo_id = ?'
  ).bind(photoId).first();
  ```

- [ ] **Step 2: Replace with a JOIN that includes photo fields**

  Replace that `prepare(...)...first()` call (and the `return jsonRes` below it) with:
  ```js
  const row = await env.DB.prepare(
    `SELECT a.*, p.thumbnail AS photo_thumbnail, p.url AS photo_url, p.title AS photo_title
     FROM photo_analyses a
     LEFT JOIN photos p ON p.id = a.photo_id
     WHERE a.photo_id = ?`
  ).bind(photoId).first();
  if (!row) return jsonRes({ error: 'לא נמצא' }, 404, request);
  return jsonRes({
    ...row,
    annotations: JSON.parse(row.annotations_json || '[]'),
    camera: JSON.parse(row.camera_json || '{}'),
    tags: JSON.parse(row.tags_json || '[]'),
  }, 200, request);
  ```

- [ ] **Step 3: Verify no other callers of handleAnalysesGet are broken**

  Run: `grep -n "handleAnalysesGet" worker.js`
  Expected: only the definition line and the router line (`/api/analyses/` GET).

- [ ] **Step 4: Commit**

  ```bash
  git add worker.js
  git commit -m "fix: return photo_thumbnail in handleAnalysesGet for admin editor preview"
  ```

---

## Task 2: Add CSS for split-pane layout in admin.html

**Files:**
- Modify: `admin.html` — inside the `<style>` block (near end of existing styles, before `</style>`)

- [ ] **Step 1: Add the CSS block**

  Add this after the last rule in the `<style>` block (search for the end of styles, before `</style>`):

  ```css
  /* ===== LEARN EDIT SPLIT DIALOG ===== */
  .learn-edit-dialog{width:min(1200px,96vw)!important;max-height:90vh;overflow:hidden;display:flex;flex-direction:column}
  .learn-edit-split{display:flex;flex:1;overflow:hidden;min-height:0}
  .learn-edit-form{width:380px;flex-shrink:0;overflow-y:auto;border-left:1px solid var(--border)}
  .learn-edit-preview{flex:1;overflow-y:auto;background:#0a0a0a;display:flex;flex-direction:column}
  .learn-preview-label{font-size:.72rem;color:var(--text-muted);padding:.4rem 1rem;border-bottom:1px solid #222;text-align:center;flex-shrink:0}
  .learn-preview-body{padding:.75rem 1rem;flex:1}
  .learn-edit-photo-header{display:flex;align-items:center;gap:.75rem;padding:.25rem 0 .5rem}
  .learn-edit-photo-header img{width:52px;height:52px;object-fit:cover;border-radius:6px;flex-shrink:0}
  #learn-edit-title-label{font-size:.88rem;font-weight:600;color:var(--text);line-height:1.3}
  .comp-paragraphs{display:flex;flex-direction:column;gap:.6rem}
  .comp-para-row{display:flex;flex-direction:column;gap:.25rem;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:.5rem .65rem}
  .comp-para-row input[type=text]{background:transparent;border:none;border-bottom:1px solid var(--border);color:var(--text);font-size:.8rem;font-weight:600;padding:.15rem 0;outline:none;width:100%}
  .comp-para-row textarea{background:transparent;border:none;color:var(--text-muted);font-size:.8rem;resize:vertical;min-height:42px;outline:none;line-height:1.5;width:100%;font-family:inherit}
  /* preview inner styles */
  .lpv-cam-cards{display:grid;grid-template-columns:1fr 1fr;gap:.5rem;margin-bottom:.75rem}
  .lpv-cam-card{background:#111;border:1px solid #222;border-radius:8px;padding:.65rem}
  .lpv-cam-label{font-size:.65rem;color:#888;margin-bottom:.2rem}
  .lpv-cam-value{font-size:.95rem;color:#c8a96e;font-weight:700}
  .lpv-cam-desc{font-size:.65rem;color:#888;margin-top:.2rem;line-height:1.4}
  .lpv-section{margin-bottom:.75rem}
  .lpv-section-title{font-size:.85rem;color:#c8a96e;font-weight:700;margin-bottom:.5rem}
  .lpv-comp-box{background:#111;border:1px solid #222;border-radius:8px;padding:.85rem;font-size:.8rem;color:#888;line-height:1.7}
  .lpv-comp-box p{margin-bottom:.55rem}
  .lpv-comp-box p:last-of-type{margin-bottom:.4rem}
  .lpv-comp-box strong{color:#f0ede8}
  .lpv-tags-row{display:flex;flex-wrap:wrap;gap:.25rem;margin-top:.5rem}
  .lpv-tag{font-size:.68rem;color:#c8a96e;background:rgba(200,169,110,.1);border:1px solid rgba(200,169,110,.25);border-radius:4px;padding:2px 7px}
  /* highlight flash */
  @keyframes lpvHighlight{0%{outline:2px solid rgba(200,169,110,.8)}100%{outline:2px solid transparent}}
  .preview-highlight{animation:lpvHighlight .65s ease-out forwards;border-radius:8px}
  /* mobile */
  .learn-preview-toggle{display:none}
  @media(max-width:900px){
    .learn-edit-dialog{width:min(640px,96vw)!important}
    .learn-edit-preview{display:none}
    .learn-edit-preview.preview-visible{display:flex}
    .learn-edit-form.form-hidden{display:none}
    .learn-preview-toggle{display:inline-flex}
  }
  ```

- [ ] **Step 2: Verify CSS was added correctly**

  Open admin.html in a text editor and search for `.learn-edit-dialog` — it should appear exactly once in the style block.

---

## Task 3: Replace learn-edit-dialog HTML

**Files:**
- Modify: `admin.html` — the entire `<!-- LEARN EDIT DIALOG -->` section (~lines 1115–1160)

- [ ] **Step 1: Replace the dialog element**

  Find and replace the entire block from `<!-- LEARN EDIT DIALOG -->` through the closing `</dialog>` (currently ends at line ~1160) with:

  ```html
  <!-- LEARN EDIT DIALOG -->
  <dialog id="learn-edit-dialog" class="learn-edit-dialog">
    <div class="dialog-header">
      <span class="dialog-title">עריכת ניתוח צילום</span>
      <button class="dialog-close" onclick="closeLearnModal()">✕</button>
    </div>
    <div class="learn-edit-split">
      <!-- Right: form -->
      <div class="learn-edit-form" id="learn-edit-form-col">
        <div class="dialog-body">
          <input type="hidden" id="learn-edit-id">
          <div class="learn-edit-photo-header">
            <img id="learn-edit-thumb" src="" alt="" style="display:none">
            <span id="learn-edit-title-label"></span>
          </div>
          <div class="form-field">
            <label>ניתוח קומפוזיציה (3 פסקאות)</label>
            <div class="comp-paragraphs">
              <div class="comp-para-row">
                <input type="text" id="learn-edit-comp-label-1" placeholder="כותרת 1 (למשל: פוקוס)">
                <textarea id="learn-edit-comp-body-1" rows="2" placeholder="טקסט הפסקה הראשונה..."></textarea>
              </div>
              <div class="comp-para-row">
                <input type="text" id="learn-edit-comp-label-2" placeholder="כותרת 2">
                <textarea id="learn-edit-comp-body-2" rows="2" placeholder="טקסט הפסקה השנייה..."></textarea>
              </div>
              <div class="comp-para-row">
                <input type="text" id="learn-edit-comp-label-3" placeholder="כותרת 3">
                <textarea id="learn-edit-comp-body-3" rows="2" placeholder="טקסט הפסקה השלישית..."></textarea>
              </div>
            </div>
          </div>
          <div class="form-row">
            <div class="form-field">
              <label>צמצם — הסבר</label>
              <input type="text" id="learn-edit-aperture" placeholder="למשל: צמצם רחב f/1.8 יוצר בוקה עמוקה...">
            </div>
            <div class="form-field">
              <label>מהירות תריס — הסבר</label>
              <input type="text" id="learn-edit-shutter" placeholder="למשל: תריס מהיר 1/500 מקפיא תנועה...">
            </div>
          </div>
          <div class="form-row">
            <div class="form-field">
              <label>ISO — הסבר</label>
              <input type="text" id="learn-edit-iso" placeholder="למשל: ISO נמוך 100 מפחית רעש...">
            </div>
            <div class="form-field">
              <label>עדשה / מיקוד — הסבר</label>
              <input type="text" id="learn-edit-focal" placeholder="למשל: עדשה 85mm מאידאלית לפורטרטים...">
            </div>
          </div>
          <div class="form-field">
            <label>תגיות (מופרדות בפסיקים)</label>
            <input type="text" id="learn-edit-tags" placeholder="בוקה, חוק השליש, תאורה טבעית">
          </div>
          <div class="form-field">
            <label>הערות על נקודות (JSON מערך)</label>
            <textarea id="learn-edit-annotations" rows="4" placeholder='[{"x":50,"y":30,"label":"נקודת מיקוד ראשית"}]'></textarea>
          </div>
        </div>
      </div>
      <!-- Left: preview -->
      <div class="learn-edit-preview" id="learn-edit-preview-col">
        <div class="learn-preview-label">תצוגה מקדימה</div>
        <div class="learn-preview-body" id="learn-preview-body"></div>
      </div>
    </div>
    <div class="dialog-footer" style="justify-content:space-between;align-items:center">
      <button class="btn btn-ghost btn-sm learn-preview-toggle" id="learn-preview-toggle" onclick="toggleLearnPreview()">הצג תצוגה מקדימה</button>
      <div style="display:flex;gap:.6rem">
        <button class="btn btn-primary" onclick="learnSave()">שמור</button>
        <button class="btn btn-ghost" onclick="closeLearnModal()">ביטול</button>
      </div>
    </div>
  </dialog>
  ```

- [ ] **Step 2: Verify old IDs are gone, new ones are present**

  Search admin.html for `learn-edit-html` — should return 0 results.
  Search for `learn-edit-comp-label-1` — should return 1 result (the new input).

---

## Task 4: Add parseCompHtml and buildCompHtml helpers

**Files:**
- Modify: `admin.html` — add two functions in the `<script>` section, near `learnEdit` (~line 3017)

- [ ] **Step 1: Add the helper functions just before `learnEdit`**

  ```js
  // Parses "<p><strong>Label:</strong> body</p>" repeated up to 3 times into an array of {label, body}
  function parseCompHtml(html) {
    const out = [{label:'',body:''},{label:'',body:''},{label:'',body:''}];
    const re = /<p><strong>([^<]*?):<\/strong>\s*([\s\S]*?)<\/p>/g;
    let m, i = 0;
    while ((m = re.exec(html)) !== null && i < 3) {
      out[i++] = { label: m[1].trim(), body: m[2].trim() };
    }
    return out;
  }

  // Reconstructs HTML from 3 {label, body} pairs
  function buildCompHtml() {
    return [1,2,3].map(i => {
      const label = ($('learn-edit-comp-label-' + i)?.value || '').trim();
      const body  = ($('learn-edit-comp-body-'  + i)?.value || '').trim();
      if (!label && !body) return '';
      return `<p><strong>${label}:</strong> ${body}</p>`;
    }).filter(Boolean).join('\n');
  }
  ```

- [ ] **Step 2: Verify by search**

  Search admin.html for `parseCompHtml` — should return 2 results (definition + usage in Task 6).
  Search for `buildCompHtml` — should return 2 results (definition + usage in Task 7).

---

## Task 5: Add escHtml helper and updatePreview function

**Files:**
- Modify: `admin.html` — add functions after `buildCompHtml` (inserted in Task 4)

- [ ] **Step 1: Check if escHtml already exists in admin.html**

  Run: `grep -n "function escHtml" admin.html`
  If it exists, skip adding it. If not, add it.

- [ ] **Step 2: Add escHtml (if not already present) and updatePreview**

  Add immediately after the `buildCompHtml` function:

  ```js
  function escHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function updatePreview(highlightId) {
    const previewBody = $('learn-preview-body');
    if (!previewBody) return;

    const camera = (currentAnalysis && currentAnalysis.camera) || {};
    const camKeys   = ['aperture','shutter','iso','focal'];
    const camLabels = {aperture:'צמצם',shutter:'מהירות תריס',iso:'ISO',focal:'מרחק מוקד'};
    const camInputs = {aperture:'learn-edit-aperture',shutter:'learn-edit-shutter',iso:'learn-edit-iso',focal:'learn-edit-focal'};

    const cameraHtml = camKeys.map(k => {
      const val = (camera[k] && camera[k].value) || '—';
      const exp = $( camInputs[k])?.value || '';
      return `<div class="lpv-cam-card">
        <div class="lpv-cam-label">${camLabels[k]}</div>
        <div class="lpv-cam-value">${escHtml(val)}</div>
        <div class="lpv-cam-desc">${escHtml(exp)}</div>
      </div>`;
    }).join('');

    const compHtml = [1,2,3].map(i => {
      const label = ($('learn-edit-comp-label-' + i)?.value || '').trim();
      const body  = ($('learn-edit-comp-body-'  + i)?.value || '').trim();
      if (!label && !body) return '';
      return `<p><strong>${escHtml(label)}:</strong> ${escHtml(body)}</p>`;
    }).filter(Boolean).join('');

    const tagsHtml = ($('learn-edit-tags')?.value || '')
      .split(',').map(t=>t.trim()).filter(Boolean)
      .map(t=>`<span class="lpv-tag">${escHtml(t)}</span>`).join('');

    const thumb = currentAnalysis?._thumb || '';

    previewBody.innerHTML =
      (thumb ? `<img src="${escHtml(thumb)}" style="width:100%;border-radius:8px;display:block;margin-bottom:.75rem" alt="">` : '') +
      `<div class="lpv-cam-cards" id="lpv-cam-cards">${cameraHtml}</div>` +
      `<div class="lpv-section">` +
        `<div class="lpv-section-title">🎨 ניתוח קומפוזיציה</div>` +
        `<div class="lpv-comp-box" id="lpv-comp-box">${compHtml}<div class="lpv-tags-row" id="lpv-tags-row">${tagsHtml}</div></div>` +
      `</div>`;

    if (highlightId) {
      const el = document.getElementById(highlightId);
      if (el) {
        el.classList.remove('preview-highlight');
        void el.offsetWidth;
        el.classList.add('preview-highlight');
        setTimeout(() => el.classList.remove('preview-highlight'), 700);
      }
    }
  }
  ```

---

## Task 6: Update learnEdit() to use new fields and call updatePreview

**Files:**
- Modify: `admin.html` — `learnEdit` function (~line 3017)

- [ ] **Step 1: Replace the field-population block inside learnEdit**

  The block currently sets `learn-edit-html`, `learn-edit-aperture`, etc. Replace from `$('learn-edit-id').value = photoId;` through `document.getElementById('learn-edit-dialog').showModal();` with:

  ```js
  $('learn-edit-id').value = photoId;

  // thumbnail header
  const thumb = analysis.photo_thumbnail || analysis.photo_url || '';
  currentAnalysis._thumb = thumb;
  const thumbEl = $('learn-edit-thumb');
  if (thumbEl) { thumbEl.src = thumb; thumbEl.style.display = thumb ? '' : 'none'; }
  const titleLabelEl = $('learn-edit-title-label');
  if (titleLabelEl) titleLabelEl.textContent = analysis.photo_title || analysis.title || photoId;

  // composition: parse HTML → 3 label+body pairs
  const parts = parseCompHtml(analysis.composition_html || '');
  [1,2,3].forEach((i, idx) => {
    $('learn-edit-comp-label-' + i).value = parts[idx].label;
    $('learn-edit-comp-body-'  + i).value = parts[idx].body;
  });

  $('learn-edit-aperture').value = (camera.aperture && camera.aperture.explanation) || '';
  $('learn-edit-shutter').value  = (camera.shutter  && camera.shutter.explanation)  || '';
  $('learn-edit-iso').value      = (camera.iso      && camera.iso.explanation)      || '';
  $('learn-edit-focal').value    = (camera.focal    && camera.focal.explanation)    || '';
  $('learn-edit-tags').value = Array.isArray(tags) ? tags.join(', ') : (tags || '');
  $('learn-edit-annotations').value = typeof analysis.annotations_json === 'string'
    ? analysis.annotations_json
    : JSON.stringify(analysis.annotations_json || [], null, 2);

  document.getElementById('learn-edit-dialog').showModal();
  updatePreview(null);
  ```

- [ ] **Step 2: Verify**

  Search admin.html for `learn-edit-html` — should return 0 results (the old textarea ID is gone).

---

## Task 7: Update learnSave() to reconstruct composition_html

**Files:**
- Modify: `admin.html` — `learnSave` function

- [ ] **Step 1: Replace the composition_html line**

  Find in `learnSave`:
  ```js
  composition_html: $('learn-edit-html').value,
  ```
  Replace with:
  ```js
  composition_html: buildCompHtml(),
  ```

- [ ] **Step 2: Verify**

  Search admin.html for `learn-edit-html` — should return 0 results.
  Search for `buildCompHtml()` — should return 2 results (definition + usage here).

---

## Task 8: Wire input events and mobile toggle

**Files:**
- Modify: `admin.html` — add a `learnWireInputs()` function and call it from `learnEdit` after `showModal()`

- [ ] **Step 1: Add learnWireInputs and toggleLearnPreview functions**

  Add these two functions after `closeLearnModal`:

  ```js
  function learnWireInputs() {
    // composition → lpv-comp-box
    [1,2,3].forEach(i => {
      $('learn-edit-comp-label-' + i)?.addEventListener('input', () => updatePreview('lpv-comp-box'));
      $('learn-edit-comp-body-'  + i)?.addEventListener('input', () => updatePreview('lpv-comp-box'));
    });
    // camera → lpv-cam-cards
    ['learn-edit-aperture','learn-edit-shutter','learn-edit-iso','learn-edit-focal'].forEach(id => {
      $(id)?.addEventListener('input', () => updatePreview('lpv-cam-cards'));
    });
    // tags → lpv-tags-row
    $('learn-edit-tags')?.addEventListener('input', () => updatePreview('lpv-tags-row'));
  }

  function toggleLearnPreview() {
    const formCol    = $('learn-edit-form-col');
    const previewCol = $('learn-edit-preview-col');
    const btn        = $('learn-preview-toggle');
    const showingPreview = previewCol.classList.contains('preview-visible');
    previewCol.classList.toggle('preview-visible', !showingPreview);
    formCol.classList.toggle('form-hidden', !showingPreview);
    btn.textContent = showingPreview ? 'הצג תצוגה מקדימה' : 'חזרה לעריכה';
  }
  ```

- [ ] **Step 2: Call learnWireInputs() once on page load**

  Find the `DOMContentLoaded` listener or equivalent init block in admin.html.
  If there isn't a dedicated init block, find the bottom of the `<script>` section and add:

  ```js
  document.addEventListener('DOMContentLoaded', () => {
    learnWireInputs();
  });
  ```

  If a `DOMContentLoaded` listener already exists, add `learnWireInputs();` inside it.

- [ ] **Step 3: Verify toggle is wired**

  Search admin.html for `toggleLearnPreview` — should return 2 results (definition + the onclick in the button HTML from Task 3).

---

## Task 9: Deploy and test

- [ ] **Step 1: Deploy to Cloudflare**

  ```bash
  npx wrangler deploy
  ```

- [ ] **Step 2: Manual verification**

  Open admin panel → ניתוח תמונות tab → click "עריכה" on any analysis.

  Check:
  - Dialog is wide (~1200px), two columns visible on desktop
  - Right column: thumbnail + title shown at top, 3 label+body pairs populated from existing data, camera fields filled
  - Left column: preview shows photo, camera cards, composition text, tags
  - Editing a composition label → composition section in preview highlights yellow briefly
  - Editing a camera field → camera cards section highlights
  - Editing tags → tags row highlights
  - Clicking "שמור" → analysis saved, dialog closes, toast shown
  - Reopen same analysis → composition fields still show the correct plain-text values
  - On narrow screen (< 900px): only form shown, "הצג תצוגה מקדימה" button visible, click toggles to preview

- [ ] **Step 3: Commit**

  ```bash
  git add admin.html worker.js
  git commit -m "feat: admin analysis editor with split-pane live preview and plain-text composition fields"
  git push
  ```
