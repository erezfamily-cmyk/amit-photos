# Implementation Plan: שיפורי ניווט — amit-photos

## Overview

שיפור חוויית הניווט באתר הפורטפוליו. לאחר בדיקת הקוד, רוב הדברים שהוצעו **כבר קיימים** (sticky filter, swipe, active nav, back-to-top). נשארו 4 משימות ריאליות.

## מה כבר עובד (אין צורך לגעת)

| פיצ'ר | קובץ | שורות |
|-------|------|-------|
| Sticky filter-bar | style.css | 502-504 |
| Swipe בלייטבוקס | gallery.js | 835-843 |
| Active state בנב | nav.js | 225-232 |
| Back-to-top (index.html) | index.html | 845 |
| "קרא גם" בדפי /camera/ | nav.js | 322-406 |

---

## Architecture Decisions

- **breadcrumbs דרך nav.js** — nav.js כבר מזהה דפי /camera/ ומזריק תוכן. נוסיף breadcrumb באותו מנגנון — שינוי בקובץ אחד ומשפיע על כל 23 דפים.
- **back-to-top דרך nav.js** — גם כן: nav.js יזריק כפתור + CSS לכל דף שאין בו `#back-to-top` קיים. אפס שינויים ב-HTML נפרד.
- **שמירת פילטר ב-localStorage** — gallery.js מריץ `applyFilters()` + `history.replaceState()`. נוסיף `localStorage.setItem('lastFilter', cat)` בלחיצה, ו-`getItem` בטעינה.
- **חיפוש בפילטרים** — input מעל filter-bar, מסנן `allPhotos` לפי title/category, מציג תוצאות דינמיות (לא נוגע בפילטרים הקיימים).

---

## Task List

### Phase 1: nav.js — breadcrumbs + back-to-top לדפי משנה

#### Task 1: Breadcrumb לדפי /camera/

**Description:** הוספת breadcrumb קטן בראש כל דף /camera/: `← כל המדריכים`. מוזרק דרך nav.js, שכבר מזהה את /camera/ sub-pages ומזריק "קרא גם" + JSON-LD.

**Acceptance criteria:**
- [ ] breadcrumb מופיע מעל ה-`<h1>` בכל 23 דפי /camera/ (לא ב-/camera/ עצמו)
- [ ] קישור מוביל ל-/camera/
- [ ] טקסט: HE = "← כל המדריכים" / EN = "← All Guides"
- [ ] מתעדכן עם שינוי שפה

**Verification:**
- [ ] פתח /camera/exposure/ — breadcrumb מופיע בראש הדף
- [ ] החלף שפה ל-EN — טקסט משתנה
- [ ] לחיצה מובילה ל-/camera/

**Dependencies:** None

**Files likely touched:**
- `assets/js/nav.js` (הוספת breadcrumb block בתוך ה-camera block הקיים)

**Estimated scope:** Small (1 file, ~20 שורות)

---

#### Task 2: Back-to-top אוניברסלי לדפי משנה דרך nav.js

**Description:** nav.js יזריק כפתור back-to-top + CSS + לוגיקה לכל דף שאין בו `#back-to-top` קיים. כרגע 7 דפי camera חסרים אותו (depth-of-field, focus, histogram, lenses, macro, sports, white-balance).

**Acceptance criteria:**
- [ ] כפתור ↑ מופיע בכל דפי /camera/ אחרי גלילה של 400px
- [ ] לחיצה גוללת לראש הדף
- [ ] לא כפול ב-index.html (שכבר יש לו `#back-to-top`)

**Verification:**
- [ ] פתח /camera/lenses/ — גלול למטה — כפתור ↑ מופיע
- [ ] פתח index.html — וודא שיש רק כפתור אחד

**Dependencies:** None (parallel עם Task 1)

**Files likely touched:**
- `assets/js/nav.js`

**Estimated scope:** Small (1 file, ~15 שורות)

---

### Checkpoint: Phase 1

- [ ] בדיקה ב-/camera/exposure/, /camera/lenses/, /camera/depth-of-field/
- [ ] breadcrumb ובוטן ↑ מופיעים ועובדים
- [ ] שפה מתחלפת נכון

---

### Phase 2: gallery.js — שמירת פילטר + חיפוש

#### Task 3: שמירת פילטר אחרון (localStorage)

**Description:** כאשר המשתמש בוחר פילטר קטגוריה, שמור ב-`localStorage`. בטעינת הדף הבא, שחזר את הפילטר האחרון — אלא אם יש hash ב-URL (`#filter-xxx`) שמנצח.

**Acceptance criteria:**
- [ ] בחירת פילטר שומרת `localStorage.setItem('gallery_filter', cat)`
- [ ] טעינת עמוד בודקת localStorage ומפעילה את הפילטר הנכון
- [ ] URL hash מנצח על localStorage
- [ ] דף הבית (best-of) לא מושפע — שם ברירת מחדל היא `best` לא `all`

**Verification:**
- [ ] בחר "טנזניה" — רענן — גלריה נפתחת על "טנזניה"
- [ ] לחץ על "חדש באתר" בנב — גלריה נפתחת על "חדש" (URL hash גובר)
- [ ] בדף הבית — best-of עדיין ברירת המחדל

**Dependencies:** None

**Files likely touched:**
- `assets/js/gallery.js` (initFilters + applyFilters)

**Estimated scope:** Small (1 file, ~10 שורות)

---

#### Task 4: חיפוש מהיר בגלריה

**Description:** שדה חיפוש מעל שורת הפילטרים. מסנן `allPhotos` לפי `title` בזמן אמת (debounce 200ms). כשיש טקסט בחיפוש — הפילטרים הרגילים מתבטלים; ניקוי החיפוש מחזיר את הפילטר הקודם.

**Acceptance criteria:**
- [ ] input מופיע מעל filter-bar, placeholder: "חיפוש תמונה..."
- [ ] הקלדה מסננת allPhotos לפי title (case-insensitive, תומך בעברית)
- [ ] תוצאות מתעדכנות תוך 200ms
- [ ] ניקוי input מחזיר את הפילטר הפעיל
- [ ] EN placeholder: "Search photos..."
- [ ] לא מופיע בדף הבית (שם אין filter-bar עצמאי)

**Verification:**
- [ ] חפש "טנזניה" — מוצג תמונות עם "טנזניה" בכותרת
- [ ] חפש "עץ" — מוצג "עץ בודד בסוואנה"
- [ ] נקה — חוזר לפילטר הקודם
- [ ] בדוק ב-/gallery/ (לא index.html)

**Dependencies:** Task 3 (שניהם נוגעים ב-initFilters)

**Files likely touched:**
- `assets/js/gallery.js`
- `assets/css/style.css` (~10 שורות עיצוב)

**Estimated scope:** Medium (2 files, ~50 שורות)

---

### Checkpoint: Phase 2 (סופי)

- [ ] כל 4 משימות הושלמו
- [ ] בדיקה על mobile (swipe, sticky filter, back-to-top)
- [ ] בדיקה על desktop
- [ ] אין רגרסיות: best-of, lightbox, פילטרים קיימים עובדים

---

## Dependency Graph

```
nav.js
├── Task 1: breadcrumb  (עצמאי)
└── Task 2: back-to-top (עצמאי)

gallery.js
├── Task 3: localStorage filter  (עצמאי)
└── Task 4: חיפוש  (תלוי ב-Task 3 — שניהם ב-initFilters)
```

Tasks 1+2 ניתן לעשות במקביל. Task 4 אחרי Task 3.

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| localStorage conflict עם URL hash | Med | hash תמיד גובר על localStorage |
| חיפוש עברית — encoding | Low | `toLowerCase()` + unicode-aware match |
| back-to-top כפול ב-index.html | Low | בדיקת `document.getElementById('back-to-top')` לפני הזרקה |
| breadcrumb position לא נכון בכל דפי camera | Med | `insertBefore` ראשון ב-body, מתחת לnav |
