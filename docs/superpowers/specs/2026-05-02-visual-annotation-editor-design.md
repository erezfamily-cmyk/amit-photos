# Visual Annotation Editor — Design Spec

## Goal

Add a fullscreen visual editor to admin.html that lets the user draw lines and place labeled dots directly on a photo, replacing the current x_pct/y_pct table. Changes save back to the same `annotations_json` + `composition_rule` columns — no backend changes required.

## Architecture

The editor is a new `<dialog id="ann-editor-dialog">` opened from the existing learn-edit dialog. It shares the same data layer: reads/writes `annotations_json` (array of annotation objects) and `composition_rule` (string). The rendering on `/learn/` pages is unchanged — `buildRuleOverlay` and the dot annotation renderer already handle both dots and `type:"line"` annotations.

**Tech Stack:** Vanilla JS + SVG overlay on `<img>`, Cloudflare D1 (existing), admin.html (single file)

---

## Layout

```
┌─────────────────────────────────────────────────────────┐
│  [✕ סגור]                          עורך ויזואלי — [title] │
├──────────┬──────────────────────────────────────────────┤
│  פאנל    │                                              │
│  כלים    │            קנבס התמונה                       │
│  140px   │         (SVG overlay מעל img)                │
│          │                                              │
│  [שמור]  │                                              │
└──────────┴──────────────────────────────────────────────┘
```

---

## Tool Panel (right-to-left, fixed 140px)

1. **חוק קומפוזיציה** — `<select>` with all 6 rules. Changing it updates `composition_rule` live and re-renders the static rule overlay (rule_of_thirds grid, symmetry line, etc.) behind the annotations.

2. **כלי ציור** — 4 mode buttons (only one active at a time):
   - ✏️ **צייר קו** — click+drag on canvas draws a line
   - 📍 **הוסף נקודה** — click on canvas places a dot; small inline popup asks for label text (Enter to confirm, Escape to cancel)
   - ↖ **בחר/הזז** — click selects an element (highlighted in blue), drag moves it; click empty space deselects
   - 🗑 **מחק** — click any element to delete it immediately

3. **אלמנטים** — scrollable list of all current annotations. Each row shows icon (— for line, • for dot) + label/name + ×delete button.

4. **שמור** button at bottom — saves to `annotations_json` hidden field in learn-edit dialog, then closes this dialog.

---

## Canvas Interactions

### Drawing a line (✏️ mode)
- `mousedown` on canvas → record start point as `(x/width*100, y/height*100)`
- `mousemove` → draw temporary dashed line from start to cursor
- `mouseup` → finalize line; show small popup at midpoint: "שם הקו (אופציונלי):" with text input + OK + Skip buttons
- Line stored as `{ type: "line", x1_pct, y1_pct, x2_pct, y2_pct, label: "" }`

### Placing a dot (📍 mode)
- `mousedown` on canvas → record position, show inline popup: "תווית:" text input + OK + ביטול
- On OK → store as `{ x_pct, y_pct, label, anchor: "bottom" }`

### Select + move (↖ mode)
- `mousedown` on an element → select it (highlight), start drag tracking
- `mousemove` while dragging → update element position live
- `mouseup` → finalize new position
- `mousedown` on empty canvas → deselect all
- Hit target: 12px radius around dot center; 8px tolerance around line segment (using point-to-segment distance)

### Delete (🗑 mode)
- `mousedown` on any element → delete immediately, re-render

---

## SVG Rendering

The canvas uses a `<div>` with `position:relative` containing:
1. `<img>` — the photo, 100% width/height
2. `<svg>` absolutely positioned over the image — draws:
   - Static rule overlay (from `buildRuleOverlay` logic, replicated in JS)
   - All `type:"line"` annotations as `<line>` elements in gold
   - All dot annotations as `<circle>` + `<text>` elements in gold
   - Selected element highlighted with blue stroke

All coordinates stored as percentages → multiply by `img.offsetWidth` / `img.offsetHeight` for SVG rendering.

---

## Data Flow

```
learn-edit dialog opens
  → reads annotations_json from hidden field (populated from DB on learnEdit())
  → "ערוך ויזואלי" button opens ann-editor-dialog
    → loads current annotations into canvas
    → user draws/edits
    → "שמור" → serializes annotations back to hidden field
  → learn-edit "שמור" → PUT /api/analyses/:id → DB updated
```

No new API endpoints. All changes flow through the existing `learnSave()` → `PUT /api/analyses/:id` path.

---

## Files Changed

| File | Change |
|------|--------|
| `admin.html` | Add `<dialog id="ann-editor-dialog">` HTML + all editor JS (open, canvas interactions, SVG render, save) + "ערוך ויזואלי" button in learn-edit dialog |

`worker.js` — no changes needed. The existing `handleAnalysesUpdate` already accepts `annotations_json` as a JSON string and stores it as-is.

---

## Out of Scope

- Undo/redo
- Touch/mobile support
- Changing the photo itself
- Editing composition_html text (stays in learn-edit dialog)
