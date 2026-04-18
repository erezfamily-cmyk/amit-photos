# Photo Price Override — Design Spec

## Goal

Allow the photographer to set custom per-photo download prices (small/medium/large) from the admin panel, with a global default and per-photo overrides.

---

## Features

### 1. Global Prices Section (top of Photos tab in admin)

- Three numeric inputs: קטנה / בינונית / גדולה
- Pre-filled from `settings` table (`key='prices'`)
- "שמור" button → POSTs to `/api/admin/prices`
- Saving global prices does **not** affect photos that already have an override — their custom prices remain intact
- Default values: small=19, medium=59, large=129 (₪)

### 2. Per-Photo Price Override (₪ button on each photo card)

**Button states:**
- No override → normal color (white/gray)
- Has override → light blue (visually distinct from the gold "חדש" star)

**Popup behavior:**
- Clicking ₪ opens a small popup near the button
- Popup title: "מחיר מיוחד לתמונה זו"
- Three fields: קטנה / בינונית / גדולה
- Fields pre-filled with: current photo override if set, otherwise global prices
- **"עדכן מחירים"** button → saves override as JSON to `photos.price_override`, closes popup
- **"אפס לברירת מחדל"** button → sets `photos.price_override = NULL`, closes popup, button returns to normal color
- Clicking outside the popup closes it without saving

### 3. Checkout Behavior (worker.js)

- Global prices loaded from `settings` table on every verify-payment request
- For single-photo purchases: if `photos.price_override` is set, use those values instead of global
- For bundle purchases (multiple photos): always use global prices (no per-photo override)
- PayPal amount validation uses the resolved price

---

## Data Model

### `settings` table (existing)
```
key='prices' → value='{"small":19,"medium":59,"large":129}'
```

### `photos` table
```sql
price_override REAL  -- to be replaced with TEXT (JSON)
```
**Change:** `price_override` column type changes from `REAL` to `TEXT` (stores JSON `{"small":X,"medium":Y,"large":Z}` or NULL).

> Note: Column was added as REAL in a previous session. A new column `price_overrides` (TEXT) will be added and `price_override` left unused (SQLite doesn't support DROP COLUMN easily).

---

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/admin/prices` | public | Get global prices |
| POST | `/api/admin/prices` | admin | Save global prices |
| POST | `/api/admin/photo-price` | admin | Save or clear per-photo override |

### POST `/api/admin/photo-price` body
```json
{ "photo_id": "abc", "price_override": {"small": 1, "medium": 1, "large": 1} }
// or to clear:
{ "photo_id": "abc", "price_override": null }
```

---

## UI Components

### Popup
- Positioned absolutely near the ₪ button (below or above depending on card position)
- Dark background matching admin theme (`var(--bg-card)`)
- Close on outside click or Escape key
- Only one popup open at a time (opening a new one closes the previous)

### ₪ Button
- Same size/style as other `btn-icon` buttons
- Active state: `color: #60a5fa` (light blue, Tailwind blue-400)

---

## Files Changed

- `worker.js` — update `handleAdminPhotoPrice` to accept JSON; update `handleVerifyPayment` to parse JSON override
- `admin.html` — global price inputs, ₪ button popup, JS logic
- D1 migration — add `price_overrides TEXT` column to `photos`
