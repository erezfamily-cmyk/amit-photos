# Locations English — Phase 1 Design
**Date:** 2026-05-16  
**Scope:** Full English localization of the Locations section (index + spot pages) with AI-powered content generation and Admin support.

---

## Overview

Add English content for all photography locations. The existing Hebrew content stays untouched; English is stored in parallel columns in D1. The spot and index pages read `localStorage.getItem('lang')` and render accordingly. The admin panel gets a tabbed editor (HE | EN) with a "Generate English" button powered by Claude API.

---

## 1. Database — D1 Schema

**Migration:** `ALTER TABLE locations ADD COLUMN ...` for each new field.

New columns added to the `locations` table:

| Column | Type | Description |
|--------|------|-------------|
| `title_en` | TEXT | English title |
| `description_en` | TEXT | Full English description |
| `best_time_en` | TEXT | Best time to visit |
| `equipment_en` | TEXT | Recommended equipment |
| `my_tip_en` | TEXT | Amit's personal tip |
| `when_to_visit_en` | TEXT | JSON — same structure as `when_to_visit`, English notes only (ratings unchanged) |
| `recommended_gear_en` | TEXT | JSON — same structure as `recommended_gear`, English names |

`region` is translated client-side via a JS mapping (e.g. `ישראל → Israel`, `איטליה → Italy`). No new column needed.

All new columns default to NULL. A NULL value signals "not yet translated."

---

## 2. New Worker: Generate English Content

**Handler:** new function `handleAdminLocationsGenerateEn` in `worker.js`  
**Endpoint:** `POST /api/admin/locations/[slug]/generate-en`  
**Auth:** `X-Admin-Password` header (same pattern as all admin routes)

**Request body:**
```json
{ "slug": "roma" }
```

**Flow:**
1. Fetch the location row from D1 by slug (Hebrew fields)
2. Call Claude API (`claude-sonnet-4-6`) with a structured prompt
3. Return JSON with all `*_en` fields

**Claude prompt strategy:**
- System: "You are Amit Erez, an Israeli photographer writing for an international travel-photography audience."
- User: Pass Hebrew fields as labeled JSON
- Instruct: Return valid JSON with keys matching the `*_en` columns
- Style: Personal, first-person, inspiring, travel-photography tone. Descriptions should be adapted (not literal translation) — vivid, location-specific, useful for photographers visiting the spot.
- `when_to_visit_en`: same JSON structure, translate only the `note` values; keep `rating` keys unchanged
- `recommended_gear_en`: translate gear names to standard English photography terminology

**Response:**
```json
{
  "title_en": "Rome — Eternity You Can Photograph",
  "description_en": "...",
  "best_time_en": "...",
  "equipment_en": "...",
  "my_tip_en": "...",
  "when_to_visit_en": "{\"summer\":{\"rating\":\"ok\",\"note\":\"...\"},...}",
  "recommended_gear_en": "[{\"name\":\"Wide-angle 16-35mm\",\"primary\":true},...]"
}
```

The worker does NOT save to D1 — admin JS previews and saves after user review.

---

## 3. Admin Panel Changes (`admin.html`)

**Location editor gets tabbed UI:**

```
[ עברית ]  [ English ]
```

- **Hebrew tab:** existing fields, no changes
- **English tab:** mirrors same fields (`title_en`, `description_en`, `best_time_en`, `equipment_en`, `my_tip_en`, `when_to_visit_en`, `recommended_gear_en`) — all `dir="ltr"`, English placeholders
- Above English tab: **"✨ Generate English"** button
  - Shows loading spinner while calling worker
  - Fills all EN fields with generated content
  - Fields remain editable after generation
- Save button sends both HE and EN fields together via existing location save endpoint (which needs updating to accept `*_en` fields)

**Existing save endpoint** (`functions/api/locations/[slug].js` or equivalent) — extend to accept and persist the new `*_en` columns.

**Locations list in Admin** — add a small "EN" badge on cards that have `title_en` populated, so it's easy to see translation coverage.

---

## 4. Spot Page (`/locations/spot/index.html`)

**Language detection:**
```js
const lang = localStorage.getItem('lang') || 'he';
```
Listen for `storage` event to re-render when user switches language via nav.

**Rendering logic:**
- If `lang === 'en'` and `title_en` is populated → use `*_en` fields
- If `lang === 'en'` and `title_en` is NULL → use Hebrew fields + show badge `🔜 English coming soon`
- If `lang === 'he'` → always use Hebrew fields

**Document direction:**
```js
document.documentElement.dir = lang === 'en' ? 'ltr' : 'rtl';
document.documentElement.lang = lang;
```

**Font:** When `lang === 'en'`, body uses `font-family: 'Inter', system-ui, sans-serif`. Syne already loaded for headings.

**Fields that change by language:**
- Title, region (JS mapping), description, best_time, equipment, my_tip
- Season notes (`when_to_visit_en` JSON)
- Gear chip names (`recommended_gear_en` JSON)

**Fields that stay fixed regardless of language:**
- Map embed, coordinates, Waze link
- Photo gallery
- Share buttons
- Related guide chips (URL paths are universal)

---

## 5. Locations Index (`/locations/index.html`)

- Card title and region text switch to English when `lang === 'en'`
- Hero heading, subtitle, filter buttons, sort dropdown — add keys to `i18n.js`:
  - `locations.hero.title`, `locations.hero.sub`, `locations.filter.all`, `locations.sort.label`, etc.
- "Suggest a location" button text switches language
- Cards without `title_en` show Hebrew title as fallback

**Region mapping (client-side JS object):**
```js
const REGION_MAP = {
  'ישראל': 'Israel', 'איטליה': 'Italy', 'יוון': 'Greece',
  'צרפת': 'France', 'ספרד': 'Spain', /* extend as needed */
};
```

---

## 6. Content Generation Workflow

After code is deployed:

1. Open Admin → Locations list
2. Click a location → switch to English tab → click "✨ Generate English"
3. Review generated content (edit if needed)
4. Click Save
5. Repeat for all locations

All existing locations get English content generated via admin in one session. No batch script needed — the admin UI makes it fast enough.

---

## 7. Files Changed / Created

| File | Change |
|------|--------|
| `functions/api/locations/generate-en.js` | **New** — Claude-powered generation worker |
| `functions/api/locations/[slug].js` | **Extend** — accept `*_en` fields in PATCH/PUT |
| `locations/spot/index.html` | **Update** — bilingual rendering |
| `locations/index.html` | **Update** — bilingual cards + UI |
| `assets/js/i18n.js` | **Extend** — add locations index keys |
| `admin.html` | **Update** — tabbed EN editor + "Generate" button + EN badge |
| D1 migration SQL | **New** — ALTER TABLE to add 7 columns |

---

## 8. Out of Scope (Phase 1)

- Camera guides EN (Phase 2)
- `/learn/` photo analysis (separate project)
- SEO hreflang tags (can be added later)
- Automatic language detection from browser headers
