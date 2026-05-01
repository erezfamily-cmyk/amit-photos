# Sale Page — Weekly Rotating Discount Gallery

**Date:** 2026-05-01  
**Status:** Approved for implementation

---

## Overview

A dedicated sale page (`/sale/`) displaying 50 randomly-selected photos at 20% discount. Photos rotate every Sunday automatically via a GitHub Actions workflow. The quiz "לגלריה" button redirects here instead of `/?discount=quiz`.

---

## Data Model

### D1 Schema Changes

Add two columns to the `photos` table:

```sql
ALTER TABLE photos ADD COLUMN on_sale INTEGER DEFAULT 0;
ALTER TABLE photos ADD COLUMN sale_started_at TEXT;  -- ISO timestamp, set when rotation runs
```

`sale_started_at` is the same for all current on-sale photos (set at rotation time). The sale end date is computed as `sale_started_at + 7 days`.

---

## API Changes (worker.js)

### GET /api/sale-photos
Returns all published photos where `on_sale=1`, including `sale_started_at` for computing the countdown.

```json
[
  {
    "id": "...",
    "title": "...",
    "category": "...",
    "thumbnail": "/photos/...",
    "url": "/photos/...",
    "sale_started_at": "2026-05-05T00:00:00Z"
  }
]
```

### PATCH /api/photos (existing, extended)
Admin endpoint already handles partial updates. Extend to accept `on_sale` (boolean).

```json
{ "id": "...", "on_sale": true }
```

When toggling a single photo on, set its `sale_started_at` to the current Monday's midnight.

### POST /api/sale/rotate (admin only, X-Admin-Password required)
Rotates the sale:
1. Sets `on_sale=0` for all current sale photos
2. Randomly selects 50 published photos and sets `on_sale=1`, `sale_started_at=now`
3. Returns `{ rotated: 50, next_rotation: "<ISO date>" }`

---

## Sale Page (/sale/index.html)

Standalone page, RTL, same dark theme as quiz page.

### Structure

**Header bar:** "Amit Photos" logo linking back to main site.

**Sale banner:**
- Title: "🏷️ מבצע השבוע"
- Subtitle: "50 תמונות נבחרות ב-20% הנחה"
- Countdown timer showing days/hours/minutes until next Sunday midnight
- "המבצע מתחלף כל שבוע" note

**Photo grid:**
- Masonry or 2-column grid (mobile-first)
- Each photo card shows:
  - Thumbnail image
  - Category tag
  - Original price crossed out (₪X)
  - Sale price in gold (₪Y)
  - "20% הנחה" red badge
- Clicking a photo opens the existing buy modal (same as gallery)

**Footer:** Link back to full gallery.

### Price Logic
Sale price = `Math.round(base_price * 0.80)`. Base price from the existing global prices config (same as gallery).

### Countdown Logic
```js
const saleEnd = new Date(sale_started_at);
saleEnd.setDate(saleEnd.getDate() + 7);
// Count down to saleEnd
```

If no `sale_started_at` available (API empty), show "המבצע יתחיל בקרוב".

---

## Weekly Rotation Workflow

**File:** `.github/workflows/weekly-sale-rotation.yml`  
**Schedule:** Every Sunday at 00:00 Israel time (21:00 UTC Saturday)  
**Trigger:** Also `workflow_dispatch` for manual rotation

```yaml
on:
  schedule:
    - cron: '0 21 * * 6'   # Saturday 21:00 UTC = Sunday 00:00 Israel
  workflow_dispatch:
```

**Steps:**
1. Call `POST /api/sale/rotate` with Admin token
2. Log result (how many rotated, next rotation date)

No Python script needed — a single `curl` call is sufficient.

---

## Admin Panel Changes

**Photo grid badges:** Add golden "מבצע" badge on photos where `on_sale=1`, similar to the existing "השבוע" badge.

**Sale management section** (in existing admin panel):
- Current sale stats: "50 תמונות במבצע | נגמר ב-X ימים"
- "רוטציה ידנית עכשיו" button → calls `POST /api/sale/rotate`
- Per-photo toggle: clicking the "מבצע" badge opens a confirm dialog to remove/add that photo from the sale

---

## Quiz Integration

In `quiz/index.html`, change the result screen button:

```js
// Before:
document.getElementById('btn-gallery').href = `${SITE_URL}/?discount=quiz`;

// After:
document.getElementById('btn-gallery').href = `${SITE_URL}/sale/`;
```

Button text changes from "🛍️ לגלריה עם ההנחה" to "🛍️ לגלריה המבצע".

Remove the `quizDiscountActive` logic from `gallery.js` (no longer needed — the discount is now encoded in the sale page itself, not a URL parameter).

---

## Error Handling

- If `/api/sale-photos` returns 0 photos: show "המבצע יתחיל בקרוב" message
- If rotation fails (workflow error): existing photos remain on sale (no photos lose their discount mid-week)
- Buy modal reuses existing code — no changes needed

---

## Out of Scope

- Different discount percentages per photo
- User-specific discount codes
- Sale history / analytics
- Email notifications for sale start
