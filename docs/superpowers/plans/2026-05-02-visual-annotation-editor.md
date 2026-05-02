# Visual Annotation Editor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fullscreen visual editor to admin.html that lets the user draw lines and place labeled dots directly on a photo, then save the result as `annotations_json` to D1 via the existing PUT endpoint.

**Architecture:** Single new `<dialog id="ann-editor-dialog">` added to admin.html. A global `annEditor` state object holds the photo URL, current rule, annotations array, and active tool mode. All rendering goes through one `annEditorRender()` function that redraws the SVG on every state change. Opens from the existing learn-edit dialog; on save, writes back to the `learn-edit-annotations` hidden field. No backend changes.

**Tech Stack:** Vanilla JS, SVG overlay on `<img>`, admin.html (single file ~3371 lines), Cloudflare D1 (existing PUT /api/analyses/:id endpoint)

---

## File Map

| File | Change |
|------|--------|
| `admin.html` | (1) Add `<dialog id="ann-editor-dialog">` HTML before `<!-- Price override popup -->` comment at line 3373; (2) Add CSS block inside the dialog's inline `<style>`; (3) Add all editor JS before closing `</script>` at line 3371; (4) Add "ערוך ויזואלי" button in learn-edit dialog footer |

---

### Task 1: Dialog HTML + CSS

**Files:**
- Modify: `admin.html` (insert near line 3373 and inside `<style>` block)

Context: The learn-edit dialog lives at lines 1160–1235. The closing `</script>` is line 3371. The `<!-- Price override popup -->` comment is line 3373. CSS lives in a `<style>` block in the `<head>`.

- [ ] **Step 1: Find the existing CSS `<style>` block in the `<head>` of admin.html**

Run:
```
Grep for: id="ann-editor-dialog"
```
Expected: no results (doesn't exist yet). Also confirm `<style>` block exists in `<head>` by reading lines 1-20.

- [ ] **Step 2: Add CSS for the editor dialog**

Find this line in admin.html (inside the `<style>` block, near other dialog styles — search for `.learn-edit-dialog`):

```css
.learn-edit-dialog {
```

Insert the following CSS block immediately before it (or at the end of the `<style>` block — either location is fine):

```css
/* ===== VISUAL ANNOTATION EDITOR ===== */
#ann-editor-dialog {
  width: 100vw; height: 100vh; max-width: 100vw; max-height: 100vh;
  margin: 0; padding: 0; border: none; background: #0d0d0d;
  display: flex; flex-direction: column;
}
#ann-editor-dialog::backdrop { background: #000; }
.ann-ed-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 16px; background: #141414; border-bottom: 1px solid #2a2a2a;
  flex-shrink: 0;
}
.ann-ed-title { color: #c8a96e; font-size: 14px; font-weight: 600; }
.ann-ed-body {
  display: flex; flex: 1; overflow: hidden;
}
.ann-ed-sidebar {
  width: 148px; flex-shrink: 0; background: #161616;
  border-right: 1px solid #222; display: flex; flex-direction: column;
  padding: 10px 8px; gap: 10px; overflow-y: auto;
}
.ann-ed-sidebar-title {
  font-size: 9px; text-transform: uppercase; letter-spacing: .1em;
  color: #555; margin-bottom: 2px;
}
.ann-ed-rule-select {
  width: 100%; background: #222; border: 1px solid #333; border-radius: 4px;
  color: #c8a96e; font-size: 11px; padding: 4px 6px;
}
.ann-ed-tools { display: flex; flex-direction: column; gap: 4px; }
.ann-ed-tool-btn {
  background: #222; border: 1px solid #333; border-radius: 4px;
  color: #ccc; font-size: 11px; padding: 5px 6px; text-align: right;
  cursor: pointer; display: flex; align-items: center; gap: 5px;
}
.ann-ed-tool-btn.active { background: #2a2010; border-color: #c8a96e; color: #c8a96e; }
.ann-ed-elem-list {
  flex: 1; overflow-y: auto; background: #1a1a1a; border: 1px solid #282828;
  border-radius: 4px; padding: 4px;
}
.ann-ed-elem-item {
  font-size: 9px; color: #888; padding: 3px 4px;
  border-bottom: 1px solid #1e1e1e; display: flex;
  justify-content: space-between; align-items: center; gap: 4px;
}
.ann-ed-elem-item.selected { color: #6ab0ff; }
.ann-ed-elem-del { color: #c44; cursor: pointer; flex-shrink: 0; }
.ann-ed-save-btn {
  background: #c8a96e; color: #111; font-size: 12px; font-weight: 700;
  border: none; border-radius: 5px; padding: 8px; cursor: pointer; width: 100%;
}
.ann-ed-canvas-outer {
  flex: 1; overflow: auto; background: #111;
  display: flex; align-items: flex-start; justify-content: center;
}
.ann-ed-canvas-inner {
  position: relative; display: inline-block;
  min-width: min-content; cursor: crosshair;
}
#ann-editor-img { display: block; max-width: 100%; height: auto; }
#ann-editor-svg {
  position: absolute; top: 0; left: 0; width: 100%; height: 100%;
  overflow: visible;
}
.ann-ed-popup {
  position: fixed; background: #1e1e1e; border: 1px solid #3a3a3a;
  border-radius: 6px; padding: 8px 10px; z-index: 10000;
  display: flex; gap: 6px; align-items: center; box-shadow: 0 4px 16px #0008;
}
.ann-ed-popup input {
  background: #111; border: 1px solid #333; border-radius: 4px;
  color: #eee; font-size: 12px; padding: 3px 7px; width: 140px;
}
.ann-ed-popup button {
  background: #c8a96e; color: #111; border: none; border-radius: 4px;
  font-size: 11px; font-weight: 700; padding: 4px 8px; cursor: pointer;
}
.ann-ed-popup .btn-skip {
  background: #2a2a2a; color: #aaa;
}
```

- [ ] **Step 3: Add the dialog HTML**

Find the comment `<!-- Price override popup -->` (line 3373) and insert the following immediately before it:

```html
<!-- Visual Annotation Editor -->
<dialog id="ann-editor-dialog">
  <div class="ann-ed-header">
    <span class="ann-ed-title" id="ann-ed-title-label">עורך ויזואלי</span>
    <button class="dialog-close" onclick="annEdClose()">✕</button>
  </div>
  <div class="ann-ed-body">
    <div class="ann-ed-sidebar">
      <div>
        <div class="ann-ed-sidebar-title">חוק קומפוזיציה</div>
        <select class="ann-ed-rule-select" id="ann-ed-rule" onchange="annEdSetRule(this.value)">
          <option value="leading_lines">↗ קווים מובילים</option>
          <option value="rule_of_thirds">⊞ חוק השליש</option>
          <option value="golden_ratio">⬦ יחס הזהב</option>
          <option value="symmetry">| סימטריה</option>
          <option value="framing">▭ מסגור</option>
          <option value="negative_space">◩ מרחב שלילי</option>
        </select>
      </div>
      <div>
        <div class="ann-ed-sidebar-title">כלי ציור</div>
        <div class="ann-ed-tools">
          <button class="ann-ed-tool-btn active" id="ann-tool-line"   onclick="annEdSetMode('line')">✏️ צייר קו</button>
          <button class="ann-ed-tool-btn"        id="ann-tool-dot"    onclick="annEdSetMode('dot')">📍 הוסף נקודה</button>
          <button class="ann-ed-tool-btn"        id="ann-tool-select" onclick="annEdSetMode('select')">↖ בחר/הזז</button>
          <button class="ann-ed-tool-btn"        id="ann-tool-delete" onclick="annEdSetMode('delete')">🗑 מחק</button>
        </div>
      </div>
      <div style="flex:1;overflow:hidden;display:flex;flex-direction:column;gap:4px">
        <div class="ann-ed-sidebar-title">אלמנטים</div>
        <div class="ann-ed-elem-list" id="ann-ed-elem-list"></div>
      </div>
      <button class="ann-ed-save-btn" onclick="annEdSave()">שמור</button>
    </div>
    <div class="ann-ed-canvas-outer" id="ann-ed-canvas-outer">
      <div class="ann-ed-canvas-inner" id="ann-ed-canvas-inner">
        <img id="ann-editor-img" alt="">
        <svg id="ann-editor-svg" viewBox="0 0 100 100" preserveAspectRatio="none"></svg>
      </div>
    </div>
  </div>
</dialog>
```

- [ ] **Step 4: Add "ערוך ויזואלי" button in learn-edit dialog footer**

Find this block in admin.html (lines ~1230-1235):

```html
  <div class="dialog-footer" style="justify-content:space-between;align-items:center">
    <button class="btn btn-ghost btn-sm learn-preview-toggle" id="learn-preview-toggle" onclick="toggleLearnPreview()">הצג תצוגה מקדימה</button>
    <div style="display:flex;gap:.6rem">
      <button class="btn btn-primary" onclick="learnSave()">שמור</button>
      <button class="btn btn-ghost" onclick="closeLearnModal()">ביטול</button>
    </div>
  </div>
```

Replace with:

```html
  <div class="dialog-footer" style="justify-content:space-between;align-items:center">
    <button class="btn btn-ghost btn-sm learn-preview-toggle" id="learn-preview-toggle" onclick="toggleLearnPreview()">הצג תצוגה מקדימה</button>
    <div style="display:flex;gap:.6rem">
      <button class="btn btn-ghost btn-sm" onclick="annEdOpen()">✏️ ערוך ויזואלי</button>
      <button class="btn btn-primary" onclick="learnSave()">שמור</button>
      <button class="btn btn-ghost" onclick="closeLearnModal()">ביטול</button>
    </div>
  </div>
```

- [ ] **Step 5: Commit**

```bash
git add admin.html
git commit -m "feat: add visual annotation editor dialog HTML and CSS"
```

---

### Task 2: State management + open/close

**Files:**
- Modify: `admin.html` (add JS before closing `</script>` at line 3371)

Context: `currentAnalysis` is an existing global holding the loaded analysis. `annGetRows()` reads the hidden `learn-edit-annotations` field as a JSON array. `authHeaders()` returns `{ 'Content-Type': 'application/json', 'X-Session-Token': SESSION_TOKEN }`.

- [ ] **Step 1: Add the state object and open/close functions**

Find this line near the bottom of the `<script>` block:

```js
document.addEventListener('DOMContentLoaded', () => {
  learnWireInputs();
});
```

Insert the following immediately before it:

```js
// ===== VISUAL ANNOTATION EDITOR =====
const annEditor = {
  rule: 'leading_lines',
  annotations: [],
  mode: 'line',
  selectedIdx: -1,
  dragData: null,   // { idx, startX, startY, origX, origY } during select-drag
  tempLine: null,   // { x1, y1, x2, y2 } during line draw (all in 0-100 pct)
  drawStart: null,  // { x, y } mousedown position during line draw
};

function annEdOpen() {
  if (!currentAnalysis) return;
  const rule = currentAnalysis.composition_rule || 'leading_lines';
  annEditor.rule = rule;
  annEditor.annotations = annGetRows().map(a => Object.assign({}, a));
  annEditor.mode = 'line';
  annEditor.selectedIdx = -1;
  annEditor.dragData = null;
  annEditor.tempLine = null;
  annEditor.drawStart = null;

  const select = $('ann-ed-rule');
  if (select) select.value = rule;
  annEdSetMode('line');

  const img = $('ann-editor-img');
  const thumb = currentAnalysis._thumb || '';
  img.src = thumb;

  const titleEl = $('ann-ed-title-label');
  if (titleEl) titleEl.textContent = 'עורך ויזואלי — ' + (currentAnalysis.photo_title || currentAnalysis.title || '');

  document.getElementById('ann-editor-dialog').showModal();
  annEdRender();
}

function annEdClose() {
  document.getElementById('ann-editor-dialog').close();
}

function annEdSetMode(mode) {
  annEditor.mode = mode;
  annEditor.selectedIdx = -1;
  annEditor.dragData = null;
  annEditor.tempLine = null;
  annEditor.drawStart = null;
  ['line','dot','select','delete'].forEach(m => {
    const btn = $('ann-tool-' + m);
    if (btn) btn.classList.toggle('active', m === mode);
  });
  const svg = $('ann-editor-svg');
  if (svg) svg.style.cursor = mode === 'select' ? 'default' : 'crosshair';
  annEdRender();
}

function annEdSetRule(rule) {
  annEditor.rule = rule;
  annEdRender();
}

function annEdSave() {
  $('learn-edit-annotations').value = JSON.stringify(annEditor.annotations);
  annRender(annEditor.annotations);
  // also sync the composition_rule — store on currentAnalysis so learnSave() can pick it up
  if (currentAnalysis) currentAnalysis.composition_rule = annEditor.rule;
  annEdClose();
}
```

- [ ] **Step 2: Update learnSave() to include composition_rule**

Find in `learnSave()`:

```js
  const body = {
    composition_html: buildCompHtml(),
    camera_json: JSON.stringify({
```

Replace with:

```js
  const body = {
    composition_rule: (currentAnalysis && currentAnalysis.composition_rule) || '',
    composition_html: buildCompHtml(),
    camera_json: JSON.stringify({
```

- [ ] **Step 3: Verify handleAnalysesUpdate in worker.js accepts composition_rule**

Search worker.js for `handleAnalysesUpdate`. Confirm it has a `composition_rule` field in the UPDATE SQL. If it does not, open worker.js and find the UPDATE statement — add `composition_rule = COALESCE(?, composition_rule)` alongside the other fields, and bind the value from the request body.

Expected: worker.js UPDATE includes composition_rule.

- [ ] **Step 4: Commit**

```bash
git add admin.html worker.js
git commit -m "feat: add annEditor state, open/close, mode switching"
```

---

### Task 3: SVG rendering

**Files:**
- Modify: `admin.html`

Context: `annEditor.annotations` is an array of objects. Dot annotations have `{ x_pct, y_pct, label, anchor }`. Line annotations have `{ type:'line', x1_pct, y1_pct, x2_pct, y2_pct, label }`. The SVG uses `viewBox="0 0 100 100" preserveAspectRatio="none"` so all coordinates are already in 0–100 space.

- [ ] **Step 1: Add annEdRender() and helpers**

Add the following after `annEdSave()` and before the `document.addEventListener('DOMContentLoaded'...` line:

```js
function annEdRuleOverlaySVG(rule, annotations) {
  const gold = 'rgba(200,169,110,0.45)';
  const dash = '1.5,1';
  if (rule === 'rule_of_thirds') return `
    <line x1="33.3" y1="0" x2="33.3" y2="100" stroke="${gold}" stroke-width=".4" stroke-dasharray="${dash}"/>
    <line x1="66.6" y1="0" x2="66.6" y2="100" stroke="${gold}" stroke-width=".4" stroke-dasharray="${dash}"/>
    <line x1="0" y1="33.3" x2="100" y2="33.3" stroke="${gold}" stroke-width=".4" stroke-dasharray="${dash}"/>
    <line x1="0" y1="66.6" x2="100" y2="66.6" stroke="${gold}" stroke-width=".4" stroke-dasharray="${dash}"/>
    <circle cx="33.3" cy="33.3" r="1.2" fill="${gold}"/>
    <circle cx="66.6" cy="33.3" r="1.2" fill="${gold}"/>
    <circle cx="33.3" cy="66.6" r="1.2" fill="${gold}"/>
    <circle cx="66.6" cy="66.6" r="1.2" fill="${gold}"/>`;
  if (rule === 'symmetry') return `
    <line x1="50" y1="0" x2="50" y2="100" stroke="${gold}" stroke-width=".5" stroke-dasharray="${dash}"/>`;
  if (rule === 'framing') return `
    <rect x="8" y="8" width="84" height="84" fill="none" stroke="${gold}" stroke-width=".6" stroke-dasharray="${dash}"/>`;
  if (rule === 'leading_lines') {
    const vp = annotations.find(a => !a.type && a.label && a.label.includes('מגוז'))
             || annotations.find(a => !a.type);
    if (vp) {
      const vx = parseFloat(vp.x_pct) ?? 80, vy = parseFloat(vp.y_pct) ?? 50;
      const sx = vx >= 50 ? 0 : 100;
      return [-35,-12,12,35].map(off => {
        const sy = Math.max(2, Math.min(98, vy + off));
        return `<line x1="${sx}" y1="${sy}" x2="${vx}" y2="${vy}" stroke="${gold}" stroke-width=".5" opacity=".7"/>`;
      }).join('');
    }
    return '';
  }
  if (rule === 'golden_ratio') return `
    <rect x="0" y="0" width="61.8" height="100" fill="none" stroke="${gold}" stroke-width=".4" stroke-dasharray="${dash}"/>
    <rect x="0" y="0" width="61.8" height="61.8" fill="none" stroke="${gold}" stroke-width=".4" stroke-dasharray="${dash}"/>`;
  if (rule === 'negative_space') return `
    <line x1="0" y1="0" x2="100" y2="100" stroke="${gold}" stroke-width=".4" stroke-dasharray="${dash}"/>`;
  return '';
}

function annEdRender() {
  const svg = $('ann-editor-svg');
  if (!svg) return;

  const gold = '#c8a96e';
  const selectedColor = '#6ab0ff';
  let html = '';

  // 1. Static rule overlay
  html += annEdRuleOverlaySVG(annEditor.rule, annEditor.annotations);

  // 2. Saved annotations
  annEditor.annotations.forEach((ann, idx) => {
    const isSelected = idx === annEditor.selectedIdx;
    const color = isSelected ? selectedColor : gold;
    if (ann.type === 'line') {
      const x1 = ann.x1_pct, y1 = ann.y1_pct, x2 = ann.x2_pct, y2 = ann.y2_pct;
      html += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
        stroke="${color}" stroke-width="${isSelected ? 1 : .7}" stroke-linecap="round"
        data-ann-idx="${idx}" style="cursor:pointer"/>`;
      if (ann.label) {
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        html += `<text x="${mx}" y="${my - 1.5}" text-anchor="middle"
          font-size="3" fill="${color}" style="pointer-events:none">${escSvgText(ann.label)}</text>`;
      }
    } else {
      const x = ann.x_pct, y = ann.y_pct;
      html += `<circle cx="${x}" cy="${y}" r="${isSelected ? 2 : 1.5}"
        fill="${color}" data-ann-idx="${idx}" style="cursor:pointer"/>`;
      if (ann.label) {
        const dy = ann.anchor === 'top' ? -3 : 3;
        const anchor = ann.anchor === 'right' ? 'start' : ann.anchor === 'left' ? 'end' : 'middle';
        html += `<text x="${x}" y="${y + dy}" text-anchor="${anchor}"
          font-size="2.8" fill="${color}" style="pointer-events:none">${escSvgText(ann.label)}</text>`;
      }
    }
  });

  // 3. Temp line during draw
  if (annEditor.tempLine) {
    const t = annEditor.tempLine;
    html += `<line x1="${t.x1}" y1="${t.y1}" x2="${t.x2}" y2="${t.y2}"
      stroke="${gold}" stroke-width=".6" stroke-dasharray="2,1" opacity=".8"/>`;
  }

  svg.innerHTML = html;

  // Re-attach click handlers for select/delete modes
  if (annEditor.mode === 'select' || annEditor.mode === 'delete') {
    svg.querySelectorAll('[data-ann-idx]').forEach(el => {
      el.addEventListener('pointerdown', e => {
        e.stopPropagation();
        const idx = parseInt(el.getAttribute('data-ann-idx'));
        annEdElementPointerDown(e, idx);
      });
    });
  }

  // Sidebar element list
  const list = $('ann-ed-elem-list');
  if (list) {
    list.innerHTML = annEditor.annotations.map((ann, idx) => {
      const isSelected = idx === annEditor.selectedIdx;
      const icon = ann.type === 'line' ? '—' : '•';
      const name = ann.label || (ann.type === 'line' ? 'קו' : 'נקודה');
      return `<div class="ann-ed-elem-item${isSelected ? ' selected' : ''}">
        <span>${icon} ${escHtml(name)}</span>
        <span class="ann-ed-elem-del" onclick="annEdDeleteIdx(${idx})">×</span>
      </div>`;
    }).join('');
  }
}

function escSvgText(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
```

- [ ] **Step 2: Open admin → open a learn-edit dialog → click "ערוך ויזואלי"**

Expected: fullscreen editor opens, photo shows, rule overlay is visible (e.g., thirds grid), annotation dots/lines from existing analysis are drawn in gold.

- [ ] **Step 3: Commit**

```bash
git add admin.html
git commit -m "feat: add annEdRender() with rule overlay and annotation SVG rendering"
```

---

### Task 4: Canvas pointer events (draw line + place dot)

**Files:**
- Modify: `admin.html`

Context: The SVG uses `viewBox="0 0 100 100" preserveAspectRatio="none"`. To convert a pointer event to SVG coordinates, use `getBoundingClientRect()` of the SVG element. Pointer events are registered on the SVG element (not the canvas wrapper) so `e.target` is always the SVG or a child.

- [ ] **Step 1: Add svgPos() helper and canvas pointer event handlers**

Add the following after `annEdRender()` and before `document.addEventListener('DOMContentLoaded'...`:

```js
function annEdSvgPos(e) {
  const svg = $('ann-editor-svg');
  const rect = svg.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(100, (e.clientX - rect.left) / rect.width * 100)),
    y: Math.max(0, Math.min(100, (e.clientY - rect.top) / rect.height * 100))
  };
}

function annEdCanvasPointerDown(e) {
  if (annEditor.mode === 'line') {
    const pos = annEdSvgPos(e);
    annEditor.drawStart = pos;
    annEditor.tempLine = { x1: pos.x, y1: pos.y, x2: pos.x, y2: pos.y };
    const svg = $('ann-editor-svg');
    svg.setPointerCapture(e.pointerId);
  } else if (annEditor.mode === 'dot') {
    const pos = annEdSvgPos(e);
    annEdShowLabelPopup(e.clientX, e.clientY, '', label => {
      annEditor.annotations.push({ x_pct: pos.x, y_pct: pos.y, label, anchor: 'bottom' });
      annEdRender();
    });
  } else if (annEditor.mode === 'select') {
    annEditor.selectedIdx = -1;
    annEdRender();
  }
}

function annEdCanvasPointerMove(e) {
  if (annEditor.mode === 'line' && annEditor.drawStart) {
    const pos = annEdSvgPos(e);
    annEditor.tempLine = {
      x1: annEditor.drawStart.x, y1: annEditor.drawStart.y,
      x2: pos.x, y2: pos.y
    };
    annEdRender();
  } else if (annEditor.mode === 'select' && annEditor.dragData) {
    const pos = annEdSvgPos(e);
    const d = annEditor.dragData;
    const dx = pos.x - d.startX, dy = pos.y - d.startY;
    const ann = annEditor.annotations[d.idx];
    if (ann.type === 'line') {
      ann.x1_pct = Math.max(0, Math.min(100, d.origX1 + dx));
      ann.y1_pct = Math.max(0, Math.min(100, d.origY1 + dy));
      ann.x2_pct = Math.max(0, Math.min(100, d.origX2 + dx));
      ann.y2_pct = Math.max(0, Math.min(100, d.origY2 + dy));
    } else {
      ann.x_pct = Math.max(0, Math.min(100, d.origX + dx));
      ann.y_pct = Math.max(0, Math.min(100, d.origY + dy));
    }
    annEdRender();
  }
}

function annEdCanvasPointerUp(e) {
  if (annEditor.mode === 'line' && annEditor.drawStart) {
    const pos = annEdSvgPos(e);
    const dx = pos.x - annEditor.drawStart.x;
    const dy = pos.y - annEditor.drawStart.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 2) { // ignore accidental clicks (< 2% distance)
      const newLine = {
        type: 'line',
        x1_pct: annEditor.drawStart.x, y1_pct: annEditor.drawStart.y,
        x2_pct: pos.x, y2_pct: pos.y,
        label: ''
      };
      annEditor.annotations.push(newLine);
      const newIdx = annEditor.annotations.length - 1;
      annEditor.tempLine = null;
      annEditor.drawStart = null;
      annEdRender();
      // Popup for optional label — positioned at midpoint
      const svg = $('ann-editor-svg');
      const rect = svg.getBoundingClientRect();
      const mx = rect.left + (newLine.x1_pct + newLine.x2_pct) / 2 / 100 * rect.width;
      const my = rect.top  + (newLine.y1_pct + newLine.y2_pct) / 2 / 100 * rect.height;
      annEdShowLabelPopup(mx, my, '', label => {
        annEditor.annotations[newIdx].label = label;
        annEdRender();
      }, true);
    } else {
      annEditor.tempLine = null;
      annEditor.drawStart = null;
      annEdRender();
    }
  } else if (annEditor.mode === 'select' && annEditor.dragData) {
    annEditor.dragData = null;
  }
}

function annEdShowLabelPopup(clientX, clientY, defaultValue, onConfirm, allowSkip = false) {
  annEdRemovePopup();
  const popup = document.createElement('div');
  popup.className = 'ann-ed-popup';
  popup.id = 'ann-ed-label-popup';
  popup.style.left = Math.min(clientX, window.innerWidth - 280) + 'px';
  popup.style.top  = Math.min(clientY + 10, window.innerHeight - 60) + 'px';
  const input = document.createElement('input');
  input.type = 'text';
  input.value = defaultValue;
  input.placeholder = 'תווית (אופציונלי)';
  const okBtn = document.createElement('button');
  okBtn.textContent = 'אישור';
  const confirm = () => { annEdRemovePopup(); onConfirm(input.value.trim()); };
  okBtn.onclick = confirm;
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') confirm();
    if (e.key === 'Escape') { annEdRemovePopup(); if (allowSkip) onConfirm(''); }
  });
  popup.appendChild(input);
  popup.appendChild(okBtn);
  if (allowSkip) {
    const skipBtn = document.createElement('button');
    skipBtn.textContent = 'דלג';
    skipBtn.className = 'btn-skip';
    skipBtn.onclick = () => { annEdRemovePopup(); onConfirm(''); };
    popup.appendChild(skipBtn);
  }
  document.body.appendChild(popup);
  input.focus();
}

function annEdRemovePopup() {
  const p = $('ann-ed-label-popup');
  if (p) p.remove();
}
```

- [ ] **Step 2: Wire the SVG pointer events after the dialog HTML exists**

Add the following inside the `annEdOpen()` function, right after `document.getElementById('ann-editor-dialog').showModal();`:

```js
  // Wire pointer events (only once — check if already wired)
  const svg = $('ann-editor-svg');
  if (!svg._annWired) {
    svg._annWired = true;
    svg.addEventListener('pointerdown', annEdCanvasPointerDown);
    svg.addEventListener('pointermove', annEdCanvasPointerMove);
    svg.addEventListener('pointerup',   annEdCanvasPointerUp);
  }
```

- [ ] **Step 3: Manual test — draw line**

Open editor on any photo. Click ✏️ צייר קו. Drag across the photo. On release: a gold line appears, popup asks for label. Type a name and click אישור. Line appears with label. Click "דלג" instead — line appears with no label.

- [ ] **Step 4: Manual test — place dot**

Click 📍 הוסף נקודה. Click anywhere on photo. Popup asks for label. Type label. Gold dot + label appear.

- [ ] **Step 5: Commit**

```bash
git add admin.html
git commit -m "feat: add draw-line and place-dot tools with label popup"
```

---

### Task 5: Select+move and Delete tools

**Files:**
- Modify: `admin.html`

Context: `annEdElementPointerDown` is called when clicking on an SVG element that has `data-ann-idx`. Hit detection is handled by SVG itself (elements with `data-ann-idx` get click handlers in `annEdRender()`).

- [ ] **Step 1: Add annEdElementPointerDown() and annEdDeleteIdx()**

Add after `annEdRemovePopup()`:

```js
function annEdElementPointerDown(e, idx) {
  if (annEditor.mode === 'delete') {
    annEdDeleteIdx(idx);
    return;
  }
  if (annEditor.mode === 'select') {
    annEditor.selectedIdx = idx;
    const ann = annEditor.annotations[idx];
    annEditor.dragData = ann.type === 'line'
      ? { idx,
          startX: annEdSvgPos(e).x, startY: annEdSvgPos(e).y,
          origX1: ann.x1_pct, origY1: ann.y1_pct,
          origX2: ann.x2_pct, origY2: ann.y2_pct }
      : { idx,
          startX: annEdSvgPos(e).x, startY: annEdSvgPos(e).y,
          origX: ann.x_pct, origY: ann.y_pct };
    const svg = $('ann-editor-svg');
    svg.setPointerCapture(e.pointerId);
    annEdRender();
  }
}

function annEdDeleteIdx(idx) {
  annEditor.annotations.splice(idx, 1);
  if (annEditor.selectedIdx >= annEditor.annotations.length) annEditor.selectedIdx = -1;
  annEdRender();
}
```

- [ ] **Step 2: Manual test — select and move**

Click ↖ בחר/הזז. Click a line — it turns blue and is highlighted in the sidebar list. Drag it to a new position. Release — it stays in new position.

Click a dot — turns blue. Drag to new position.

- [ ] **Step 3: Manual test — delete**

Click 🗑 מחק. Click any line or dot — it disappears immediately. Also test: click × in the sidebar element list — element is removed.

- [ ] **Step 4: Commit**

```bash
git add admin.html
git commit -m "feat: add select/move and delete tools for annotation editor"
```

---

### Task 6: Save + composition_rule persistence + manual end-to-end test

**Files:**
- Modify: `admin.html`, `worker.js`

- [ ] **Step 1: Verify handleAnalysesUpdate saves composition_rule**

Read `worker.js` and search for `handleAnalysesUpdate`. Find the UPDATE SQL statement. Verify it includes `composition_rule`.

If the UPDATE SQL is:
```sql
UPDATE photo_analyses SET
  composition_html = ?,
  camera_json = ?,
  tags_json = ?,
  annotations_json = ?
WHERE photo_id = ?
```

Replace with:
```sql
UPDATE photo_analyses SET
  composition_rule = COALESCE(?, composition_rule),
  composition_html = ?,
  camera_json = ?,
  tags_json = ?,
  annotations_json = ?
WHERE photo_id = ?
```

And bind `body.composition_rule || null` as the first parameter (before `composition_html`). The `COALESCE` ensures that if no `composition_rule` is sent, the existing value is kept.

- [ ] **Step 2: Commit worker.js if changed**

```bash
git add worker.js
git commit -m "fix: persist composition_rule in handleAnalysesUpdate"
```

- [ ] **Step 3: End-to-end test**

1. Open admin → click edit (✏️) on any analysis that has `leading_lines`
2. Click "ערוך ויזואלי" — editor opens with rule overlay and existing annotations
3. Change rule dropdown to "חוק השליש" — grid overlay updates immediately
4. Draw 2 lines using ✏️ tool, place 1 dot using 📍 tool
5. Click "שמור" — editor closes, learn-edit dialog is still open
6. In the sidebar element list of learn-edit, the new annotations appear as rows
7. Click "שמור" in learn-edit — data saved to DB
8. Navigate to the photo's `/learn/` page — verify:
   - Rule overlay shows thirds grid (not leading_lines fan)
   - The 2 lines appear in gold
   - The dot appears with its label

- [ ] **Step 4: Push**

```bash
git add admin.html worker.js
git commit -m "feat: complete visual annotation editor — end-to-end save"
git push
```

---

### Task 7: Manual verification checklist

- [ ] Draw a diagonal line from top-left to bottom-right — line appears correctly at angle
- [ ] Draw a short line (< 2% distance) — nothing is added (accidental click prevention)
- [ ] Place dot near right edge, anchor "right" — label appears to the right of the dot
- [ ] Select a line, drag it — moves correctly
- [ ] Delete from sidebar × button — works same as delete tool
- [ ] Change photo rule to "סימטריה" — single vertical line overlay appears
- [ ] Re-open editor on same photo — previous annotations pre-loaded correctly
- [ ] Close editor with ✕ without saving — learn-edit annotations unchanged
