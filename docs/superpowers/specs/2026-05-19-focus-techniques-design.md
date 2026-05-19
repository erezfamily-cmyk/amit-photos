# Focus Techniques — Camera Guide Page Design
**Date:** 2026-05-19
**Status:** Approved

## Overview

A new camera guide page at `/camera/focus/` teaching beginner photographers about AF modes, focus areas, and focus stacking. Follows the exact same pattern as all other `/camera/` guide pages: single HTML file, dark theme, RTL Hebrew with full English i18n, interactive demo, nav.js + share.js.

## Files Changed

- **New:** `camera/focus/index.html` — full guide page
- **Edit:** `camera/index.html` — add card for `/camera/focus/`

## Page Structure

### Hero
- Badge: "📷 בית ספר לצילום" / "📷 Photography School"
- H1: "פוקוס — מצבים, נקודות ו-Stacking" / "Focus — Modes, Points & Stacking"
- Subtitle: "איך המצלמה מחליטה מה חד? בחר מצב, נסה על תמונות אמיתיות" / "How does the camera decide what's sharp? Pick a mode, try it on real photos"

### Section 1 — AF Modes Demo (hero interactive)

**Layout:** 2-column grid (photo panel + info panel), with photo picker above.

**Photo picker — 3 real photos from gallery (R2 thumbnails):**
- ינשוף שלג מתבונן (`069e2c70-b0b5-4140-a49d-47e2df9b98b0`) — static subject → One-Shot
- נשר לבן בטיסה (`286e64f7-bdaa-4bdf-88b8-1c567c4fd333`) — moving subject → AI Servo
- פרפר ציר על פרח כתום (`c68971c4-dbe1-48b0-8e48-3ba69c7a19f5`) — macro → MF

**Mode toggle — 3 buttons:**
1. **One-Shot AF** — green focus square that animates in and locks (stays fixed)
2. **AI Servo (AF-C)** — green square that continuously drifts/follows subject with CSS animation
3. **Manual Focus (MF)** — focus ring overlay, no AF square

**Info panel (right side):** For each mode:
- Icon + mode name
- "מתי להשתמש" / "When to use" — 1 sentence
- "דוגמה" / "Example" — photography use case
- Tip card (gold border)

**Mode content:**
- One-Shot: "נושא דומם — פורטרט, נוף, אוכל. מצלמה נועלת ומפסיקה לחפש." / "Still subjects — portrait, landscape, food. Camera locks and stops searching."
- AI Servo: "נושא נע — ציפורים, ספורט, ילדים. מצלמה עוקבת ברציפות." / "Moving subjects — birds, sports, children. Camera tracks continuously."
- MF: "מאקרו, חושך, זכוכית. שלוט ידנית בטבעת." / "Macro, darkness, glass. Control manually with the focus ring."

### Section 2 — Focus Areas

**4 tab cards** (horizontal row, toggle):
1. **נקודה בודדת** / Single Point — you choose exactly which AF point
2. **אזור** / Zone — cluster of points in a region
3. **אוטומטי רחב** / Wide/Auto — camera picks everything
4. **פנים + עיניים** / Face + Eye AF — camera detects face/eye

**SVG viewfinder** that updates per tab:
- Single Point: one highlighted square in center (or off-center if you click)
- Zone: 3x3 cluster highlighted
- Wide/Auto: all points lit
- Face+Eye AF: face outline + dot on eye

Below viewfinder: 1-sentence when-to-use per mode.

### Section 3 — Focus Stacking (advanced)

**Badge:** "מתקדם" / "Advanced"

**Canvas demo:** Three painted layers showing depth:
- Layer 1: foreground sharp (e.g., front petal), background blurred
- Layer 2: middle sharp
- Layer 3: background sharp

**Slider:** 0→3 steps — Layer 1 | Layer 2 | Layer 3 | Stacked Result

At "Stacked Result" position: all layers combined → everything sharp.

**Caption:** "בצילום מאקרו עומק השדה הוא מילימטרים — מגדילים אותו ב-Photoshop/Lightroom" / "In macro photography DOF is millimeters — extend it using Photoshop/Lightroom"

### Info Cards (4)

1. **Back-Button Focus (BBF)** — assign AF to thumb button instead of half-press shutter; separates focus from exposure
2. **Eye AF** — modern cameras detect and lock on the nearest eye automatically; use in portrait mode
3. **MF Override** — half-press to AF-lock, then rotate ring to fine-tune; useful in macro and low light
4. **Hyperfocal Distance** — focus point where everything from half that distance to infinity is sharp; used in landscape

### Navigation + Share
- `.nav-prev` div at bottom (triggers share.js insertion)
- `<script src="/assets/js/share.js" defer></script>`
- Back link: "← חזרה לבית הספר לצילום" / "← Back to Photography School"

## Hub Page Update (`camera/index.html`)

Add new card for focus guide. Card text:
- Hebrew: "פוקוס — מצבים וטכניקות"
- English: "Focus — Modes & Techniques"
- Icon: 🎯

## i18n

Full `data-he` / `data-en` on all text elements. `applyLang()` function identical to other camera guide pages. `getLang()` reads from localStorage. `document.title` switches on lang change.

English title: "Focus Techniques — AF Modes, Points & Stacking | Photography School | Amit Photos"

## Technical Constraints

- Photo URLs: `https://amitphotos.com/photos/<id>.jpg` (R2 thumbnails)
- CSS: same variables as all camera guides (`--bg`, `--surface`, `--border`, `--accent`, `--text`, `--muted`)
- Fonts: Heebo + Syne from Google Fonts
- No external JS libraries — pure vanilla JS + CSS animations
- `<script src="/assets/js/nav.js" defer></script>` before share.js
- canonical/hreflang tags matching other camera pages pattern
