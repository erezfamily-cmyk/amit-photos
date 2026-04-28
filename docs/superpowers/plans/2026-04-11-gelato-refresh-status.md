# Gelato Refresh Status Button — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-row "רענן סטטוס" button in the admin print orders table that fetches the live status from Gelato and updates D1.

**Architecture:** New `POST /api/print/refresh-status` endpoint in `worker.js` that calls Gelato's status API and updates D1. Admin UI adds a small refresh button on `in_production` rows that calls the endpoint and updates the badge in place.

**Tech Stack:** Cloudflare Worker (worker.js), D1 SQLite, Gelato API v2, Vanilla JS in admin.html

---

### Task 1: Backend — `/api/print/refresh-status` endpoint

**Files:**
- Modify: `worker.js` (add `handlePrintRefreshStatus` function + route)

**Context:**
- `checkAuth(request, env)` checks `X-Session-Token` header — already exists at line ~29
- `jsonRes(data, status, request)` — already exists at line ~21
- `unauth(request)` — already exists at line ~27
- `GELATO_API` const = `'https://order.gelatoapis.com/v4'` — but status API uses different domain: `https://api.gelato.com/v2`
- Gelato status API: `GET https://api.gelato.com/v2/order/status/{orderReferenceId}` with header `X-API-KEY`
- Webhook STATUS_MAP (reuse exact same mapping): `created/passed/in_production/printed → in_production`, `shipped/delivered → shipped`, `cancelled/failed → cancelled`
- D1 table `print_orders` columns: `id`, `prodigi_order_id` (= Gelato order ID), `status`
- Route registrations are at line ~1252 in the big `if/else` block

- [ ] **Step 1: Add `handlePrintRefreshStatus` function to worker.js**

Find `async function handlePrintWebhook` and add this new function **directly before it** (around line 887):

```js
async function handlePrintRefreshStatus(request, env) {
  if (request.method !== 'POST') return jsonRes({ error: 'method not allowed' }, 405, request);
  if (!await checkAuth(request, env)) return unauth(request);

  const { orderId } = await request.json().catch(() => ({}));
  if (!orderId) return jsonRes({ error: 'orderId חסר' }, 400, request);

  const order = await env.DB.prepare(
    'SELECT id, prodigi_order_id, status FROM print_orders WHERE id=?'
  ).bind(orderId).first();
  if (!order) return jsonRes({ error: 'הזמנה לא נמצאה' }, 404, request);

  const gelatoOrderId = order.prodigi_order_id;
  if (!gelatoOrderId) return jsonRes({ error: 'אין Gelato order ID' }, 400, request);

  const gelatoRes = await fetch(
    `https://api.gelato.com/v2/order/status/${gelatoOrderId}`,
    { headers: { 'X-API-KEY': env.GELATO_API_KEY } }
  );
  if (!gelatoRes.ok) {
    const err = await gelatoRes.text();
    return jsonRes({ error: `שגיאת Gelato: ${gelatoRes.status} ${err}` }, 502, request);
  }
  const gelatoData = await gelatoRes.json();

  const STATUS_MAP = {
    'created':       'in_production',
    'passed':        'in_production',
    'in_production': 'in_production',
    'printed':       'in_production',
    'shipped':       'shipped',
    'delivered':     'shipped',
    'cancelled':     'cancelled',
    'failed':        'cancelled',
  };
  const rawStatus = (gelatoData.productionStatus || '').toLowerCase();
  const newStatus = STATUS_MAP[rawStatus];

  if (newStatus && newStatus !== order.status && order.status !== 'cancelled') {
    await env.DB.prepare(
      'UPDATE print_orders SET status=? WHERE id=?'
    ).bind(newStatus, orderId).run();
  }

  const tracking = gelatoData.trackingCode?.[0] || '';
  return jsonRes({
    orderId,
    previousStatus: order.status,
    status: newStatus || order.status,
    gelatoStatus: rawStatus,
    tracking,
    changed: !!(newStatus && newStatus !== order.status && order.status !== 'cancelled'),
  }, 200, request);
}
```

- [ ] **Step 2: Register the route in the routing block**

Find this line in worker.js (around line 1257):
```js
    if (path === '/api/print/webhook')        return handlePrintWebhook(request, env);
```

Add directly after it:
```js
    if (path === '/api/print/refresh-status') return handlePrintRefreshStatus(request, env);
```

- [ ] **Step 3: Commit**

```bash
git add worker.js
git commit -m "feat: add /api/print/refresh-status endpoint for Gelato status polling"
```

---

### Task 2: Frontend — refresh button per row

**Files:**
- Modify: `admin.html` (update `render()` function in PrintOrders module + add click handler)

**Context:**
- `PrintOrders` module is an IIFE starting around line 2010
- `authHeaders()` returns `{ 'Content-Type': 'application/json', 'X-Session-Token': SESSION_TOKEN }`
- `toast(msg, type)` — already used throughout admin.html for notifications
- `data` array holds order objects with: `id`, `prodigi_order_id`, `status`, `customer_name`, etc.
- Current row template is in `render()` starting around line 2027
- The status badge currently: `<span class="badge-status">${o.status||'—'}</span>`

- [ ] **Step 1: Update the row template in `render()` to add the refresh button**

Find the current status cell in the `render()` function:
```js
        <td><span class="badge-status">${o.status||'—'}</span></td>
```

Replace with:
```js
        <td>
          <span class="badge-status" id="status-badge-${o.id}">${o.status||'—'}</span>
          ${o.status === 'in_production'
            ? `<button type="button" class="btn btn-ghost btn-sm refresh-status-btn"
                 data-order-id="${o.id}" style="margin-right:.4rem;padding:.1rem .4rem;font-size:.75rem"
                 title="רענן סטטוס מ-Gelato">🔄</button>`
            : ''}
        </td>
```

- [ ] **Step 2: Add click handler for refresh buttons**

Find this line near the end of the PrintOrders IIFE:
```js
  $('print-orders-refresh-btn').addEventListener('click', load);
```

Add directly after it:
```js
  $('print-orders-tbody').addEventListener('click', async e => {
    const btn = e.target.closest('.refresh-status-btn');
    if (!btn) return;
    const orderId = btn.dataset.orderId;
    btn.disabled = true;
    btn.textContent = '⏳';
    try {
      const r = await fetch('/api/print/refresh-status', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ orderId }),
      });
      const res = await r.json();
      if (!r.ok) { toast(res.error || 'שגיאה', 'error'); return; }
      const badge = document.getElementById(`status-badge-${orderId}`);
      if (badge) badge.textContent = res.status;
      if (res.changed) {
        toast(`סטטוס עודכן: ${res.status}`, 'success');
        if (res.status !== 'in_production') btn.remove();
      } else {
        toast('אין שינוי בסטטוס', 'info');
        btn.textContent = '🔄';
        btn.disabled = false;
      }
    } catch { toast('שגיאת רשת', 'error'); btn.textContent = '🔄'; btn.disabled = false; }
  });
```

- [ ] **Step 3: Commit**

```bash
git add admin.html
git commit -m "feat: add per-row refresh status button for Gelato print orders"
```

---

### Task 3: Deploy and verify

- [ ] **Step 1: Push to GitHub**

```bash
git push origin main
```

- [ ] **Step 2: Trigger Cloudflare deploy**

```bash
gh workflow run update-photos.yml
```

Wait for completion:
```bash
gh run watch $(gh run list --workflow=update-photos.yml --limit=1 --json databaseId -q '.[0].databaseId')
```
Expected: `✓ success`

- [ ] **Step 3: Verify in admin panel**

1. פתח `https://amitphotos.com/admin.html`
2. נווט ל"הדפסות"
3. אם יש הזמנה עם סטטוס `in_production` — לחץ 🔄
4. ציפייה: toast מופיע ("אין שינוי בסטטוס" או "סטטוס עודכן")
5. אם אין הזמנות — בדוק ב-DevTools Network שה-endpoint מחזיר 200 עם body תקין כשנשלח `orderId` ידני
