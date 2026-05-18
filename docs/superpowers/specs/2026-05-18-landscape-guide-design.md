# מדריך צילום לנדסקייפ — Design Spec

**Date:** 2026-05-18  
**URL:** `/camera/landscape/`  
**Status:** Approved for implementation

---

## Goal

Create an interactive landscape photography guide page that:
- Uses Amit's real photos as teaching examples in each section
- Teaches 5 topics unique to landscape (not covered in other 16 camera pages)
- Is fully bilingual: Hebrew (RTL) + English (LTR) via `applyLang()` + `data-i18n`
- Ends with a "photos for purchase" gallery strip to drive sales
- Follows the same visual system as existing camera pages (`/camera/`, `/camera/lenses/`, `/camera/exposure/`)

---

## Page Structure

```
/camera/landscape/index.html
```

### Layout (top to bottom)

1. **Shared nav bar** — `assets/js/nav.js` (already exists, inject as all other pages do)
2. **Hero** — dark background, Hebrew title + English subtitle, brief intro
3. **5 content sections** — linear scroll, one topic per section
4. **"Photos for Purchase" gallery** — 8–12 landscape photos, click → existing buy flow
5. **Footer** — link back to `/camera/` hub

---

## Hero Section

```
תמונת עמית ברקע (שקיעה על הים המלח — ID: 1k4LOA2xLBmYw70cLpGmHZYaAWD9H5Um1)
overlaid with:

HE: "צילום לנדסקייפ"
EN: "Landscape Photography"

HE subtitle: "5 טכניקות. תמונות אמיתיות מהשטח."
EN subtitle: "5 techniques. Real photos from the field."
```

---

## Section 1 — שעת הזהב / Golden Hour

**Purpose:** Teach when to shoot — golden hour timing is the #1 mistake beginners skip.

**Photo:** `1M0MNq47h_rck94IU0GlqlX9yIA5_6MMe` (שדה בזריחה) as primary;  
secondary: `1k4LOA2xLBmYw70cLpGmHZYaAWD9H5Um1` (שקיעה על הים המלח)

**Hebrew text:** האור הרך של שעת הזהב — 30–60 דקות אחרי הזריחה ולפני השקיעה — נותן לנוף עומק וחום שלא ניתן לשחזר בפוסט-פרודקשן. האור הזה נמוך, רך, ועושה כל נוף לאמנות.

**English text:** The soft light of golden hour — 30–60 minutes after sunrise and before sunset — gives landscapes depth and warmth that can't be replicated in post-processing. Low, diffused, magical.

**Interactive element:** Static info card showing today's sunrise/sunset times for 3 Israeli cities (Jerusalem, Tel Aviv, Haifa) — hardcoded representative times, no live API. User clicks a city to see its times. Cities: ירושלים / Jerusalem, תל אביב / Tel Aviv, חיפה / Haifa.

**Link out:** none (unique content)

---

## Section 2 — חשיפה ארוכה / Long Exposure

**Purpose:** Silky water + dramatic sky effects — specific to landscape, not covered in exposure page.

**Photo:** `1n7ml6jRSlfDWtrILiPi8oqevBQtelUoG` (שקט של שקיעה בים) as primary  
secondary: `16hKNONU3uhqCUBBG2VS0oIK_KqWP3lP6` (גלים על הסלע)

**Hebrew text:** חשיפה של 2–30 שניות הופכת גלים לאחידים כמשי ועננים לפסים דרמטיים. צריך: חצובה, שלט אלחוטי, ו-ND filter. בלי אחד מהם — לא עובד.

**English text:** A 2–30 second exposure turns crashing waves into silky glass and clouds into dramatic streaks. You need: a tripod, remote shutter release, and an ND filter. Without these, it won't work.

**Interactive element:** Tabbed settings calculator — user picks scene type (מים / Water, עננים / Clouds, עיר / City), page shows recommended settings: shutter speed, aperture, ISO, ND filter strength. 3 presets, no real calculation needed — static lookup table.

**Link out:** `→ מדריך חשיפה מלא` links to `/camera/exposure/`

---

## Section 3 — קדמת הבמה / Foreground Interest

**Purpose:** Depth illusion — placing a strong foreground subject to pull viewers into the frame.

**Photo:** `1d8LFk1t2KZRu2o8VmgJxszQCFPbEW-lg` (שדה פרחים בשפע) as primary  
secondary: `15DHem8sAK2c9pkuXzPd03rP34-UnHe3M` (שקט בשדה לבנדר)

**Hebrew text:** תמונות לנדסקייפ שטוחות נראות דו-ממדיות. פתרון: מצא אלמנט קרוב — אבן, פרח, שביל — ושים אותו בשליש התחתון. הוא גורר את העין פנימה לעומק התמונה.

**English text:** Flat landscape photos look two-dimensional. The fix: find a close element — a rock, wildflower, path — and place it in the lower third. It pulls the viewer's eye deep into the frame.

**Interactive element:** Rule-of-thirds overlay on Amit's photo. Click "הצג רשת / Show Grid" to overlay the 3×3 grid. Click again to hide. Shows which zone the foreground occupies and where the horizon line sits. Pure CSS/JS toggle, no canvas needed.

**Link out:** `→ מדריך קומפוזיציה` links to relevant existing page if one exists, otherwise no link

---

## Section 4 — סיור מיקומים / Location Scouting

**Purpose:** Planning visits in advance — arriving before sunrise, finding multiple angles.

**Photo:** `1faq_DVrfSiQiczGp3_CAiPEjy4plh3Pb` (גנים בהאי חיפה) as primary  
secondary: `1LjGcU5ogKfQ2cnf5OvxV-xe6HPiqGMk3` (גנים בהאי — angle 2)

**Hebrew text:** הצלמים הטובים מגיעים לפני כולם. הם בודקים כיוון השמש, מכינים 3 זוויות ירי, ויודעים מה לעשות אם מגיע ענן. ההכנה היא חלק מהצילום.

**English text:** Great landscape photographers arrive before anyone else. They check the sun direction, prepare 3 shooting angles, and know what to do if clouds roll in. Preparation is part of the craft.

**Interactive element:** Interactive checklist — 6 items a photographer should check before a location visit. Each item is checkable. State resets on page load (no localStorage). Items:
1. בדוק כיוון זריחה/שקיעה ב-Google Maps / Check sunrise/sunset direction on Google Maps
2. מצא 3 זוויות שונות מראש / Scout 3 angles in advance
3. תכנן גיבוי לתנאי מזג אוויר שונים / Plan backup for different weather
4. בדוק גישה וחניה / Check access and parking
5. הגע 30 דקות לפני הזריחה / Arrive 30 min before sunrise
6. טען סוללות + כרטיס זיכרון / Charge batteries + check memory card

**Link out:** none (unique content)

---

## Section 5 — מזג האוויר כהזדמנות / Weather as Opportunity

**Purpose:** Reframe "bad weather" as creative opportunity — the counterintuitive lesson.

**Photo:** `1DKV8fePHvPbFLArxDDCRuGsX9eT48ZKd` (שדה בערפל בוקר, סלובקיה) as primary  
secondary: `1nLh9i-XaerEFjja5UUD3KfZgg1jRPv5J` (שחפים בערפל)

**Hebrew text:** רוב אנשים בורחים מגשם וערפל. צלמי לנדסקייפ רצים לשם. כל מזג אוויר נותן הזדמנות שונה: גשם → שלוליות כמראות, ערפל → עומק מסתורי, עננים → שמיים דרמטיים.

**English text:** Most people run from rain and fog. Landscape photographers run toward them. Every weather type offers a unique opportunity: rain → mirror-like puddles, fog → mysterious depth, clouds → dramatic skies.

**Interactive element:** 4 weather cards (⛈️ גשם/Rain, 🌫️ ערפל/Fog, ☁️ מעונן/Overcast, ☀️ צח/Clear). Click each card to reveal a tip about what to shoot and what settings to use. One card active at a time.

**Link out:** none (unique content)

---

## "תמונות לרכישה" / Photos for Purchase — Bottom Gallery

**Purpose:** Convert guide readers into buyers — they've just seen Amit's work in context.

**Layout:** Horizontal scrollable strip (on mobile) / 4-column grid (desktop) of 8–12 photos.

**Photos to include** (landscape/nature from Amit's collection):
- `1k4LOA2xLBmYw70cLpGmHZYaAWD9H5Um1` — שקיעה על הים המלח
- `1M0MNq47h_rck94IU0GlqlX9yIA5_6MMe` — שדה בזריחה
- `1d8LFk1t2KZRu2o8VmgJxszQCFPbEW-lg` — שדה פרחים בשפע
- `15DHem8sAK2c9pkuXzPd03rP34-UnHe3M` — שקט בשדה לבנדר
- `1n7ml6jRSlfDWtrILiPi8oqevBQtelUoG` — שקט של שקיעה בים
- `18yuQlOZTp7sf-JjpfCBVCRItafDJSuG0` — שקיעה סגולה על הים
- `1faq_DVrfSiQiczGp3_CAiPEjy4plh3Pb` — גנים בהאי חיפה
- `1DKV8fePHvPbFLArxDDCRuGsX9eT48ZKd` — שדה בערפל בוקר
- `1LLJ3g6rQlEhnQ_nTZhcyWrWifVa3XKgt` — שקיעה על הסלעים
- `1Rwx9jKcw9RERPNi2Rf1PdXuRbGrDIHXC` — שקיעה על ים סוף

**Thumbnail URL pattern:** `https://drive.google.com/thumbnail?id={ID}&sz=w400`

**Click behavior:** Opens existing lightbox/buy modal from `index.html`. Reuse the same `openBuyModal(photo)` or equivalent function.

**Section heading:**
- HE: "תמונות לרכישה — הדפס על הקיר שלך"
- EN: "Photos for Purchase — Print for Your Wall"

---

## Bilingual System

Follow the exact same pattern as existing camera pages:

```html
<span data-i18n="he">טקסט בעברית</span>
<span data-i18n="en" style="display:none">English text</span>
```

```js
// In <script> at bottom of page — same as /camera/exposure/index.html
function applyLang(lang) { ... }
const savedLang = localStorage.getItem('lang') || 'he';
applyLang(savedLang);
```

Language toggle button in nav (already handled by `nav.js`).

---

## Tech Stack

- Pure HTML/CSS/JS — no frameworks
- Google Fonts: Syne (headings) + Heebo (Hebrew body)
- Image URLs: Google Drive thumbnail API (`sz=w800` for display, `sz=w400` for gallery)
- No external JS libraries

---

## Out of Scope

- Live sunrise/sunset API (use hardcoded representative times)
- Before/after image slider (use static image only)
- User accounts or saved checklists
- Any topic already covered: bokeh, aperture basics, macro, composition rules, lenses, exposure triangle

---

## Links to Existing Pages (avoid duplication)

| Topic | Links to |
|-------|----------|
| חשיפה כללית | `/camera/exposure/` |
| עדשות | `/camera/lenses/` |
| כל המדריכים | `/camera/` |

---

## Success Criteria

1. Page renders correctly in Hebrew (RTL) and English (LTR)
2. All 5 interactive elements work without errors
3. All 10 purchase photos display and clicking opens buy flow
4. Language toggle switches all text on the page
5. Nav bar appears with correct active state
6. Page is mobile-responsive
