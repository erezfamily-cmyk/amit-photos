# Newsletter Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the newsletter issue page with a wall-mockup, gallery strip, sale banner, step-by-step guide, home/office CTA cards, and personal contact card — turning every issue into a conversion tool.

**Architecture:** All changes are in `worker.js`. New helper `nlPickGalleryPhotos` picks gallery photos at draft-generation time and stores them in `content_json`. `nlGenerateContent` prompt is extended to return `guide_steps` and `sale` fields. `handleNlIssue` renders six new visual sections. Old issues degrade gracefully (all new sections are conditional on presence of their `content_json` fields).

**Tech Stack:** Cloudflare Workers, Cloudflare D1, Claude API (claude-opus-4-7), vanilla JS/HTML/CSS

---

## Files Changed

| File | What changes |
|---|---|
| `worker.js` | `nlPickGalleryPhotos()` (new), `nlGenerateContent()` prompt (extended), `nlGenerateDraft()` (wires gallery + sale + steps), `handleNlIssue()` (6 new sections + CSS + JS), `handleAdminNlEditor()` (sale fields + steps display) |

---

### Task 1: `nlPickGalleryPhotos` helper + wire into `nlGenerateDraft`

**Files:**
- Modify: `worker.js` (after `nlPickHeroPhoto` ~line 4424, and in `nlGenerateDraft` ~line 4504)

- [ ] **Step 1: Add `nlPickGalleryPhotos` function**

Add this function immediately after `nlPickHeroPhoto` (around line 4424):

```js
async function nlPickGalleryPhotos(env, heroPhotoId) {
  const { results } = await env.DB.prepare(
    'SELECT id, title FROM photos WHERE published=1 AND id != ? ORDER BY RANDOM() LIMIT 3'
  ).bind(heroPhotoId).all();
  return (results || []).map(p => ({
    id: p.id,
    title: p.title || '',
    url: `https://amitphotos.com/photos/${p.id}.jpg`
  }));
}
```

- [ ] **Step 2: Call it in `nlGenerateDraft` and store result**

In `nlGenerateDraft`, after `const heroPhoto = await nlPickHeroPhoto(env);`, add:

```js
const galleryPhotos = await nlPickGalleryPhotos(env, heroPhoto.id);
```

Then in the `content` object for **full** issues, add `gallery_photos: galleryPhotos` at the top level:

```js
const content = type === 'full' ? {
  hero: { photo_id: heroPhoto.id, photo_url: photoUrl,
    title_he: heroPhoto.title, text_he: generated.hero_text_he, text_en: generated.hero_text_en },
  guide: { slug: guide.slug, title_he: guide.he, title_en: guide.en,
    text_he: generated.guide_text_he, text_en: generated.guide_text_en },
  location: location ? { id: location.id, title_he: location.title,
    text_he: generated.location_text_he, text_en: generated.location_text_en } : null,
  tip: { title_he: generated.tip_title_he, title_en: generated.tip_title_en,
    text_he: generated.tip_text_he, text_en: generated.tip_text_en },
  gallery_photos: galleryPhotos,
  links: [
    { label_he: 'גלריה', label_en: 'Gallery', url: '/' },
    { label_he: 'מדריכים', label_en: 'Guides', url: '/camera/' },
    { label_he: 'מקומות', label_en: 'Locations', url: '/locations/' },
    { label_he: 'ניתוחי תמונות', label_en: 'Photo Analyses', url: '/learn/' }
  ]
} : {
  hero: { photo_id: heroPhoto.id, photo_url: photoUrl,
    title_he: heroPhoto.title, text_he: generated.hero_text_he, text_en: generated.hero_text_en },
  tip: { text_he: generated.tip_text_he, text_en: generated.tip_text_en },
  gallery_photos: galleryPhotos
};
```

- [ ] **Step 3: Commit**

```bash
git add worker.js
git commit -m "feat: nlPickGalleryPhotos — 3 random photos stored in content_json"
```

---

### Task 2: Update Claude prompt for `guide.steps` + `sale`

**Files:**
- Modify: `worker.js` — `nlGenerateContent` (~line 4426) and `nlGenerateDraft` (~line 4516)

- [ ] **Step 1: Update the full-issue Claude prompt**

Replace the `userPrompt` for `type === 'full'` in `nlGenerateContent`:

```js
userPrompt = `כתוב תוכן לניוזלטר צילום חודשי. החזר JSON בלבד (ללא markdown), עם השדות הבאים:

{
  "hero_text_he": "פסקה קצרה (2-3 משפטים) בעברית תקנית על התמונה",
  "hero_text_en": "same paragraph in English",
  "guide_steps": [
    {"num": 1, "title_he": "כותרת השלב (4-6 מילים)", "text_he": "הסבר (2-3 משפטים)"},
    {"num": 2, "title_he": "...", "text_he": "..."},
    {"num": 3, "title_he": "...", "text_he": "..."}
  ],
  "guide_text_en": "2 sentences about this guide topic in English",
  "location_text_he": "2-3 משפטים על המקום — מה מיוחד בו, מתי ללכת",
  "location_text_en": "same in English",
  "tip_title_he": "כותרת קצרה לטיפ (5-7 מילים)",
  "tip_title_en": "short tip title in English",
  "tip_text_he": "טיפ צילום שלא קיים באתר — מקורי, פרקטי, 2-3 משפטים",
  "tip_text_en": "same tip in English",
  "sale_title_he": "שם מבצע קצר (4-5 מילים, למשל: מבצע קיץ על הדפסות A2)",
  "sale_desc_he": "תיאור קצר עם תאריך סיום (למשל: עד סוף החודש · כולל מסגור חינם)",
  "sale_original_price": "₪480",
  "sale_price": "₪385",
  "sale_discount_label": "20% הנחה"
}

פרטים לתוכן:
- תמונה: "${heroPhoto.title}" (קטגוריה: ${heroPhoto.category || 'טבע'})
- מדריך: "${guide.he}"
- מקום: "${location.title}" — ${location.description || ''} — הזמן הטוב: ${location.best_time || 'לא צוין'}`;
```

Also bump `max_tokens` from 1500 to 2000 (more content now):

```js
max_tokens: 2000,
```

- [ ] **Step 2: Wire `guide.steps` and `sale` into `content_json` in `nlGenerateDraft`**

Replace the `guide` and add `sale` in the full-issue content object:

```js
guide: { slug: guide.slug, title_he: guide.he, title_en: guide.en,
  text_he: (generated.guide_steps || []).map(s => `${s.num}. ${s.title_he}: ${s.text_he}`).join(' '),
  text_en: generated.guide_text_en,
  steps: generated.guide_steps || [] },
sale: generated.sale_title_he ? {
  title_he: generated.sale_title_he,
  desc_he: generated.sale_desc_he,
  original_price: generated.sale_original_price || '₪480',
  sale_price: generated.sale_price || '₪385',
  discount_label: generated.sale_discount_label || 'מבצע'
} : null,
```

- [ ] **Step 3: Commit**

```bash
git add worker.js
git commit -m "feat: Claude prompt — guide steps (3) + sale banner fields"
```

---

### Task 3: Render new sections in `handleNlIssue`

**Files:**
- Modify: `worker.js` — `handleNlIssue` (~line 4642): CSS block, section variables, HTML layout

- [ ] **Step 1: Add CSS for new sections**

In the `<style>` block inside `handleNlIssue` (after `.nl-links-row` rule around line 4722), add:

```css
.nl-wall-section{text-align:center}
.nl-wall-room{background:linear-gradient(180deg,#2a2520,#1e1a16);border-radius:10px;padding:2rem 1.5rem 1rem;display:inline-flex;flex-direction:column;align-items:center;width:100%;max-width:500px;margin:.75rem auto 0}
.nl-wall-frame{border:8px solid #2a2416;box-shadow:0 8px 32px rgba(0,0,0,.6);width:220px;height:160px;overflow:hidden}
.nl-wall-frame img{width:100%;height:100%;object-fit:cover;display:block}
.nl-wall-floor{width:100%;height:6px;background:linear-gradient(90deg,#3a3020,#4a4030,#3a3020);border-radius:2px;margin-top:1.5rem}
.nl-wall-price{color:var(--accent);font-size:.9rem;font-weight:700;margin:.6rem 0 .4rem;text-align:center}
.nl-wall-cta{display:flex;gap:.6rem;justify-content:center;flex-wrap:wrap;margin-bottom:.4rem}
.nl-btn-buy{background:var(--accent);color:#000;padding:.45rem 1.2rem;border-radius:8px;font-size:.8rem;font-weight:700;text-decoration:none}
.nl-btn-outline{background:transparent;color:var(--accent);border:1px solid rgba(200,169,110,.4);padding:.45rem 1rem;border-radius:8px;font-size:.8rem;text-decoration:none}
.nl-wall-note{font-size:.7rem;color:var(--muted);text-align:center}
.nl-gallery-strip{display:flex;gap:.6rem;overflow-x:auto;padding-bottom:.5rem;margin-top:.6rem;-webkit-overflow-scrolling:touch}
.nl-gallery-strip::-webkit-scrollbar{height:3px}
.nl-gallery-strip::-webkit-scrollbar-thumb{background:#333;border-radius:2px}
.nl-gallery-thumb{flex:0 0 110px;background:#1a1a1a;border-radius:8px;overflow:hidden;border:1px solid #222;text-decoration:none;display:block}
.nl-gallery-thumb:hover{border-color:var(--accent)}
.nl-gallery-thumb img{width:110px;height:75px;object-fit:cover;display:block}
.nl-gallery-thumb-label{padding:.3rem .5rem;font-size:.62rem;color:var(--muted)}
.nl-gallery-more{flex:0 0 75px;background:rgba(200,169,110,.05);border:1px dashed rgba(200,169,110,.3);border-radius:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--accent);font-size:.65rem;gap:.25rem;text-decoration:none}
.nl-sale-banner{background:linear-gradient(135deg,#1a1500,#252010);border:1px solid rgba(200,169,110,.35);border-radius:10px;padding:1rem 1.25rem;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.75rem;margin-top:.6rem}
.nl-sale-tag{background:var(--accent);color:#000;font-size:.62rem;font-weight:800;padding:.2rem .55rem;border-radius:4px;display:inline-block;margin-bottom:.3rem}
.nl-sale-title{font-size:.9rem;font-weight:700;color:var(--text);margin-bottom:.2rem}
.nl-sale-desc{font-size:.72rem;color:var(--muted)}
.nl-sale-price-block{text-align:center}
.nl-sale-old{font-size:.75rem;color:#666;text-decoration:line-through}
.nl-sale-new{font-size:1.3rem;font-weight:800;color:var(--accent)}
.nl-sale-cta{background:var(--accent);color:#000;padding:.4rem 1.1rem;border-radius:8px;font-size:.78rem;font-weight:700;text-decoration:none;display:inline-block;margin-top:.4rem}
.nl-steps-nav{display:flex;gap:.4rem;margin-bottom:.75rem;flex-wrap:wrap}
.nl-step-btn{background:#1a1a1a;border:1px solid #333;color:var(--muted);border-radius:20px;padding:.3rem .75rem;font-size:.72rem;cursor:pointer;font-family:inherit}
.nl-step-btn.active{background:var(--accent);color:#000;border-color:var(--accent);font-weight:700}
.nl-step-title{font-size:.9rem;color:var(--text);margin-bottom:.4rem;font-weight:600}
.nl-cta-grid{display:grid;grid-template-columns:1fr 1fr;gap:.65rem;margin-top:.6rem}
.nl-cta-card{background:#141414;border:1px solid #252525;border-radius:10px;padding:.85rem;text-decoration:none;display:block;transition:border-color .2s}
.nl-cta-card:hover{border-color:rgba(200,169,110,.4)}
.nl-cta-icon{font-size:1.2rem;margin-bottom:.35rem}
.nl-cta-card h4{font-size:.78rem;color:var(--text);margin-bottom:.2rem}
.nl-cta-card p{font-size:.68rem;color:var(--muted);line-height:1.4}
.nl-contact-card{border:1px solid rgba(200,169,110,.25);border-radius:12px;padding:1.1rem;background:#111;margin-top:.6rem}
.nl-contact-top{display:flex;gap:.75rem;align-items:flex-start;margin-bottom:.85rem}
.nl-contact-avatar{width:42px;height:42px;background:linear-gradient(135deg,#2a2010,#1a1508);border-radius:50%;border:2px solid rgba(200,169,110,.3);display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0}
.nl-contact-title{font-size:.85rem;color:var(--text);margin-bottom:.2rem;font-weight:600}
.nl-contact-desc{font-size:.72rem;color:var(--muted);line-height:1.45}
.nl-contact-btns{display:flex;gap:.5rem;flex-wrap:wrap}
.nl-pay-btn{display:inline-flex;align-items:center;gap:.35rem;padding:.4rem .85rem;border-radius:8px;font-size:.75rem;font-weight:700;text-decoration:none}
.nl-pay-wa{background:#25d366;color:#fff}
.nl-pay-bit{background:#e8390e;color:#fff}
.nl-pay-paybox{background:#6c3fd1;color:#fff}
.nl-contact-note{font-size:.65rem;color:#555;margin-top:.5rem}
```

- [ ] **Step 2: Build new section variables**

In `handleNlIssue`, after the existing `linksSection` variable (around line 4691), add:

```js
const wallSection = c.hero ? `
<section class="nl-section nl-wall-section">
  <div class="nl-section-badge">📸 תמונת החודש — כך היא נראית אצלך בבית</div>
  <div class="nl-wall-room">
    <div class="nl-wall-frame">
      <img src="${escXml(c.hero.photo_url)}" alt="${escXml(c.hero.title_he)}">
    </div>
    <div class="nl-wall-floor"></div>
  </div>
  <div class="nl-wall-price">הדפסה מקצועית · מ-₪290</div>
  <div class="nl-wall-cta">
    <a href="/photos/${escXml(c.hero.photo_id)}/" class="nl-btn-buy">🛒 הזמן הדפסה</a>
    <a href="/contact/" class="nl-btn-outline">מידות וחומרים</a>
  </div>
  <p class="nl-wall-note">קנבס · אלומיניום · נייר ארכיוני · משלוח עד הבית</p>
</section>` : '';

const gallerySection = (c.gallery_photos || []).length ? `
<section class="nl-section nl-gallery-section">
  <div class="nl-section-badge">🖼 עוד מהסדרה</div>
  <div class="nl-gallery-strip">
    ${(c.gallery_photos || []).map(p => `
      <a class="nl-gallery-thumb" href="/photos/${escXml(p.id)}/" title="${escXml(p.title)}">
        <img src="${escXml(p.url)}" alt="${escXml(p.title)}" loading="lazy">
        <div class="nl-gallery-thumb-label">${escXml(p.title)}</div>
      </a>`).join('')}
    <a class="nl-gallery-more" href="/">
      <span style="font-size:1rem">←</span>
      <span>כל הגלריה</span>
    </a>
  </div>
</section>` : '';

const saleSection = isFull && c.sale ? `
<section class="nl-section nl-sale-section">
  <div class="nl-section-badge">🏷️ מבצע החודש</div>
  <div class="nl-sale-banner">
    <div>
      <span class="nl-sale-tag">${escXml(c.sale.discount_label)}</span>
      <div class="nl-sale-title">${escXml(c.sale.title_he)}</div>
      <div class="nl-sale-desc">${escXml(c.sale.desc_he)}</div>
    </div>
    <div class="nl-sale-price-block">
      <div class="nl-sale-old">${escXml(c.sale.original_price)}</div>
      <div class="nl-sale-new">${escXml(c.sale.sale_price)}</div>
      <a href="/contact/" class="nl-sale-cta">להזמנה →</a>
    </div>
  </div>
</section>` : '';

const ctaCardsSection = `
<section class="nl-section nl-cta-section">
  <div class="nl-section-badge">🏠 מחפש תמונה לבית או למשרד?</div>
  <div class="nl-cta-grid">
    <a class="nl-cta-card" href="/?category=נוף"><div class="nl-cta-icon">🛋️</div><h4>לסלון / חדר שינה</h4><p>נוף, טבע, שחור-לבן — אווירה ביתית</p></a>
    <a class="nl-cta-card" href="/?category=עירוני"><div class="nl-cta-icon">💼</div><h4>למשרד / קליניקה</h4><p>תמונות מרגיעות לסביבת עבודה</p></a>
    <a class="nl-cta-card" href="/contact/"><div class="nl-cta-icon">🎁</div><h4>מתנה מיוחדת</h4><p>תמונה ממוסגרת — מתנה שנשארת</p></a>
    <a class="nl-cta-card" href="/contact/"><div class="nl-cta-icon">✨</div><h4>הדפסה אישית</h4><p>תמונה שצילמת? נדפיס בסטנדרט גלריה</p></a>
  </div>
</section>`;

const contactSection = `
<section class="nl-section nl-contact-section">
  <div class="nl-section-badge">💬 רוצה עזרה אישית בבחירת תמונה?</div>
  <div class="nl-contact-card">
    <div class="nl-contact-top">
      <div class="nl-contact-avatar">👨‍🎨</div>
      <div>
        <div class="nl-contact-title">עמית זמין לך אישית</div>
        <p class="nl-contact-desc">לא בטוח איזו תמונה מתאימה לחלל? שלח לי תמונה של הקיר ואני אמליץ — בחינם.</p>
      </div>
    </div>
    <div class="nl-contact-btns">
      <a href="https://wa.me/972503333227" class="nl-pay-btn nl-pay-wa" target="_blank" rel="noopener">💬 וואטסאפ</a>
      <a href="https://bitpay.co.il/app/bizcard/0503333227" class="nl-pay-btn nl-pay-bit" target="_blank" rel="noopener">💳 ביט</a>
      <a href="https://payboxapp.page.link/pay?phone=972503333227" class="nl-pay-btn nl-pay-paybox" target="_blank" rel="noopener">💳 פייבוקס</a>
    </div>
    <p class="nl-contact-note">תשלום נוח — ביט, פייבוקס, או כרטיס אשראי באתר</p>
  </div>
</section>`;
```

- [ ] **Step 3: Update `guideSection` to support steps**

Replace the existing `guideSection` variable with:

```js
const guideSection = isFull && c.guide ? (() => {
  if (c.guide.steps && c.guide.steps.length) {
    const pills = c.guide.steps.map((s, i) =>
      `<button class="nl-step-btn${i === 0 ? ' active' : ''}" onclick="showStep(${i})" type="button">שלב ${s.num}</button>`
    ).join('');
    const steps = c.guide.steps.map((s, i) =>
      `<div class="nl-step" data-step="${i}"${i > 0 ? ' hidden' : ''}>
        <div class="nl-step-title">${escXml(s.title_he)}</div>
        <p class="nl-body-text">${escXml(s.text_he)}</p>
      </div>`
    ).join('');
    return `
    <section class="nl-section nl-guide-section">
      <div class="nl-section-badge" data-he="מדריך החודש" data-en="Guide of the Month">מדריך החודש</div>
      <h2 class="nl-section-title" data-he="${escXml(c.guide.title_he)}" data-en="${escXml(c.guide.title_en || c.guide.title_he)}">${escXml(c.guide.title_he)}</h2>
      <div class="nl-steps-nav">${pills}</div>
      ${steps}
      <a class="nl-link" href="/camera/${escXml(c.guide.slug)}/" data-he="קרא את המדריך המלא ←" data-en="Read full guide ←">קרא את המדריך המלא ←</a>
    </section>`;
  }
  return `
  <section class="nl-section nl-guide-section">
    <div class="nl-section-badge" data-he="מדריך החודש" data-en="Guide of the Month">מדריך החודש</div>
    <h2 class="nl-section-title" data-he="${escXml(c.guide.title_he)}" data-en="${escXml(c.guide.title_en || c.guide.title_he)}">${escXml(c.guide.title_he)}</h2>
    <p class="nl-body-text" data-he="${escXml(c.guide.text_he)}" data-en="${escXml(c.guide.text_en || c.guide.text_he)}">${escXml(c.guide.text_he)}</p>
    <a class="nl-link" href="/camera/${escXml(c.guide.slug)}/" data-he="קרא את המדריך ←" data-en="Read the guide ←">קרא את המדריך ←</a>
  </section>`;
})() : '';
```

- [ ] **Step 4: Update the HTML layout in `handleNlIssue`**

Replace the line that assembles the issue body HTML (the part that combines all sections into the final `<body>`). Find where `heroSection`, `guideSection`, etc. are concatenated and replace with the new order:

```js
${previewBanner}
${nlHeader}
<h1 class="nl-issue-title">${escXml(issue.title_he)}</h1>
${heroSection}
<hr class="nl-divider">
${wallSection}
${gallerySection}
${saleSection}
<hr class="nl-divider">
${guideSection}
${locationSection}
${tipSection}
<hr class="nl-divider">
${ctaCardsSection}
${contactSection}
<hr class="nl-divider">
${linksSection}
${nlFooter}
```

(Replace the old concatenation that had `heroSection + guideSection + locationSection + tipSection + linksSection`.)

- [ ] **Step 5: Add `showStep` JS function**

In the `<script>` block at the bottom of `handleNlIssue` (where `copyLink()` and `nlSubscribe()` are defined), add:

```js
function showStep(idx) {
  document.querySelectorAll('.nl-step').forEach((el, i) => {
    if (i === idx) el.removeAttribute('hidden'); else el.setAttribute('hidden', '');
  });
  document.querySelectorAll('.nl-step-btn').forEach((btn, i) => {
    btn.classList.toggle('active', i === idx);
  });
}
```

- [ ] **Step 6: Commit**

```bash
git add worker.js
git commit -m "feat: newsletter issue page — wall mockup, gallery, sale, steps, CTA cards, contact"
```

---

### Task 4: Admin editor new fields + deploy

**Files:**
- Modify: `worker.js` — `handleAdminNlEditor` (~line 4894)

- [ ] **Step 1: Update `guideFields` to show steps in editor**

Replace the `guideFields` variable in `handleAdminNlEditor`:

```js
const guideFields = c.guide ? `
  <h2>מדריך החודש</h2>
  <div class="field"><label>Slug</label><input name="guide.slug" value="${escXml(c.guide.slug||'')}"></div>
  ${c.guide.steps && c.guide.steps.length
    ? c.guide.steps.map((s, i) => `
      <h2 style="font-size:.85rem;color:#888">שלב ${s.num}</h2>
      ${field(`כותרת שלב ${s.num}`, `guide.steps.${i}`, 'title_he', s.title_he)}
      ${field(`טקסט שלב ${s.num}`, `guide.steps.${i}`, 'text_he', s.text_he)}`
    ).join('')
    : `${field('טקסט עברית','guide','text_he',c.guide.text_he)}
       ${field('טקסט אנגלית','guide','text_en',c.guide.text_en)}`
  }` : '';
```

- [ ] **Step 2: Add `saleFields` to editor**

After `tipFields`, add:

```js
const saleFields = c.sale ? `
  <h2>מבצע החודש</h2>
  ${field('כותרת','sale','title_he',c.sale.title_he)}
  ${field('תיאור','sale','desc_he',c.sale.desc_he)}
  ${field('מחיר מקורי','sale','original_price',c.sale.original_price)}
  ${field('מחיר מבצע','sale','sale_price',c.sale.sale_price)}
  ${field('תווית הנחה','sale','discount_label',c.sale.discount_label)}` : '';
```

Add `${saleFields}` to the editor HTML after `${tipFields}`:
```js
${heroFields}${guideFields}${locationFields}${tipFields}${saleFields}
```

- [ ] **Step 3: Update `collectContent()` in editor JS to handle nested steps**

Find `collectContent()` in the editor's `<script>` block and update it to handle `guide.steps.N.title_he` style names:

```js
function collectContent() {
  const out = {};
  document.querySelectorAll('input[name],textarea[name]').forEach(el => {
    const parts = el.name.split('.');
    let cur = out;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i];
      const nextIsNum = !isNaN(parts[i + 1]);
      if (cur[key] === undefined) cur[key] = nextIsNum ? [] : {};
      cur = cur[key];
      if (Array.isArray(cur) && !isNaN(parts[i])) {
        // navigating into array by index
        const idx = parseInt(parts[i]);
        if (cur[idx] === undefined) cur[idx] = {};
        cur = cur[idx];
      }
    }
    cur[parts[parts.length - 1]] = el.value;
  });
  return out;
}
```

Wait — this approach is complex. Instead, keep it simple: the steps fields use names like `guide.steps.0.title_he`. The existing `collectContent` uses dot-notation. Replace `collectContent` with:

```js
function collectContent() {
  const flat = {};
  document.querySelectorAll('input[name],textarea[name]').forEach(el => { flat[el.name] = el.value; });
  const out = {};
  Object.entries(flat).forEach(([path, val]) => {
    const keys = path.split('.');
    let cur = out;
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      const nextIsIndex = /^\d+$/.test(keys[i + 1]);
      if (cur[k] === undefined) cur[k] = nextIsIndex ? [] : {};
      if (Array.isArray(cur[k]) && /^\d+$/.test(keys[i + 1])) {
        cur = cur[k];
        const idx = parseInt(keys[i + 1]);
        if (cur[idx] === undefined) cur[idx] = {};
        cur = cur[idx];
        i++; // skip numeric key
      } else {
        cur = cur[k];
      }
    }
    cur[keys[keys.length - 1]] = val;
  });
  return out;
}
```

- [ ] **Step 4: Find and update existing `collectContent` in editor script**

Locate in `handleAdminNlEditor` the existing `collectContent` function (around line 5010) and replace it with the version above.

- [ ] **Step 5: Deploy**

```bash
npx wrangler deploy --minify
```

Expected output ends with: `Current Version ID: ...`

- [ ] **Step 6: Smoke test**

1. Open `https://amitphotos.com/admin/newsletter/`
2. Click "צור גיליון מלא" — wait ~30s
3. When redirected to editor — verify `sale` fields and `guide.steps` fields are shown
4. Click "👁 תצוגה מקדימה" — verify: wall mockup renders with photo, gallery strip shows 3 thumbs, sale banner shows, guide has 3 step pills, CTA cards show, contact card shows with WhatsApp/Bit/Paybox buttons

- [ ] **Step 7: Commit**

```bash
git add worker.js
git commit -m "feat: admin editor — sale fields + guide steps editing + deploy"
```
