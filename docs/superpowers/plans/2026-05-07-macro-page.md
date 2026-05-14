# Macro Photography Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** צור דף חינוכי חדש `/camera/macro/` על צילום מאקרו — עם שני סליידרים אינטראקטיביים, אינפוגרפיקה, וגלריה מסוננת של תמונות עמית.

**Architecture:** דף HTML סטטי עצמאי בסגנון זהה לדפי camera קיימים (lenses, exposure). CSS inline, JS inline, תמונות מ-Google Photos CDN. האינפוגרפיקה מוצגת ב-lightbox פשוט.

**Tech Stack:** HTML5, CSS3, Vanilla JS — ללא frameworks. Google Fonts: Syne + Heebo.

---

## קבצים

| קובץ | פעולה |
|------|--------|
| `assets/infographics/macro-infographic.png` | שינוי שם מ-`ChatGPT Image May 7, 2026, 11_37_27 PM.png` |
| `camera/macro/index.html` | יצירה חדשה |
| `camera/index.html` | עדכון — הוספת קארד מאקרו |
| `sitemap.xml` | עדכון — הוספת `/camera/macro/` |
| `worker.js` | עדכון — הוספת `/camera/macro/` לרשימת staticPages |

---

### Task 1: שינוי שם קובץ האינפוגרפיקה

**Files:**
- Rename: `assets/infographics/ChatGPT Image May 7, 2026, 11_37_27 PM.png` → `assets/infographics/macro-infographic.png`

- [ ] **Step 1: שנה שם**

```powershell
Rename-Item "c:\Users\erezf\amit-photos\assets\infographics\ChatGPT Image May 7, 2026, 11_37_27 PM.png" "macro-infographic.png"
```

- [ ] **Step 2: ודא**

```powershell
Test-Path "c:\Users\erezf\amit-photos\assets\infographics\macro-infographic.png"
```

Expected: `True`

- [ ] **Step 3: Commit**

```bash
cd c:/Users/erezf/amit-photos
git add assets/infographics/
git commit -m "chore: rename macro infographic to clean filename"
```

---

### Task 2: צור `camera/macro/index.html`

**Files:**
- Create: `camera/macro/index.html`

- [ ] **Step 1: צור תיקייה וקובץ HTML**

צור את הקובץ `camera/macro/index.html` עם התוכן המלא הבא:

```html
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>צילום מאקרו — בית ספר לצילום | Amit Photos</title>
<meta name="description" content="למד צילום מאקרו — יחס הגדלה, עומק שדה דק, ציוד וטכניקות — עם תמונות אמיתיות של עמית.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;600;700&family=Syne:wght@700&display=swap" rel="stylesheet">
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --bg: #0a0a0a; --surface: #111; --surface2: #181818; --border: #222;
  --accent: #c8a96e; --text: #f0ede8; --muted: #888;
}
body { font-family: 'Heebo', sans-serif; background: var(--bg); color: var(--text);
  direction: rtl; min-height: 100vh; padding-bottom: 4rem; }

.hero { text-align: center; padding: 2.5rem 1.5rem 1.5rem; }
.hero-badge { display: inline-block; font-size: .72rem;
  background: rgba(200,169,110,.12); border: 1px solid rgba(200,169,110,.3);
  color: var(--accent); border-radius: 20px; padding: .3rem .8rem;
  margin-bottom: .75rem; letter-spacing: .05em; }
.hero h1 { font-family: 'Syne', sans-serif; font-size: 2rem;
  color: var(--accent); margin-bottom: .5rem; }
.hero p { color: var(--muted); font-size: .9rem; max-width: 440px; margin: 0 auto; }

.toc { position: sticky; top: 0; z-index: 10;
  background: rgba(10,10,10,.92); backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--border);
  padding: .6rem 1.25rem; display: flex; gap: 1.25rem; overflow-x: auto; }
.toc a { font-size: .77rem; color: var(--muted); text-decoration: none; white-space: nowrap; }
.toc a.active { color: var(--accent); }
.toc a:hover { color: var(--text); }

.section { max-width: 760px; margin: 0 auto; padding: 2.5rem 1.25rem;
  border-bottom: 1px solid var(--border); }
.section-label { font-size: .7rem; text-transform: uppercase; letter-spacing: .12em;
  color: var(--accent); margin-bottom: .5rem; }
.section h2 { font-family: 'Syne', sans-serif; font-size: 1.3rem; margin-bottom: .6rem; }
.section > p { color: var(--muted); font-size: .88rem; line-height: 1.7; margin-bottom: 1rem; }

.demo-card { background: var(--surface); border: 1px solid var(--border);
  border-radius: 14px; padding: 1.5rem; margin-top: .75rem; }

.slider-row { display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem; }
.slider-row label { font-size: .8rem; color: var(--muted); white-space: nowrap; }
.slider-row input[type=range] { flex: 1; accent-color: var(--accent); cursor: pointer; }
.slider-value { font-family: 'Syne', sans-serif; color: var(--accent);
  font-size: 1.15rem; min-width: 4rem; text-align: center; }
.slider-desc { font-size: .82rem; color: var(--muted); text-align: center;
  margin-top: .75rem; min-height: 1.4em; }

.focal-canvas { position: relative; border-radius: 10px; overflow: hidden;
  background: #000; aspect-ratio: 16/9; }
.focal-canvas img { width: 100%; height: 100%; object-fit: cover;
  transition: transform .35s ease; display: block; }
.focal-hint-row { display: flex; justify-content: space-between;
  font-size: .75rem; color: var(--muted); margin-top: .4rem; }

.bokeh-split { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; margin-bottom: 1rem; }
.bokeh-img { border-radius: 8px; overflow: hidden; position: relative; aspect-ratio: 4/3; }
.bokeh-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
.bokeh-blur { position: absolute; inset: 0;
  -webkit-backdrop-filter: blur(0px); backdrop-filter: blur(0px);
  transition: -webkit-backdrop-filter .25s, backdrop-filter .25s; }
.bokeh-label { position: absolute; bottom: 6px; right: 8px; font-size: .7rem;
  background: rgba(0,0,0,.7); padding: .2rem .5rem; border-radius: 4px; color: var(--accent); }

/* אינפוגרפיקה */
.infographic-wrap { background: var(--surface); border: 1px solid var(--border);
  border-radius: 14px; overflow: hidden; margin-top: .75rem; cursor: zoom-in;
  transition: border-color .2s; }
.infographic-wrap:hover { border-color: var(--accent); }
.infographic-wrap img { width: 100%; display: block; }
.infographic-hint { text-align: center; font-size: .75rem; color: var(--muted);
  padding: .6rem; border-top: 1px solid var(--border); }

/* Lightbox */
.lightbox { display: none; position: fixed; inset: 0; z-index: 1000;
  background: rgba(0,0,0,.92); align-items: center; justify-content: center;
  padding: 1rem; cursor: zoom-out; }
.lightbox.open { display: flex; }
.lightbox img { max-width: 100%; max-height: 90vh; object-fit: contain;
  border-radius: 8px; }

/* גלריה */
.gallery-filters { display: flex; gap: .5rem; flex-wrap: wrap; margin-bottom: 1.25rem; }
.filter-btn { font-size: .78rem; padding: .35rem .85rem; border-radius: 20px;
  border: 1px solid var(--border); background: transparent; color: var(--muted);
  cursor: pointer; transition: all .15s; font-family: 'Heebo', sans-serif; }
.filter-btn:hover { border-color: var(--accent); color: var(--text); }
.filter-btn.active { background: var(--accent); border-color: var(--accent); color: #000; font-weight: 700; }

.gallery-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: .6rem; }
@media (max-width: 520px) { .gallery-grid { grid-template-columns: repeat(2, 1fr); } }

.gallery-item { border-radius: 8px; overflow: hidden; aspect-ratio: 1;
  background: var(--surface); cursor: pointer; position: relative; }
.gallery-item img { width: 100%; height: 100%; object-fit: cover; display: block;
  transition: transform .25s; }
.gallery-item:hover img { transform: scale(1.05); }
.gallery-item .g-label { position: absolute; bottom: 0; inset-inline: 0;
  background: linear-gradient(transparent, rgba(0,0,0,.75));
  padding: .75rem .5rem .4rem; font-size: .7rem; color: #ddd;
  opacity: 0; transition: opacity .2s; }
.gallery-item:hover .g-label { opacity: 1; }
.gallery-item[data-cat].hidden { display: none; }

.cta-section { text-align: center; padding: 3rem 1.25rem;
  max-width: 500px; margin: 0 auto; }
.cta-section h3 { font-family: 'Syne', sans-serif; font-size: 1.2rem;
  color: var(--accent); margin-bottom: .75rem; }
.cta-section p { color: var(--muted); font-size: .87rem;
  margin-bottom: 1.25rem; line-height: 1.6; }
.cta-btn { display: inline-block; background: var(--accent); color: #000;
  font-weight: 700; font-size: .9rem; border-radius: 8px;
  padding: .7rem 1.6rem; text-decoration: none; transition: background .15s; }
.cta-btn:hover { background: #e0c080; }
</style>
<script src="/assets/js/nav.js" defer></script>
</head>
<body>

<div class="hero">
  <div class="hero-badge">📷 בית ספר לצילום</div>
  <h1>צילום מאקרו — עולם הקרוב</h1>
  <p>גלה את היקום הנסתר — איך לצלם חרקים, פרחים וטיפות טל מקרוב עם תמונות אמיתיות של עמית</p>
</div>

<nav class="toc">
  <a href="#magnification">יחס הגדלה</a>
  <a href="#dof">עומק שדה</a>
  <a href="#guide">מדריך מלא</a>
  <a href="#gallery">גלריה</a>
</nav>

<section class="section" id="magnification">
  <div class="section-label">חלק 1</div>
  <h2>יחס הגדלה — כמה קרוב?</h2>
  <p>במאקרו אמיתי (1:1) חלק של החרק ממלא את כל הסנסור. ב-1:4 אנחנו עדיין רואים הרבה מהסביבה. גרור את הסליידר כדי לראות את ההבדל.</p>
  <div class="demo-card">
    <div class="slider-row">
      <label>1:4</label>
      <input type="range" id="magSlider" min="1" max="4" step="1" value="1"
             aria-label="יחס הגדלה" oninput="updateMag(this.value)">
      <label>1:1</label>
      <div class="slider-value" id="magVal">1:4</div>
    </div>
    <div class="focal-canvas">
      <img id="magImg"
           src="https://lh3.googleusercontent.com/d/12j16hqpKwFflypGVYZrvXhFDCH0YgeCT=w800"
           alt="דבורה מוכסת אבקה על חמניה">
    </div>
    <div class="focal-hint-row">
      <span>1:4 — מרחק, הקשר נראה</span>
      <span>1:1 — מאקרו אמיתי, פרטים זעירים</span>
    </div>
    <p class="slider-desc" id="magDesc"></p>
  </div>
</section>

<section class="section" id="dof">
  <div class="section-label">חלק 2</div>
  <h2>עומק שדה דק — הקסם והאתגר</h2>
  <p>במאקרו, אפילו ב-f/8 עומק השדה יכול להיות מילימטר אחד בלבד. זה מה שמייצר את הרקע המטושטש הקסום — אבל גם מקשה על המיקוד.</p>
  <div class="demo-card">
    <div class="bokeh-split">
      <div class="bokeh-img">
        <img src="https://lh3.googleusercontent.com/d/1sFRvwHnpOODK4KEkEaJCsHNZGl35oBrA=w600"
             alt="פרפר ציר מצוי על פרח ורוד — נושא">
        <div class="bokeh-label">נושא</div>
      </div>
      <div class="bokeh-img">
        <img src="https://drive.google.com/thumbnail?id=10D5va4MnAh7QpagtevvTqzipMA3cS_8c&sz=w600"
             alt="פרחים — רקע">
        <div class="bokeh-blur" id="macroBgBlur"></div>
        <div class="bokeh-label">רקע</div>
      </div>
    </div>
    <div class="slider-row">
      <label>f/2.8</label>
      <input type="range" id="macroApertureSlider" min="2.8" max="11" step="0.5" value="2.8"
             aria-label="צמצם" oninput="updateMacroAperture(this.value)">
      <label>f/11</label>
      <div class="slider-value" id="macroApertureVal">f/2.8</div>
    </div>
    <p class="slider-desc" id="macroApertureDesc"></p>
  </div>
</section>

<section class="section" id="guide">
  <div class="section-label">חלק 3</div>
  <h2>ציוד, טכניקות ו-Focus Stacking</h2>
  <p>כל מה שצריך לדעת כדי להתחיל לצלם מאקרו — ציוד, הגדרות, וטכניקת הצטרפות מוקד (Focus Stacking) לתמונות חדות יותר.</p>
  <div class="infographic-wrap" onclick="openLightbox()">
    <img src="/assets/infographics/macro-infographic.png"
         alt="מדריך צילום מאקרו — ציוד, טכניקות ו-Focus Stacking">
    <div class="infographic-hint">לחץ להגדלה 🔍</div>
  </div>
</section>

<section class="section" id="gallery">
  <div class="section-label">חלק 4</div>
  <h2>תמונות מאקרו של עמית</h2>
  <p>49 תמונות מהעולם הקטן — פרפרים, חרקים, עכבישים וטיפות טל שצולמו בטבע ישראל.</p>

  <div class="gallery-filters">
    <button class="filter-btn active" onclick="filterGallery('all', this)">הכל</button>
    <button class="filter-btn" onclick="filterGallery('פרפרים', this)">🦋 פרפרים</button>
    <button class="filter-btn" onclick="filterGallery('חרקים', this)">🐝 חרקים</button>
    <button class="filter-btn" onclick="filterGallery('עכבישים', this)">🕷️ עכבישים</button>
    <button class="filter-btn" onclick="filterGallery('טל', this)">💧 טל ואחר</button>
  </div>

  <div class="gallery-grid">
    <!-- פרפרים -->
    <a class="gallery-item" data-cat="פרפרים" href="https://amitphotos.com/photo/10D5va4MnAh7QpagtevvTqzipMA3cS_8c" target="_blank">
      <img src="https://drive.google.com/thumbnail?id=10D5va4MnAh7QpagtevvTqzipMA3cS_8c&sz=w400" alt="פרפר לבן על פרחים צהובים" loading="lazy">
      <div class="g-label">פרפר לבן על פרחים צהובים</div>
    </a>
    <a class="gallery-item" data-cat="פרפרים" href="https://amitphotos.com/photo/1sFRvwHnpOODK4KEkEaJCsHNZGl35oBrA" target="_blank">
      <img src="https://lh3.googleusercontent.com/d/1sFRvwHnpOODK4KEkEaJCsHNZGl35oBrA=w400" alt="פרפר ציר מצוי על פרח ורוד" loading="lazy">
      <div class="g-label">פרפר ציר מצוי על פרח ורוד</div>
    </a>
    <a class="gallery-item" data-cat="פרפרים" href="https://amitphotos.com/photo/16Scx1OhcvEY-JkM7g4barZWZAf0uugXl" target="_blank">
      <img src="https://lh3.googleusercontent.com/d/16Scx1OhcvEY-JkM7g4barZWZAf0uugXl=w400" alt="פרפר כחול על פרח צהוב" loading="lazy">
      <div class="g-label">פרפר כחול על פרח צהוב</div>
    </a>
    <a class="gallery-item" data-cat="פרפרים" href="https://amitphotos.com/photo/1jM6WxSM-WFWihhnhgqURVJAyhVsS62rH" target="_blank">
      <img src="https://lh3.googleusercontent.com/d/1jM6WxSM-WFWihhnhgqURVJAyhVsS62rH=w400" alt="פרפר על פרח — רקע כהה" loading="lazy">
      <div class="g-label">פרפר על פרח — רקע כהה</div>
    </a>
    <a class="gallery-item" data-cat="פרפרים" href="https://amitphotos.com/photo/1Yrm9Ix9wGU-h70l7GadHkAFOfHTRM8M2" target="_blank">
      <img src="https://lh3.googleusercontent.com/d/1Yrm9Ix9wGU-h70l7GadHkAFOfHTRM8M2=w400" alt="פרפר שועל על קוץ" loading="lazy">
      <div class="g-label">פרפר שועל על קוץ</div>
    </a>
    <!-- חרקים -->
    <a class="gallery-item" data-cat="חרקים" href="https://amitphotos.com/photo/12j16hqpKwFflypGVYZrvXhFDCH0YgeCT" target="_blank">
      <img src="https://lh3.googleusercontent.com/d/12j16hqpKwFflypGVYZrvXhFDCH0YgeCT=w400" alt="דבורה מוכסת אבקה על חמניה" loading="lazy">
      <div class="g-label">דבורה מוכסת אבקה על חמניה</div>
    </a>
    <a class="gallery-item" data-cat="חרקים" href="https://amitphotos.com/photo/1_OgIaYrGEs5a2CWXgIw-1dQSGGoSsgKz" target="_blank">
      <img src="https://lh3.googleusercontent.com/d/1_OgIaYrGEs5a2CWXgIw-1dQSGGoSsgKz=w400" alt="דבורה לעבר פרח אירוס" loading="lazy">
      <div class="g-label">דבורה לעבר פרח אירוס</div>
    </a>
    <a class="gallery-item" data-cat="חרקים" href="https://amitphotos.com/photo/1YNcAYWbn10SGtWab0Ei0lo3jFiFsQ6wZ" target="_blank">
      <img src="https://lh3.googleusercontent.com/d/1YNcAYWbn10SGtWab0Ei0lo3jFiFsQ6wZ=w400" alt="חיפושית מתכתית ירוקה על עלה" loading="lazy">
      <div class="g-label">חיפושית מתכתית ירוקה על עלה</div>
    </a>
    <a class="gallery-item" data-cat="חרקים" href="https://amitphotos.com/photo/15Lr-mM2Y0Bkzd7r_YcOXxghEjLOJM3dA" target="_blank">
      <img src="https://lh3.googleusercontent.com/d/15Lr-mM2Y0Bkzd7r_YcOXxghEjLOJM3dA=w400" alt="פרת משה רבנו על צמח" loading="lazy">
      <div class="g-label">פרת משה רבנו על צמח</div>
    </a>
    <a class="gallery-item" data-cat="חרקים" href="https://amitphotos.com/photo/1u99GC6e2o2WTuvvNQEgIEChBKwIeKmlI" target="_blank">
      <img src="https://lh3.googleusercontent.com/d/1u99GC6e2o2WTuvvNQEgIEChBKwIeKmlI=w400" alt="זבוב טורף עם טרף" loading="lazy">
      <div class="g-label">זבוב טורף עם טרף</div>
    </a>
    <!-- עכבישים -->
    <a class="gallery-item" data-cat="עכבישים" href="https://amitphotos.com/photo/1R5jm4QZChik_NTc1CoZnfNr56FQmz7qI" target="_blank">
      <img src="https://lh3.googleusercontent.com/d/1R5jm4QZChik_NTc1CoZnfNr56FQmz7qI=w400" alt="עכביש על קורה" loading="lazy">
      <div class="g-label">עכביש על קורה</div>
    </a>
    <a class="gallery-item" data-cat="עכבישים" href="https://amitphotos.com/photo/1U1fMS581LcGhLDtWACy8egYhZSDevuzK" target="_blank">
      <img src="https://lh3.googleusercontent.com/d/1U1fMS581LcGhLDtWACy8egYhZSDevuzK=w400" alt="עכביש סרטן לבן בתוך פרח" loading="lazy">
      <div class="g-label">עכביש סרטן לבן בתוך פרח</div>
    </a>
    <a class="gallery-item" data-cat="עכבישים" href="https://amitphotos.com/photo/1rszBmosFZprvt4HBLPl6rDYYbcvhjTkx" target="_blank">
      <img src="https://lh3.googleusercontent.com/d/1rszBmosFZprvt4HBLPl6rDYYbcvhjTkx=w400" alt="קורת עכביש עם טיפות טל" loading="lazy">
      <div class="g-label">קורת עכביש עם טיפות טל</div>
    </a>
    <!-- טל ואחר -->
    <a class="gallery-item" data-cat="טל" href="https://amitphotos.com/photo/1knoCRePQXXbxiQnUWKrWWcUVak5zBxu6" target="_blank">
      <img src="https://drive.google.com/thumbnail?id=1knoCRePQXXbxiQnUWKrWWcUVak5zBxu6&sz=w400" alt="טל על קורי עכביש" loading="lazy">
      <div class="g-label">טל על קורי עכביש</div>
    </a>
    <a class="gallery-item" data-cat="טל" href="https://amitphotos.com/photo/10rE-_ZJqqxcpfrcIDulapy2WIk_ZbPLQ" target="_blank">
      <img src="https://lh3.googleusercontent.com/d/10rE-_ZJqqxcpfrcIDulapy2WIk_ZbPLQ=w400" alt="שבלול זעיר על קצה עלה" loading="lazy">
      <div class="g-label">שבלול זעיר על קצה עלה</div>
    </a>
    <a class="gallery-item" data-cat="טל" href="https://amitphotos.com/photo/1kVMLX7V2GeD-pHr08pSJY_3rKUOh-cXy" target="_blank">
      <img src="https://lh3.googleusercontent.com/d/1kVMLX7V2GeD-pHr08pSJY_3rKUOh-cXy=w400" alt="עין הזיקית בתקריב" loading="lazy">
      <div class="g-label">עין הזיקית בתקריב</div>
    </a>
  </div>
</section>

<div class="lightbox" id="lightbox" onclick="closeLightbox()">
  <img src="/assets/infographics/macro-infographic.png" alt="מדריך צילום מאקרו">
</div>

<div class="cta-section">
  <h3>עוד מאקרו מחכה לך</h3>
  <p>49 תמונות מאקרו של עמית — פרפרים, חרקים, עכבישים וטל מהטבע הישראלי.</p>
  <a href="https://amitphotos.com" class="cta-btn">לגלריה המלאה ←</a>
</div>

<script>
const MAG_DESCS = {
  1: '1:4 — רחוק יחסית. רואים את הנושא בהקשרו, פרטים זעירים אינם נראים.',
  2: '1:2 — חצי גדול. מאקרו חצי-מסגרת, פרטים מתחילים להיראות.',
  3: '3:4 — קרוב מאוד. רוב הסנסור מלא בנושא.',
  4: '1:1 — מאקרו אמיתי! חרק בגודל הסנסור — כל פרט זעיר נראה בחדות.'
};
function updateMag(v) {
  v = parseInt(v);
  const labels = {1:'1:4', 2:'1:2', 3:'3:4', 4:'1:1'};
  document.getElementById('magVal').textContent = labels[v];
  const scale = 1 + (v - 1) * 0.55;
  document.getElementById('magImg').style.transform = `scale(${scale})`;
  document.getElementById('magDesc').textContent = MAG_DESCS[v];
}
updateMag(1);

function updateMacroAperture(v) {
  v = parseFloat(v);
  document.getElementById('macroApertureVal').textContent = 'f/' + v.toFixed(1);
  const blur = ((11 - v) / 8.2) * 16;
  const blurVal = `blur(${blur.toFixed(1)}px)`;
  document.getElementById('macroBgBlur').style.webkitBackdropFilter = blurVal;
  document.getElementById('macroBgBlur').style.backdropFilter = blurVal;
  const desc = v < 4
    ? 'צמצם פתוח — עומק שדה של מילימטרים, רקע מטושטש לחלוטין. קשה למקד!'
    : v < 8
    ? 'צמצם בינוני — קצת יותר עומק שדה, אבל עדיין מאקרו עדין.'
    : 'צמצם סגור — עומק שדה רחב יותר, קל יותר למקד. אידיאלי ל-Focus Stacking.';
  document.getElementById('macroApertureDesc').textContent = desc;
}
updateMacroAperture(2.8);

function openLightbox() {
  document.getElementById('lightbox').classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeLightbox() {
  document.getElementById('lightbox').classList.remove('open');
  document.body.style.overflow = '';
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLightbox(); });

function filterGallery(cat, btn) {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.gallery-item').forEach(item => {
    if (cat === 'all' || item.dataset.cat === cat) {
      item.classList.remove('hidden');
    } else {
      item.classList.add('hidden');
    }
  });
}

const tocLinks = document.querySelectorAll('.toc a');
const sectionIds = ['magnification','dof','guide','gallery'];
const sections = sectionIds.map(id => document.getElementById(id)).filter(Boolean);
function updateToc() {
  const scrollY = window.scrollY + 120;
  let active = null;
  for (const s of sections) { if (s.offsetTop <= scrollY) active = s.id; }
  tocLinks.forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + active));
}
window.addEventListener('scroll', updateToc, { passive: true });
updateToc();
</script>
</body>
</html>
```

- [ ] **Step 2: ודא שהקובץ נוצר**

```bash
ls c:/Users/erezf/amit-photos/camera/macro/index.html
```

Expected: הקובץ קיים.

- [ ] **Step 3: Commit**

```bash
git add camera/macro/
git commit -m "feat: add macro photography education page /camera/macro/"
```

---

### Task 3: הוסף קארד מאקרו ל-`camera/index.html`

**Files:**
- Modify: `camera/index.html`

- [ ] **Step 1: פתח את הקובץ ומצא את האזור שאחרי קארד `controls`**

חפש את הבלוק:
```html
  <a class="card" href="/camera/controls/">
```

- [ ] **Step 2: הוסף קארד מאקרו אחרי קארד controls**

הוסף את הבלוק הבא אחרי תגית הסגירה `</a>` של קארד controls:

```html
  <a class="card" href="/camera/macro/">
    <div class="card-emoji">🔍</div>
    <div class="card-title">צילום מאקרו</div>
    <div class="card-desc">יחס הגדלה, עומק שדה דק, ציוד וטכניקות — גלה את העולם הנסתר של הקטן</div>
    <span class="card-cta">התחל ללמוד</span>
  </a>
```

- [ ] **Step 3: Commit**

```bash
git add camera/index.html
git commit -m "feat: add macro card to camera education hub"
```

---

### Task 4: עדכן sitemap.xml ו-worker.js

**Files:**
- Modify: `sitemap.xml`
- Modify: `worker.js`

- [ ] **Step 1: הוסף ל-sitemap.xml**

מצא את הבלוק:
```xml
  <url>
    <loc>https://amitphotos.com/camera/visual-language/</loc>
```

הוסף לפניו:
```xml
  <url>
    <loc>https://amitphotos.com/camera/macro/</loc>
    <lastmod>2026-05-07</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
```

- [ ] **Step 2: הוסף ל-worker.js**

מצא את השורה בתוך `staticPages`:
```js
    { loc: '/camera/visual-language/', priority: '0.8', changefreq: 'monthly' },
```

הוסף לפניה:
```js
    { loc: '/camera/macro/', priority: '0.8', changefreq: 'monthly' },
```

- [ ] **Step 3: Commit ו-push**

```bash
git add sitemap.xml worker.js
git commit -m "feat: add /camera/macro/ to sitemap and dynamic worker sitemap"
git push
```
