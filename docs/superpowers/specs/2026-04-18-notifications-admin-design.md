# Notifications + Admin Dashboard — Design Spec

_Date: 2026-04-18_

---

## Overview

Two features:
1. **Purchase notifications** — email + WhatsApp to Amit when a digital download is purchased
2. **Admin purchases tab** — view purchases, active tokens, and revenue stats in the existing admin dashboard

---

## 1. Purchase Notifications

### Trigger
`handleVerifyPayment` in `worker.js` — after tokens are successfully created in D1, before returning the response.

### Email (Resend)
Reuses the existing Resend integration already in the worker.

- **To:** `env.ADMIN_EMAIL` (existing env var)
- **From:** `Amit Photos <onboarding@resend.dev>`
- **Subject:** `רכישה חדשה 📸 — {photo title} ({size})`
- **Body:** Simple HTML: photo title(s), size, amount paid, txn_id, download token link(s)
- **Condition:** Only if `env.RESEND_API_KEY` is set

### WhatsApp (CallMeBot)
- **Endpoint:** `https://api.callmebot.com/whatsapp.php?phone={PHONE}&text={MESSAGE}&apikey={APIKEY}`
- **Message:** `רכישה חדשה! 📸 {titles} | {size} | ₪{amount} | {txn_id}`
- **Env vars:** `CALLMEBOT_PHONE` (e.g. `972501234567`), `CALLMEBOT_APIKEY`
- **Condition:** Only if both vars are set
- **Error handling:** Fire-and-forget via `ctx.waitUntil` — notification failure must NOT block download

### CallMeBot Setup (one-time)
1. Send WhatsApp to `+34 644 75 31 00`: `I allow callmebot.com to send me messages`
2. Save the API key received back
3. Set `CALLMEBOT_PHONE` and `CALLMEBOT_APIKEY` as Worker secrets

---

## 2. Admin Purchases Tab

### Location
New tab "רכישות" in existing `admin.html`.

### D1 Schema Change
Add `amount REAL DEFAULT 0` column to `download_tokens`.
Migration: `ALTER TABLE download_tokens ADD COLUMN amount REAL DEFAULT 0`

`handleVerifyPayment` saves `mc_gross` at insert time so revenue is accurate.

### Purchases Table
Queries via new Worker endpoint `GET /api/admin/purchases`.

Columns: כותרת | גודל | סכום | תאריך | סטטוס | txn_id

Filters: הכל / פעיל / שומש / פג תוקף

### Manual Token Creation
Button "צור טוקן" — form with Photo ID + Size, calls `POST /api/admin/create-token`.
Manual tokens get 30-day expiry.

### Statistics Panel
3 cards at top of tab:
- **סה"כ הכנסות** — sum of `amount` from all tokens
- **רכישות החודש** — count created this month
- **תמונות פופולריות** — top 5 by purchase count

### Worker API
`GET /api/admin/purchases?filter=all|active|used|expired`
- Requires `checkAuth`
- Joins `download_tokens` with `photos` for titles
- Returns `{ tokens, stats: { total_revenue, this_month, top_photos } }`

`POST /api/admin/create-token`
- Body: `{ photo_id, size }`
- Returns `{ token, url }`

---

## Scope

Not included:
- Customer email notifications (no email collected in PayPal flow)
- Webhook-based notifications
- Export/CSV

---

## Environment Variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `CALLMEBOT_PHONE` | Worker secret | Amit's phone (international format) |
| `CALLMEBOT_APIKEY` | Worker secret | CallMeBot API key |
| `ADMIN_EMAIL` | Worker var | Already exists |
| `RESEND_API_KEY` | Worker secret | Already exists |
