# Newsletter System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a bi-monthly newsletter system with auto-generated Hebrew content from D1 data, magazine-style web pages at `/newsletter/`, and an admin editor at `/admin/newsletter/`.

**Architecture:** All logic lives in `worker.js` (4500-line Cloudflare Worker). New handler functions are inserted before `// ===== MAIN ROUTER =====`. Routes are wired in the fetch handler. Rotation state stored in the `settings` D1 table. Claude Opus 4.7 generates Hebrew text on demand.

**Tech Stack:** Cloudflare Workers, D1 (SQLite), R2, Claude API (`claude-opus-4-7`), vanilla HTML/CSS in template literals.

---

## File Map

| Action | File | Purpose |
|---|---|---|
| Modify | `worker.js` | All new handler functions + router wiring + cron extension |
| Modify | `wrangler.toml` | Add `0 9 1,15 * *` cron trigger |

---

## Task 1: DB Migration

**Files:**
- No file edits — run SQL via wrangler CLI

- [ ] **Step 1: Create the newsletter_issues table**

```bash
npx wrangler d1 execute amit-photos-db --remote --command "
CREATE TABLE IF NOT EXISTS newsletter_issues (
  id           TEXT PRIMARY KEY,
  slug         TEXT UNIQUE NOT NULL,
  type         TEXT NOT NULL DEFAULT 'full',
  issue_number INTEGER NOT NULL DEFAULT 1,
  title_he     TEXT NOT NULL DEFAULT '',
  title_en     TEXT NOT NULL DEFAULT '',
  content_json TEXT NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'draft',
  published_at TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
)
"
```

Expected output: `Executed 1 command in Xms`

- [ ] **Step 2: Seed rotation settings**

```bash
npx wrangler d1 execute amit-photos-db --remote --command "
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('nl_guide_index', '0'),
  ('nl_location_index', '0'),
  ('nl_issue_number', '0'),
  ('nl_last_hero_id', '')
"
```

Expected: `Executed 1 command`

- [ ] **Step 3: Verify table exists**

```bash
npx wrangler d1 execute amit-photos-db --remote --command "SELECT * FROM newsletter_issues LIMIT 1"
```

Expected: `results: []` (empty table, no error)

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: create newsletter_issues table + rotation settings"
git push
```

---

## Task 2: Content Helpers + Claude API

**Files:**
- Modify: `worker.js` — add functions before `// ===== MAIN ROUTER =====`

- [ ] **Step 1: Add the GUIDE_SLUGS constant and helpers**

Find `// ===== MAIN ROUTER =====` in worker.js (around line 4352). Insert ABOVE it:

```js
// ===== NEWSLETTER SYSTEM =====

const NL_GUIDE_SLUGS = [
  'lenses','light','exposure','depth-of-field','filters',
  'composition','white-balance','histogram','dynamic-range',
  'editing','software','sports','macro','types',
  'visual-language','controls','landscape','portrait','focus'
];

const NL_GUIDE_TITLES = {
  'lenses':         { he: 'עדשות',             en: 'Lenses' },
  'light':          { he: 'אור וצבע',           en: 'Light & Color' },
  'exposure':       { he: 'חשיפה',              en: 'Exposure' },
  'depth-of-field': { he: 'עומק שדה',           en: 'Depth of Field' },
  'filters':        { he: 'פילטרים',            en: 'Filters' },
  'composition':    { he: 'קומפוזיציה',         en: 'Composition' },
  'white-balance':  { he: 'איזון לבן',          en: 'White Balance' },
  'histogram':      { he: 'היסטוגרם',           en: 'Histogram' },
  'dynamic-range':  { he: 'טווח דינמי',         en: 'Dynamic Range' },
  'editing':        { he: 'עריכה בסיסית',       en: 'Basic Editing' },
  'software':       { he: 'תוכנות עריכה',       en: 'Editing Software' },
  'sports':         { he: 'ספורט ותנועה',       en: 'Sports & Motion' },
  'macro':          { he: 'צילום מאקרו',         en: 'Macro Photography' },
  'types':          { he: 'סוגי מצלמות',        en: 'Camera Types' },
  'visual-language':{ he: 'שפה ויזואלית',       en: 'Visual Language' },
  'controls':       { he: 'כפתורי המצלמה',      en: 'Camera Controls' },
  'landscape':      { he: 'לנדסקייפ',           en: 'Landscape' },
  'portrait':       { he: 'פורטרט',             en: 'Portrait' },
  'focus':          { he: 'פוקוס',              en: 'Focus Techniques' },
};

async function nlGetSetting(env, key) {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key=?').bind(key).first();
  return row?.value ?? null;
}

async function nlSetSetting(env, key, value) {
  await env.DB.prepare(
    `INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`
  ).bind(key, String(value)).run();
}

async function nlPickHeroPhoto(env) {
  const lastId = await nlGetSetting(env, 'nl_last_hero_id') || '';
  const row = await env.DB.prepare(
    `SELECT id, title, thumbnail FROM photos WHERE id != ? AND thumbnail IS NOT NULL ORDER BY created_at DESC LIMIT 1`
  ).bind(lastId).first();
  return row || null;
}

async function nlPickGuide(env) {
  const raw = await nlGetSetting(env, 'nl_guide_index');
  const idx = parseInt(raw || '0', 10);
  const slug = NL_GUIDE_SLUGS[idx % NL_GUIDE_SLUGS.length];
  return { slug, idx, ...NL_GUIDE_TITLES[slug] };
}

async function nlPickLocation(env) {
  const raw = await nlGetSetting(env, 'nl_location_index');
  const idx = parseInt(raw || '0', 10);
  const { results } = await env.DB.prepare(
    `SELECT id, title, description, best_time, my_tip FROM locations WHERE published=1 ORDER BY id LIMIT 1 OFFSET ?`
  ).bind(idx).all();
  if (!results.length) {
    // wrap around
    const first = await env.DB.prepare(
      `SELECT id, title, description, best_time, my_tip FROM locations WHERE published=1 ORDER BY id LIMIT 1`
    ).first();
    return first ? { ...first, idx: 0 } : null;
  }
  return results[0] ? { ...results[0], idx } : null;
}
```

- [ ] **Step 2: Add the Claude text generation function (after the helpers above)**

```js
async function nlGenerateContent(env, heroPhoto, guide, location, type) {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  let userPrompt;
  if (type === 'full') {
    userPrompt = `כתוב תוכן לניוזלטר צילום חודשי. החזר JSON בלבד (ללא markdown), עם השדות הבאים:

{
  "hero_text_he": "פסקה קצרה (2-3 משפטים) בעברית תקנית על התמונה",
  "hero_text_en": "same paragraph in English",
  "guide_text_he": "2 משפטים מעניינים על המדריך הזה",
  "guide_text_en": "same in English",
  "location_text_he": "2-3 משפטים על המקום — מה מיוחד בו, מתי ללכת",
  "location_text_en": "same in English",
  "tip_title_he": "כותרת קצרה לטיפ (5-7 מילים)",
  "tip_title_en": "short tip title in English",
  "tip_text_he": "טיפ צילום שלא קיים באתר — מקורי, פרקטי, 2-3 משפטים",
  "tip_text_en": "same tip in English"
}

פרטים לתוכן:
- תמונה: "${heroPhoto.title}" (קטגוריה: ${heroPhoto.category || 'טבע'})
- מדריך: "${guide.he}"
- מקום: "${location.title}" — ${location.description || ''} — הזמן הטוב: ${location.best_time || 'לא צוין'}`;
  } else {
    userPrompt = `כתוב תוכן לניוזלטר צילום קצר (הבזק). החזר JSON בלבד:

{
  "hero_text_he": "משפט אחד קצר וחזק על התמונה",
  "hero_text_en": "same in English",
  "tip_text_he": "טיפ קצר אחד — משפט אחד, פרקטי",
  "tip_text_en": "same in English"
}

תמונה: "${heroPhoto.title}"`;
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-opus-4-7',
      max_tokens: 1500,
      system: 'אתה עורך ניוזלטר צילום מקצועי. כתוב עברית תקנית וברורה. טון חם ומקצועי לצלמים. החזר JSON תקין בלבד, ללא שום טקסט נוסף.',
      messages: [{ role: 'user', content: userPrompt }]
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  const raw = data.content[0].text.trim();
  const jsonStr = raw.startsWith('```') ? raw.replace(/^```json?\n?/, '').replace(/\n?```$/, '') : raw;
  return JSON.parse(jsonStr);
}
```

- [ ] **Step 3: Commit**

```bash
git add worker.js
git commit -m "feat: newsletter content helpers + Claude API function"
git push
```

---

## Task 3: Draft Generator + Cron Handler

**Files:**
- Modify: `worker.js` — add `nlGenerateDraft` and cron wiring

- [ ] **Step 1: Add `nlGenerateDraft` function (after nlGenerateContent)**

```js
async function nlGenerateDraft(env, type) {
  // Get next issue number
  const rawNum = await nlGetSetting(env, 'nl_issue_number');
  const issueNumber = parseInt(rawNum || '0', 10) + 1;

  const now = new Date();
  const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const slug = `${monthStr}-${type}`;

  // Skip if already exists
  const existing = await env.DB.prepare('SELECT id FROM newsletter_issues WHERE slug=?').bind(slug).first();
  if (existing) return { skipped: true, slug };

  // Pick content
  const heroPhoto = await nlPickHeroPhoto(env);
  if (!heroPhoto) throw new Error('No photos found');

  const guide = await nlPickGuide(env);
  const location = type === 'full' ? await nlPickLocation(env) : null;

  // Generate text via Claude
  const generated = await nlGenerateContent(env, heroPhoto, guide, location, type);

  // Build content_json
  const photoUrl = `https://amitphotos.com/photos/${heroPhoto.id}.jpg`;
  const content = type === 'full' ? {
    hero: { photo_id: heroPhoto.id, photo_url: photoUrl,
      title_he: heroPhoto.title, text_he: generated.hero_text_he, text_en: generated.hero_text_en },
    guide: { slug: guide.slug, title_he: guide.he, title_en: guide.en,
      text_he: generated.guide_text_he, text_en: generated.guide_text_en },
    location: location ? { id: location.id, title_he: location.title,
      text_he: generated.location_text_he, text_en: generated.location_text_en } : null,
    tip: { title_he: generated.tip_title_he, title_en: generated.tip_title_en,
      text_he: generated.tip_text_he, text_en: generated.tip_text_en },
    links: [
      { label_he: 'גלריה', label_en: 'Gallery', url: '/' },
      { label_he: 'מדריכים', label_en: 'Guides', url: '/camera/' },
      { label_he: 'מקומות', label_en: 'Locations', url: '/locations/' },
      { label_he: 'ניתוחי תמונות', label_en: 'Photo Analyses', url: '/learn/' }
    ]
  } : {
    hero: { photo_id: heroPhoto.id, photo_url: photoUrl,
      title_he: heroPhoto.title, text_he: generated.hero_text_he, text_en: generated.hero_text_en },
    tip: { text_he: generated.tip_text_he, text_en: generated.tip_text_en }
  };

  const titleHe = type === 'full'
    ? `גיליון #${issueNumber} — ${['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'][now.getMonth()]} ${now.getFullYear()}`
    : `הבזק — ${['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'][now.getMonth()]} ${now.getFullYear()}`;
  const titleEn = type === 'full'
    ? `Issue #${issueNumber} — ${now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`
    : `Flash — ${now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`;

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO newsletter_issues (id, slug, type, issue_number, title_he, title_en, content_json, status, created_at)
     VALUES (?,?,?,?,?,?,?,'draft',?)`
  ).bind(id, slug, type, issueNumber, titleHe, titleEn, JSON.stringify(content), now.toISOString()).run();

  // Update rotation (only on full issues)
  if (type === 'full') {
    await nlSetSetting(env, 'nl_last_hero_id', heroPhoto.id);
    await nlSetSetting(env, 'nl_guide_index', String((guide.idx + 1) % NL_GUIDE_SLUGS.length));
    if (location) {
      const { results: total } = await env.DB.prepare('SELECT COUNT(*) as c FROM locations WHERE published=1').all();
      const totalLocs = total[0]?.c || 1;
      await nlSetSetting(env, 'nl_location_index', String((location.idx + 1) % totalLocs));
    }
    await nlSetSetting(env, 'nl_issue_number', String(issueNumber));
  }

  return { id, slug, issueNumber };
}
```

- [ ] **Step 2: Add cron runner function (after nlGenerateDraft)**

```js
async function runNewsletterCron(env) {
  const day = new Date().getDate();
  const type = day <= 2 ? 'full' : 'flash'; // 1st = full, 15th = flash
  try {
    const result = await nlGenerateDraft(env, type);
    console.log('[newsletter cron]', result.skipped ? 'skipped' : `draft created: ${result.slug}`);
  } catch (e) {
    console.error('[newsletter cron] error:', e.message);
  }
}
```

- [ ] **Step 3: Wire into existing `scheduled()` handler**

Find this in worker.js (around line 4525):
```js
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runPinterestCronSync(env));
  },
```

Replace with:
```js
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runPinterestCronSync(env));
    ctx.waitUntil(runNewsletterCron(env));
  },
```

- [ ] **Step 4: Commit**

```bash
git add worker.js
git commit -m "feat: newsletter draft generator + cron handler"
git push
```

---

## Task 4: Public Newsletter Pages

**Files:**
- Modify: `worker.js` — add `handleNlList` and `handleNlIssue`

- [ ] **Step 1: Add `handleNlList` (public list page) — add after `runNewsletterCron`**

```js
async function handleNlList(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, slug, type, issue_number, title_he, published_at, content_json
     FROM newsletter_issues WHERE status='published' ORDER BY published_at DESC LIMIT 24`
  ).all();

  const cards = (results || []).map(issue => {
    const c = JSON.parse(issue.content_json || '{}');
    const thumb = c.hero?.photo_url || '';
    const badge = issue.type === 'full' ? 'גיליון מלא' : 'הבזק';
    const badgeEn = issue.type === 'full' ? 'Full Issue' : 'Flash';
    const date = issue.published_at ? issue.published_at.slice(0, 10) : '';
    return `<a class="nl-card" href="/newsletter/${escXml(issue.slug)}/">
      ${thumb ? `<img src="${escXml(thumb)}" alt="${escXml(issue.title_he)}" loading="lazy">` : '<div class="nl-card-placeholder"></div>'}
      <div class="nl-card-body">
        <span class="nl-badge" data-he="${escXml(badge)}" data-en="${escXml(badgeEn)}">${escXml(badge)}</span>
        <div class="nl-card-title">${escXml(issue.title_he)}</div>
        <div class="nl-card-date">${escXml(date)}</div>
      </div>
    </a>`;
  }).join('\n');

  const empty = !results?.length
    ? '<p style="text-align:center;color:#888;padding:4rem">הניוזלטר הראשון יפורסם בקרוב</p>'
    : '';

  return new Response(`<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ניוזלטר | Amit Photos</title>
<link rel="canonical" href="https://amitphotos.com/newsletter/">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;600;700&family=Syne:wght@700&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0a0a0a;--surface:#111;--border:#222;--accent:#c8a96e;--text:#f0ede8;--muted:#888}
body{font-family:'Heebo',sans-serif;background:var(--bg);color:var(--text);direction:rtl;min-height:100vh;padding:0 0 4rem}
.page-hero{text-align:center;padding:2.5rem 1.25rem 1.5rem}
.page-hero h1{font-family:'Syne',sans-serif;font-size:1.8rem;color:var(--accent);margin-bottom:.5rem}
.page-hero p{color:var(--muted);font-size:.9rem}
.nl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:1.25rem;padding:1.25rem;max-width:1100px;margin:0 auto}
.nl-card{background:var(--surface);border:1px solid var(--border);border-radius:14px;overflow:hidden;text-decoration:none;color:inherit;transition:border-color .2s}
.nl-card:hover{border-color:var(--accent)}
.nl-card img,.nl-card-placeholder{width:100%;height:160px;object-fit:cover;display:block;background:#1a1a1a}
.nl-card-body{padding:.75rem 1rem}
.nl-badge{display:inline-block;font-size:.68rem;background:rgba(200,169,110,.12);border:1px solid rgba(200,169,110,.3);color:var(--accent);border-radius:20px;padding:2px 8px;margin-bottom:.5rem}
.nl-card-title{font-family:'Syne',sans-serif;font-size:.95rem;color:var(--text);margin-bottom:.3rem}
.nl-card-date{font-size:.75rem;color:var(--muted)}
</style>
<script src="/assets/js/nav.js" defer></script>
</head>
<body>
<div class="page-hero">
  <h1 data-he="ניוזלטר" data-en="Newsletter">ניוזלטר</h1>
  <p data-he="גיליונות חודשיים — תמונות, מדריכים ומקומות צילום" data-en="Monthly issues — photos, guides and shooting locations">גיליונות חודשיים — תמונות, מדריכים ומקומות צילום</p>
</div>
<div class="nl-grid">${cards}${empty}</div>
<script>
function getLang(){return localStorage.getItem('lang')||'he'}
function applyLang(){const lang=getLang(),isEn=lang==='en';document.documentElement.dir=isEn?'ltr':'rtl';document.documentElement.lang=lang;document.querySelectorAll('[data-he]').forEach(el=>{el.innerHTML=isEn?(el.dataset.en||el.dataset.he):el.dataset.he})}
applyLang();window.setLang=applyLang;window.addEventListener('storage',e=>{if(e.key==='lang')applyLang()})
</script>
</body></html>`, { headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-cache' } });
}
```

- [ ] **Step 2: Add `handleNlIssue` (magazine page) — add after `handleNlList`**

```js
async function handleNlIssue(env, slug, isPreview) {
  const issue = await env.DB.prepare(
    `SELECT * FROM newsletter_issues WHERE slug=?${isPreview ? '' : " AND status='published'"}`
  ).bind(slug).first();
  if (!issue) return new Response('Not found', { status: 404 });

  const c = JSON.parse(issue.content_json || '{}');
  const isFull = issue.type === 'full';
  const dateStr = issue.published_at ? issue.published_at.slice(0, 10) : new Date().toISOString().slice(0, 10);

  const heroSection = c.hero ? `
    <section class="nl-section nl-hero-section">
      <img src="${escXml(c.hero.photo_url)}" alt="${escXml(c.hero.title_he)}" class="nl-hero-img">
      <h2 class="nl-photo-title">${escXml(c.hero.title_he)}</h2>
      <p class="nl-body-text" data-he="${escXml(c.hero.text_he)}" data-en="${escXml(c.hero.text_en || c.hero.text_he)}">${escXml(c.hero.text_he)}</p>
    </section>` : '';

  const guideSection = isFull && c.guide ? `
    <section class="nl-section nl-guide-section">
      <div class="nl-section-badge" data-he="מדריך החודש" data-en="Guide of the Month">מדריך החודש</div>
      <h2 class="nl-section-title" data-he="${escXml(c.guide.title_he)}" data-en="${escXml(c.guide.title_en || c.guide.title_he)}">${escXml(c.guide.title_he)}</h2>
      <p class="nl-body-text" data-he="${escXml(c.guide.text_he)}" data-en="${escXml(c.guide.text_en || c.guide.text_he)}">${escXml(c.guide.text_he)}</p>
      <a class="nl-link" href="/camera/${escXml(c.guide.slug)}/" data-he="קרא את המדריך ←" data-en="Read the guide ←">קרא את המדריך ←</a>
    </section>` : '';

  const locationSection = isFull && c.location ? `
    <section class="nl-section nl-location-section">
      <div class="nl-section-badge" data-he="מקום לצילום" data-en="Photo Location">מקום לצילום</div>
      <h2 class="nl-section-title">${escXml(c.location.title_he)}</h2>
      <p class="nl-body-text" data-he="${escXml(c.location.text_he)}" data-en="${escXml(c.location.text_en || c.location.text_he)}">${escXml(c.location.text_he)}</p>
      <a class="nl-link" href="/locations/" data-he="לכל המקומות ←" data-en="All locations ←">לכל המקומות ←</a>
    </section>` : '';

  const tipSection = c.tip ? `
    <section class="nl-section nl-tip-section">
      <div class="nl-tip-card">
        <div class="nl-tip-title" data-he="${escXml(c.tip.title_he || 'טיפ החודש')}" data-en="${escXml(c.tip.title_en || 'Tip of the Month')}">${escXml(c.tip.title_he || 'טיפ החודש')}</div>
        <p data-he="${escXml(c.tip.text_he)}" data-en="${escXml(c.tip.text_en || c.tip.text_he)}">${escXml(c.tip.text_he)}</p>
      </div>
    </section>` : '';

  const linksSection = isFull && c.links ? `
    <section class="nl-section nl-links-section">
      <div class="nl-section-badge" data-he="קישורים שימושיים" data-en="Useful Links">קישורים שימושיים</div>
      <div class="nl-links-row">${c.links.map(l =>
        `<a class="nl-link-pill" href="${escXml(l.url)}" data-he="${escXml(l.label_he)}" data-en="${escXml(l.label_en)}">${escXml(l.label_he)}</a>`
      ).join('')}</div>
    </section>` : '';

  const previewBanner = isPreview
    ? `<div style="background:#7c3f00;color:#fff;text-align:center;padding:.5rem;font-size:.8rem">טיוטה — לא פורסמה</div>` : '';

  const html = `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escXml(issue.title_he)} | Amit Photos</title>
${!isPreview ? `<link rel="canonical" href="https://amitphotos.com/newsletter/${escXml(slug)}/">` : ''}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;600;700&family=Syne:wght@700&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0a0a0a;--surface:#111;--border:#222;--accent:#c8a96e;--text:#f0ede8;--muted:#888}
body{font-family:'Heebo',sans-serif;background:var(--bg);color:var(--text);direction:rtl;min-height:100vh}
.nl-header{display:flex;justify-content:space-between;align-items:center;padding:1rem 1.5rem;border-bottom:1px solid var(--border);max-width:800px;margin:0 auto}
.nl-header-logo{font-family:'Syne',sans-serif;color:var(--accent);text-decoration:none;font-size:1rem}
.nl-header-meta{font-size:.75rem;color:var(--muted)}
.nl-issue-title{font-family:'Syne',sans-serif;font-size:1.6rem;color:var(--accent);text-align:center;padding:2rem 1.5rem 1rem;max-width:800px;margin:0 auto}
.nl-section{max-width:800px;margin:0 auto;padding:1.5rem}
.nl-hero-img{width:100%;max-height:480px;object-fit:cover;border-radius:12px;display:block;margin-bottom:1rem}
.nl-photo-title{font-family:'Syne',sans-serif;font-size:1.1rem;color:var(--accent);margin-bottom:.5rem}
.nl-body-text{color:var(--text);font-size:.95rem;line-height:1.7;margin-bottom:.75rem}
.nl-section-badge{display:inline-block;font-size:.68rem;background:rgba(200,169,110,.12);border:1px solid rgba(200,169,110,.3);color:var(--accent);border-radius:20px;padding:3px 10px;margin-bottom:.75rem}
.nl-section-title{font-family:'Syne',sans-serif;font-size:1.1rem;color:var(--text);margin-bottom:.6rem}
.nl-link{color:var(--accent);font-size:.85rem;text-decoration:none;display:inline-block;margin-top:.25rem}
.nl-link:hover{text-decoration:underline}
.nl-tip-card{background:rgba(200,169,110,.08);border:1px solid rgba(200,169,110,.25);border-radius:12px;padding:1.25rem}
.nl-tip-title{font-family:'Syne',sans-serif;font-size:.95rem;color:var(--accent);margin-bottom:.5rem}
.nl-links-row{display:flex;gap:.6rem;flex-wrap:wrap;margin-top:.5rem}
.nl-link-pill{background:var(--surface);border:1px solid var(--border);border-radius:20px;padding:.4rem .9rem;font-size:.8rem;color:var(--text);text-decoration:none;transition:border-color .2s}
.nl-link-pill:hover{border-color:var(--accent);color:var(--accent)}
.nl-divider{max-width:800px;margin:0 auto;border:none;border-top:1px solid var(--border)}
.nl-footer{text-align:center;padding:2rem;color:var(--muted);font-size:.75rem;max-width:800px;margin:0 auto}
.nl-footer a{color:var(--muted)}
@media print{
  body{background:#fff;color:#111}
  :root{--bg:#fff;--surface:#f5f5f5;--border:#ccc;--accent:#8b6914;--text:#111;--muted:#555}
  .nl-header{border-bottom:1px solid #ccc}
  .nl-link-pill{border:1px solid #ccc;color:#333}
  nav,.no-print{display:none!important}
  @page{size:A4;margin:15mm}
  .nl-section{page-break-inside:avoid}
}
</style>
<script src="/assets/js/nav.js" defer></script>
</head>
<body>
${previewBanner}
<header class="nl-header">
  <a class="nl-header-logo" href="/">Amit Photos</a>
  <span class="nl-header-meta">${escXml(dateStr)}</span>
</header>
<h1 class="nl-issue-title">${escXml(issue.title_he)}</h1>
${heroSection}
<hr class="nl-divider">
${guideSection}
${guideSection ? '<hr class="nl-divider">' : ''}
${locationSection}
${locationSection ? '<hr class="nl-divider">' : ''}
${tipSection}
${tipSection ? '<hr class="nl-divider">' : ''}
${linksSection}
<footer class="nl-footer">
  <p>© Amit Photos | <a href="/">amitphotos.com</a></p>
</footer>
<script>
function getLang(){return localStorage.getItem('lang')||'he'}
function applyLang(){const lang=getLang(),isEn=lang==='en';document.documentElement.dir=isEn?'ltr':'rtl';document.documentElement.lang=lang;document.querySelectorAll('[data-he]').forEach(el=>{el.innerHTML=isEn?(el.dataset.en||el.dataset.he):el.dataset.he})}
applyLang();window.setLang=applyLang;window.addEventListener('storage',e=>{if(e.key==='lang')applyLang()})
</script>
</body></html>`;

  return new Response(html, { headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-cache' } });
}
```

- [ ] **Step 3: Commit**

```bash
git add worker.js
git commit -m "feat: public newsletter list + magazine issue pages"
git push
```

---

## Task 5: Admin Newsletter Pages

**Files:**
- Modify: `worker.js` — add `handleAdminNlList`, `handleAdminNlEditor`

- [ ] **Step 1: Add `handleAdminNlList` (after `handleNlIssue`)**

```js
async function handleAdminNlList(request, env) {
  if (!await checkAuth(request, env)) return new Response('Unauthorized', { status: 401 });

  const { results } = await env.DB.prepare(
    `SELECT id, slug, type, issue_number, title_he, status, published_at, created_at
     FROM newsletter_issues ORDER BY created_at DESC LIMIT 50`
  ).all();

  const rows = (results || []).map(issue => {
    const statusBadge = issue.status === 'published'
      ? `<span style="color:#4caf50">פורסם</span>`
      : `<span style="color:#ff9800">טיוטה</span>`;
    const date = issue.created_at ? issue.created_at.slice(0, 10) : '';
    return `<tr>
      <td>${escXml(String(issue.issue_number))}</td>
      <td>${statusBadge}</td>
      <td>${escXml(issue.type === 'full' ? 'מלא' : 'הבזק')}</td>
      <td>${escXml(issue.title_he)}</td>
      <td>${escXml(date)}</td>
      <td>
        <a href="/admin/newsletter/${escXml(issue.id)}/">ערוך</a> |
        <a href="/admin/newsletter/${escXml(issue.id)}/preview/" target="_blank">תצוגה מקדימה</a>
        ${issue.status === 'published' ? ` | <a href="/newsletter/${escXml(issue.slug)}/" target="_blank">צפה</a>` : ''}
      </td>
    </tr>`;
  }).join('');

  return new Response(`<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ניהול ניוזלטר | Admin</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Heebo',Arial,sans-serif;background:#0a0a0a;color:#f0ede8;padding:1.5rem;direction:rtl}
h1{font-size:1.4rem;color:#c8a96e;margin-bottom:1.25rem}
.actions{display:flex;gap:.75rem;margin-bottom:1.5rem;flex-wrap:wrap}
button{background:#c8a96e;color:#000;border:none;padding:.5rem 1.1rem;border-radius:8px;cursor:pointer;font-size:.85rem;font-weight:700}
button:disabled{opacity:.5;cursor:default}
#msg{font-size:.85rem;padding:.5rem;border-radius:6px;margin-bottom:1rem;display:none}
table{width:100%;border-collapse:collapse;font-size:.85rem}
th,td{padding:.6rem .75rem;border-bottom:1px solid #222;text-align:right}
th{color:#888;font-weight:600}
a{color:#c8a96e;text-decoration:none}
a:hover{text-decoration:underline}
</style>
</head>
<body>
<h1>ניהול ניוזלטר</h1>
<div class="actions">
  <button onclick="generate('full')">📰 צור גיליון מלא</button>
  <button onclick="generate('flash')">⚡ צור הבזק</button>
</div>
<div id="msg"></div>
<table>
  <thead><tr><th>#</th><th>סטטוס</th><th>סוג</th><th>כותרת</th><th>תאריך</th><th>פעולות</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="6" style="text-align:center;color:#888;padding:2rem">אין גיליונות עדיין</td></tr>'}</tbody>
</table>
<script>
const tok = localStorage.getItem('adminToken') || '';
async function generate(type) {
  const msg = document.getElementById('msg');
  msg.style.display = 'block';
  msg.style.background = '#1a1a1a';
  msg.style.color = '#888';
  msg.textContent = 'יוצר טיוטה... (עד 30 שניות)';
  try {
    const r = await fetch('/api/admin/newsletter/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Session-Token': tok },
      body: JSON.stringify({ type })
    });
    const d = await r.json();
    if (d.skipped) { msg.style.color = '#ff9800'; msg.textContent = 'גיליון לתקופה זו כבר קיים'; }
    else if (d.slug) { msg.style.color = '#4caf50'; msg.textContent = 'נוצר! מרענן...'; setTimeout(() => location.reload(), 1000); }
    else { msg.style.color = '#f44336'; msg.textContent = d.error || 'שגיאה'; }
  } catch(e) { msg.style.color = '#f44336'; msg.textContent = 'שגיאת רשת: ' + e.message; }
}
</script>
</body></html>`, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
}
```

- [ ] **Step 2: Add `handleAdminNlEditor` (after `handleAdminNlList`)**

```js
async function handleAdminNlEditor(request, env, id) {
  if (!await checkAuth(request, env)) return new Response('Unauthorized', { status: 401 });
  const issue = await env.DB.prepare('SELECT * FROM newsletter_issues WHERE id=?').bind(id).first();
  if (!issue) return new Response('Not found', { status: 404 });
  const c = JSON.parse(issue.content_json || '{}');

  const field = (label, key, subkey, val) =>
    `<div class="field">
      <label>${escXml(label)}</label>
      <textarea name="${escXml(key + '.' + subkey)}" rows="3">${escXml(val || '')}</textarea>
    </div>`;

  const heroFields = c.hero ? `
    <h2>תמונה ראשית</h2>
    <div class="field"><label>Photo ID</label><input name="hero.photo_id" value="${escXml(c.hero.photo_id||'')}"></div>
    ${field('טקסט עברית','hero','text_he',c.hero.text_he)}
    ${field('טקסט אנגלית','hero','text_en',c.hero.text_en)}` : '';

  const guideFields = c.guide ? `
    <h2>מדריך החודש</h2>
    <div class="field"><label>Slug</label><input name="guide.slug" value="${escXml(c.guide.slug||'')}"></div>
    ${field('טקסט עברית','guide','text_he',c.guide.text_he)}
    ${field('טקסט אנגלית','guide','text_en',c.guide.text_en)}` : '';

  const locationFields = c.location ? `
    <h2>מקום לצילום</h2>
    ${field('טקסט עברית','location','text_he',c.location.text_he)}
    ${field('טקסט אנגלית','location','text_en',c.location.text_en)}` : '';

  const tipFields = c.tip ? `
    <h2>טיפ החודש</h2>
    ${field('כותרת עברית','tip','title_he',c.tip.title_he)}
    ${field('טקסט עברית','tip','text_he',c.tip.text_he)}
    ${field('טקסט אנגלית','tip','text_en',c.tip.text_en)}` : '';

  const publishBtn = issue.status === 'draft'
    ? `<button type="button" onclick="publish()">🚀 פרסם</button>`
    : `<span style="color:#4caf50">✓ פורסם ב-${escXml((issue.published_at||'').slice(0,10))}</span>`;

  return new Response(`<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>עורך ניוזלטר | Admin</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Heebo',Arial,sans-serif;background:#0a0a0a;color:#f0ede8;padding:1.5rem;direction:rtl;max-width:800px}
h1{font-size:1.3rem;color:#c8a96e;margin-bottom:1rem}
h2{font-size:1rem;color:#c8a96e;margin:1.5rem 0 .75rem;border-bottom:1px solid #222;padding-bottom:.4rem}
.field{margin-bottom:1rem}
label{display:block;font-size:.8rem;color:#888;margin-bottom:.3rem}
input,textarea{width:100%;background:#111;border:1px solid #333;color:#f0ede8;padding:.5rem .75rem;border-radius:8px;font-family:inherit;font-size:.85rem;resize:vertical}
.actions{display:flex;gap:.75rem;margin:1.5rem 0;flex-wrap:wrap;align-items:center}
button{background:#c8a96e;color:#000;border:none;padding:.5rem 1.1rem;border-radius:8px;cursor:pointer;font-size:.85rem;font-weight:700}
.btn-secondary{background:#222;color:#f0ede8}
#msg{font-size:.85rem;padding:.5rem;border-radius:6px;margin-top:.5rem;display:none}
</style>
</head>
<body>
<h1>${escXml(issue.title_he)}</h1>
<div class="actions">
  <button onclick="save()">💾 שמור טיוטה</button>
  <a href="/admin/newsletter/${escXml(id)}/preview/" target="_blank"><button type="button" class="btn-secondary">👁 תצוגה מקדימה</button></a>
  ${publishBtn}
  <a href="/admin/newsletter/"><button type="button" class="btn-secondary">← חזרה לרשימה</button></a>
</div>
<div id="msg"></div>
${heroFields}${guideFields}${locationFields}${tipFields}
<script>
const tok = localStorage.getItem('adminToken') || '';
function collectContent() {
  const content = ${JSON.stringify(c)};
  document.querySelectorAll('input[name],textarea[name]').forEach(el => {
    const [section, key] = el.name.split('.');
    if (!content[section]) content[section] = {};
    content[section][key] = el.value;
  });
  return content;
}
async function save() {
  const msg = document.getElementById('msg');
  msg.style.display = 'block'; msg.style.color = '#888'; msg.textContent = 'שומר...';
  const r = await fetch('/api/admin/newsletter/${escXml(id)}', {
    method: 'PATCH',
    headers: {'Content-Type':'application/json','X-Session-Token':tok},
    body: JSON.stringify({ content_json: JSON.stringify(collectContent()) })
  });
  const d = await r.json();
  msg.style.color = d.ok ? '#4caf50' : '#f44336';
  msg.textContent = d.ok ? 'נשמר!' : (d.error || 'שגיאה');
}
async function publish() {
  if (!confirm('לפרסם את הגיליון?')) return;
  const msg = document.getElementById('msg');
  msg.style.display = 'block'; msg.style.color = '#888'; msg.textContent = 'מפרסם...';
  const r = await fetch('/api/admin/newsletter/${escXml(id)}/publish', {
    method: 'POST', headers: {'X-Session-Token':tok}
  });
  const d = await r.json();
  if (d.url) { msg.style.color = '#4caf50'; msg.textContent = 'פורסם! מנתב...'; setTimeout(() => location.href = d.url, 800); }
  else { msg.style.color = '#f44336'; msg.textContent = d.error || 'שגיאה'; }
}
</script>
</body></html>`, { headers: { 'Content-Type': 'text/html;charset=utf-8' } });
}
```

- [ ] **Step 3: Commit**

```bash
git add worker.js
git commit -m "feat: admin newsletter list + editor pages"
git push
```

---

## Task 6: Admin API Routes

**Files:**
- Modify: `worker.js` — add API handlers for generate, update, publish, preview

- [ ] **Step 1: Add API handlers (after `handleAdminNlEditor`)**

```js
async function handleAdminNlGenerate(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== 'POST') return jsonRes({ error: 'method not allowed' }, 405, request);
  const { type } = await request.json().catch(() => ({}));
  if (!['full', 'flash'].includes(type)) return jsonRes({ error: 'type must be full or flash' }, 400, request);
  try {
    const result = await nlGenerateDraft(env, type);
    return jsonRes(result, 200, request);
  } catch(e) {
    return jsonRes({ error: e.message }, 500, request);
  }
}

async function handleAdminNlUpdate(request, env, id) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== 'PATCH') return jsonRes({ error: 'method not allowed' }, 405, request);
  const body = await request.json().catch(() => ({}));
  const updates = [];
  const binds = [];
  if (body.title_he !== undefined) { updates.push('title_he=?'); binds.push(body.title_he); }
  if (body.title_en !== undefined) { updates.push('title_en=?'); binds.push(body.title_en); }
  if (body.content_json !== undefined) { updates.push('content_json=?'); binds.push(body.content_json); }
  if (!updates.length) return jsonRes({ error: 'no fields to update' }, 400, request);
  binds.push(id);
  await env.DB.prepare(`UPDATE newsletter_issues SET ${updates.join(',')} WHERE id=?`).bind(...binds).run();
  return jsonRes({ ok: true }, 200, request);
}

async function handleAdminNlPublish(request, env, id) {
  if (!await checkAuth(request, env)) return unauth(request);
  if (request.method !== 'POST') return jsonRes({ error: 'method not allowed' }, 405, request);
  const issue = await env.DB.prepare('SELECT slug, status FROM newsletter_issues WHERE id=?').bind(id).first();
  if (!issue) return jsonRes({ error: 'not found' }, 404, request);
  await env.DB.prepare(
    `UPDATE newsletter_issues SET status='published', published_at=? WHERE id=?`
  ).bind(new Date().toISOString(), id).run();
  return jsonRes({ ok: true, url: `/newsletter/${issue.slug}/` }, 200, request);
}
```

- [ ] **Step 2: Commit**

```bash
git add worker.js
git commit -m "feat: admin newsletter API routes (generate, update, publish)"
git push
```

---

## Task 7: Router Wiring + Wrangler Cron

**Files:**
- Modify: `worker.js` — add routes to fetch handler
- Modify: `wrangler.toml` — add newsletter cron trigger

- [ ] **Step 1: Add routes to the fetch handler**

In `worker.js`, find this block near the end of the `fetch` handler (around line 4486):
```js
    if (path.startsWith('/learn/') && path.length > '/learn/'.length)
```

Add BEFORE that line:

```js
    // Newsletter public routes
    if (path === '/newsletter' || path === '/newsletter/') return handleNlList(env);
    if (path.startsWith('/newsletter/') && path.length > '/newsletter/'.length) {
      const slug = path.slice('/newsletter/'.length).replace(/\/$/, '');
      return handleNlIssue(env, slug, false);
    }

    // Newsletter admin pages
    if (path === '/admin/newsletter' || path === '/admin/newsletter/') return handleAdminNlList(request, env);
    if (path.match(/^\/admin\/newsletter\/[^/]+\/preview\/?$/)) {
      const id = path.slice('/admin/newsletter/'.length).replace(/\/preview\/?$/, '');
      if (!await checkAuth(request, env)) return new Response('Unauthorized', { status: 401 });
      const issue = await env.DB.prepare('SELECT * FROM newsletter_issues WHERE id=?').bind(id).first();
      return issue ? handleNlIssue(env, issue.slug, true) : new Response('Not found', { status: 404 });
    }
    if (path.match(/^\/admin\/newsletter\/[^/]+\/?$/)) {
      const id = path.slice('/admin/newsletter/'.length).replace(/\/$/, '');
      return handleAdminNlEditor(request, env, id);
    }

    // Newsletter API routes
    if (path === '/api/admin/newsletter/generate' && request.method === 'POST') return handleAdminNlGenerate(request, env);
    if (path.match(/^\/api\/admin\/newsletter\/[^/]+$/) && request.method === 'PATCH') {
      const id = path.slice('/api/admin/newsletter/'.length);
      return handleAdminNlUpdate(request, env, id);
    }
    if (path.match(/^\/api\/admin\/newsletter\/[^/]+\/publish$/) && request.method === 'POST') {
      const id = path.slice('/api/admin/newsletter/'.length).replace(/\/publish$/, '');
      return handleAdminNlPublish(request, env, id);
    }
```

- [ ] **Step 2: Update wrangler.toml to add newsletter cron**

Find in `wrangler.toml`:
```toml
[triggers]
crons = ["0 */2 * * *"]
```

Replace with:
```toml
[triggers]
crons = ["0 */2 * * *", "0 9 1,15 * *"]
```

- [ ] **Step 3: Deploy**

```bash
npx wrangler deploy --minify 2>&1 | tail -6
```

Expected: `Deployed amit-photos triggers` with updated version ID.

- [ ] **Step 4: Smoke test public list page**

Open `https://amitphotos.com/newsletter/` — should show the newsletter list (empty for now with "בקרוב" message).

- [ ] **Step 5: Smoke test admin**

In browser console on admin.html, get `localStorage.getItem('adminToken')`. Then:

```bash
curl -X POST https://amitphotos.com/api/admin/newsletter/generate \
  -H "Content-Type: application/json" \
  -H "X-Session-Token: YOUR_TOKEN" \
  -d '{"type":"full"}'
```

Expected: `{"id":"...","slug":"2026-05-full","issueNumber":1}` (takes ~20s while Claude generates)

- [ ] **Step 6: Test full flow**

1. Open `https://amitphotos.com/admin/newsletter/` — should show the new draft
2. Click "ערוך" — editor opens with all sections
3. Edit a text field, click "שמור טיוטה" — should save
4. Click "תצוגה מקדימה" — magazine page with orange banner "טיוטה"
5. Click "פרסם" — redirects to `/newsletter/2026-05-full/`
6. Open `/newsletter/` — card appears in list

- [ ] **Step 7: Commit**

```bash
git add worker.js wrangler.toml
git commit -m "feat: wire newsletter routes + add cron trigger"
git push
```

---

## Self-Review

**Spec coverage:**
- ✅ `newsletter_issues` D1 table → Task 1
- ✅ Rotation state in settings table → Task 1 + Task 2
- ✅ Hero photo selection (newest, not last used) → Task 2 `nlPickHeroPhoto`
- ✅ Guide rotation (19 guides, circular) → Task 2 `nlPickGuide`
- ✅ Location rotation (from D1) → Task 2 `nlPickLocation`
- ✅ Claude Opus 4.7 for Hebrew text → Task 2 `nlGenerateContent`
- ✅ Draft saved to D1 → Task 3 `nlGenerateDraft`
- ✅ Cron: 1st = full, 15th = flash → Task 3 `runNewsletterCron` + Task 7 wrangler.toml
- ✅ `/newsletter/` list page → Task 4 `handleNlList`
- ✅ `/newsletter/:slug/` magazine page + print CSS → Task 4 `handleNlIssue`
- ✅ Admin list `/admin/newsletter/` → Task 5 `handleAdminNlList`
- ✅ Admin editor `/admin/newsletter/:id/` → Task 5 `handleAdminNlEditor`
- ✅ Preview at `/admin/newsletter/:id/preview/` → Task 7 router inline
- ✅ API: generate, update, publish → Task 6
- ✅ Full issue: hero + guide + location + tip + links → Task 3 content build
- ✅ Flash issue: hero + tip → Task 3 content build
- ✅ i18n data-he/data-en + applyLang() → Tasks 4, 5
- ✅ Print CSS → Task 4 `handleNlIssue` `@media print`

**Placeholder scan:** None.

**Type consistency:**
- `nlGenerateDraft` calls `nlPickHeroPhoto`, `nlPickGuide`, `nlPickLocation`, `nlGenerateContent` — all defined in Task 2 ✅
- `handleAdminNlEditor` uses `escXml` — defined in worker.js line 2027 ✅
- Router calls `handleNlList`, `handleNlIssue`, `handleAdminNlList`, `handleAdminNlEditor`, `handleAdminNlGenerate`, `handleAdminNlUpdate`, `handleAdminNlPublish` — all defined in Tasks 2–6 ✅
- `collectContent()` in editor JS starts from `${JSON.stringify(c)}` (server-inlined) and merges textarea values — consistent with PATCH body shape ✅
