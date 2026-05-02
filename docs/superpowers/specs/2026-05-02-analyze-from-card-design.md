# Analyze Photo from Card — Design Spec

**Date:** 2026-05-02

## Summary

Add a "analyze" button (🔬) to each photo card in the admin gallery, allowing the admin to trigger a Claude analysis for a specific photo directly from the card. The automatic random analysis button in the analyses section remains unchanged.

## Components

### 1. Photo Card Button

- Add a 🔬 `btn-icon` button to the `.photo-actions` row of each photo card
- Title: `"ייצר ניתוח"`
- During processing: button disabled, icon replaced with `"⏳"`
- On success: toast `"ניתוח נוצר: [photo title]"` + reload analyses section
- On error: toast with error message, button re-enabled

### 2. Frontend Function

New function `analyzePhoto(photoId, btn)`:

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
```

### 3. Backend — `handleAnalysesGenerate`

- Parse JSON body from request
- If `photo_id` present: fetch that specific photo by ID (skip the "unanalyzed only" filter — re-analysis is allowed)
- If `photo_id` absent: existing random selection logic unchanged
- R2 size check (≤4.5MB) applies in both cases
- Claude call and DB insert logic identical for both paths

## Data Flow

```
[Card 🔬 click] → analyzePhoto(id, btn)
  → POST /api/analyses/generate  { photo_id }
    → fetch photo from DB by id
    → fetch from R2, check size
    → call Claude API
    → insert into photo_analyses
  ← { photo_id, title }
→ toast + loadLearn()
```

## Out of Scope

- Showing "already analyzed" state on the card button (not needed)
- Upload from computer (explicitly excluded)
- Any changes to the analyses section UI
