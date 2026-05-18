# Landscape Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/camera/landscape/index.html` — an interactive Hebrew/English landscape photography guide using Amit's real photos, with 5 teaching sections and a purchase gallery at the bottom.

**Architecture:** Single self-contained HTML file, all CSS inline in `<style>`, all JS inline in `<script>`. Follows the identical pattern of `/camera/exposure/index.html` — `data-he`/`data-en` attributes, `applyLang()` at bottom, `nav.js` injected. No external dependencies beyond Google Fonts + nav.js.

**Tech Stack:** HTML5, CSS3, Vanilla JS, Google Drive thumbnail API for images, existing `assets/js/nav.js` for navigation.

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `camera/landscape/index.html` | Complete page — HTML + CSS + JS, all inline |

No other files are touched. This page follows the pattern of `camera/exposure/index.html` exactly.

---

### Task 1: Page Skeleton + Nav + Bilingual System

**Files:**
- Create: `camera/landscape/index.html`

- [ ] **Step 1: Create the file with head, meta, fonts, nav injection, and bilingual scaffold**

```html
<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="canonical" href="https://amitphotos.com/camera/landscape/" />
<link rel="alternate" hreflang="he" href="https://amitphotos.com/camera/landscape/" />
<link rel="alternate" hreflang="en" href="https://amitphotos.com/camera/landscape/" />
<link rel="alternate" hreflang="x-default" href="https://amitphotos.com/camera/landscape/" />
<title>צילום לנדסקייפ — מדריך מלא | בית ספר לצילום | Amit Photos</title>
<meta name="description" content="5 טכניקות לצילום לנדסקייפ: שעת הזהב, חשיפה ארוכה, קדמת הבמה, סיור מיקומים ומזג האוויר כהזדמנות — עם תמונות אמיתיות של עמית ארז.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;600;700&family=Syne:wght@700&display=swap" rel="stylesheet">
<style>
/* ── Reset + CSS vars ──────────────────────────────────── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --bg: #0a0a0a; --surface: #111; --surface2: #181818; --border: #222;
  --accent: #c8a96e; --text: #f0ede8; --muted: #888;
}
body {
  font-family: 'Heebo', sans-serif;
  background: var(--bg); color: var(--text);
  direction: rtl; min-height: 100vh; padding-bottom: 5rem;
}

/* ── Breadcrumb ──────────────────────────────────────── */
.breadcrumb {
  font-size: .8rem; color: var(--muted);
  padding: 1.25rem 1.5rem 0;
  max-width: 900px; margin: 0 auto;
}
.breadcrumb a { color: var(--accent); text-decoration: none; }

/* ── Article wrapper ────────────────────────────────── */
.article { max-width: 900px; margin: 0 auto; padding: 0 1.25rem; }

.divider { border: none; border-top: 1px solid var(--border); margin: 3rem 0; }

/* ── Section shared layout ───────────────────────────── */
.ls-section { margin-bottom: 3.5rem; }
.ls-section-badge {
  display: inline-flex; align-items: center; gap: .4rem;
  font-size: .72rem; font-weight: 700; color: #000;
  background: var(--accent); border-radius: 20px;
  padding: .25rem .75rem; margin-bottom: .75rem;
}
.ls-section h2 {
  font-family: 'Syne', sans-serif; font-size: 1.5rem;
  color: var(--text); margin-bottom: .35rem;
}
.ls-section .en-h2 {
  font-family: 'Syne', sans-serif; font-size: 1.1rem;
  color: var(--muted); margin-bottom: 1rem;
}
.ls-section p { color: var(--muted); line-height: 1.75; margin-bottom: .85rem; font-size: .95rem; }
.ls-section p strong { color: var(--text); }

/* ── Two-column layout (photo + content) ─────────────── */
.ls-two-col {
  display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; align-items: start;
}
@media (max-width: 640px) {
  .ls-two-col { grid-template-columns: 1fr; }
}

/* ── Photo block ─────────────────────────────────────── */
.ls-photo {
  border-radius: 12px; overflow: hidden;
  aspect-ratio: 4/3; background: #111;
}
.ls-photo img {
  width: 100%; height: 100%; object-fit: cover;
  display: block; border-radius: 12px;
  transition: transform .4s ease;
}
.ls-photo img:hover { transform: scale(1.02); }
.ls-photo-caption {
  font-size: .72rem; color: var(--muted);
  padding: .4rem 0; text-align: center;
}

/* ── Interactive box ─────────────────────────────────── */
.ls-interactive {
  background: var(--surface);
  border: 1px solid rgba(200,169,110,.25);
  border-radius: 14px; padding: 1.25rem;
  margin-top: 1rem;
}
.ls-interactive-title {
  font-family: 'Syne', sans-serif; font-size: .85rem;
  color: var(--accent); margin-bottom: .75rem;
}

/* ── Link out ────────────────────────────────────────── */
.ls-link-out {
  display: inline-block; margin-top: .75rem;
  font-size: .82rem; color: var(--accent);
  text-decoration: none; border-bottom: 1px solid rgba(200,169,110,.3);
  padding-bottom: .1rem;
}
.ls-link-out:hover { border-bottom-color: var(--accent); }

/* ── Nav back footer ─────────────────────────────────── */
.nav-prev { text-align: center; padding: 1.5rem; }
.nav-prev a { color: var(--accent); font-size: .9rem; text-decoration: none; }
</style>
<script src="/assets/js/nav.js" defer></script>
</head>
<body>

<div class="breadcrumb">
  <a href="/camera/" data-he="למד לצלם" data-en="Photography School">למד לצילום</a>
  <span data-he=" ← לנדסקייפ" data-en=" ← Landscape"> ← לנדסקייפ</span>
</div>

<!-- HERO, SECTIONS, GALLERY go here (Tasks 2-9) -->

<div class="nav-prev">
  <a href="/camera/" data-he="← חזרה לבית ספר לצילום" data-en="← Back to Photography School">← חזרה לבית ספר לצילום</a>
</div>

<script>
function getLang() { return localStorage.getItem('lang') || 'he'; }

function applyLang() {
  const lang = getLang();
  const isEn = lang === 'en';
  document.documentElement.dir = isEn ? 'ltr' : 'rtl';
  document.documentElement.lang = lang;
  document.body.style.direction = isEn ? 'ltr' : 'rtl';
  document.title = isEn
    ? 'Landscape Photography — Full Guide | Photography School | Amit Photos'
    : 'צילום לנדסקייפ — מדריך מלא | בית ספר לצילום | Amit Photos';
  document.querySelectorAll('[data-he]').forEach(el => {
    el.textContent = isEn ? (el.dataset.en || el.dataset.he) : el.dataset.he;
  });
  // interactive section updates handled by each section's own applyLang hook
  if (typeof updateInteractiveLang === 'function') updateInteractiveLang(isEn);
}

window.setLang = applyLang;
applyLang();
window.addEventListener('storage', e => { if (e.key === 'lang') applyLang(); });
</script>
</body>
</html>
```

- [ ] **Step 2: Open in browser and verify**

Open `http://localhost:8000/camera/landscape/` (run `python -m http.server 8000` from repo root).  
Expected: Dark page, nav bar appears, breadcrumb shows "למד לצלם ← לנדסקייפ", back link at bottom. No JS errors in console.

- [ ] **Step 3: Commit**

```bash
git add camera/landscape/index.html
git commit -m "feat: landscape guide page skeleton + nav + bilingual system"
git push origin main
```

---

### Task 2: Hero Section

**Files:**
- Modify: `camera/landscape/index.html` — add hero HTML and CSS

- [ ] **Step 1: Add hero CSS inside `<style>`** (before closing `</style>`)

```css
/* ── Hero ────────────────────────────────────────────── */
.ls-hero {
  position: relative; height: 70vh; min-height: 420px; max-height: 600px;
  display: flex; align-items: center; justify-content: center;
  text-align: center; overflow: hidden; margin-bottom: 3rem;
}
.ls-hero-bg {
  position: absolute; inset: 0;
  background-image: url('https://drive.google.com/thumbnail?id=1k4LOA2xLBmYw70cLpGmHZYaAWD9H5Um1&sz=w1600');
  background-size: cover; background-position: center;
  filter: brightness(.45);
  z-index: 0;
}
.ls-hero-content {
  position: relative; z-index: 1; padding: 2rem;
}
.ls-hero-badge {
  display: inline-block; font-size: .72rem; letter-spacing: .15em;
  text-transform: uppercase;
  background: rgba(200,169,110,.15); border: 1px solid rgba(200,169,110,.35);
  color: var(--accent); border-radius: 20px;
  padding: .3rem .9rem; margin-bottom: 1rem;
}
.ls-hero h1 {
  font-family: 'Syne', sans-serif; font-size: 3rem;
  color: #fff; margin-bottom: .4rem; line-height: 1.1;
}
@media (max-width: 480px) { .ls-hero h1 { font-size: 2rem; } }
.ls-hero-en {
  font-family: 'Syne', sans-serif; font-size: 1.1rem;
  color: rgba(255,255,255,.4); margin-bottom: 1rem;
}
.ls-hero-sub {
  font-size: 1rem; color: rgba(255,255,255,.7);
  max-width: 480px; margin: 0 auto; line-height: 1.6;
}
```

- [ ] **Step 2: Add hero HTML** — insert between `</div><!-- breadcrumb -->` and `<!-- HERO, SECTIONS... comment -->`

```html
<div class="ls-hero">
  <div class="ls-hero-bg"></div>
  <div class="ls-hero-content">
    <div class="ls-hero-badge" data-he="🏔️ מדריך לצלם המתחיל" data-en="🏔️ Beginner's Guide">🏔️ מדריך לצלם המתחיל</div>
    <h1 data-he="צילום לנדסקייפ" data-en="Landscape Photography">צילום לנדסקייפ</h1>
    <div class="ls-hero-en" data-he="Landscape Photography" data-en="צילום לנדסקייפ">Landscape Photography</div>
    <p class="ls-hero-sub" data-he="5 טכניקות. 5 הזדמנויות. תמונות אמיתיות מהשטח." data-en="5 techniques. 5 opportunities. Real photos from the field.">5 טכניקות. 5 הזדמנויות. תמונות אמיתיות מהשטח.</p>
  </div>
</div>
```

- [ ] **Step 3: Verify in browser**

Expected: Full-width dark landscape photo fills top of page, Hebrew title centered with gold accent badge. No console errors.

- [ ] **Step 4: Commit**

```bash
git add camera/landscape/index.html
git commit -m "feat: landscape guide hero section"
git push origin main
```

---

### Task 3: Section 1 — שעת הזהב / Golden Hour

**Files:**
- Modify: `camera/landscape/index.html`

- [ ] **Step 1: Add Section 1 CSS** (inside `<style>` block, before `</style>`)

```css
/* ── Section 1: Golden Hour ── */
.city-cards { display: flex; gap: .6rem; flex-wrap: wrap; }
.city-card {
  flex: 1; min-width: 80px;
  background: var(--surface2); border: 1px solid var(--border);
  border-radius: 10px; padding: .6rem .75rem; cursor: pointer;
  text-align: center; transition: border-color .2s, background .2s;
}
.city-card:hover { border-color: rgba(200,169,110,.4); }
.city-card.active { border-color: var(--accent); background: rgba(200,169,110,.08); }
.city-card .city-name { font-size: .8rem; font-weight: 700; color: var(--text); margin-bottom: .3rem; }
.city-card .city-en { font-size: .68rem; color: var(--muted); margin-bottom: .5rem; }
.city-times { font-size: .75rem; color: var(--muted); display: flex; gap: .5rem; justify-content: center; }
.city-times .sun { color: var(--accent); font-weight: 700; }
.golden-tip {
  margin-top: .75rem; padding: .65rem .85rem;
  background: rgba(200,169,110,.07); border-radius: 8px;
  font-size: .8rem; color: var(--muted); line-height: 1.55;
}
.golden-tip strong { color: var(--accent); }
```

- [ ] **Step 2: Add Section 1 HTML** — inside `<div class="article">`, before the nav-prev div

```html
<div class="article">
<div class="ls-section" id="golden-hour">
  <div class="ls-section-badge">01</div>
  <h2 data-he="שעת הזהב" data-en="Golden Hour">שעת הזהב</h2>
  <div class="en-h2" data-he="Golden Hour — When to Shoot" data-en="שעת הזהב — מתי לצלם">Golden Hour — When to Shoot</div>

  <div class="ls-two-col">
    <div>
      <div class="ls-photo">
        <img src="https://drive.google.com/thumbnail?id=1M0MNq47h_rck94IU0GlqlX9yIA5_6MMe&sz=w800"
             alt="שדה בזריחה — עמית ארז" loading="lazy">
      </div>
      <div class="ls-photo-caption" data-he="📸 שדה בזריחה — עמית ארז" data-en="📸 Field at Sunrise — Amit Erez">📸 שדה בזריחה — עמית ארז</div>
    </div>

    <div>
      <p data-he="האור הרך של שעת הזהב — 30–60 דקות אחרי הזריחה ולפני השקיעה — נותן לנוף עומק וחום שלא ניתן לשחזר בפוסט-פרודקשן. האור הזה נמוך, רך, ועושה כל נוף לאמנות."
         data-en="The soft light of golden hour — 30–60 minutes after sunrise and before sunset — gives landscapes depth and warmth that can't be replicated in post-processing. Low, diffused, magical.">האור הרך של שעת הזהב...</p>
      <p data-he="<strong>הכלל הפשוט:</strong> הגע לאתר לפחות 30 דקות לפני הזריחה. חכה לאור לפני שתלחץ על הכפתור."
         data-en="<strong>The simple rule:</strong> Arrive at the location at least 30 minutes before sunrise. Wait for the light before pressing the shutter."><strong>הכלל הפשוט:</strong> הגע לאתר לפחות 30 דקות לפני הזריחה.</p>

      <div class="ls-interactive">
        <div class="ls-interactive-title" data-he="⏰ בחר עיר — שעות זריחה ושקיעה (מייצגות)" data-en="⏰ Select a city — representative sunrise/sunset times">⏰ בחר עיר — שעות זריחה ושקיעה</div>
        <div class="city-cards">
          <div class="city-card active" onclick="selectCity(this, '05:18', '19:52')">
            <div class="city-name" data-he="ירושלים" data-en="Jerusalem">ירושלים</div>
            <div class="city-en" data-he="Jerusalem" data-en="ירושלים">Jerusalem</div>
            <div class="city-times">
              <span>🌅 <span class="sun">05:18</span></span>
              <span>🌇 <span class="sun">19:52</span></span>
            </div>
          </div>
          <div class="city-card" onclick="selectCity(this, '05:22', '19:58')">
            <div class="city-name" data-he="תל אביב" data-en="Tel Aviv">תל אביב</div>
            <div class="city-en" data-he="Tel Aviv" data-en="תל אביב">Tel Aviv</div>
            <div class="city-times">
              <span>🌅 <span class="sun">05:22</span></span>
              <span>🌇 <span class="sun">19:58</span></span>
            </div>
          </div>
          <div class="city-card" onclick="selectCity(this, '05:20', '20:00')">
            <div class="city-name" data-he="חיפה" data-en="Haifa">חיפה</div>
            <div class="city-en" data-he="Haifa" data-en="חיפה">Haifa</div>
            <div class="city-times">
              <span>🌅 <span class="sun">05:20</span></span>
              <span>🌇 <span class="sun">20:00</span></span>
            </div>
          </div>
        </div>
        <div class="golden-tip" id="goldenTip" data-he="🌅 הגע ב-04:48 לירושלים — 30 דקות לפני הזריחה. שעת הזהב: 05:18–05:48. 🌇 שעת הזהב ערב: 19:22–19:52." data-en="🌅 Arrive at 04:48 in Jerusalem — 30 min before sunrise. Golden hour: 05:18–05:48. 🌇 Evening golden hour: 19:22–19:52.">🌅 הגע ב-04:48 לירושלים — 30 דקות לפני הזריחה.</div>
      </div>
    </div>
  </div>
</div>
<hr class="divider">
```

- [ ] **Step 3: Add Section 1 JS** — inside `<script>` block, before `applyLang()` call

```js
// Section 1: Golden Hour city selector
const CITY_TIPS = {
  he: [
    '🌅 הגע ב-{arr} לירושלים — 30 דקות לפני הזריחה. שעת הזהב: {rise}–{end}. 🌇 שעת הזהב ערב: {evstart}–{set}.',
    '🌅 הגע ב-{arr} לתל אביב — 30 דקות לפני הזריחה. שעת הזהב: {rise}–{end}. 🌇 שעת הזהב ערב: {evstart}–{set}.',
    '🌅 הגע ב-{arr} לחיפה — 30 דקות לפני הזריחה. שעת הזהב: {rise}–{end}. 🌇 שעת הזהב ערב: {evstart}–{set}.'
  ],
  en: [
    '🌅 Arrive at {arr} in Jerusalem — 30 min before sunrise. Golden hour: {rise}–{end}. 🌇 Evening golden hour: {evstart}–{set}.',
    '🌅 Arrive at {arr} in Tel Aviv — 30 min before sunrise. Golden hour: {rise}–{end}. 🌇 Evening golden hour: {evstart}–{set}.',
    '🌅 Arrive at {arr} in Haifa — 30 min before sunrise. Golden hour: {rise}–{end}. 🌇 Evening golden hour: {evstart}–{set}.'
  ]
};

let activeCity = 0;

function minusMinutes(hhmm, mins) {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m - mins;
  return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
}
function plusMinutes(hhmm, mins) {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m + mins;
  return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
}

function selectCity(el, rise, set) {
  document.querySelectorAll('.city-card').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  const cards = Array.from(document.querySelectorAll('.city-card'));
  activeCity = cards.indexOf(el);
  updateGoldenTip(rise, set);
}

function updateGoldenTip(rise, set) {
  const lang = getLang();
  const arr = minusMinutes(rise, 30);
  const end = plusMinutes(rise, 60);
  const evstart = minusMinutes(set, 60);
  const tip = document.getElementById('goldenTip');
  if (!tip) return;
  let tmpl = (CITY_TIPS[lang] || CITY_TIPS.he)[activeCity];
  tip.textContent = tmpl
    .replace('{arr}', arr).replace('{rise}', rise)
    .replace('{end}', end).replace('{evstart}', evstart)
    .replace('{set}', set);
}
```

- [ ] **Step 4: Hook `updateInteractiveLang` for city cards** — add to the `applyLang` section

After the `applyLang` function definition, add:

```js
function updateInteractiveLang(isEn) {
  // Section 1: re-render active city tip
  const activeCard = document.querySelector('.city-card.active');
  if (activeCard) {
    const times = activeCard.querySelectorAll('.sun');
    if (times.length === 2) updateGoldenTip(times[0].textContent, times[1].textContent);
  }
}
```

- [ ] **Step 5: Verify in browser**

Open page. Section 1 should show Amit's sunrise photo on the left, text + golden hour cards on the right. Click each city — the tip text changes. Switch language — all text switches. No console errors.

- [ ] **Step 6: Commit**

```bash
git add camera/landscape/index.html
git commit -m "feat: landscape guide section 1 — golden hour"
git push origin main
```

---

### Task 4: Section 2 — חשיפה ארוכה / Long Exposure

**Files:**
- Modify: `camera/landscape/index.html`

- [ ] **Step 1: Add Section 2 CSS**

```css
/* ── Section 2: Long Exposure ── */
.scene-tabs { display: flex; gap: .4rem; margin-bottom: .85rem; }
.scene-tab {
  flex: 1; padding: .45rem; text-align: center;
  background: var(--surface2); border: 1px solid var(--border);
  border-radius: 8px; cursor: pointer; font-size: .8rem; color: var(--muted);
  transition: border-color .2s, color .2s;
}
.scene-tab.active { border-color: var(--accent); color: var(--accent); background: rgba(200,169,110,.07); }
.settings-grid {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: .5rem;
}
@media (max-width: 480px) { .settings-grid { grid-template-columns: repeat(2, 1fr); } }
.setting-cell {
  background: var(--surface2); border-radius: 8px;
  padding: .6rem; text-align: center;
}
.setting-val { font-family: monospace; font-size: 1rem; font-weight: 700; color: var(--accent); }
.setting-key { font-size: .68rem; color: var(--muted); margin-top: .2rem; }
.exposure-note { font-size: .78rem; color: var(--muted); margin-top: .6rem; line-height: 1.55; }
```

- [ ] **Step 2: Add Section 2 HTML** — after Section 1's `<hr class="divider">`, before `</div><!-- article -->`

```html
<div class="ls-section" id="long-exposure">
  <div class="ls-section-badge">02</div>
  <h2 data-he="חשיפה ארוכה" data-en="Long Exposure">חשיפה ארוכה</h2>
  <div class="en-h2" data-he="Long Exposure — Water & Sky" data-en="חשיפה ארוכה — מים ושמיים">Long Exposure — Water & Sky</div>

  <div class="ls-two-col">
    <div>
      <div class="ls-photo">
        <img src="https://drive.google.com/thumbnail?id=1n7ml6jRSlfDWtrILiPi8oqevBQtelUoG&sz=w800"
             alt="שקט של שקיעה בים — עמית ארז" loading="lazy">
      </div>
      <div class="ls-photo-caption" data-he="📸 שקט של שקיעה בים — עמית ארז" data-en="📸 Calm Sea at Sunset — Amit Erez">📸 שקט של שקיעה בים — עמית ארז</div>
    </div>

    <div>
      <p data-he="חשיפה של 2–30 שניות הופכת גלים לאחידים כמשי ועננים לפסים דרמטיים. צריך: חצובה, שלט אלחוטי, ו-ND filter. בלי אחד מהם — לא עובד."
         data-en="A 2–30 second exposure turns crashing waves into silky glass and clouds into dramatic streaks. You need: a tripod, remote shutter release, and an ND filter. Without these, it won't work.">חשיפה של 2–30 שניות...</p>
      <p data-he="תוצאות הכי טובות: מים זורמים, גלים נשברים, עננים בתנועה — כל אלה מרוויחים מחשיפה ארוכה."
         data-en="Best results: flowing water, crashing waves, moving clouds — all benefit greatly from long exposure.">תוצאות הכי טובות: מים זורמים...</p>

      <div class="ls-interactive">
        <div class="ls-interactive-title" data-he="📊 בחר סצנה — ראה הגדרות מומלצות" data-en="📊 Choose scene — see recommended settings">📊 בחר סצנה — ראה הגדרות מומלצות</div>
        <div class="scene-tabs">
          <div class="scene-tab active" onclick="selectScene(this,0)" data-he="🌊 מים" data-en="🌊 Water">🌊 מים</div>
          <div class="scene-tab" onclick="selectScene(this,1)" data-he="☁️ עננים" data-en="☁️ Clouds">☁️ עננים</div>
          <div class="scene-tab" onclick="selectScene(this,2)" data-he="🌃 עיר" data-en="🌃 City">🌃 עיר</div>
        </div>
        <div class="settings-grid" id="expSettings">
          <div class="setting-cell"><div class="setting-val" id="es-shutter">15s</div><div class="setting-key" data-he="תריס" data-en="Shutter">תריס</div></div>
          <div class="setting-cell"><div class="setting-val" id="es-ap">f/11</div><div class="setting-key" data-he="צמצם" data-en="Aperture">צמצם</div></div>
          <div class="setting-cell"><div class="setting-val" id="es-iso">ISO 100</div><div class="setting-key">ISO</div></div>
          <div class="setting-cell"><div class="setting-val" id="es-nd">ND64</div><div class="setting-key" data-he="פילטר" data-en="Filter">פילטר</div></div>
        </div>
        <div class="exposure-note" id="expNote" data-he="💡 מים: 15 שניות מאחידות גלים. השתמש ב-f/11 לחדות מקסימלית בנוף. ND64 מוריד 6 סטופ אור." data-en="💡 Water: 15 seconds smooths waves. Use f/11 for maximum landscape sharpness. ND64 reduces 6 stops of light.">💡 מים: 15 שניות מאחידות גלים.</div>
      </div>

      <a class="ls-link-out" href="/camera/exposure/" data-he="→ מדריך חשיפה מלא" data-en="→ Full Exposure Guide">→ מדריך חשיפה מלא</a>
    </div>
  </div>
</div>
<hr class="divider">
```

- [ ] **Step 3: Add Section 2 JS** — inside `<script>`, before `applyLang()` call

```js
// Section 2: Long Exposure scene selector
const SCENES = [
  {
    shutter: '15s', ap: 'f/11', iso: 'ISO 100', nd: 'ND64',
    note: { he: '💡 מים: 15 שניות מאחידות גלים. השתמש ב-f/11 לחדות מקסימלית בנוף. ND64 מוריד 6 סטופ אור.', en: '💡 Water: 15 seconds smooths waves. Use f/11 for max sharpness. ND64 reduces 6 stops of light.' }
  },
  {
    shutter: '30s', ap: 'f/16', iso: 'ISO 100', nd: 'ND1000',
    note: { he: '💡 עננים: 30 שניות יוצרות פסים דרמטיים. ND1000 מאפשר חשיפות ארוכות גם ביום. f/16 — כל שדה בפוקוס.', en: '💡 Clouds: 30 seconds creates dramatic streaks. ND1000 enables long exposures in daylight. f/16 — full depth of field.' }
  },
  {
    shutter: '8s', ap: 'f/8', iso: 'ISO 200', nd: 'ND8',
    note: { he: '💡 עיר לילה: 8 שניות מותחות אורות מכוניות. ND8 מוסיף גמישות. f/8 לחדות עיר.', en: '💡 Night city: 8 seconds stretches car lights into streaks. ND8 adds flexibility. f/8 for cityscape sharpness.' }
  }
];

let activeScene = 0;

function selectScene(el, idx) {
  document.querySelectorAll('.scene-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  activeScene = idx;
  renderScene();
}

function renderScene() {
  const s = SCENES[activeScene];
  const lang = getLang();
  document.getElementById('es-shutter').textContent = s.shutter;
  document.getElementById('es-ap').textContent = s.ap;
  document.getElementById('es-iso').textContent = s.iso;
  document.getElementById('es-nd').textContent = s.nd;
  const note = document.getElementById('expNote');
  if (note) note.textContent = s.note[lang] || s.note.he;
}
```

- [ ] **Step 4: Update `updateInteractiveLang` to handle scene notes**

Replace the existing `updateInteractiveLang` function:

```js
function updateInteractiveLang(isEn) {
  // Section 1: re-render active city tip
  const activeCard = document.querySelector('.city-card.active');
  if (activeCard) {
    const times = activeCard.querySelectorAll('.sun');
    if (times.length === 2) updateGoldenTip(times[0].textContent, times[1].textContent);
  }
  // Section 2: re-render scene note
  renderScene();
}
```

- [ ] **Step 5: Verify in browser**

Section 2 shows sea photo + settings calculator. Clicking מים/עננים/עיר updates 4 setting values and note text. Language toggle updates scene labels and note. No console errors.

- [ ] **Step 6: Commit**

```bash
git add camera/landscape/index.html
git commit -m "feat: landscape guide section 2 — long exposure calculator"
git push origin main
```

---

### Task 5: Section 3 — קדמת הבמה / Foreground Interest

**Files:**
- Modify: `camera/landscape/index.html`

- [ ] **Step 1: Add Section 3 CSS**

```css
/* ── Section 3: Foreground + Rule of Thirds ── */
.rof-wrap { position: relative; border-radius: 12px; overflow: hidden; }
.rof-img { width: 100%; display: block; border-radius: 12px; }
.rof-grid-overlay {
  position: absolute; inset: 0; pointer-events: none;
  opacity: 0; transition: opacity .35s;
  display: grid; grid-template-columns: 1fr 1fr 1fr;
  grid-template-rows: 1fr 1fr 1fr;
}
.rof-grid-overlay.visible { opacity: 1; }
.rof-cell-ov {
  border: 1px solid rgba(200,169,110,.5);
}
.rof-cell-ov.highlight-fg { background: rgba(200,169,110,.18); }
.rof-grid-btn {
  display: block; width: 100%; margin-top: .6rem; padding: .5rem;
  background: var(--surface2); border: 1px solid var(--border);
  border-radius: 8px; color: var(--muted); font-size: .82rem;
  cursor: pointer; text-align: center; font-family: 'Heebo', sans-serif;
  transition: border-color .2s, color .2s;
}
.rof-grid-btn:hover { border-color: rgba(200,169,110,.4); color: var(--text); }
.rof-legend {
  font-size: .75rem; color: var(--muted); margin-top: .5rem;
  line-height: 1.55; padding: .5rem .7rem;
  background: rgba(200,169,110,.06); border-radius: 8px;
}
```

- [ ] **Step 2: Add Section 3 HTML** — after Section 2's `<hr class="divider">`

```html
<div class="ls-section" id="foreground">
  <div class="ls-section-badge">03</div>
  <h2 data-he="קדמת הבמה" data-en="Foreground Interest">קדמת הבמה</h2>
  <div class="en-h2" data-he="Foreground Interest — Depth" data-en="קדמת הבמה — עומק">Foreground Interest — Depth</div>

  <div class="ls-two-col">
    <div>
      <div class="rof-wrap" id="rofWrap">
        <img class="rof-img" src="https://drive.google.com/thumbnail?id=1d8LFk1t2KZRu2o8VmgJxszQCFPbEW-lg&sz=w800"
             alt="שדה פרחים בשפע — עמית ארז" loading="lazy">
        <div class="rof-grid-overlay" id="rofOverlay">
          <div class="rof-cell-ov"></div><div class="rof-cell-ov"></div><div class="rof-cell-ov"></div>
          <div class="rof-cell-ov"></div><div class="rof-cell-ov"></div><div class="rof-cell-ov"></div>
          <div class="rof-cell-ov highlight-fg"></div><div class="rof-cell-ov highlight-fg"></div><div class="rof-cell-ov"></div>
        </div>
      </div>
      <button class="rof-grid-btn" id="rofBtn" onclick="toggleRof()"
              data-he="📐 הצג רשת חוק השליש" data-en="📐 Show Rule of Thirds Grid">📐 הצג רשת חוק השליש</button>
      <div class="rof-legend" data-he="💡 השליש התחתון מודגש (זהב): שם הפרחים — קדמת הבמה. שתי-שלישיות עליונות: שמיים ורקע." data-en="💡 Lower third highlighted (gold): where the flowers sit — the foreground. Upper two-thirds: sky and background.">💡 השליש התחתון מודגש (זהב): שם הפרחים — קדמת הבמה.</div>
      <div class="ls-photo-caption" data-he="📸 שדה פרחים בשפע — עמית ארז" data-en="📸 Field of Wildflowers — Amit Erez">📸 שדה פרחים בשפע — עמית ארז</div>
    </div>

    <div>
      <p data-he="תמונות לנדסקייפ שטוחות נראות דו-ממדיות. פתרון: מצא אלמנט קרוב — אבן, פרח, שביל — ושים אותו בשליש התחתון. הוא גורר את העין פנימה לעומק התמונה."
         data-en="Flat landscape photos look two-dimensional. The fix: find a close element — a rock, wildflower, path — and place it in the lower third. It pulls the viewer's eye deep into the frame.">תמונות לנדסקייפ שטוחות...</p>
      <p data-he="כלל אחד לזכור: <strong>שני שלישים לנוף, שליש לקדמה.</strong> קו האופק ב-שליש העליון או התחתון — לא באמצע."
         data-en="One rule to remember: <strong>two-thirds for the landscape, one-third for the foreground.</strong> Horizon line in the upper or lower third — never in the middle.">כלל אחד לזכור: <strong>שני שלישים לנוף, שליש לקדמה.</strong></p>
      <p data-he="השתמש בצמצם צר (f/8–f/11) לוודא שגם הקדמה וגם הרקע בפוקוס — עומק שדה עמוק."
         data-en="Use a narrow aperture (f/8–f/11) to ensure both the foreground and background are in focus — deep depth of field.">השתמש בצמצם צר (f/8–f/11) לוודא שגם הקדמה וגם הרקע בפוקוס.</p>
    </div>
  </div>
</div>
<hr class="divider">
```

- [ ] **Step 3: Add Section 3 JS** — inside `<script>`, before `applyLang()` call

```js
// Section 3: Rule of thirds toggle
let rofVisible = false;

function toggleRof() {
  rofVisible = !rofVisible;
  const overlay = document.getElementById('rofOverlay');
  const btn = document.getElementById('rofBtn');
  const lang = getLang();
  if (overlay) overlay.classList.toggle('visible', rofVisible);
  if (btn) {
    btn.dataset.he = rofVisible ? '📐 הסתר רשת' : '📐 הצג רשת חוק השליש';
    btn.dataset.en = rofVisible ? '📐 Hide Grid' : '📐 Show Rule of Thirds Grid';
    btn.textContent = lang === 'en'
      ? (rofVisible ? '📐 Hide Grid' : '📐 Show Rule of Thirds Grid')
      : (rofVisible ? '📐 הסתר רשת' : '📐 הצג רשת חוק השליש');
  }
}
```

- [ ] **Step 4: Verify in browser**

Section 3 shows wildflower photo with toggle button. Click button — 3×3 grid appears, lower-left two cells in gold. Click again — grid hides. Language toggle updates button text. No console errors.

- [ ] **Step 5: Commit**

```bash
git add camera/landscape/index.html
git commit -m "feat: landscape guide section 3 — foreground rule of thirds"
git push origin main
```

---

### Task 6: Section 4 — סיור מיקומים / Location Scouting

**Files:**
- Modify: `camera/landscape/index.html`

- [ ] **Step 1: Add Section 4 CSS**

```css
/* ── Section 4: Location Scouting checklist ── */
.loc-checklist { display: flex; flex-direction: column; gap: .5rem; margin-top: .25rem; }
.loc-item {
  display: flex; align-items: flex-start; gap: .75rem;
  background: var(--surface2); border: 1px solid var(--border);
  border-radius: 8px; padding: .6rem .85rem; cursor: pointer;
  transition: border-color .2s;
}
.loc-item.checked { border-color: rgba(200,169,110,.5); background: rgba(200,169,110,.06); }
.loc-checkbox {
  width: 1.1rem; height: 1.1rem; flex-shrink: 0; margin-top: .1rem;
  border: 1.5px solid #444; border-radius: 4px;
  display: flex; align-items: center; justify-content: center;
  font-size: .65rem; color: #000; transition: background .2s, border-color .2s;
}
.loc-item.checked .loc-checkbox { background: var(--accent); border-color: var(--accent); }
.loc-text { font-size: .83rem; color: var(--muted); line-height: 1.5; }
.loc-item.checked .loc-text { color: var(--text); }
.loc-progress {
  margin-top: .6rem; font-size: .75rem; color: var(--muted); text-align: center;
}
.loc-progress-bar {
  height: 3px; background: var(--border); border-radius: 2px;
  margin-top: .35rem; overflow: hidden;
}
.loc-progress-fill {
  height: 100%; background: var(--accent); border-radius: 2px;
  transition: width .3s;
}
```

- [ ] **Step 2: Add Section 4 HTML** — after Section 3's `<hr class="divider">`

```html
<div class="ls-section" id="scouting">
  <div class="ls-section-badge">04</div>
  <h2 data-he="סיור מיקומים" data-en="Location Scouting">סיור מיקומים</h2>
  <div class="en-h2" data-he="Location Scouting — Plan Ahead" data-en="סיור מיקומים — תכנן מראש">Location Scouting — Plan Ahead</div>

  <div class="ls-two-col">
    <div>
      <div class="ls-photo">
        <img src="https://drive.google.com/thumbnail?id=1faq_DVrfSiQiczGp3_CAiPEjy4plh3Pb&sz=w800"
             alt="גנים בהאיי חיפה — עמית ארז" loading="lazy">
      </div>
      <div class="ls-photo-caption" data-he="📸 גנים בהאיי חיפה — עמית ארז" data-en="📸 Bahá'í Gardens, Haifa — Amit Erez">📸 גנים בהאיי חיפה — עמית ארז</div>
    </div>

    <div>
      <p data-he="הצלמים הטובים מגיעים לפני כולם. הם בודקים כיוון השמש, מכינים 3 זוויות ירי, ויודעים מה לעשות אם מגיע ענן. ההכנה היא חלק מהצילום."
         data-en="Great landscape photographers arrive before anyone else. They check the sun direction, prepare 3 shooting angles, and know what to do if clouds roll in. Preparation is part of the craft.">הצלמים הטובים מגיעים לפני כולם.</p>

      <div class="ls-interactive">
        <div class="ls-interactive-title" data-he="✅ צ'קליסט לסיור מיקומים" data-en="✅ Location Scouting Checklist">✅ צ'קליסט לסיור מיקומים</div>
        <div class="loc-checklist" id="locChecklist">
          <div class="loc-item" onclick="toggleCheck(this)">
            <div class="loc-checkbox"></div>
            <div class="loc-text" data-he="בדוק כיוון זריחה/שקיעה ב-Google Maps" data-en="Check sunrise/sunset direction on Google Maps">בדוק כיוון זריחה/שקיעה ב-Google Maps</div>
          </div>
          <div class="loc-item" onclick="toggleCheck(this)">
            <div class="loc-checkbox"></div>
            <div class="loc-text" data-he="מצא 3 זוויות שונות מראש" data-en="Scout 3 different angles in advance">מצא 3 זוויות שונות מראש</div>
          </div>
          <div class="loc-item" onclick="toggleCheck(this)">
            <div class="loc-checkbox"></div>
            <div class="loc-text" data-he="תכנן גיבוי לתנאי מזג אוויר שונים" data-en="Plan a backup for different weather conditions">תכנן גיבוי לתנאי מזג אוויר שונים</div>
          </div>
          <div class="loc-item" onclick="toggleCheck(this)">
            <div class="loc-checkbox"></div>
            <div class="loc-text" data-he="בדוק גישה וחניה מראש" data-en="Check access and parking in advance">בדוק גישה וחניה מראש</div>
          </div>
          <div class="loc-item" onclick="toggleCheck(this)">
            <div class="loc-checkbox"></div>
            <div class="loc-text" data-he="הגע 30 דקות לפני הזריחה" data-en="Arrive 30 minutes before sunrise">הגע 30 דקות לפני הזריחה</div>
          </div>
          <div class="loc-item" onclick="toggleCheck(this)">
            <div class="loc-checkbox"></div>
            <div class="loc-text" data-he="טען סוללות + בדוק כרטיס זיכרון" data-en="Charge batteries + check memory card">טען סוללות + בדוק כרטיס זיכרון</div>
          </div>
        </div>
        <div class="loc-progress">
          <span id="locCount" data-he="0 מתוך 6" data-en="0 of 6">0 מתוך 6</span>
          <div class="loc-progress-bar"><div class="loc-progress-fill" id="locFill" style="width:0%"></div></div>
        </div>
      </div>
    </div>
  </div>
</div>
<hr class="divider">
```

- [ ] **Step 3: Add Section 4 JS** — inside `<script>`, before `applyLang()` call

```js
// Section 4: Location checklist
function toggleCheck(el) {
  el.classList.toggle('checked');
  const cb = el.querySelector('.loc-checkbox');
  if (cb) cb.textContent = el.classList.contains('checked') ? '✓' : '';
  updateLocProgress();
}

function updateLocProgress() {
  const total = document.querySelectorAll('.loc-item').length;
  const done = document.querySelectorAll('.loc-item.checked').length;
  const lang = getLang();
  const countEl = document.getElementById('locCount');
  const fill = document.getElementById('locFill');
  if (countEl) countEl.textContent = lang === 'en' ? `${done} of ${total}` : `${done} מתוך ${total}`;
  if (fill) fill.style.width = (done / total * 100) + '%';
}
```

- [ ] **Step 4: Update `updateInteractiveLang` to refresh checklist count**

```js
function updateInteractiveLang(isEn) {
  // Section 1
  const activeCard = document.querySelector('.city-card.active');
  if (activeCard) {
    const times = activeCard.querySelectorAll('.sun');
    if (times.length === 2) updateGoldenTip(times[0].textContent, times[1].textContent);
  }
  // Section 2
  renderScene();
  // Section 4
  updateLocProgress();
}
```

- [ ] **Step 5: Verify in browser**

Section 4 shows Bahai gardens photo + 6-item checklist. Click items — they turn gold and get a checkmark. Progress bar fills. Language toggle updates item text and count. No console errors.

- [ ] **Step 6: Commit**

```bash
git add camera/landscape/index.html
git commit -m "feat: landscape guide section 4 — location scouting checklist"
git push origin main
```

---

### Task 7: Section 5 — מזג האוויר כהזדמנות / Weather as Opportunity

**Files:**
- Modify: `camera/landscape/index.html`

- [ ] **Step 1: Add Section 5 CSS**

```css
/* ── Section 5: Weather cards ── */
.wx-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: .5rem; margin-bottom: .75rem; }
@media (max-width: 480px) { .wx-grid { grid-template-columns: repeat(2, 1fr); } }
.wx-card {
  background: var(--surface2); border: 1px solid var(--border);
  border-radius: 10px; padding: .65rem .5rem; text-align: center;
  cursor: pointer; transition: border-color .2s, background .2s;
}
.wx-card.active { border-color: var(--accent); background: rgba(200,169,110,.08); }
.wx-card .wx-icon { font-size: 1.4rem; display: block; margin-bottom: .3rem; }
.wx-card .wx-label { font-size: .72rem; color: var(--muted); }
.wx-card.active .wx-label { color: var(--accent); font-weight: 700; }
.wx-tip {
  padding: .75rem .9rem; background: rgba(200,169,110,.06);
  border: 1px solid rgba(200,169,110,.15); border-radius: 10px;
  font-size: .83rem; color: var(--muted); line-height: 1.65;
}
.wx-tip strong { color: var(--text); }
```

- [ ] **Step 2: Add Section 5 HTML** — after Section 4's `<hr class="divider">`

```html
<div class="ls-section" id="weather">
  <div class="ls-section-badge">05</div>
  <h2 data-he="מזג האוויר כהזדמנות" data-en="Weather as Opportunity">מזג האוויר כהזדמנות</h2>
  <div class="en-h2" data-he="Weather as Opportunity — Don't Run From Rain" data-en="מזג האוויר כהזדמנות — אל תברח מגשם">Weather as Opportunity — Don't Run From Rain</div>

  <div class="ls-two-col">
    <div>
      <div class="ls-photo">
        <img src="https://drive.google.com/thumbnail?id=1DKV8fePHvPbFLArxDDCRuGsX9eT48ZKd&sz=w800"
             alt="שדה בערפל בוקר — עמית ארז" loading="lazy">
      </div>
      <div class="ls-photo-caption" data-he="📸 שדה בערפל בוקר — עמית ארז" data-en="📸 Morning Fog Field — Amit Erez">📸 שדה בערפל בוקר — עמית ארז</div>
    </div>

    <div>
      <p data-he="רוב אנשים בורחים מגשם וערפל. צלמי לנדסקייפ רצים לשם. כל מזג אוויר נותן הזדמנות שונה שלא קיימת ביום שמשי רגיל."
         data-en="Most people run from rain and fog. Landscape photographers run toward them. Every weather type offers a unique opportunity that doesn't exist on a regular sunny day.">רוב אנשים בורחים מגשם וערפל.</p>

      <div class="ls-interactive">
        <div class="ls-interactive-title" data-he="🌦️ בחר מזג אוויר — מה לצלם?" data-en="🌦️ Choose weather — what to shoot?">🌦️ בחר מזג אוויר — מה לצלם?</div>
        <div class="wx-grid">
          <div class="wx-card active" onclick="selectWx(this,0)">
            <span class="wx-icon">⛈️</span>
            <div class="wx-label" data-he="גשם" data-en="Rain">גשם</div>
          </div>
          <div class="wx-card" onclick="selectWx(this,1)">
            <span class="wx-icon">🌫️</span>
            <div class="wx-label" data-he="ערפל" data-en="Fog">ערפל</div>
          </div>
          <div class="wx-card" onclick="selectWx(this,2)">
            <span class="wx-icon">☁️</span>
            <div class="wx-label" data-he="מעונן" data-en="Overcast">מעונן</div>
          </div>
          <div class="wx-card" onclick="selectWx(this,3)">
            <span class="wx-icon">☀️</span>
            <div class="wx-label" data-he="צח" data-en="Clear">צח</div>
          </div>
        </div>
        <div class="wx-tip" id="wxTip"></div>
      </div>
    </div>
  </div>
</div>
```

- [ ] **Step 3: Add Section 5 JS** — inside `<script>`, before `applyLang()` call

```js
// Section 5: Weather cards
const WX = [
  {
    he: '<strong>⛈️ גשם — צלם אחרי:</strong> שלוליות כמראות, צבעים עשירים, עצים רטובים. הגדרות: ISO 400, f/8, מדידה נקודתית. הגן על הציוד עם מכסה גשם.',
    en: '<strong>⛈️ Rain — shoot after:</strong> mirror-like puddles, rich saturated colors, wet textures. Settings: ISO 400, f/8, spot metering. Protect gear with a rain cover.'
  },
  {
    he: '<strong>🌫️ ערפל — עומק מסתורי:</strong> שכבות ערפל בין הרים יוצרות עומק תלת-ממדי. הגדרות: ISO 200, f/5.6, חשוף לפי השמיים. הגע מוקדם — הערפל מתפזר עם השמש.',
    en: '<strong>🌫️ Fog — mysterious depth:</strong> fog layers between hills create three-dimensional depth. Settings: ISO 200, f/5.6, expose for the sky. Arrive early — fog dissipates with sunlight.'
  },
  {
    he: '<strong>☁️ מעונן — אור אחיד ומפוזר:</strong> האור הרך של עננים מתאים לפרחים וצמחים — ללא צללים קשים. הגדרות: ISO 200–400, f/8, חשיפה +0.3 EV לפצות על אפרוריות.',
    en: '<strong>☁️ Overcast — soft diffused light:</strong> cloud cover is perfect for flowers and plants — no harsh shadows. Settings: ISO 200–400, f/8, exposure +0.3 EV to compensate for grayness.'
  },
  {
    he: '<strong>☀️ צח — זהירות מהאור הקשה:</strong> אמצע היום — האור הקשה שורף פרטים. הפתרון: הגע בשעת הזהב (ראה section 1), השתמש בפילטר מקטב (CPL) להפחתת הבהוב.',
    en: '<strong>☀️ Clear — beware harsh midday light:</strong> midday sun burns out highlight details. Solution: arrive during golden hour (see section 1), use a polarizing filter (CPL) to reduce glare.'
  }
];

let activeWx = 0;

function selectWx(el, idx) {
  document.querySelectorAll('.wx-card').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  activeWx = idx;
  renderWx();
}

function renderWx() {
  const tip = document.getElementById('wxTip');
  if (!tip) return;
  const lang = getLang();
  tip.innerHTML = WX[activeWx][lang] || WX[activeWx].he;
}

// Initialize weather tip
renderWx();
```

- [ ] **Step 4: Update `updateInteractiveLang` for weather tip**

```js
function updateInteractiveLang(isEn) {
  // Section 1
  const activeCard = document.querySelector('.city-card.active');
  if (activeCard) {
    const times = activeCard.querySelectorAll('.sun');
    if (times.length === 2) updateGoldenTip(times[0].textContent, times[1].textContent);
  }
  // Section 2
  renderScene();
  // Section 4
  updateLocProgress();
  // Section 5
  renderWx();
}
```

- [ ] **Step 5: Verify in browser**

Section 5 shows foggy field photo + 4 weather cards. ⛈️ is active by default showing rain tip. Click each card — tip text changes. Language toggle switches tip to English and back. No console errors.

- [ ] **Step 6: Commit**

```bash
git add camera/landscape/index.html
git commit -m "feat: landscape guide section 5 — weather opportunity cards"
git push origin main
```

---

### Task 8: Purchase Gallery

**Files:**
- Modify: `camera/landscape/index.html`

- [ ] **Step 1: Add gallery CSS**

```css
/* ── Purchase Gallery ── */
.purchase-section {
  margin: 4rem 0 2rem;
  background: var(--surface);
  border-top: 1px solid var(--border);
  padding: 2.5rem 1.25rem;
}
.purchase-section .article { max-width: 900px; margin: 0 auto; padding: 0; }
.purchase-heading {
  font-family: 'Syne', sans-serif; font-size: 1.4rem;
  color: var(--accent); text-align: center; margin-bottom: .35rem;
}
.purchase-sub {
  color: var(--muted); text-align: center; font-size: .88rem; margin-bottom: 1.75rem;
}
.purchase-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: .75rem;
}
@media (max-width: 700px) { .purchase-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 380px) { .purchase-grid { grid-template-columns: 1fr; } }
.purchase-thumb {
  position: relative; border-radius: 10px; overflow: hidden;
  aspect-ratio: 4/3; background: #111; cursor: pointer;
  transition: transform .25s;
}
.purchase-thumb:hover { transform: scale(1.03); }
.purchase-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.purchase-overlay {
  position: absolute; inset: 0;
  background: rgba(0,0,0,.6);
  display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: .4rem;
  opacity: 0; transition: opacity .25s;
}
.purchase-thumb:hover .purchase-overlay { opacity: 1; }
.purchase-overlay .po-title {
  font-size: .75rem; color: #fff; font-weight: 600; text-align: center; padding: 0 .5rem;
}
.purchase-overlay .po-btn {
  font-size: .72rem; background: var(--accent); color: #000;
  border-radius: 20px; padding: .25rem .75rem; font-weight: 700;
}
.purchase-cta-wrap { text-align: center; margin-top: 1.5rem; }
.purchase-cta {
  display: inline-block; padding: .7rem 2rem;
  background: var(--accent); color: #000;
  border-radius: 30px; font-weight: 700; font-size: .95rem;
  text-decoration: none; transition: opacity .2s;
}
.purchase-cta:hover { opacity: .85; }
```

- [ ] **Step 2: Add gallery HTML** — right before `<div class="nav-prev">`, outside `<div class="article">`

The article `</div>` closes before this section. Add after `</div><!-- end article -->`:

```html
</div><!-- end article -->

<section class="purchase-section">
  <div class="article">
    <h2 class="purchase-heading" data-he="🖼️ תמונות לרכישה — הדפס על הקיר שלך" data-en="🖼️ Photos for Purchase — Print for Your Wall">🖼️ תמונות לרכישה — הדפס על הקיר שלך</h2>
    <p class="purchase-sub" data-he="תמונות לנדסקייפ של עמית ארז — זמינות להדפסה בכל גודל" data-en="Landscape photos by Amit Erez — available for print in any size">תמונות לנדסקייפ של עמית ארז — זמינות להדפסה בכל גודל</p>
    <div class="purchase-grid">

      <div class="purchase-thumb" onclick="openBuyContact('שקיעה על הים המלח')">
        <img src="https://drive.google.com/thumbnail?id=1k4LOA2xLBmYw70cLpGmHZYaAWD9H5Um1&sz=w400" alt="שקיעה על הים המלח" loading="lazy">
        <div class="purchase-overlay">
          <span class="po-title" data-he="שקיעה על הים המלח" data-en="Dead Sea Sunset">שקיעה על הים המלח</span>
          <span class="po-btn" data-he="לרכישה" data-en="Buy Print">לרכישה</span>
        </div>
      </div>

      <div class="purchase-thumb" onclick="openBuyContact('שדה בזריחה')">
        <img src="https://drive.google.com/thumbnail?id=1M0MNq47h_rck94IU0GlqlX9yIA5_6MMe&sz=w400" alt="שדה בזריחה" loading="lazy">
        <div class="purchase-overlay">
          <span class="po-title" data-he="שדה בזריחה" data-en="Field at Sunrise">שדה בזריחה</span>
          <span class="po-btn" data-he="לרכישה" data-en="Buy Print">לרכישה</span>
        </div>
      </div>

      <div class="purchase-thumb" onclick="openBuyContact('שדה פרחים בשפע')">
        <img src="https://drive.google.com/thumbnail?id=1d8LFk1t2KZRu2o8VmgJxszQCFPbEW-lg&sz=w400" alt="שדה פרחים בשפע" loading="lazy">
        <div class="purchase-overlay">
          <span class="po-title" data-he="שדה פרחים בשפע" data-en="Field of Wildflowers">שדה פרחים בשפע</span>
          <span class="po-btn" data-he="לרכישה" data-en="Buy Print">לרכישה</span>
        </div>
      </div>

      <div class="purchase-thumb" onclick="openBuyContact('שקט בשדה לבנדר')">
        <img src="https://drive.google.com/thumbnail?id=15DHem8sAK2c9pkuXzPd03rP34-UnHe3M&sz=w400" alt="שקט בשדה לבנדר" loading="lazy">
        <div class="purchase-overlay">
          <span class="po-title" data-he="שקט בשדה לבנדר" data-en="Lavender Field Calm">שקט בשדה לבנדר</span>
          <span class="po-btn" data-he="לרכישה" data-en="Buy Print">לרכישה</span>
        </div>
      </div>

      <div class="purchase-thumb" onclick="openBuyContact('שקט של שקיעה בים')">
        <img src="https://drive.google.com/thumbnail?id=1n7ml6jRSlfDWtrILiPi8oqevBQtelUoG&sz=w400" alt="שקט של שקיעה בים" loading="lazy">
        <div class="purchase-overlay">
          <span class="po-title" data-he="שקט של שקיעה בים" data-en="Calm Sea at Sunset">שקט של שקיעה בים</span>
          <span class="po-btn" data-he="לרכישה" data-en="Buy Print">לרכישה</span>
        </div>
      </div>

      <div class="purchase-thumb" onclick="openBuyContact('שקיעה סגולה על הים')">
        <img src="https://drive.google.com/thumbnail?id=18yuQlOZTp7sf-JjpfCBVCRItafDJSuG0&sz=w400" alt="שקיעה סגולה על הים" loading="lazy">
        <div class="purchase-overlay">
          <span class="po-title" data-he="שקיעה סגולה על הים" data-en="Purple Sea Sunset">שקיעה סגולה על הים</span>
          <span class="po-btn" data-he="לרכישה" data-en="Buy Print">לרכישה</span>
        </div>
      </div>

      <div class="purchase-thumb" onclick="openBuyContact('גנים בהאיי חיפה')">
        <img src="https://drive.google.com/thumbnail?id=1faq_DVrfSiQiczGp3_CAiPEjy4plh3Pb&sz=w400" alt="גנים בהאיי חיפה" loading="lazy">
        <div class="purchase-overlay">
          <span class="po-title" data-he="גנים בהאיי חיפה" data-en="Bahá'í Gardens, Haifa">גנים בהאיי חיפה</span>
          <span class="po-btn" data-he="לרכישה" data-en="Buy Print">לרכישה</span>
        </div>
      </div>

      <div class="purchase-thumb" onclick="openBuyContact('שקיעה על ים סוף')">
        <img src="https://drive.google.com/thumbnail?id=1Rwx9jKcw9RERPNi2Rf1PdXuRbGrDIHXC&sz=w400" alt="שקיעה על ים סוף" loading="lazy">
        <div class="purchase-overlay">
          <span class="po-title" data-he="שקיעה על ים סוף" data-en="Red Sea Sunset">שקיעה על ים סוף</span>
          <span class="po-btn" data-he="לרכישה" data-en="Buy Print">לרכישה</span>
        </div>
      </div>

    </div>
    <div class="purchase-cta-wrap">
      <a class="purchase-cta" href="https://wa.me/972XXXXXXXXX?text=" id="buyCtaLink"
         data-he="📞 לפרטים ורכישה — WhatsApp" data-en="📞 Contact for Purchase — WhatsApp">📞 לפרטים ורכישה — WhatsApp</a>
    </div>
  </div>
</section>
```

**Note:** Replace `972XXXXXXXXX` with Amit's actual WhatsApp number. Check existing `index.html` for the WhatsApp link in the contact section — grep for `wa.me` to find it.

- [ ] **Step 3: Find Amit's WhatsApp number** from `index.html`

```bash
grep -n "wa.me" index.html | head -5
```

Copy the number from the result and replace `972XXXXXXXXX` in the landscape page.

- [ ] **Step 4: Add gallery JS** — inside `<script>`, before `applyLang()` call

```js
// Purchase gallery
function openBuyContact(photoTitle) {
  const lang = getLang();
  const msg = lang === 'en'
    ? encodeURIComponent(`Hello! I'm interested in purchasing a print of "${photoTitle}" from your landscape guide.`)
    : encodeURIComponent(`שלום! אני מעוניין לרכוש הדפסה של "${photoTitle}" מהמדריך לצילום לנדסקייפ.`);
  const link = document.getElementById('buyCtaLink');
  const base = link ? link.href.split('?')[0] : 'https://wa.me/972XXXXXXXXX';
  window.open(base + '?text=' + msg, '_blank');
}
```

- [ ] **Step 5: Verify in browser**

Scroll to bottom — 8-photo grid appears in 4 columns. Hover over any photo — overlay with title + "לרכישה" button appears. Click a photo — WhatsApp opens with pre-filled message mentioning the photo title. Language toggle switches overlay labels to English. No console errors.

- [ ] **Step 6: Commit**

```bash
git add camera/landscape/index.html
git commit -m "feat: landscape guide purchase gallery with WhatsApp contact"
git push origin main
```

---

### Task 9: Mobile Responsiveness + Final Polish

**Files:**
- Modify: `camera/landscape/index.html`

- [ ] **Step 1: Add mobile CSS** — inside `<style>` block

```css
/* ── Mobile responsive ── */
@media (max-width: 640px) {
  .ls-hero { height: 55vh; }
  .ls-hero h1 { font-size: 1.8rem; }
  .ls-section { margin-bottom: 2.5rem; }
  .purchase-section { padding: 2rem .75rem; }
}

/* ── RTL/LTR direction fix for English ── */
[dir="ltr"] body { direction: ltr; }
[dir="ltr"] .breadcrumb { direction: ltr; }

/* ── Smooth scroll ── */
html { scroll-behavior: smooth; }

/* ── Image lazy loading fade-in ── */
img { opacity: 1; transition: opacity .4s; }
img[loading="lazy"] { opacity: 0; }
img.loaded { opacity: 1; }
```

- [ ] **Step 2: Add lazy-load fade-in JS** — inside `<script>`, before `applyLang()` call

```js
// Lazy image fade-in
document.querySelectorAll('img[loading="lazy"]').forEach(img => {
  if (img.complete) {
    img.classList.add('loaded');
  } else {
    img.addEventListener('load', () => img.classList.add('loaded'));
  }
});
```

- [ ] **Step 3: Add page link to `/camera/` hub**

Open `camera/index.html` and find where other guide pages are listed (the grid of camera topics). Add the landscape guide entry there. Grep first:

```bash
grep -n "exposure\|lenses\|depth-of-field" camera/index.html | head -10
```

Find the pattern for existing cards and add:

```html
<a href="/camera/landscape/" class="topic-card">
  <div class="topic-icon">🏔️</div>
  <div class="topic-name" data-he="לנדסקייפ" data-en="Landscape">לנדסקייפ</div>
  <div class="topic-desc" data-he="שעת זהב, חשיפה ארוכה, קדמת הבמה" data-en="Golden hour, long exposure, foreground">שעת זהב, חשיפה ארוכה, קדמת הבמה</div>
</a>
```

- [ ] **Step 4: Full browser test — desktop**

Open `http://localhost:8000/camera/landscape/`. Check:
- [ ] Hero photo loads, text visible
- [ ] All 5 section photos load
- [ ] All interactive elements work (city cards, scene tabs, ROT grid, checklist, weather cards)
- [ ] Purchase gallery shows 8 photos with hover overlays
- [ ] Language toggle (EN button in nav) switches all text
- [ ] Nav breadcrumb correct: "למד לצלם ← לנדסקייפ"
- [ ] Back link at bottom works

- [ ] **Step 5: Mobile test**

Open Chrome DevTools (F12), toggle device toolbar (Ctrl+Shift+M), set to iPhone SE (375px width). Check:
- [ ] Hero is readable
- [ ] Two-column sections collapse to single column
- [ ] Purchase grid shows 2 columns
- [ ] City cards wrap without overflow
- [ ] All interactive elements are tappable (large enough touch targets)

- [ ] **Step 6: Console check**

No red errors in browser console on initial load or after interacting with all elements.

- [ ] **Step 7: Final commit and push**

```bash
git add camera/landscape/index.html camera/index.html
git commit -m "feat: landscape photography guide — complete interactive page"
git push origin main
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|------------------|------|
| `/camera/landscape/` page | Task 1 |
| Hero with background photo | Task 2 |
| Section 1: Golden Hour + city cards | Task 3 |
| Section 2: Long Exposure + settings tabs | Task 4 |
| Section 3: Foreground + ROT toggle | Task 5 |
| Section 4: Location Scouting + checklist | Task 6 |
| Section 5: Weather + weather cards | Task 7 |
| Purchase gallery 8 photos | Task 8 |
| WhatsApp contact for purchases | Task 8 |
| Hebrew/English bilingual (data-he/data-en) | Task 1 + all |
| `applyLang()` + `window.setLang` | Task 1 |
| `nav.js` injection | Task 1 |
| Mobile responsive | Task 9 |
| Link to exposure guide in Section 2 | Task 4 |
| Link back to `/camera/` hub | Task 9 |
| Add page to `/camera/` hub index | Task 9 |

**No gaps found.**

**Type consistency:** `getLang()`, `applyLang()`, `updateInteractiveLang()`, `selectCity()`, `selectScene()`, `toggleRof()`, `toggleCheck()`, `selectWx()`, `openBuyContact()` — all defined before first use. `renderScene()`, `renderWx()`, `updateLocProgress()` — defined before called in `updateInteractiveLang`. `updateInteractiveLang` is updated incrementally across Tasks 3→7 — the final version in Task 7 is the authoritative one. ✅

**Placeholder scan:** No TBD, TODO, or vague steps. WhatsApp number is flagged with explicit grep instruction in Task 8, Step 3. ✅
