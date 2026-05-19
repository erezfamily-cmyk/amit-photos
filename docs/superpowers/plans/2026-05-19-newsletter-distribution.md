# Newsletter Distribution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add email distribution (send to all subscribers), a subscribe form, share buttons, and a PDF button to the newsletter system.

**Architecture:** All changes are in `worker.js`. New functions `nlBuildEmailHtml` and `handleAdminNlSend` are added before `// ===== MAIN ROUTER =====`. `handleAdminNlEditor` gets a send button. `handleNlIssue` gets PDF/share/subscribe UI.

**Tech Stack:** Cloudflare Workers, D1, Resend API (already wired via `env.RESEND_API_KEY`), vanilla JS.

---

## File Map

| Action | File | What changes |
|---|---|---|
| Modify | `worker.js` | `nlBuildEmailHtml` + `handleAdminNlSend` (new functions) + route wiring + `handleAdminNlEditor` send button + `handleNlIssue` PDF/share/subscribe |

---

## Task 1: Email Build Function + Send API

**Files:**
- Modify: `worker.js` — add `nlBuildEmailHtml` and `handleAdminNlSend` before `// ===== MAIN ROUTER =====` (currently around line 4993), then add send route to router (currently around line 5156)

- [ ] **Step 1: Add `nlBuildEmailHtml` before `// ===== MAIN ROUTER =====`**

Find `// ===== MAIN ROUTER =====` in worker.js. Insert immediately ABOVE it:

```js
function nlBuildEmailHtml(issue, issueUrl, unsubscribeUrl, subscriberName) {
  const c = typeof issue.content_json === 'string'
    ? JSON.parse(issue.content_json || '{}')
    : (issue.content_json || {});
  const greeting = subscriberName
    ? `<p style="margin:0 0 16px;font-size:14px;color:#d0cdc8">שלום ${escXml(subscriberName)},</p>`
    : '';
  const heroHtml = c.hero ? `
    <img src="${escXml(c.hero.photo_url)}" alt="${escXml(c.hero.title_he)}" width="560" style="width:100%;max-width:560px;height:auto;display:block;border-radius:8px;margin-bottom:16px">
    <h2 style="margin:0 0 8px;font-size:18px;color:#c8a96e;font-family:Georgia,serif">${escXml(c.hero.title_he)}</h2>
    <p style="margin:0 0 24px;font-size:14px;line-height:1.7;color:#d0cdc8">${escXml(c.hero.text_he)}</p>` : '';
  const guideHtml = c.guide ? `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px">
      <tr><td style="background:#1a1a1a;border-radius:8px;padding:14px 16px">
        <div style="font-size:10px;color:#c8a96e;letter-spacing:.1em;margin-bottom:6px;text-transform:uppercase">מדריך החודש</div>
        <div style="font-size:14px;font-weight:700;color:#f0ede8;margin-bottom:6px">${escXml(c.guide.title_he)}</div>
        <p style="margin:0;font-size:13px;color:#999;line-height:1.6">${escXml(c.guide.text_he)}</p>
      </td></tr>
    </table>` : '';
  const tipHtml = c.tip ? `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">
      <tr><td style="background:#1f1a10;border:1px solid #4a3a1a;border-radius:8px;padding:14px 16px">
        <div style="font-size:13px;font-weight:700;color:#c8a96e;margin-bottom:6px">${escXml(c.tip.title_he || 'טיפ החודש')}</div>
        <p style="margin:0;font-size:13px;color:#d0cdc8;line-height:1.6">${escXml(c.tip.text_he)}</p>
      </td></tr>
    </table>` : '';
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:Arial,Helvetica,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:24px 0">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#111;border-radius:12px;overflow:hidden">
      <tr><td style="background:#0a0a0a;padding:24px 32px;text-align:center;border-bottom:1px solid #222">
        <div style="color:#c8a96e;font-size:20px;font-weight:700;letter-spacing:.2em;font-family:Georgia,serif">AMIT PHOTOS</div>
        <div style="color:#888;font-size:11px;margin-top:4px">${escXml(issue.title_he)}</div>
      </td></tr>
      <tr><td style="padding:28px 32px;direction:rtl;text-align:right">
        ${greeting}${heroHtml}${guideHtml}${tipHtml}
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px">
          <tr><td align="center">
            <a href="${escXml(issueUrl)}" style="display:inline-block;background:#c8a96e;color:#000;font-weight:700;font-size:14px;padding:12px 28px;border-radius:8px;text-decoration:none">קרא את הגיליון המלא ←</a>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:16px 32px 24px;text-align:center;border-top:1px solid #222">
        <p style="margin:0 0 6px;color:#666;font-size:11px">קיבלת מייל זה כי נרשמת ל<a href="https://amitphotos.com" style="color:#c8a96e;text-decoration:none">amitphotos.com</a></p>
        <a href="${escXml(unsubscribeUrl)}" style="color:#555;font-size:10px;text-decoration:underline">הסר אותי מהרשימה</a>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

async function handleAdminNlSend(request, env, id) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== 'POST') return jsonRes({ error: 'method not allowed' }, 405, request);
  if (!env.RESEND_API_KEY) return jsonRes({ error: 'RESEND_API_KEY לא מוגדר' }, 500, request);

  const issue = await env.DB.prepare('SELECT * FROM newsletter_issues WHERE id=?').bind(id).first();
  if (!issue) return jsonRes({ error: 'not found' }, 404, request);
  if (issue.status !== 'published') return jsonRes({ error: 'יש לפרסם את הגיליון לפני שליחה' }, 400, request);

  const { results: subscribers } = await env.DB.prepare('SELECT id, email, name FROM subscribers').all();
  if (!subscribers.length) return jsonRes({ error: 'אין נרשמים ברשימה' }, 400, request);

  const origin = new URL(request.url).origin;
  const issueUrl = `${origin}/newsletter/${issue.slug}/`;
  const fromEmail = env.FROM_EMAIL || 'amit@amitphotos.com';

  const batch = subscribers.map(sub => ({
    from: fromEmail,
    to: sub.email,
    subject: issue.title_he,
    html: nlBuildEmailHtml(issue, issueUrl, `${origin}/api/unsubscribe?token=${sub.id}`, sub.name)
  }));

  const res = await fetch('https://api.resend.com/emails/batch', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(batch)
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    return jsonRes({ error: `שגיאת Resend: ${errBody.message || res.status}` }, 500, request);
  }

  const data = await res.json().catch(() => ({}));
  const sent = Array.isArray(data.data) ? data.data.length : subscribers.length;
  return jsonRes({ ok: true, sent }, 200, request);
}
```

- [ ] **Step 2: Add send route to the router**

Find line 5153–5156 in `worker.js` (the publish route):
```js
    if (path.match(/^\/api\/admin\/newsletter\/[^/]+\/publish$/) && request.method === 'POST') {
      const id = path.slice('/api/admin/newsletter/'.length).replace(/\/publish$/, '');
      return handleAdminNlPublish(request, env, id);
    }
```

Add AFTER it:
```js
    if (path.match(/^\/api\/admin\/newsletter\/[^/]+\/send$/) && request.method === 'POST') {
      const id = path.slice('/api/admin/newsletter/'.length).replace(/\/send$/, '');
      return handleAdminNlSend(request, env, id);
    }
```

- [ ] **Step 3: Commit**

```bash
git add worker.js
git commit -m "feat: newsletter email send API (nlBuildEmailHtml + handleAdminNlSend)"
git push
```

---

## Task 2: Admin Editor — Send Button

**Files:**
- Modify: `worker.js` — update `handleAdminNlEditor` (around line 4848)

The goal: when an issue is published, show a "📧 שלח לנרשמים (X אנשים)" button. The count is loaded on page load via a fetch to `/api/subscribers`.

- [ ] **Step 1: Add `sendSection` variable and CSS to `handleAdminNlEditor`**

Find in `handleAdminNlEditor`:
```js
  const publishBtn = issue.status === 'draft'
    ? `<button type="button" onclick="publish()">🚀 פרסם</button>`
    : `<span style="color:#4caf50">✓ פורסם ב-${escXml((issue.published_at||'').slice(0,10))}</span>`;
```

Replace with:
```js
  const publishBtn = issue.status === 'draft'
    ? `<button type="button" onclick="publish()">🚀 פרסם</button>`
    : `<span style="color:#4caf50">✓ פורסם ב-${escXml((issue.published_at||'').slice(0,10))}</span>`;

  const sendSection = issue.status === 'published' ? `
<div style="margin-top:1.5rem;padding-top:1rem;border-top:1px solid #222;display:flex;align-items:center;gap:1rem;flex-wrap:wrap">
  <button type="button" id="send-btn" onclick="sendToSubs()">📧 שלח לנרשמים (<span id="sub-count">...</span>)</button>
  <span id="send-msg" style="font-size:.85rem;display:none"></span>
</div>` : '';
```

- [ ] **Step 2: Add `sendSection` to the HTML body**

Find in the HTML template of `handleAdminNlEditor`:
```js
<div id="msg"></div>
${heroFields}${guideFields}${locationFields}${tipFields}
```

Replace with:
```js
<div id="msg"></div>
${sendSection}
${heroFields}${guideFields}${locationFields}${tipFields}
```

- [ ] **Step 3: Add `sendToSubs` JS function and subscriber count fetch**

Find in the `<script>` block at the end of the editor HTML:
```js
const tok = localStorage.getItem('adminToken') || '';
```

Replace with:
```js
const tok = localStorage.getItem('adminToken') || '';
${issue.status === 'published' ? `
fetch('/api/subscribers', { headers: {'X-Session-Token': tok} })
  .then(r => r.json())
  .then(d => { if (Array.isArray(d)) document.getElementById('sub-count').textContent = d.length; })
  .catch(() => {});
async function sendToSubs() {
  if (!confirm('לשלוח את הגיליון לכל הנרשמים?')) return;
  const btn = document.getElementById('send-btn');
  const msg = document.getElementById('send-msg');
  btn.disabled = true;
  msg.style.display = 'inline'; msg.style.color = '#888'; msg.textContent = 'שולח...';
  try {
    const r = await fetch('/api/admin/newsletter/${escXml(id)}/send', {
      method: 'POST', headers: {'X-Session-Token': tok}
    });
    const d = await r.json();
    if (d.ok) { msg.style.color = '#4caf50'; msg.textContent = 'נשלח ל-' + d.sent + ' נרשמים ✓'; }
    else { msg.style.color = '#f44336'; msg.textContent = d.error || 'שגיאה'; }
  } catch { msg.style.color = '#f44336'; msg.textContent = 'שגיאת רשת'; }
  btn.disabled = false;
}` : ''}
```

- [ ] **Step 4: Commit**

```bash
git add worker.js
git commit -m "feat: admin newsletter editor — send to subscribers button"
git push
```

---

## Task 3: Newsletter Issue Page — PDF + Share + Subscribe Form + Deploy

**Files:**
- Modify: `worker.js` — update `handleNlIssue` (around line 4641)

Three additions to the issue page: PDF button, share buttons, subscribe form. All hidden in print via `.no-print` class (already handled by `nav,.no-print{display:none!important}` in the existing `@media print` CSS).

- [ ] **Step 1: Add CSS for new elements to the `<style>` block in `handleNlIssue`**

Find in the `<style>` block of `handleNlIssue` (just before `@media print{`):
```css
.nl-footer{text-align:center;padding:2rem;color:var(--muted);font-size:.75rem;max-width:800px;margin:0 auto}
.nl-footer a{color:var(--muted)}
@media print{
```

Replace with:
```css
.nl-footer{text-align:center;padding:2rem;color:var(--muted);font-size:.75rem;max-width:800px;margin:0 auto}
.nl-footer a{color:var(--muted)}
.nl-actions{display:flex;gap:.75rem;flex-wrap:wrap;align-items:center;max-width:800px;margin:1.5rem auto;padding:0 1.5rem}
.nl-actions button,.nl-actions a{background:transparent;border:1px solid var(--accent);color:var(--accent);border-radius:20px;padding:.4rem 1rem;font-size:.8rem;cursor:pointer;text-decoration:none;font-family:inherit;transition:background .2s,color .2s}
.nl-actions button:hover,.nl-actions a:hover{background:var(--accent);color:#000}
.nl-subscribe-section{max-width:800px;margin:1.5rem auto 3rem;padding:0 1.5rem}
.nl-subscribe-card{background:rgba(200,169,110,.07);border:1px solid rgba(200,169,110,.25);border-radius:14px;padding:1.5rem}
.nl-subscribe-card h3{font-family:'Syne',sans-serif;font-size:1.05rem;color:var(--accent);margin-bottom:.4rem}
.nl-subscribe-card p{font-size:.85rem;color:var(--muted);margin-bottom:1rem}
.nl-sub-form{display:flex;gap:.5rem;flex-wrap:wrap}
.nl-sub-form input{flex:1;min-width:180px;background:var(--surface);border:1px solid var(--border);color:var(--text);padding:.45rem .75rem;border-radius:8px;font-family:inherit;font-size:.85rem}
.nl-sub-form button{background:var(--accent);color:#000;border:none;padding:.45rem 1.2rem;border-radius:8px;cursor:pointer;font-weight:700;font-size:.85rem}
#nl-sub-msg{font-size:.8rem;margin-top:.5rem;min-height:1.2em}
@media print{
```

- [ ] **Step 2: Add PDF button, share buttons, and subscribe section to the HTML body**

In `handleNlIssue`, the `issueUrl` and `waUrl` constants must be computed in the JS (server-side JS for building template strings). Add these two lines immediately before building `heroSection` (around line 4656):

```js
  const pageUrl = `https://amitphotos.com/newsletter/${slug}/`;
  const waHref = escXml(`https://wa.me/?text=${encodeURIComponent(issue.title_he + ' — ' + pageUrl)}`);
```

Then find in the HTML template body:
```js
<footer class="nl-footer">
  <p>© Amit Photos | <a href="/">amitphotos.com</a></p>
</footer>
<script>
```

Replace with:
```js
<footer class="nl-footer">
  <p>© Amit Photos | <a href="/">amitphotos.com</a></p>
</footer>
<div class="nl-actions no-print">
  <button onclick="window.print()">🖨 <span data-he="הדפס / שמור PDF" data-en="Print / Save PDF">הדפס / שמור PDF</span></button>
  <a href="${waHref}" target="_blank" rel="noopener">📲 <span data-he="שתף ב-WhatsApp" data-en="Share on WhatsApp">שתף ב-WhatsApp</span></a>
  <button onclick="copyLink()">🔗 <span id="copy-label" data-he="העתק קישור" data-en="Copy Link">העתק קישור</span></button>
</div>
<section class="nl-subscribe-section no-print">
  <div class="nl-subscribe-card">
    <h3 data-he="רוצה לקבל את הניוזלטר?" data-en="Want to receive the newsletter?">רוצה לקבל את הניוזלטר?</h3>
    <p data-he="גיליונות חודשיים — תמונות, מדריכים ומקומות צילום ישירות למייל." data-en="Monthly issues — photos, guides and shooting locations delivered to your inbox.">גיליונות חודשיים — תמונות, מדריכים ומקומות צילום ישירות למייל.</p>
    <form class="nl-sub-form" onsubmit="nlSubscribe(event)">
      <input type="email" id="nl-email" placeholder="כתובת המייל שלך" required>
      <button type="submit" data-he="הרשמה" data-en="Subscribe">הרשמה</button>
    </form>
    <p id="nl-sub-msg"></p>
  </div>
</section>
<script>
```

- [ ] **Step 3: Add `copyLink` and `nlSubscribe` JS functions to the script block**

Find at the end of the `<script>` block in `handleNlIssue`:
```js
applyLang();window.setLang=applyLang;window.addEventListener('storage',e=>{if(e.key==='lang')applyLang()})
```

Replace with:
```js
applyLang();window.setLang=applyLang;window.addEventListener('storage',e=>{if(e.key==='lang')applyLang()})
function copyLink(){navigator.clipboard.writeText(location.href).then(()=>{const el=document.getElementById('copy-label');const orig=el.innerHTML;el.textContent='✓ הועתק!';setTimeout(()=>{el.innerHTML=orig;applyLang()},2000)}).catch(()=>{})}
async function nlSubscribe(e){e.preventDefault();const email=document.getElementById('nl-email').value.trim();const msg=document.getElementById('nl-sub-msg');const btn=e.target.querySelector('button[type="submit"]');btn.disabled=true;try{const r=await fetch('/api/subscribers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})});const d=await r.json();if(d.already){msg.style.color='#c8a96e';msg.textContent='כבר רשום/ה — תקבל את הגיליון הבא!'}else if(d.ok){msg.style.color='#4caf50';msg.textContent='נרשמת! תקבל את הגיליון הבא ישירות למייל 🎉';document.getElementById('nl-email').value=''}else{msg.style.color='#f44336';msg.textContent=d.error||'שגיאה'}}catch{msg.style.color='#f44336';msg.textContent='שגיאת רשת'}btn.disabled=false}
```

- [ ] **Step 4: Deploy**

```bash
npx wrangler deploy --minify 2>&1 | tail -6
```

Expected: successful deploy with updated version ID.

- [ ] **Step 5: Smoke test**

```bash
curl -s -o /dev/null -w "%{http_code}" https://amitphotos.com/newsletter/
```

Expected: `200`

- [ ] **Step 6: Commit**

```bash
git add worker.js
git commit -m "feat: newsletter issue page — PDF, share, subscribe form"
git push
```

---

## Self-Review

**Spec coverage:**
- ✅ `nlBuildEmailHtml` — dark email, hero + guide + tip + CTA button → Task 1
- ✅ `handleAdminNlSend` — auth, published-only guard, Resend batch → Task 1
- ✅ `/api/admin/newsletter/:id/send` route → Task 1
- ✅ Send button in admin editor with subscriber count → Task 2
- ✅ Confirm dialog before sending → Task 2
- ✅ Success/error feedback after send → Task 2
- ✅ PDF button (`window.print()`) on issue page → Task 3
- ✅ WhatsApp share button → Task 3
- ✅ Copy link button → Task 3
- ✅ Subscribe form on issue page (POST `/api/subscribers`) → Task 3
- ✅ `already: true` handled in subscribe → Task 3
- ✅ All new UI elements hidden in print (`.no-print`) → Task 3
- ✅ i18n `data-he`/`data-en` on new elements → Task 3

**Placeholder scan:** None — all code is complete.

**Type consistency:**
- `nlBuildEmailHtml(issue, issueUrl, unsubscribeUrl, subscriberName)` — called in `handleAdminNlSend` with matching args ✅
- `handleAdminNlSend(request, env, id)` — called from router with matching pattern ✅
- `sendToSubs()` calls `/api/admin/newsletter/${id}/send` — matches route pattern ✅
- `nlSubscribe()` calls `/api/subscribers` — matches existing route ✅
