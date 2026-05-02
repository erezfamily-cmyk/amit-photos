# Admin Analysis Editor — Split-Pane with Live Preview

**Date:** 2026-05-02  
**Status:** Approved

---

## Goal

Improve the admin photo analysis edit dialog so that:
1. Composition text is edited as **plain text** (not raw HTML)
2. The editor shows a **live preview** of the learn page alongside the form, so the admin can see exactly which field affects which part of the page

---

## Current State

`admin.html` contains `<dialog id="learn-edit-dialog">` (640px wide) with:
- `textarea#learn-edit-html` — raw HTML like `<p><strong>כותרת:</strong> גוף</p>`
- 4 text inputs: aperture, shutter, iso, focal (explanation only)
- Tags text input (comma-separated)
- `textarea#learn-edit-annotations` — raw JSON array

The composition HTML always follows a fixed structure: exactly 3 `<p>` blocks, each starting with `<strong>label:</strong> body text`.

JS functions: `learnEdit(photoId)` (opens + populates), `learnSave()` (PUT to `/api/admin/analyses/{id}`), `closeLearnModal()`.

---

## Design

### Dialog Size

Widen dialog from `min(640px,95vw)` to `min(1200px,96vw)`.  
Add two-column layout: right column = form (380px fixed), left column = preview (fills remaining space).

Below 900px (mobile/narrow): show only the form column. Add a toggle button "הצג תצוגה מקדימה" that swaps to preview-only mode.

---

### Form Column (right)

#### Photo header
Small thumbnail (60×60px, `object-fit:cover`) + photo title, shown at the top of the form for context.

#### Composition (3 plain-text paragraphs)
Replace the single raw-HTML textarea with **3 paragraph rows**, each containing:
- `input[type=text]` — paragraph label (e.g., "פוקוס")
- `textarea` (2 rows) — paragraph body text

Labels above the group: "ניתוח קומפוזיציה (3 פסקאות)"

On **save**, reconstruct HTML:
```js
`<p><strong>${label1}:</strong> ${body1}</p>\n<p><strong>${label2}:</strong> ${body2}</p>\n<p><strong>${label3}:</strong> ${body3}</p>`
```

On **load** (`learnEdit`), parse existing `composition_html` into 3 pairs using a regex:
```js
/<p><strong>([^<]+):<\/strong>\s*([\s\S]*?)<\/p>/g
```
If fewer than 3 matches, fill remaining rows with empty strings.

#### Camera fields
Unchanged: 4 text inputs (aperture, shutter, iso, focal) in a 2-column grid.

#### Tags
Unchanged: single text input, comma-separated.

#### Annotations JSON
Unchanged: raw JSON textarea. (Complex enough that structured UI would be a separate feature.)

---

### Preview Column (left)

Renders a **client-side replica** of the `/learn/{photoId}` page using the same CSS and HTML structure from `worker.js`. No server round-trip needed.

Sections rendered in the preview:
1. **Photo** — `<img>` with thumbnail URL (loaded from the analysis data)
2. **Camera cards** — 4 cards (צמצם / מהירות תריס / ISO / מרחק מוקד) with value + explanation
3. **Composition box** — the 3-paragraph text rendered as `<p><strong>label:</strong> body</p>`
4. **Tags row** — pill tags

Sections **not** rendered in preview (static, no editing):
- Rule overlay (SVG lines — depends on `composition_rule`, not editable here)
- Bokeh diagram (static SVG)
- Nav row

#### Live update behavior
Each form input fires an `input` event listener that calls `updatePreview()`. This function reads all current form values, builds the HTML, and patches the preview DOM directly — no re-render of the whole preview, just targeted updates:
- Composition input → patch `.comp-box` innerHTML
- Camera input → patch the matching `.cam-card` `.cam-value` / `.cam-desc`
- Tags input → patch `.tags-row` innerHTML

#### Highlight on change
When a section updates, add a CSS class `preview-highlight` (yellow border, 600ms fade-out via `setTimeout`) to the updated element so the admin can see what changed.

---

## Data Flow

```
learnEdit(photoId)
  → GET /api/admin/analyses/{photoId}
  → populate form fields (parse composition HTML → 3 label+body pairs)
  → load thumbnail from photo data
  → call updatePreview() once to render initial preview

user types in any field
  → input event → updatePreview()
  → patch preview DOM + flash highlight

learnSave()
  → reconstruct composition_html from 3 pairs
  → reconstruct camera_json from existing values + new explanations
  → PUT /api/admin/analyses/{photoId}
  → toast + closeLearnModal()
```

---

## Files Changed

| File | Change |
|------|--------|
| `admin.html` | Widen dialog, add preview column, replace HTML textarea with 3-paragraph fields, add `updatePreview()`, add CSS for split layout and highlight |

No changes to `worker.js` — the API (`handleAnalysesUpdate`) already accepts `composition_html` as a string, so reconstructed HTML from plain-text fields is compatible.

---

## Edge Cases

- **Fewer than 3 existing paragraphs** — fill missing rows with empty strings; on save, still emit all 3 `<p>` tags (empty body is fine).
- **Composition HTML with non-standard markup** — the regex extracts what it can; unrecognized content is discarded. This is acceptable since Claude always generates the standard 3-paragraph format.
- **Missing thumbnail** — fall back to `photo.url` (same as the live page).
- **Narrow screen** — below 900px, hide preview column; show toggle button to switch views.
