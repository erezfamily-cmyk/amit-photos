# סטטוס אמיתי של ביקורת האבטחה/UX — 26.9.2026

## הממצא המרכזי

הענף `fix/security-analytics-ux-audit` (קיים ב-`origin`, לא אבד) מכיל **19 קומיטים** עם תיקונים
שנבדקו ונכתבו במלואם (כולל טסטים), אך **מעולם לא נפתח עבורם PR ומעולם לא מוזגו ל-`main`**.
רק חלק קטן מהעבודה הזו הגיע בסופו של דבר ל-production, דרך מסלולים נפרדים (PR #4–#9, ותיקונים
של סשן מקביל). התוצאה: כמה באגים שתועדו בעבר כ"תוקנו" עדיין קיימים בפועל ב-`main` וב-production.
הדוח הזה מבוסס על השוואה בפועל של קוד — לא על זיכרון של שיחות קודמות.

כל הבדיקות בדוח זה הן **קריאה בלבד** (git log/diff/grep מול `origin/main`). לא בוצע שום שינוי קוד,
commit, merge או deploy כחלק ממנו.

## מה כבר באמת ב-main (מאומת)

| נושא | מקור בפועל |
|------|-----------|
| הפרדת הסכמה שיווקית (consent_marketing) | PR #4, #5, #6, #9 |
| מתג כיבוי תשלומים (`paymentsEnabled`/`paymentsDisabledResponse`) | הגיע דרך סשן מקביל, לא מהענף הישן |
| `invalidatePublicPhotosCache()` אחרי מוטציות | worker.js, מאומת קיים ונקרא מכל נקודות הכתיבה |
| `funnel_events` בדוח GA השבועי | src/ga_weekly_report.py |
| מסרי רכישה + באנר תקופת ניסיון | PR #12, #13 (היום, מימוש טרי — לא מהענף הישן) |

## מה עדיין חסר ב-main בפועל (מאומת עכשיו, לא מהזיכרון)

| # | נושא | קומיט ישן (לא מוזג) | מה קורה היום ב-main |
|---|------|----------------------|----------------------|
| 1 | HSTS + CSP Report-Only | `9b411c62` | `_headers` מכיל רק X-Frame-Options / X-Content-Type-Options / Referrer-Policy / Permissions-Policy — אין HSTS ואין CSP בכלל |
| 2 | הקשחת Gelato webhook (escXml, מניעת שכפול) | `a334d3d0` | `handlePrintWebhook` (worker.js:2500) עדיין מכניס `customer_name`/`product_label`/`address_*`/`trackingCode` ל-HTML של המייל **בלי escaping כלל** — פרצת HTML-injection פעילה. **אבל:** PR #11 הפתוח כרגע (מסשן אחר, טרי, מבוסס על `main` הנוכחי) מתקן את זה נכון יותר ומחליף גם את #2 ו-#3 |
| 3 | תמונה שבורה במדריך exposure | `c91044f6` | `camera/exposure/index.html:513` עדיין מנסה לטעון `sample-landscape.jpg` שלא הועלה מעולם |
| 4 | forced reflow ב-resizeCanvas (exposure) | `fa306e0a` | אין `ResizeObserver` ב-exposure/night/composition — עדיין `window.addEventListener('resize', ...)` |
| 5 | נגישות מודלים/לייטבוקס (focus trap, aria) | `7a639458` | אין `openModalA11y`/`closeModalA11y`/`getClientRects` ב-`assets/js/gallery.js` — זה בדיוק הפריט "חלונות קופצים" ברשימה שלך |
| 6 | `<main>` landmark בדפי קטגוריה | `8ac1da3e` | `handleCategoryPage` ב-worker.js — אין שום `<main>`. גם דפי מיקום, תמונה, ו-`/free-guide/` החי (SSR) חסרים `<main>` |
| 7 | דליפת עברית באנגלית (~20 מחרוזות: GuruShots, תאריכים, כתובת) | `6e4edc7f` | `cookie-notice.js`/`accessibility-widget.js` עדיין קוראים `document.documentElement.lang` (לא `localStorage.getItem('lang')`) — באג המירוץ המקורי עדיין קיים |
| 8 | תיקון CLAUDE.md (agent_photos.py הוא הסקריפט האמיתי) | `c4e46ade` | לא קיים ב-CLAUDE.md הנוכחי |
| 9 | Drive folder ID מפורש + שגיאה על שם דו-משמעי | `85828342` | לא נמצא ב-`src/fetch_photos.py`/`agent_photos.py` |
| 10 | dedup לפי Drive ID בלבד + כשל CI על שגיאות | `c0b0a1ac` | לא נמצא |
| 11 | network-first ל-`/api/*` ו-`photos.json` ב-Service Worker | `9817f063` | `sw.js` הנוכחי הוא cache-first לכל מה שאינו "photos/images" לפי תגובה קיימת — לא זהה למימוש שנכתב |
| 12 | באנר תקופת ניסיון מוסתר מאחורי ה-nav (`--beta-banner-h`) | `b572e8b8` | לא קיים ב-gallery.js/style.css — **אך** PR #12/#13 מהיום פתרו גרסה אחרת של אותה בעיה (nav sticky מתחת לבאנר) בגישה שונה, כדאי לבדוק אם עדיין נדרש |

## PR-ים פתוחים כרגע ב-GitHub

| PR | כותרת | סטטוס |
|----|-------|-------|
| #2 | security: escXml חסר במייל שליחת הדפסה | פתוח מ-24.8, **מיושן** — מכסה רק handlePrintWebhook |
| #3 | תיקון אבטחה: escXml חסר במיילים של הדפסה | פתוח מ-21.9, מכסה גם handlePrintOrderComplete |
| #11 | Harden Gelato print webhook handling | פתוח מהיום (26.9), **מבוסס על main נוכחי**, מחליף במפורש את #2 ו-#3, 7/7 + 85/85 טסטים עוברים |

**המלצה:** לבדוק ולמזג את #11 (הפתרון המלא והעדכני ביותר), ואז לסגור את #2 ו-#3 כמיושנים/מוחלפים —
לא בוצע כאן, ממתין לאישור.

## המלצה להמשך — לא בוצע, ממתין לאישור

הענף הישן `fix/security-analytics-ux-audit` מבוסס על `main` ישן בהרבה (מלפני PR #4–#13), כך שמיזוג
ישיר שלו עלול להתנגש ולדרוס עבודה חדשה יותר (למשל הגרסה הטרייה יותר של תיקון ה-Gelato ב-PR #11,
ותיקון הבאנר של PR #12/#13). הדרך הבטוחה: **cherry-pick נקודתי** של כל קומיט רלוונטי מהרשימה למעלה
לענף חדש שמבוסס על `main` הנוכחי, קומיט-קומיט, בדיוק כפי שנעשה בעבר עם שלושת קומיטי ההסכמה
(2712fddd/1ce1e5ce/632582ca) שחולצו לפני PR #4.

סדר עדיפות מומלץ לשחזור (לפי חומרה):
1. `7a639458` — נגישות מודלים/לייטבוקס (קריטי ל-UX, לא תלוי בהרשאות production)
2. `8ac1da3e` — `<main>` landmarks
3. `6e4edc7f` — תיקון דליפת עברית/אנגלית
4. `c91044f6` + `fa306e0a` — exposure (תמונה שבורה + ביצועים)
5. `9b411c62` — HSTS/CSP (לבדוק תאימות מול מצב headers נוכחי לפני שחזור)
6. `b572e8b8` — לבדוק קודם אם PR #12/#13 כבר כיסו את זה במלואו, כדי לא לכפול עבודה
7. `85828342` + `c0b0a1ac` — Drive scan / auto-import
8. `c4e46ade` — תיקון תיעוד CLAUDE.md

**לא נכלל בסדר העדיפויות:** `a334d3d0` (Gelato) — מוחלף על ידי PR #11; `b11b1c7b`,
`504fba1a`, חלקי GA-report — כבר ב-main דרך מסלול אחר.

## אימות בטיחות

- `PAYMENTS_ENABLED` נבדק חי דרך `GET /api/payments-status` — `{"enabled":false}` ✓
- לא בוצע commit, merge, deploy, backfill, dispatch או כתיבת D1 כחלק מהדוח הזה
- כל הממצאים מבוססי `git log`/`git diff`/`grep` מול `origin/main` בפועל, לא זיכרון שיחה קודמת
