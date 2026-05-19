# Newsletter Distribution — Design Spec
**Date:** 2026-05-19
**Status:** Approved

## Overview

Add email distribution, a subscribe form, share buttons, and PDF download to the existing newsletter system. When Amit publishes a newsletter issue, he can send it to all subscribers with one click. Readers who receive the link can subscribe and share it with friends.

## Goals

- Amit sends each published issue to all subscribers via one button in the admin editor
- Subscribers receive a styled email with the issue content and a "read full issue" link
- Anyone who opens the newsletter web page can subscribe
- Readers can share via WhatsApp or copy-link
- Readers can print/download as PDF (no external libraries)

## Files Changed

| Action | File | Purpose |
|---|---|---|
| Modify | `worker.js` | New send API handler + subscribe/share/PDF HTML in newsletter pages + send button in admin editor |

All changes are in `worker.js`. No new files.

---

## Database

No new tables. Uses existing `subscribers` table:
```sql
-- already exists
CREATE TABLE subscribers (
  id        TEXT PRIMARY KEY,  -- UUID, also used as unsubscribe token
  name      TEXT,
  email     TEXT UNIQUE,
  notes     TEXT,
  created_at TEXT
);
```

---

## New API Route

### `POST /api/admin/newsletter/:id/send`

**Auth:** required (`checkAuth`)

**Logic:**
1. Fetch issue by `id` from `newsletter_issues` — must have `status = 'published'`, else return 400
2. Fetch all subscribers: `SELECT id, email, name FROM subscribers`
3. If no subscribers: return `{ error: 'אין נרשמים' }` 400
4. Build email HTML via `nlBuildEmailHtml(issue, origin)` (see below)
5. Send via Resend batch API: one email per subscriber, personalized unsubscribe URL
6. Return `{ ok: true, sent: N }`

**Error handling:** if Resend fails, return `{ error: message }` 500.

---

## Email HTML (`nlBuildEmailHtml`)

New function in worker.js. Produces email-safe HTML (table-based layout, inline styles, RTL). Subject line: `issue.title_he`.

**Structure (from `content_json`):**

```
┌─────────────────────────────┐
│  AMIT PHOTOS    גיליון #N   │  header, dark bg #111, gold text
├─────────────────────────────┤
│  [hero photo]               │  max 600px wide
│  photo title                │
│  hero text_he               │
├─────────────────────────────┤
│  מדריך החודש                │  (full issues only)
│  guide title + text_he      │
├─────────────────────────────┤
│  💡 tip title               │  gold background card
│  tip text_he                │
├─────────────────────────────┤
│  [קרא את הגיליון המלא →]    │  gold CTA button → /newsletter/:slug/
├─────────────────────────────┤
│  הסר אותי מהרשימה           │  unsubscribe link → /api/unsubscribe?token=:subscriberId
└─────────────────────────────┘
```

**Flash issues:** hero + tip + CTA only (no guide section).

**Constraints:**
- Background: `#111111` (dark, Gmail-compatible)
- Text: `#f0ede8`
- Accent / CTA: `#c8a96e`
- No CSS classes — inline styles only
- `dir="rtl"` on wrapper `<table>`
- Images hosted at `https://amitphotos.com/photos/:id.jpg`

---

## Admin Editor Changes (`handleAdminNlEditor`)

After the publish button row, add a send section that shows **only when `issue.status === 'published'`**:

```
[📧 שלח לנרשמים (X אנשים)]
```

- Button fetches `GET /api/subscribers` to show current count in label
- On click: `confirm('לשלוח לכל הנרשמים?')` → `POST /api/admin/newsletter/:id/send`
- While sending: button disabled, text "שולח..."
- On success: green message "נשלח ל-X נרשמים ✓"
- On error: red message with error text

Subscriber count loaded on page load via inline fetch in the editor's `<script>` block.

---

## Newsletter Issue Page Changes (`handleNlIssue`)

Three additions at the bottom of the page, before `</body>`:

### 1. PDF Button

Below the footer:
```html
<div class="nl-actions no-print">
  <button onclick="window.print()">🖨 הדפס / שמור PDF</button>
</div>
```

Styled: gold border, transparent background, hover fills gold. Hidden in `@media print` via existing `.no-print` rule.

### 2. Share Buttons

Same `nl-actions` bar:
```html
<a href="https://wa.me/?text=..." target="_blank">📲 שתף ב-WhatsApp</a>
<button onclick="copyLink()">🔗 העתק קישור</button>
```

WhatsApp URL: `https://wa.me/?text=${encodeURIComponent(issue.title_he + ' ' + pageUrl)}`

`copyLink()`: `navigator.clipboard.writeText(location.href)` → shows "הועתק!" for 2 seconds.

`pageUrl` is the canonical URL: `https://amitphotos.com/newsletter/:slug/`

### 3. Subscribe Form

After the actions bar, before `</body>`:
```html
<section class="nl-subscribe-section no-print">
  <div class="nl-subscribe-card">
    <div class="nl-subscribe-title" data-he="רוצה לקבל את הניוזלטר?" data-en="Want to receive the newsletter?">
      רוצה לקבל את הניוזלטר?
    </div>
    <p data-he="גיליונות חודשיים..." data-en="Monthly issues...">גיליונות חודשיים — תמונות, מדריכים ומקומות צילום</p>
    <form onsubmit="nlSubscribe(event)">
      <input type="email" id="nl-email" placeholder="כתובת המייל שלך" required>
      <button type="submit">הרשמה</button>
    </form>
    <p id="nl-sub-msg"></p>
  </div>
</section>
```

`nlSubscribe(e)`: POST to `/api/subscribers` with `{ email }`. On success: "נרשמת! תקבל את הגיליון הבא ישירות למייל 🎉". On `already: true`: "כבר רשום/ה — תקבל את הגיליון הבא!".

**CSS:** gold-bordered card, same style as `nl-tip-card`. Hidden in `@media print`.

**i18n:** `data-he` / `data-en` attributes on all text elements, covered by existing `applyLang()` call.

---

## Technical Constraints

- No new npm packages — vanilla JS + Cloudflare Workers native fetch
- Resend API: existing `env.RESEND_API_KEY` + `env.FROM_EMAIL`
- Unsubscribe token: existing subscriber `id` (UUID), existing `/api/unsubscribe?token=:id` route
- `escXml()` on all dynamic values in HTML
- Resend batch: single API call with array of message objects (existing pattern in worker.js line ~1471)
