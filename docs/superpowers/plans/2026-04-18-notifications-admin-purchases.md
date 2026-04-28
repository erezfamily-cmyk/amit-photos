# Notifications + Admin Purchases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send email + WhatsApp to Amit on every digital purchase, and add a Purchases tab to admin.html with stats, token list, and manual token creation.

**Architecture:** All notification logic lives in `worker.js` inside `handleVerifyPayment`, fired via `ctx.waitUntil` so it never blocks the download response. Admin tab follows the existing pattern in `admin.html` — a new `data-section="purchases"` nav item + section div + `Purchases` JS module, backed by two new Worker API endpoints.

**Tech Stack:** Cloudflare Worker (JS), Cloudflare D1, Resend API (email), CallMeBot API (WhatsApp), vanilla JS in admin.html

---

## Files

| File | Action | What changes |
|------|--------|-------------|
| `worker.js` | Modify | Add `sendPurchaseNotifications`, `handleAdminPurchases`, `handleAdminCreateToken`; update `handleVerifyPayment` to save `amount` and call notifications; add routes |
| `admin.html` | Modify | Add nav item + section HTML + `Purchases` JS module |

---

## Task 1: D1 schema — add `amount` column to `download_tokens`

**Files:**
- Modify: `worker.js` — add migration endpoint and update INSERT

- [ ] **Step 1: Add one-time migration endpoint to worker.js**

Find the routing block (around line 1521 in worker.js) and add before the closing `}`:

```js
if (path === '/api/admin/migrate-amount' && request.method === 'POST') {
  if (!await checkAuth(request, env)) return unauth(request);
  await env.DB.prepare('ALTER TABLE download_tokens ADD COLUMN amount REAL DEFAULT 0').run().catch(() => {});
  return jsonRes({ ok: true }, 200, request);
}
```

- [ ] **Step 2: Deploy worker**

```bash
npx wrangler deploy
```

- [ ] **Step 3: Run migration**

```bash
curl -s -X POST https://amitphotos.com/api/admin/migrate-amount \
  -H "X-Session-Token: YOUR_SESSION_TOKEN"
```

Expected: `{"ok":true}`

- [ ] **Step 4: Update INSERT in handleVerifyPayment to save amount**

Find this line in `handleVerifyPayment` (around line 677):
```js
'INSERT INTO download_tokens (token, photo_ids, size, tx, used, expires_at, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)'
).bind(token, JSON.stringify([photoId]), size, txnId, expires, now).run();
```

Replace with:
```js
'INSERT INTO download_tokens (token, photo_ids, size, tx, used, expires_at, created_at, amount) VALUES (?, ?, ?, ?, 0, ?, ?, ?)'
).bind(token, JSON.stringify([photoId]), size, txnId, expires, now, mcGross / photoIds.length).run();
```

Note: `mcGross` is already defined earlier in `handleVerifyPayment` as `const mcGross = parseFloat(params.get('mc_gross') || 0);`

- [ ] **Step 5: Commit**

```bash
git add worker.js
git commit -m "feat: add amount column to download_tokens"
```

---

## Task 2: Purchase notifications — email via Resend

**Files:**
- Modify: `worker.js` — add `sendPurchaseEmail` function + call in `handleVerifyPayment`

- [ ] **Step 1: Add sendPurchaseEmail function to worker.js**

Add before `handleVerifyPayment`:

```js
async function sendPurchaseEmail(env, { titles, size, amount, txnId, tokens, origin }) {
  if (!env.RESEND_API_KEY) return;
  const adminEmail = env.ADMIN_EMAIL || 'contact@amitphotos.com';
  const fromEmail = 'Amit Photos <onboarding@resend.dev>';
  const sizeLabel = { small: 'קובץ רשת', medium: 'קובץ הדפסה', large: 'קובץ מלא' }[size] || size;
  const tokenLinks = tokens.map(t => `<a href="${origin}/api/download/${t}">${origin}/api/download/${t}</a>`).join('<br>');
  const html = `
    <div dir="rtl" style="font-family:Arial,sans-serif;padding:24px">
      <h2>📸 רכישה חדשה ב-Amit Photos!</h2>
      <p><strong>תמונות:</strong> ${titles.join(', ')}</p>
      <p><strong>גודל:</strong> ${sizeLabel}</p>
      <p><strong>סכום:</strong> ₪${amount}</p>
      <p><strong>Transaction:</strong> ${txnId}</p>
      <p><strong>קישורי הורדה:</strong><br>${tokenLinks}</p>
    </div>`;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: fromEmail, to: adminEmail, subject: `רכישה חדשה 📸 — ${titles[0]} (${sizeLabel})`, html }),
  }).catch(() => {});
}
```

- [ ] **Step 2: Call sendPurchaseEmail in handleVerifyPayment**

Find the return statements at the end of `handleVerifyPayment`. Before the first `return jsonRes(...)`, add:

```js
  // Collect titles for notification
  const notifTitles = await Promise.all(photoIds.map(async id => {
    const r = await env.DB.prepare('SELECT title FROM photos WHERE id = ?').bind(id).first();
    return r?.title || id;
  }));
  const origin = new URL(request.url).origin;
  ctx.waitUntil(sendPurchaseEmail(env, {
    titles: notifTitles, size, amount: mcGross, txnId, tokens, origin
  }));
```

Note: `handleVerifyPayment` currently doesn't receive `ctx`. Update its signature and the caller:

Find: `async function handleVerifyPayment(request, env) {`
Replace: `async function handleVerifyPayment(request, env, ctx) {`

Find the route (around line 1521): `if (path === '/api/verify-payment')    return handleVerifyPayment(request, env);`
Replace: `if (path === '/api/verify-payment')    return handleVerifyPayment(request, env, ctx);`

- [ ] **Step 3: Deploy and test**

```bash
npx wrangler deploy
```

Make a test purchase. Check that email arrives at the ADMIN_EMAIL address.

- [ ] **Step 4: Commit**

```bash
git add worker.js
git commit -m "feat: send email notification on purchase via Resend"
```

---

## Task 3: Purchase notifications — WhatsApp via CallMeBot

**Files:**
- Modify: `worker.js` — add `sendPurchaseWhatsApp` function + call in `handleVerifyPayment`

- [ ] **Step 1: Set up CallMeBot (one-time manual step)**

Send this WhatsApp message to `+34 644 75 31 00`:
```
I allow callmebot.com to send me messages
```

You'll receive an API key back. Then set Worker secrets:

```bash
npx wrangler secret put CALLMEBOT_PHONE
# Enter: 972XXXXXXXXX (your phone in international format, no + prefix)

npx wrangler secret put CALLMEBOT_APIKEY
# Enter: the API key received from CallMeBot
```

- [ ] **Step 2: Add sendPurchaseWhatsApp function to worker.js**

Add after `sendPurchaseEmail`:

```js
async function sendPurchaseWhatsApp(env, { titles, size, amount, txnId }) {
  if (!env.CALLMEBOT_PHONE || !env.CALLMEBOT_APIKEY) return;
  const sizeLabel = { small: 'רשת', medium: 'הדפסה', large: 'מלא' }[size] || size;
  const msg = `רכישה חדשה! 📸 ${titles.join(', ')} | ${sizeLabel} | ₪${amount} | ${txnId}`;
  const url = `https://api.callmebot.com/whatsapp.php?phone=${env.CALLMEBOT_PHONE}&text=${encodeURIComponent(msg)}&apikey=${env.CALLMEBOT_APIKEY}`;
  await fetch(url).catch(() => {});
}
```

- [ ] **Step 3: Call sendPurchaseWhatsApp in handleVerifyPayment**

Add after the `ctx.waitUntil(sendPurchaseEmail(...))` line:

```js
  ctx.waitUntil(sendPurchaseWhatsApp(env, {
    titles: notifTitles, size, amount: mcGross, txnId
  }));
```

- [ ] **Step 4: Deploy and test**

```bash
npx wrangler deploy
```

Make a test purchase. Check that WhatsApp message arrives.

- [ ] **Step 5: Commit**

```bash
git add worker.js
git commit -m "feat: send WhatsApp notification on purchase via CallMeBot"
```

---

## Task 4: Worker API — GET /api/admin/purchases

**Files:**
- Modify: `worker.js` — add `handleAdminPurchases` function + route

- [ ] **Step 1: Add handleAdminPurchases function**

Add before the routing block in worker.js:

```js
async function handleAdminPurchases(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  const url = new URL(request.url);
  const filter = url.searchParams.get('filter') || 'all';
  const now = Math.floor(Date.now() / 1000);

  let whereClauses = [];
  if (filter === 'active')  whereClauses.push(`t.used = 0 AND t.expires_at > ${now}`);
  if (filter === 'used')    whereClauses.push(`t.used = 1`);
  if (filter === 'expired') whereClauses.push(`t.used = 0 AND t.expires_at <= ${now}`);
  const where = whereClauses.length ? `WHERE ${whereClauses[0]}` : '';

  const rows = await env.DB.prepare(`
    SELECT t.token, t.photo_ids, t.size, t.tx, t.used, t.expires_at, t.created_at,
           COALESCE(t.amount, 0) as amount,
           p.title
    FROM download_tokens t
    LEFT JOIN photos p ON json_extract(t.photo_ids, '$[0]') = p.id
    ${where}
    ORDER BY t.created_at DESC
    LIMIT 200
  `).all();

  // Stats (always over all records)
  const stats = await env.DB.prepare(`
    SELECT
      COALESCE(SUM(amount), 0) as total_revenue,
      COUNT(*) as total_purchases,
      SUM(CASE WHEN created_at >= ${now - 30*86400} THEN 1 ELSE 0 END) as this_month
    FROM download_tokens
  `).first();

  const topPhotos = await env.DB.prepare(`
    SELECT p.title, COUNT(*) as cnt
    FROM download_tokens t
    LEFT JOIN photos p ON json_extract(t.photo_ids, '$[0]') = p.id
    WHERE p.title IS NOT NULL
    GROUP BY json_extract(t.photo_ids, '$[0]')
    ORDER BY cnt DESC
    LIMIT 5
  `).all();

  return jsonRes({
    tokens: rows.results,
    stats: { ...stats, top_photos: topPhotos.results }
  }, 200, request);
}
```

- [ ] **Step 2: Add route**

In the routing block, add after the existing admin routes:

```js
if (path === '/api/admin/purchases') return handleAdminPurchases(request, env);
```

- [ ] **Step 3: Deploy and verify**

```bash
npx wrangler deploy
```

```bash
# Get a session token first by logging into admin.html, then:
curl -s "https://amitphotos.com/api/admin/purchases" \
  -H "X-Session-Token: YOUR_TOKEN" | python3 -m json.tool | head -30
```

Expected: JSON with `tokens` array and `stats` object.

- [ ] **Step 4: Commit**

```bash
git add worker.js
git commit -m "feat: add GET /api/admin/purchases endpoint"
```

---

## Task 5: Worker API — POST /api/admin/create-token

**Files:**
- Modify: `worker.js` — add `handleAdminCreateToken` function + route

- [ ] **Step 1: Add handleAdminCreateToken function**

```js
async function handleAdminCreateToken(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  const { photo_id, size } = await request.json().catch(() => ({}));
  if (!photo_id || !size) return jsonRes({ error: 'photo_id and size required' }, 400, request);
  const VALID_SIZES = ['small', 'medium', 'large'];
  if (!VALID_SIZES.includes(size)) return jsonRes({ error: 'invalid size' }, 400, request);

  const now = Math.floor(Date.now() / 1000);
  const expires = now + 30 * 86400; // 30 days for manual tokens
  const token = crypto.randomUUID();

  await env.DB.prepare(
    'INSERT INTO download_tokens (token, photo_ids, size, tx, used, expires_at, created_at, amount) VALUES (?, ?, ?, ?, 0, ?, ?, 0)'
  ).bind(token, JSON.stringify([photo_id]), size, `MANUAL_${token.slice(0,8)}`, expires, now).run();

  const origin = new URL(request.url).origin;
  return jsonRes({ token, url: `${origin}/api/download/${token}` }, 200, request);
}
```

- [ ] **Step 2: Add route**

```js
if (path === '/api/admin/create-token' && request.method === 'POST') return handleAdminCreateToken(request, env);
```

- [ ] **Step 3: Deploy**

```bash
npx wrangler deploy
```

- [ ] **Step 4: Commit**

```bash
git add worker.js
git commit -m "feat: add POST /api/admin/create-token endpoint"
```

---

## Task 6: Admin UI — Purchases tab

**Files:**
- Modify: `admin.html` — add nav item, section HTML, and Purchases JS module

- [ ] **Step 1: Add nav item**

Find the last nav item (around `data-section="social"`) and add after it:

```html
<div class="nav-item" data-section="purchases">
  <svg class="nav-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13l-1.5 6h13M7 13L5.4 5M10 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm7 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
  רכישות
</div>
```

- [ ] **Step 2: Add section HTML**

Find the last `</section>` tag in admin.html and add after it:

```html
<section id="section-purchases" class="section">
  <h2 class="section-title">רכישות</h2>

  <!-- Stats -->
  <div class="stats-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:1rem;margin-bottom:1.5rem">
    <div class="stat-card" style="background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:1.25rem;text-align:center">
      <div class="stat-val" id="pur-total-revenue" style="font-size:1.75rem;font-weight:700;color:var(--accent)">—</div>
      <div style="color:var(--text-muted);font-size:.8rem;margin-top:.25rem">סה"כ הכנסות</div>
    </div>
    <div class="stat-card" style="background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:1.25rem;text-align:center">
      <div class="stat-val" id="pur-this-month" style="font-size:1.75rem;font-weight:700;color:var(--accent)">—</div>
      <div style="color:var(--text-muted);font-size:.8rem;margin-top:.25rem">30 ימים אחרונים</div>
    </div>
    <div class="stat-card" style="background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:1.25rem;text-align:center">
      <div id="pur-top-photos" style="font-size:.85rem;color:var(--text-muted);line-height:1.8">—</div>
      <div style="color:var(--text-muted);font-size:.8rem;margin-top:.25rem">פופולריות</div>
    </div>
  </div>

  <!-- Filter + Create -->
  <div style="display:flex;gap:.75rem;align-items:center;margin-bottom:1rem;flex-wrap:wrap">
    <div style="display:flex;gap:.5rem">
      <button class="pur-filter-btn btn-sm active" data-filter="all">הכל</button>
      <button class="pur-filter-btn btn-sm" data-filter="active">פעיל</button>
      <button class="pur-filter-btn btn-sm" data-filter="used">שומש</button>
      <button class="pur-filter-btn btn-sm" data-filter="expired">פג</button>
    </div>
    <button class="btn-accent btn-sm" id="pur-create-btn" style="margin-right:auto">+ צור טוקן</button>
  </div>

  <!-- Create token form (hidden) -->
  <div id="pur-create-form" style="display:none;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:1rem;margin-bottom:1rem">
    <div style="display:flex;gap:.75rem;align-items:flex-end;flex-wrap:wrap">
      <div>
        <label style="font-size:.8rem;color:var(--text-muted);display:block;margin-bottom:.25rem">Photo ID</label>
        <input id="pur-new-photo-id" class="input-sm" placeholder="1jmBaBvk8rKo..." style="width:280px">
      </div>
      <div>
        <label style="font-size:.8rem;color:var(--text-muted);display:block;margin-bottom:.25rem">גודל</label>
        <select id="pur-new-size" class="input-sm">
          <option value="small">קובץ רשת</option>
          <option value="medium">קובץ הדפסה</option>
          <option value="large">קובץ מלא</option>
        </select>
      </div>
      <button class="btn-accent btn-sm" id="pur-create-submit">צור</button>
    </div>
    <div id="pur-create-result" style="margin-top:.75rem;font-size:.85rem;color:var(--accent)"></div>
  </div>

  <!-- Table -->
  <div class="table-wrap">
    <table class="data-table">
      <thead><tr>
        <th>תמונה</th><th>גודל</th><th>סכום</th><th>תאריך</th><th>סטטוס</th><th>txn</th><th>קישור</th>
      </tr></thead>
      <tbody id="pur-table-body"></tbody>
    </table>
  </div>
</section>
```

- [ ] **Step 3: Add Purchases JS module**

Find the nav event listener that checks `if (item.dataset.section === 'social') SocialSection.load();` and add:
```js
if (item.dataset.section === 'purchases') Purchases.load();
```

Then add the Purchases module before the closing `</script>` tag:

```js
// ===== PURCHASES =====
const Purchases = (() => {
  let currentFilter = 'all';

  function statusBadge(t) {
    const now = Math.floor(Date.now() / 1000);
    if (t.used) return '<span style="color:#e05">שומש</span>';
    if (t.expires_at < now) return '<span style="color:#888">פג תוקף</span>';
    return '<span style="color:#4c4">פעיל</span>';
  }

  function formatDate(ts) {
    return new Date(ts * 1000).toLocaleDateString('he-IL');
  }

  async function load(filter) {
    if (filter) currentFilter = filter;
    const res = await api(`/api/admin/purchases?filter=${currentFilter}`);
    if (!res.ok) return;
    const data = await res.json();

    // Stats
    $('pur-total-revenue').textContent = `₪${Math.round(data.stats.total_revenue || 0)}`;
    $('pur-this-month').textContent = data.stats.this_month || 0;
    $('pur-top-photos').innerHTML = (data.stats.top_photos || [])
      .map(p => `${p.title} (${p.cnt})`).join('<br>') || '—';

    // Table
    const tbody = $('pur-table-body');
    tbody.innerHTML = '';
    (data.tokens || []).forEach(t => {
      const sizeLabel = { small: 'רשת', medium: 'הדפסה', large: 'מלא' }[t.size] || t.size;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.title || t.photo_ids}</td>
        <td>${sizeLabel}</td>
        <td>${t.amount ? `₪${t.amount}` : '—'}</td>
        <td>${formatDate(t.created_at)}</td>
        <td>${statusBadge(t)}</td>
        <td style="font-size:.7rem;color:var(--text-muted)">${(t.tx||'').slice(0,12)}…</td>
        <td><button class="btn-sm" onclick="navigator.clipboard.writeText('${window.location.origin}/api/download/${t.token}')">העתק</button></td>
      `;
      tbody.appendChild(tr);
    });
  }

  function initCreate() {
    $('pur-create-btn').addEventListener('click', () => {
      const form = $('pur-create-form');
      form.style.display = form.style.display === 'none' ? 'block' : 'none';
    });

    $('pur-create-submit').addEventListener('click', async () => {
      const photoId = $('pur-new-photo-id').value.trim();
      const size = $('pur-new-size').value;
      if (!photoId) return;
      const res = await api('/api/admin/create-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photo_id: photoId, size })
      });
      const data = await res.json();
      if (data.url) {
        $('pur-create-result').innerHTML = `✅ <a href="${data.url}" target="_blank">${data.url}</a>`;
        load();
      } else {
        $('pur-create-result').textContent = `שגיאה: ${data.error}`;
      }
    });
  }

  function initFilters() {
    document.querySelectorAll('.pur-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.pur-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        load(btn.dataset.filter);
      });
    });
  }

  // Init once on first section load
  let inited = false;
  return {
    load: (filter) => {
      if (!inited) { initCreate(); initFilters(); inited = true; }
      load(filter);
    }
  };
})();
```

- [ ] **Step 4: Verify in browser**

Open admin.html, click "רכישות" in sidebar. Verify:
- Stats cards show data
- Table shows tokens
- "צור טוקן" button opens form and creates a token

- [ ] **Step 5: Commit**

```bash
git add admin.html
git commit -m "feat: add purchases tab to admin dashboard"
```

---

## Task 7: Final deploy + push

- [ ] **Step 1: Deploy worker**

```bash
npx wrangler deploy
```

- [ ] **Step 2: Push all to GitHub**

```bash
python scripts/bump_versions.py
git add -A
git commit -m "feat: purchase notifications + admin purchases tab"
git push
```

- [ ] **Step 3: Verify live**

1. Make a test purchase on amitphotos.com
2. Confirm email received at ADMIN_EMAIL
3. Confirm WhatsApp received
4. Open admin.html → רכישות → confirm purchase appears with correct amount
