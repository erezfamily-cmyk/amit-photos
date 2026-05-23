# Lead Magnet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** הוסף מגנט לידים — דף נחיתה `/free-guide/` שמציע PDF חינמי ב-15 עמ' בתמורה למייל, popup exit-intent באתר, ושורת PDF בפוסטים האוטומטיים.

**Architecture:** הPDF (קיים בריפו) מוגש כ-static asset. דף נחיתה מוגש מ-worker.js עם תמונה רנדומלית מהDB. הרשמה קיימת (`POST /api/subscribers`) מורחבת עם שדה `source` ומייל ברוכים הבאים חדש הכולל קישור לPDF. Popup inline בHTML הראשי.

**Tech Stack:** Cloudflare Workers (worker.js), Cloudflare D1 (SQLite), Resend (email), Python (auto-posts)

---

## File Map

| קובץ | שינוי |
|------|-------|
| `50tips-heb.pdf` | commit לריפו (static asset → `amitphotos.com/50tips-heb.pdf`) |
| `worker.js` | פונקציה `handleFreeGuide` + route + migration source column + עדכון `handleSubscribers` |
| `index.html` | popup HTML + JS לפני `</body>` |
| `locations/spot/index.html` | אותו popup |
| `src/instagram_post.py` | PDF_FOOTER בסוף generate_caption |
| `src/facebook_post.py` | PDF_FOOTER בסוף generate_caption |

---

## Task 1: Commit PDF לריפו

**Files:**
- Commit: `50tips-heb.pdf`

- [ ] **Step 1: ודא שהקובץ קיים**

```bash
ls 50tips-heb.pdf
# expected: 50tips-heb.pdf (1.7 MB)
```

- [ ] **Step 2: Commit**

```bash
git add 50tips-heb.pdf
git commit -m "feat: add 50tips PDF as static asset for lead magnet"
```

ה-PDF יהיה זמין אוטומטית ב-`https://amitphotos.com/50tips-heb.pdf` כי `wrangler.toml` מגדיר `[assets] directory = "."`.

---

## Task 2: Migration + עדכון handleSubscribers

**Files:**
- Modify: `worker.js` — פונקציה `handleSubscribers` (שורות 177–231)

### עדכון handleSubscribers

- [ ] **Step 1: הוסף migration + source לINSERT**

מצא את הבלוק:
```js
// POST פתוח לציבור — הרשמה לניוזלטר מהאתר
if (method === 'POST') {
  const { name, email, notes } = await request.json().catch(() => ({}));
  if (!email) return jsonRes({ error: 'מייל חסר' }, 400, request);
  const existing = await env.DB.prepare('SELECT id FROM subscribers WHERE email = ?').bind(email).first();
  if (existing) return jsonRes({ ok: true, already: true }, 200, request);
  const id = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO subscribers (id, name, email, notes, created_at) VALUES (?,?,?,?,?)'
  ).bind(id, name || '', email, notes || '', new Date().toISOString()).run();
```

החלף ב:
```js
// POST פתוח לציבור — הרשמה לניוזלטר מהאתר
if (method === 'POST') {
  // migration idempotent
  await env.DB.prepare('ALTER TABLE subscribers ADD COLUMN source TEXT DEFAULT \'website\'').run().catch(() => {});

  const { name, email, notes } = await request.json().catch(() => ({}));
  if (!email) return jsonRes({ error: 'מייל חסר' }, 400, request);
  const source = new URL(request.url).searchParams.get('source') || 'website';
  const existing = await env.DB.prepare('SELECT id FROM subscribers WHERE email = ?').bind(email).first();
  if (existing) return jsonRes({ ok: true, already: true }, 200, request);
  const id = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO subscribers (id, name, email, notes, source, created_at) VALUES (?,?,?,?,?,?)'
  ).bind(id, name || '', email, notes || '', source, new Date().toISOString()).run();
```

- [ ] **Step 2: החלף את מייל האישור הנוכחי במייל מותנה**

מצא את הבלוק (שורות 192–208):
```js
    // שלח מייל אישור לנרשם
    if (env.RESEND_API_KEY) {
      const fromEmail = env.FROM_EMAIL || 'amit@amitphotos.com';
      const confirmHtml = `<div dir="rtl" style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:2rem;color:#111">
        <h2 style="color:#c8a96e;font-family:sans-serif">AMIT PHOTOS</h2>
        <p>שלום${name ? ' ' + name : ''},</p>
        <p>תודה שנרשמת לניוזלטר של עמית פוטוס! 🎉</p>
        <p>תקבל עדכונים על תמונות חדשות, מבצעים בלעדיים ותוכן מאחורי הקלעים — ישירות למייל.</p>
        <hr style="margin-top:2rem;border-color:#ddd">
        <p style="color:#999;font-size:.8rem">קיבלת מייל זה כי נרשמת לניוזלטר של <a href="https://amitphotos.com">amitphotos.com</a>.</p>
      </div>`;
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: fromEmail, to: email, subject: 'ברוך הבא לניוזלטר של עמית פוטוס!', html: confirmHtml })
      });
    }
```

החלף ב:
```js
    // שלח מייל אישור לנרשם
    if (env.RESEND_API_KEY) {
      const fromEmail = env.FROM_EMAIL || 'amit@amitphotos.com';
      const isLeadMagnet = source === 'lead_magnet' || source === 'popup';
      const subject = isLeadMagnet
        ? 'הנה ה-PDF שלך — 50 טיפים לצילום'
        : 'ברוך הבא לניוזלטר של עמית פוטוס!';
      const confirmHtml = isLeadMagnet
        ? `<div dir="rtl" style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:2rem;background:#111;color:#f0ede8">
            <h2 style="color:#c8a96e;font-family:sans-serif;margin-bottom:.5rem">AMIT PHOTOS</h2>
            <h3 style="margin-top:0">50 טיפים לצילום טוב יותר — הPDF שלך מוכן!</h3>
            <p style="color:#ccc">שלום${name ? ' ' + name : ''},</p>
            <p style="color:#ccc">תודה! הנה הקישור להורדה:</p>
            <div style="text-align:center;margin:1.5rem 0">
              <a href="https://amitphotos.com/50tips-heb.pdf"
                 style="background:#c8a96e;color:#111;padding:.8rem 2rem;border-radius:4px;text-decoration:none;font-weight:700;font-size:1rem">
                הורד את ה-PDF ←
              </a>
            </div>
            <p style="color:#aaa;font-size:.9rem">בנוסף, תקבל את הניוזלטר החודשי שלי — תמונות חדשות, מקומות צילום ומדריכים.</p>
            <hr style="margin-top:2rem;border-color:#333">
            <p style="color:#666;font-size:.8rem">לביטול הרשמה: <a href="https://amitphotos.com/api/unsubscribe?token=${id}" style="color:#888">לחץ כאן</a></p>
          </div>`
        : `<div dir="rtl" style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:2rem;color:#111">
            <h2 style="color:#c8a96e;font-family:sans-serif">AMIT PHOTOS</h2>
            <p>שלום${name ? ' ' + name : ''},</p>
            <p>תודה שנרשמת לניוזלטר של עמית פוטוס! 🎉</p>
            <p>תקבל עדכונים על תמונות חדשות, מבצעים בלעדיים ותוכן מאחורי הקלעים — ישירות למייל.</p>
            <hr style="margin-top:2rem;border-color:#ddd">
            <p style="color:#999;font-size:.8rem">קיבלת מייל זה כי נרשמת לניוזלטר של <a href="https://amitphotos.com">amitphotos.com</a>.</p>
          </div>`;
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: fromEmail, to: email, subject, html: confirmHtml })
      });
    }
```

- [ ] **Step 3: Commit**

```bash
git add worker.js
git commit -m "feat: add source tracking + PDF welcome email to subscribers API"
```

---

## Task 3: דף נחיתה /free-guide/

**Files:**
- Modify: `worker.js` — הוסף פונקציה `handleFreeGuide` + route

- [ ] **Step 1: הוסף פונקציה handleFreeGuide לפני סוגר ה-export**

מצא את השורה `if (path === '/prices') return handlePricesPage(request, env);` (סביב שורה 6047)
והוסף לפניה:
```js
    if (path === '/free-guide' || path === '/free-guide/') return handleFreeGuide(request, env);
```

- [ ] **Step 2: הוסף את הפונקציה handleFreeGuide כ-top-level function**

`handleFreeGuide` הוא top-level function כמו `handleSubscribers` — לא בתוך `export default`.
מצא את השורה `// ===== SUBSCRIBERS =====` (שורה ~177) והוסף לפניה:

```js
async function handleFreeGuide(request, env) {
  const photo = await env.DB.prepare(
    `SELECT id, r2_key, title FROM photos WHERE published=1 AND r2_key IS NOT NULL AND r2_key != '' ORDER BY RANDOM() LIMIT 1`
  ).first();
  const photoUrl = photo?.r2_key ? `https://amitphotos.com/photos/${photo.r2_key}` : '';
  const photoTitle = photo?.title || '';

  const html = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>50 טיפים לצילום טוב יותר — PDF חינם | Amit Photos</title>
<meta name="description" content="50 טיפים לצילום שישפרו את התמונות שלך — PDF חינמי ב-15 עמ', ישיר למייל.">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Heebo',sans-serif;background:#111;color:#f0ede8;min-height:100vh;display:flex;align-items:center;justify-content:center}
.wrap{display:flex;max-width:860px;width:100%;min-height:100vh}
.left{flex:1;background:${photoUrl ? `url('${photoUrl}') center/cover no-repeat` : 'linear-gradient(135deg,#1a1a2e,#0f3460)'};min-height:300px}
.right{flex:1;padding:3rem 2.5rem;display:flex;flex-direction:column;justify-content:center;direction:rtl}
.badge{font-size:.7rem;letter-spacing:.15em;color:#c8a96e;text-transform:uppercase;margin-bottom:.6rem}
h1{font-size:1.9rem;line-height:1.25;margin-bottom:.5rem;color:#f0ede8}
.sub{font-size:.95rem;color:#aaa;margin-bottom:.4rem}
.pdf-meta{font-size:.75rem;color:#666;margin-bottom:1.8rem}
input[type=email]{width:100%;padding:.75rem 1rem;background:#1e1e1e;border:1px solid #444;border-radius:4px;color:#f0ede8;font-size:1rem;margin-bottom:.75rem;direction:rtl}
input[type=email]::placeholder{color:#666}
button{width:100%;padding:.8rem 1rem;background:#c8a96e;color:#111;border:none;border-radius:4px;font-size:1rem;font-weight:700;cursor:pointer}
button:hover{background:#d4b87a}
.legal{font-size:.7rem;color:#555;margin-top:.6rem;line-height:1.5}
.msg{margin-top:.75rem;min-height:1.2em;font-size:.9rem}
.msg.ok{color:#4caf7d}
.msg.err{color:#e05555}
.back{font-size:.75rem;color:#666;margin-top:1.5rem}
.back a{color:#888;text-decoration:none}
.back a:hover{color:#c8a96e}
@media(max-width:600px){.wrap{flex-direction:column}.left{min-height:220px}.right{padding:2rem 1.5rem}}
</style>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;700&display=swap" rel="stylesheet">
</head>
<body>
<div class="wrap">
  <div class="left" title="${photoTitle}"></div>
  <div class="right">
    <div class="badge">מתנה חינמית</div>
    <h1>50 טיפים לצילום טוב יותר</h1>
    <p class="sub">המדריך שהייתי רוצה שיהיה לי כשהתחלתי לצלם</p>
    <p class="pdf-meta">PDF · 15 עמ' · ישיר למייל</p>
    <form id="fg-form">
      <input type="email" id="fg-email" placeholder="כתובת המייל שלך" required autocomplete="email">
      <button type="submit" id="fg-btn">שלח לי את ה-PDF ←</button>
      <p class="legal">קבלת ה-PDF + הרשמה לניוזלטר החודשי של עמית ארז. ניתן לבטל בכל עת.</p>
      <p class="msg" id="fg-msg"></p>
    </form>
    <div class="back"><a href="https://amitphotos.com">← חזור לאתר</a></div>
  </div>
</div>
<script>
document.getElementById('fg-form').addEventListener('submit', async function(e) {
  e.preventDefault();
  const email = document.getElementById('fg-email').value.trim();
  const btn = document.getElementById('fg-btn');
  const msg = document.getElementById('fg-msg');
  btn.disabled = true;
  btn.textContent = '...';
  try {
    const r = await fetch('/api/subscribers?source=lead_magnet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    if (r.ok) {
      msg.className = 'msg ok';
      msg.textContent = '✓ נשלח! בדוק את תיבת הדואר שלך (גם spam).';
      document.getElementById('fg-email').value = '';
      btn.textContent = 'נשלח ✓';
    } else {
      msg.className = 'msg err';
      msg.textContent = 'שגיאה. נסה שוב.';
      btn.disabled = false;
      btn.textContent = 'שלח לי את ה-PDF ←';
    }
  } catch {
    msg.className = 'msg err';
    msg.textContent = 'שגיאת רשת. נסה שוב.';
    btn.disabled = false;
    btn.textContent = 'שלח לי את ה-PDF ←';
  }
});
</script>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'no-store' }
  });
}
```

- [ ] **Step 3: בדוק locally (פתח את האתר המקומי)**

```bash
# אם יש wrangler מוגדר:
npx wrangler dev
# פתח http://localhost:8787/free-guide/
# צפוי: דף ספליט עם תמונה משמאל + טופס מימין
```

- [ ] **Step 4: Commit**

```bash
git add worker.js
git commit -m "feat: add /free-guide/ landing page with PDF lead magnet"
```

---

## Task 4: Exit-Intent Popup ב-index.html

**Files:**
- Modify: `index.html` — לפני `</body>` (שורה 1136)

- [ ] **Step 1: הוסף popup HTML + JS לפני `</body>`**

מצא `</body>` בסוף `index.html` והוסף לפניה:

```html
  <!-- ===== PDF LEAD MAGNET POPUP ===== -->
  <div id="pdf-popup" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:9999;align-items:center;justify-content:center;padding:1rem">
    <div style="background:#1a1a1a;border:1px solid #c8a96e;border-radius:8px;padding:2rem;max-width:400px;width:100%;direction:rtl;position:relative">
      <button onclick="closePdfPopup()" style="position:absolute;top:.75rem;left:.75rem;background:none;border:none;color:#666;font-size:1.2rem;cursor:pointer;line-height:1">✕</button>
      <div style="font-size:.7rem;letter-spacing:.12em;color:#c8a96e;margin-bottom:.4rem">מתנה חינמית</div>
      <h3 style="font-size:1.2rem;color:#f0ede8;margin-bottom:.3rem">50 טיפים לצילום</h3>
      <p style="font-size:.85rem;color:#aaa;margin-bottom:1.2rem">PDF חינם — ישיר למייל שלך</p>
      <form id="popup-form">
        <input type="email" id="popup-email" placeholder="כתובת המייל שלך" required
          style="width:100%;padding:.65rem 1rem;background:#111;border:1px solid #444;border-radius:4px;color:#f0ede8;font-size:.95rem;margin-bottom:.6rem;direction:rtl">
        <button type="submit" id="popup-btn"
          style="width:100%;padding:.7rem;background:#c8a96e;color:#111;border:none;border-radius:4px;font-weight:700;cursor:pointer;font-size:.95rem">
          שלח לי ←
        </button>
        <p style="font-size:.65rem;color:#555;margin-top:.5rem">הרשמה + ניוזלטר חודשי. בטל בכל עת.</p>
        <p id="popup-msg" style="margin-top:.5rem;font-size:.85rem;min-height:1.1em"></p>
      </form>
      <p style="text-align:center;margin-top:.8rem">
        <a href="/free-guide/" style="font-size:.75rem;color:#888;text-decoration:none">לדף ההורדה המלא ←</a>
      </p>
    </div>
  </div>
  <script>
  (function(){
    if (localStorage.getItem('pdfPopupSeen')) return;
    var shown = false;
    function showPdfPopup() {
      if (shown) return;
      shown = true;
      var el = document.getElementById('pdf-popup');
      el.style.display = 'flex';
    }
    // Desktop: mouse leaves window
    document.addEventListener('mouseleave', function(e) {
      if (e.clientY < 10) showPdfPopup();
    });
    // Mobile + fallback: after 30 seconds
    setTimeout(showPdfPopup, 30000);
  })();

  function closePdfPopup() {
    document.getElementById('pdf-popup').style.display = 'none';
    localStorage.setItem('pdfPopupSeen', '1');
  }

  document.getElementById('popup-form').addEventListener('submit', async function(e) {
    e.preventDefault();
    var email = document.getElementById('popup-email').value.trim();
    var btn = document.getElementById('popup-btn');
    var msg = document.getElementById('popup-msg');
    btn.disabled = true; btn.textContent = '...';
    try {
      var r = await fetch('/api/subscribers?source=popup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      if (r.ok) {
        msg.style.color = '#4caf7d';
        msg.textContent = '✓ נשלח! בדוק תיבת הדואר (גם spam).';
        document.getElementById('popup-email').value = '';
        btn.textContent = 'נשלח ✓';
        localStorage.setItem('pdfPopupSeen', '1');
      } else {
        msg.style.color = '#e05555';
        msg.textContent = 'שגיאה. נסה שוב.';
        btn.disabled = false; btn.textContent = 'שלח לי ←';
      }
    } catch {
      msg.style.color = '#e05555';
      msg.textContent = 'שגיאת רשת.';
      btn.disabled = false; btn.textContent = 'שלח לי ←';
    }
  });
  </script>
```

- [ ] **Step 2: Commit**

```bash
git add index.html
git commit -m "feat: add exit-intent PDF popup to homepage"
```

---

## Task 5: Exit-Intent Popup ב-locations/spot/index.html

**Files:**
- Modify: `locations/spot/index.html` — לפני `</body>`

- [ ] **Step 1: מצא את `</body>` ב-locations/spot/index.html והוסף לפניה את אותו קוד popup בדיוק כמו ב-Task 4 Step 1**

(אותו HTML + JS מ-Task 4, העתק מלא)

- [ ] **Step 2: Commit**

```bash
git add locations/spot/index.html
git commit -m "feat: add exit-intent PDF popup to location pages"
```

---

## Task 6: PDF Footer בפוסטים אינסטגרם

**Files:**
- Modify: `src/instagram_post.py` — פונקציה `generate_caption` (שורה 239)

- [ ] **Step 1: מצא את שורת ה-return בgenerate_caption**

```python
    return f"{caption_text}\n\n{hashtags}"
```

החלף ב:
```python
    PDF_FOOTER = "\n\n🎁 PDF חינם — 50 טיפים לצילום:\namitphotos.com/free-guide"
    return f"{caption_text}{PDF_FOOTER}\n\n{hashtags}"
```

- [ ] **Step 2: Commit**

```bash
git add src/instagram_post.py
git commit -m "feat: add PDF lead magnet footer to Instagram auto-captions"
```

---

## Task 7: PDF Footer בפוסטים פייסבוק

**Files:**
- Modify: `src/facebook_post.py` — פונקציה `generate_caption` (שורה 187)

- [ ] **Step 1: מצא את שורת ה-return בgenerate_caption**

```python
    return f"{post_text}\n\n{hashtags}"
```

החלף ב:
```python
    PDF_FOOTER = "\n\n🎁 PDF חינם — 50 טיפים לצילום:\namitphotos.com/free-guide"
    return f"{post_text}{PDF_FOOTER}\n\n{hashtags}"
```

- [ ] **Step 2: Commit**

```bash
git add src/facebook_post.py
git commit -m "feat: add PDF lead magnet footer to Facebook auto-posts"
```

---

## Task 8: Deploy + בדיקה

- [ ] **Step 1: Push לmain — GitHub Actions ידאג לdeploy**

```bash
git push origin main
```

- [ ] **Step 2: בדוק דף נחיתה**

פתח `https://amitphotos.com/free-guide/` — צפוי: תמונה משמאל, טופס מימין.

- [ ] **Step 3: בדוק PDF**

פתח `https://amitphotos.com/50tips-heb.pdf` — צפוי: PDF נטען.

- [ ] **Step 4: בדוק הרשמה**

הכנס מייל בדיקה ב-`/free-guide/` — צפוי: הודעת הצלחה + מייל עם כפתור "הורד ה-PDF".

- [ ] **Step 5: בדוק popup**

פתח `https://amitphotos.com` ב-incognito, המתן 30 שניות — צפוי: popup מופיע.
אחרי הרשמה: `localStorage.getItem('pdfPopupSeen')` === `'1'`.

---

## לאחר Deploy — פעולות ידניות

1. **עדכן ביו אינסטגרם:** `📷 צלם | 🎁 PDF חינם: amitphotos.com/free-guide` + לינקטרי/קישור ישיר
2. **פרסם בקבוצות פייסבוק** (טקסט מהspec):
   > "צילמתי 10+ שנים ועשיתי הרבה טעויות. ריכזתי 50 הטיפים שהכי שינו לי את התמונות ב-PDF חינמי. אם תרצו: **amitphotos.com/free-guide**"
