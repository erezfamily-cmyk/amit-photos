# מדריך צילום פורטרט — Design Spec

**Date:** 2026-05-18  
**URL:** `/camera/portrait/`  
**Status:** Approved for implementation

---

## Goal

Create an interactive portrait photography guide that:
- Covers basics (angle, lighting, gaze) AND creative techniques (expression, character)
- Uses Amit's 11 portrait photos as teaching examples
- Is fully bilingual: Hebrew (RTL) + English (LTR) via `data-he`/`data-en` + `applyLang()`
- Ends with a purchase gallery of all portrait photos
- Follows the exact same pattern as `/camera/landscape/index.html`

---

## Page Structure

```
/camera/portrait/index.html
```

Single self-contained HTML file — all CSS inline in `<style>`, all JS inline in `<script>`.

### Layout (top to bottom)

1. **Shared nav bar** — `assets/js/nav.js`
2. **Hero** — dark portrait photo background, Hebrew title + English subtitle
3. **5 content sections** — linear scroll, two-column (photo left, content+interactive right)
4. **Purchase gallery** — all 11 portrait photos, click → WhatsApp
5. **Footer** — link back to `/camera/` hub

---

## Hero Section

```
Photo: דיוקן בצבעים חיים (ID: 1iGsR7oUKjZ75jOxcqdw-plYU72f1LbEp)

HE: "צילום פורטרט"
EN: "Portrait Photography"

HE subtitle: "מהיסודות ועד פורטרט אופי — עם התמונות של עמית."
EN subtitle: "From fundamentals to character portraits — with Amit's photos."
```

---

## Section 1 — זווית צילום / Camera Angle

**Purpose:** Camera height relative to the subject's face dramatically changes the perceived power and mood — the most overlooked beginner mistake.

**Photo:** `1JFmSumQcXYhX4flmCGZbWXeO5bgIUU8-` (זקן הקסמים)

**Hebrew text:** גובה המצלמה ביחס לפנים משנה הכל. מלמעלה → הדמות נראית קטנה וחלשה. בגובה העיניים → טבעי ושווה. מלמטה → הדמות נראית גדולה ועוצמתית. רוב הצלמים המתחילים מצלמים מגובה עיניים שלהם — לא גובה עיניים של הנבדק.

**English text:** Camera height relative to the face changes everything. From above → subject looks small and weak. At eye level → natural and equal. From below → subject looks powerful and imposing. Most beginners shoot from their own eye level — not the subject's.

**Interactive element:** 3 angle cards (clickable):
- 🔼 **מלמעלה / From Above** → SVG diagram: camera above face line → text: "מחליש, מקטין, מתאים לתמונות ילדים / Weakens, shrinks — works well for children's portraits"
- 👁️ **גובה עיניים / Eye Level** → SVG diagram: camera level with eyes → text: "טבעי, שוויוני, ניטרלי / Natural, equal, neutral — the safe choice"
- 🔽 **מלמטה / From Below** → SVG diagram: camera below face line → text: "עוצמה, דרמטיות, סכנה — זהירות מהרחבת אף / Power, drama, danger — beware of nose distortion"

SVG diagrams are pure CSS/SVG, no images needed — show a side-view silhouette of a head + camera position.

**Link out:** none (unique content)

---

## Section 2 — דפוסי תאורה / Portrait Lighting Patterns

**Purpose:** 4 classic lighting patterns specific to portrait — not covered in the general light guide.

**Photo:** `1y6iG3IiFk0GlsCUsBZsepI4Np7JEFH0O` (לוחם קרנבל) — dramatic side lighting visible

**Hebrew text:** צלמי פורטרט מדברים ב-4 דפוסי תאורה קלאסיים. ההבדל ביניהם: מיקום מקור האור ביחס לפנים — ועל אילו חלקים יש צל ואילו מוארים.

**English text:** Portrait photographers speak in 4 classic lighting patterns. The difference: where the light source sits relative to the face — and which areas are lit vs shadowed.

**Interactive element:** 4 pattern cards (click to select):
- **Rembrandt** → SVG: light at 45° above, small triangle of light on shadowed cheek → tip: "דרמטי, אופי, קלאסי / Dramatic, character, classic"
- **Loop** → SVG: light slightly above + to side, small shadow under nose loops down → tip: "הנפוץ ביותר, מחמיא, מתאים לכולם / Most common, flattering, works for everyone"
- **Butterfly / Paramount** → SVG: light directly in front + above, shadow under nose like butterfly → tip: "מחמיא לגברות, אופנה, Hollywood / Flattering for women, fashion, Hollywood style"
- **Split** → SVG: light exactly 90° to side, half face lit half dark → tip: "דרמטי מאוד, אופי חזק, מסתורי / Very dramatic, strong character, mysterious"

Each SVG is a simple top-down view: circle (head) + line (nose direction) + arc (light source position) + shading.

**Link out:** `→ מדריך אור ואיכות תאורה` → `/camera/light/`

---

## Section 3 — מבט ועין בעין / Gaze & Eye Contact

**Purpose:** The psychology of where the subject looks — changes the emotional relationship between viewer and photo.

**Photo:** `1qS2yrWz66Xt2XQtmxjLbi30BBFrqGXB1` (מבט דרך זכוכית מגדלת) as primary;  
secondary: `1a106WxbbnFsP2vaBmmLBDBY1MMTjx8Gs` (דיוקן טורקיז עם טלית)

**Hebrew text:** איפה הנבדק מסתכל קובע את הרגש שהתמונה יוצרת. עין בעין → חיבור ישיר עם הצופה. מבט הצידה → תחושת מחשבה, רומנטיקה, חלימה. עיניים עצומות → פנימיות, שקט, שלווה.

**English text:** Where the subject looks defines the emotional impact of the photo. Direct gaze → connection with the viewer. Looking away → thoughtfulness, romance, dreaming. Eyes closed → introspection, quiet, peace.

**Interactive element:** 3 toggle cards (one active at a time):
- 👁️ **עין בעין / Direct Gaze** → description: "מושך את הצופה פנימה. יוצר חיבור ישיר, ביטחון, נוכחות. אתגר: הנבדק צריך להרגיש בנוח / Pulls the viewer in. Creates direct connection, confidence, presence. Challenge: subject must feel comfortable."
- 👀 **מבט הצידה / Looking Away** → description: "יוצר תחושה שהנבדק חושב על משהו. רומנטי, אינטרוספקטיבי. הנחה: תן הוראה ברורה מאיפה להסתכל / Creates a sense the subject is thinking. Romantic, introspective. Direction: give clear instruction on where to look."
- 🙈 **עיניים עצומות / Eyes Closed** → description: "מסלק את ה'צופה' — הנבדק לא מתקשר. מתאים לפורטרט שקט ופנימי. טיפ: צלם בזמן צחוק טבעי / Removes the 'watching' feeling. Works for quiet, introspective portraits. Tip: shoot during natural laughter."

**Link out:** none (unique content)

---

## Section 4 — רקע והפרדה / Background Separation

**Purpose:** How to visually "lift" the subject from the background using distance + aperture.

**Photo:** `100AYpaK0jeKjH_qzGfF6jNPd7katXEZR` (ציור חי)

**Hebrew text:** הטעות הנפוצה ביותר: נבדק צמוד לקיר → הרקע חד ומסיח. הפתרון: רחק את הנבדק מהרקע + פתח צמצם (f-נמוך). ככל שהנבדק רחוק יותר מהרקע — הרקע יהיה מטושטש יותר, גם בצמצם צר.

**English text:** The most common mistake: subject pressed against a wall → sharp, distracting background. The fix: move the subject away from the background + open the aperture (low f-number). The farther the subject from the background — the blurrier the background, even at narrower apertures.

**Interactive element:** Dual slider simulation:
- **מרחק מרקע / Distance from background** — slider 0.5m → 5m
- **צמצם / Aperture** — slider f/1.8 → f/11
- Result: a CSS-simulated blur preview — a colored rectangle (background) blurs dynamically using `filter: blur(Npx)` based on slider values. Formula: `blur = max(0, (distance/5 * 12) * (1 - (fstop-1.8)/9.2))`
- Shows text below: recommended combination (e.g., "f/2.8 + 2m = בוקה חזק / strong bokeh")

**Link out:** `→ מדריך עומק שדה ובוקה` → `/camera/depth-of-field/`

---

## Section 5 — ביטוי ואופי / Expression & Character

**Purpose:** How to capture authentic expression — and the creative character portrait technique shown in Amit's gallery.

**Photos:** 
- Primary: `1zRydz-feBGM0nA4GVqS2xlblOyfmEYT0` (ליצנית חייכנית)
- Secondary (shown as thumbnails in the interactive): `1jStHSSDQG3tC32p6zLS94bT7fi7j2BrA` (ג'וקר), `1y6iG3IiFk0GlsCUsBZsepI4Np7JEFH0O` (קרנבל), `1O6AzQfr_Av8rOsdRffwNBvumKBGugOQF` (שמחת פורים)

**Hebrew text:** ביטוי אמיתי לא מגיע בפקודה. הוא מגיע מחיבור, שיחה, הפתעה — ומהנבדק שמרגיש בנוח. פורטרט אופי (character portrait) לוקח את זה צעד קדימה: תחפושת, תאורה דרמטית, פרטים — כל אלה הופכים פנים לסיפור.

**English text:** Authentic expression doesn't come on command. It comes from connection, conversation, surprise — and a subject who feels comfortable. Character portraits take it further: costume, dramatic lighting, detail — these turn a face into a story.

**Interactive element:** 3 technique tip cards (character type cards, not clickable — displayed as a trio):
- 🎭 **פורטרט אופי / Character Portrait** — tip: "בחר תחפושת/מקצוע/תפקיד. אל תצלם — ספר סיפור. תאורה דרמטית (Rembrandt/Split) מחזקת את הדמות / Choose costume/profession/role. Don't photograph — tell a story. Dramatic lighting strengthens character."
- 😂 **ביטוי אמיתי / Authentic Expression** — tip: "דבר עם הנבדק. ספר בדיחה. צלם בין הצילומים — שם מקבלים הביטויים האמיתיים ביותר / Talk to your subject. Tell a joke. Shoot between poses — that's where the most authentic expressions happen."
- 🎯 **פרטים ספציפיים / Specific Details** — tip: "עיניים, ידיים, שפתיים — close-up של פרט אחד יכול לספר יותר מפורטרט מלא. חפש את הפרט שמגדיר את הדמות / Eyes, hands, lips — a close-up of one detail can tell more than a full portrait. Find the detail that defines the character."

---

## Purchase Gallery

**Heading HE:** "📸 פורטרטים לרכישה — הדפס אמנות על הקיר שלך"  
**Heading EN:** "📸 Portrait Prints — Art for Your Wall"

**All 11 portrait photos** (displayed in 4-column grid, 2-column mobile):

| ID | Title |
|----|-------|
| `1y6iG3IiFk0GlsCUsBZsepI4Np7JEFH0O` | לוחם קרנבל / Carnival Fighter |
| `1iGsR7oUKjZ75jOxcqdw-plYU72f1LbEp` | דיוקן בצבעים חיים / Vivid Portrait |
| `1zRydz-feBGM0nA4GVqS2xlblOyfmEYT0` | ליצנית חייכנית / Smiling Clown |
| `1qS2yrWz66Xt2XQtmxjLbi30BBFrqGXB1` | מבט דרך זכוכית מגדלת / Magnified Gaze |
| `15vSnXub3qWplVF87Yw7YGpEXrOh5KHj_` | נקודות צהוב שחור / Yellow Black Dots |
| `1jStHSSDQG3tC32p6zLS94bT7fi7j2BrA` | פרצוף ג'וקר / Joker Face |
| `100AYpaK0jeKjH_qzGfF6jNPd7katXEZR` | ציור חי / Live Painting |
| `1JFmSumQcXYhX4flmCGZbWXeO5bgIUU8-` | זקן הקסמים / Wizard Elder |
| `1O6AzQfr_Av8rOsdRffwNBvumKBGugOQF` | שמחת פורים / Purim Joy |
| `1a106WxbbnFsP2vaBmmLBDBY1MMTjx8Gs` | דיוקן טורקיז עם טלית / Turquoise Tallit Portrait |
| `1XIRbGx9bv3sGCWtJb2NOv4z2LD-ftgaQ` | פסל של דמות היסטורית / Historical Figure Sculpture |

Click → WhatsApp `972503333227` with photo title pre-filled.

---

## Bilingual System

Identical to `/camera/landscape/index.html`:
- `data-he` / `data-en` on every text element
- `applyLang()` uses `innerHTML` (supports `<strong>` in attributes)
- `window.setLang = applyLang` for nav.js sync
- `localStorage.getItem('lang') || 'he'`
- `.en-h2` and `.ls-hero-en` hidden in English mode

---

## Tech Stack

Identical to landscape page — pure HTML/CSS/JS, all inline, no frameworks.

---

## Links to Existing Pages

| Topic | Links to |
|-------|----------|
| איכות אור | `/camera/light/` |
| עומק שדה ובוקה | `/camera/depth-of-field/` |
| עדשת 85mm | `/camera/lenses/` |
| כל המדריכים | `/camera/` |

---

## Out of Scope

- Camera settings simulator (covered in `/camera/exposure/`)
- Bokeh calculation (covered in `/camera/depth-of-field/`)
- White balance for skin (covered in `/camera/white-balance/`)
- Live API or external data

---

## Success Criteria

1. Hebrew (RTL) and English (LTR) render correctly
2. All 5 interactive elements work without errors
3. All 11 purchase photos display with hover overlays
4. Language toggle switches all text including interactive tips
5. Nav bar appears with correct active state
6. Page is mobile-responsive
7. Page appears as a card in `/camera/` hub
