# Photo of the Week — Design Spec

## Goal

Allow the admin to set one photo per week as a featured "תמונת השבוע" with an automatic 25% discount on all purchase sizes (small/medium/large). The admin receives an auto-suggestion; the discount is applied at purchase time.

## Architecture

The feature uses the existing `settings` D1 table (key/value) to store the selected photo ID and discount rate. The `GET /api/photos` endpoint exposes an `is_week_photo` flag per photo. The admin UI shows a dedicated section with a suggest-and-confirm flow. The gallery and buy modal read the flag to render the badge and discounted prices client-side.

**Tech Stack:** Cloudflare Worker, D1 (settings table), Vanilla JS (admin.html + gallery.js)

---

## Data Layer

Two settings keys (upserted via existing settings infrastructure):

| key | value |
|-----|-------|
| `photo_of_week_id` | photo ID string, or empty |
| `photo_of_week_discount` | `0.25` |

No schema changes needed — `settings` table already exists.

---

## API

### `POST /api/admin/photo-of-week/suggest`
Returns a suggested photo: random pick from the bottom 20% of photos sorted by purchase count.

**Response:**
```json
{ "photo": { "id": "...", "title": "...", "thumbnail": "..." } }
```

**Logic:**
1. Query all photos with their purchase counts (JOIN orders or use existing stats).
2. Sort ascending by purchase count.
3. Take bottom 20% (min 1 photo).
4. Return a random pick from that slice.

### `POST /api/admin/photo-of-week/set`
Sets the photo of the week.

**Body:** `{ "photo_id": "..." }`

**Action:** Upsert `photo_of_week_id` in settings table. Return `{ "ok": true }`.

### `GET /api/photos` (modified)
Read `photo_of_week_id` from settings. Add `is_week_photo: true` to the matching photo object, `false` (or omit) for all others.

Also add `week_photo_discount: 0.25` to the matching photo's data (read from `photo_of_week_discount` setting).

---

## Admin UI

New section in admin.html titled **"⭐ תמונת השבוע"**, placed above the photos grid.

**States:**

1. **No photo set** — Shows "לא נבחרה תמונת שבוע" + "הצע תמונה" button.
2. **Suggestion pending** — Shows thumbnail + title of suggested photo, "קבע" (confirm) and "הצע אחרת" (re-suggest) buttons.
3. **Photo set** — Shows current photo thumbnail + title + "החלף" button (re-triggers suggest flow).

All actions are async with loading state. No page reload needed.

---

## Gallery Display

**Photo card badge:**
- If `is_week_photo === true`, render a badge on the card: `⭐ תמונת השבוע`
- Badge style: absolute top-left, small pill, gold background (`#c9a84c`), white text, RTL.

**Lightbox / Buy modal:**
- If `is_week_photo === true`, for each size show:
  - Original price with strikethrough
  - Discounted price (original × 0.75, rounded)
  - Small label "25% הנחה השבוע"
- Discount is computed client-side from `week_photo_discount`.
- The discounted price is what gets submitted to the purchase flow.

---

## Error Handling

- If suggest returns no photo (empty catalog): show "אין תמונות זמינות".
- If set fails: show error toast, keep previous state.
- If `photo_of_week_id` is set but photo no longer exists in catalog: treat as unset (no badge shown, suggest flow resets).

---

## Out of Scope

- Automatic weekly rotation (manual admin action only).
- Email/push notification when photo of week changes.
- Canvas prints discount (only small/medium/large sizes).
- Discount customization UI (hardcoded 25% for now, stored in settings for future).
