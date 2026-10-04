# Handoff — amit-photos

> מסמך כניסה לכל מי (אדם או סוכן AI) שנכנס לפרויקט הזה בפעם הראשונה, או חוזר אחרי הפסקה.
> עודכן: **4.10.2026**. זה מסמך חי — לעדכן אותו כשקורה משהו מהותי, לא לתת לו להתיישן.
> לא מחליף את `CLAUDE.md` (כללי ארכיטקטורה מחייבים) — משלים אותו עם "מה המצב עכשיו ולמה".

---

## Pinterest queue and publishing — 4.10.2026

- PR #139 מוזג ל-`main` כ-`87b7dbbd6f5358eb354056502a61b57cdd356322` ומכין תור פרסום מבוקר. בגיליון Google `pinterest_queue` (לשונית `pinterest_queue.csv`) וב-`data/pinterest_queue.csv` יש 447 רשומות תואמות לפי מזהה: לכל הרשומות תיאור, קישור ייעודי `?photo=<id>` ותגיות. תוקנו 59 תיאורים/תגיות, 6 כותרות ו-447 קישורים. בעת מיזוג PR #139 סומנו 11 תמונות שכבר נרשמו ב-`data/pinterest_posted.json` כ-`posted=TRUE`. אחרי הפיילוט: 12 `TRUE`, 435 `FALSE` והיסטוריית 247 מזהים. אין למחוק את ההיסטוריה.
- `src/pinterest_post.py` קורא את CSV המאגר כמקור הפרסום, מצלב עם `/api/photos` כדי לפרסם רק תמונות חיות ולקחת URL ציבורי של התמונה, ומשתמש בתיאור הערוך ובקישור לתמונה עם UTM. הוא בוחר עד שלוש תמונות מקטגוריות שונות, מדלג על מזהים בהיסטוריית הפרסום ושומר CSV ו-JSON אחרי כל Pin מוצלח. הוסרה ההבטחה הישנה `Available for purchase` ופרמטר `buy=1` כל עוד התשלומים כבויים.
- מקור התור התפעולי הוא CSV ב-GitHub; ה-JSON הוא היסטוריית dedup גם לתמונות מחוץ ל-447. PR #141 הוסיף סנכרון `posted=TRUE` לפי מזהה בלבד, בלי למחוק TRUE קיים, בדיקת התאמת כל מזהי הגיליון, workflow ידני (`pinterest-sheet-sync.yml`) ושלב סנכרון אחרי שמירת פרסום בפיילוט. **הסנכרון האוטומטי עדיין חסום בפועל:** Google Sheets API כבוי בפרויקט OAuth; אין להסיק מ-`FALSE` בגיליון שתמונה לא פורסמה מאז הסנכרון.
- ה-workflow לאחר מיזוג PR #139 הוחלף זמנית ב-CI לקריאה בלבד, ללא cron, טוקן או פרסום. 5 בדיקות ממוקדות, Pinterest queue validation, Python Data Tests ו-Business Live Verification עברו ב-PR. נוסף שלב `--dry-run` לקריאה בלבד מול הקטלוג החי; הפיילוט שתועד להלן אימת את טוקן הגישה ואת פרסום פין אחד. **אין להפעיל פרסום אוטומטי עדיין:** נדרשים ביקורת 66 הרשומות שאינן בקטלוג החי וסנכרון מצב הגיליון. אין צורך להוסיף `PINTEREST_REFRESH_TOKEN`: הקוד אינו משתמש בו.
- בזמן הביקורת שינוי להפעלה אוטומטית נדחה בבדיקת אישור אוטומטית בשל פרסום פומבי ללא פיילוט מפורש. אין לעקוף את החסימה. אישור מפורש לפין הניסיוני התקבל והפיילוט הושלם. חידוש cron הוא שלב נפרד, לאחר תיקון הפערים ובדיקה.

---

### פיילוט Pin יחיד — 4.10.2026: הושלם

- עמית אישר במפורש פרסום פין ניסיון אחד. PR #140 מוזג כ-`d695ee63eab9cd5fcd9085c1a6f0c17d6daaff96`; המועמד הקבוע היה `1A8y2S1s8pDnIzK0lbW6NpxJS5plJcYzJ` ("פרח אדום בשמש"), עם `PINTEREST_POST_LIMIT=1` וללא cron.
- שתי הריצות הראשונות (#1/#2) נכשלו **לפני פרסום**: בדיקת יחידה הניחה בחירה של יותר מתמונה אחת למרות הגבלת הפיילוט ל-1. הבדיקה תוקנה ב-`39f50d3`. ריצה חוזרת של #2 (run `37195647061`) עברה; dry-run אישר את המועמד והפרסום החזיר Pinterest Pin ID `512636370109452329`.
- הפין הציבורי נצפה ב-`https://www.pinterest.com/pin/512636370109452329/`: כותרת "פרח אדום בשמש", תיאור הגיליון והתגיות, חשבון `erezphoto`, לוח "פרחים וצמחים". הקישור `https://amitphotos.com/?photo=1A8y2S1s8pDnIzK0lbW6NpxJS5plJcYzJ&utm_source=pinterest&utm_medium=organic_social&utm_campaign=gallery_pins&utm_content=1A8y2S1s8pDnIzK0lbW6NpxJS5plJcYzJ` נבדק ישירות באתר ופתח את lightbox של אותה תמונה. Pinterest דרש התחברות כדי ללחוץ על כפתור Visit, לכן לא אושר click-through מתוך Pinterest עצמו; היעד שנשלח בקוד והעמוד המקבל אומתו בנפרד.
- `data/pinterest_queue.csv` ו-`data/pinterest_posted.json` נשמרו ב-`main` לאחר הפרסום; שורה 347 בלשונית הגיליון עודכנה ל-`posted=TRUE` ונקראה חזרה. התזכורת למחר הושהתה, כי הפיילוט הושלם.
- dry-run דיווח `live matches=381` מתוך 447 רשומות תור; 66 מזהים אינם מופיעים ב-`/api/photos` כרגע. **אין להפעיל פרסום יומי** לפני ביקורת של הרשומות החסרות וסנכרון מצב הפרסום מהמאגר לגיליון לאחר כל פין. workflow הפיילוט נשאר `workflow_dispatch` ללא cron; הרצה חוזרת עם אותו ID תיעצר כ-"already posted". אין צורך כרגע ב-`PINTEREST_REFRESH_TOKEN`.
- `PAYMENTS_ENABLED=false` נשאר ללא שינוי.

### ביקורת תור וסנכרון גיליון — 4.10.2026

- PR #141 מוזג ל-`main` כ-`05524b87e700c1c40f4fe22ecfba3791ff28a393`. בדיקות Python Data Tests ו-Pinterest queue validation עברו; `src/audit_pinterest_queue.py` מצלב את התור עם הקטלוג החי, `data/photos.json` ומצב HIDE ב-Drive.
- מצב נקודתי: 381/447 מזהים בתור נמצאים ב-`/api/photos`; 66 אינם חיים: 6 נמצאים במפורש ב-Hidden של Drive, 17 עדיין ב-`data/photos.json` אך אינם ב-API החי, ו-43 אינם בקובץ הסטטי או ב-API. מתוכם רשומה אחת כבר מסומנת TRUE מהעבר. אלה נתוני זמינות, לא הוכחה למחיקה או סיבה לפרסם תמונות נסתרות. המפרסם מצליב מול ה-API בכל ריצה ולכן מדלג על כל 66; הרשומות נשמרות לצורך היסטוריה ובירור, ללא שינוי מצב האתר.
- `src/sync_pinterest_sheet.py` נבדק ביחידות: הוא מסרב לסנכרן אם מזהי 447 הרשומות שונים בין Sheet ל-CSV, ורק מעלה `posted` ל-TRUE עבור מזהים שנמצאים בהיסטוריית הפרסום. אין כתיבת FALSE. שלב הסנכרון תלוי בשמירת מצב הפרסום ב-GitHub.
- ריצת בדיקת הרשאות קריאה בלבד `Pinterest Sheet status sync` #1 (`37197237040`, ניסיון 2) נכשלה ב-403. הודעת Google המדויקת: **Google Sheets API has not been used in project 717200418816 before or it is disabled**. סוד `GOOGLE_TOKEN` הגיע לריצה, ו-Drive scope זוהה; ההרשאה הנדרשת כאן היא הפעלת **Google Sheets API** בפרויקט Google Cloud `717200418816`, דרך `https://console.developers.google.com/apis/api/sheets.googleapis.com/overview?project=717200418816`. אין צורך להדביק או להחליף אסימון בצ'אט.
- אחרי שבעל הפרויקט מפעיל את ה-API וממתין להפצה: להריץ מחדש את job `sync` של `37197237040` לקריאה בלבד; לאשר `Sheet rows=447` ו-`missing TRUE updates=0` או לטפל בהפרש; אז להריץ את `pinterest-sheet-sync.yml` ידנית עם `check_only=false` אם יש פער, ולקרוא שוב את הגיליון. ה-workflow היומי לפרסום נשאר כבוי, והפיילוט היחיד נשאר הפין היחיד שאושר.
- `PINTEREST_ACCESS_TOKEN` עבד בפיילוט. `PINTEREST_REFRESH_TOKEN` אינו נדרש בקוד הקיים. אין להפעיל cron עד שסנכרון הגיליון אומת ובוחרים מדיניות לתור בן 381 התמונות הזמינות.

## Production health-check runner — 4.10.2026

- GitHub Actions `.github/workflows/health-check.yml` was already scheduled daily at 07:00 UTC (10:00 Israel summer / 09:00 winter). It is the authoritative production health-check runner; do not create a duplicate AI scheduled check.
- Hardened the existing workflow: bounded retries, read-only permissions, job timeout, serialized runs, non-empty array validation for photos, thumbnail passed via environment rather than shell interpolation, and an always-running summary that detects failed/skipped steps. A missing thumbnail now fails instead of reducing the denominator.
- Homepage, photo API, sitemap and sample image remain the four core checks. Existing licensing/business/admin markers and `PAYMENTS_ENABLED=false` guardrail remain checked. Workflow changes also trigger a live run on push.
- Local verification: YAML parsed; all six shell blocks passed `bash -n`; five summary scenarios and four API-validation cases passed.
- The reported Claude `403 policy denial` is a runner/proxy access failure, not evidence of a production outage. Inspect the GitHub run before concluding the site is down.
- Live verification passed on 4.10.2026 at 09:17 Israel: [health run #7](https://github.com/erezfamily-cmyk/amit-photos/actions/runs/37182347635), all four core checks + business/admin/payment guardrail; API returned 2,310 photos. PR Business Live Verification run 37182354449 also passed.
- **Closed external step (4.10.2026):** the owner paused the weekly Claude Code routine “בדיקת בריאות שבועית — amitphotos.com” in Claude Routines; the screenshot showed `Paused` and the toggle off. Keep the daily GitHub Actions check as the sole active health-check schedule. PR #138 was merged and its post-merge run passed 4/4: https://github.com/erezfamily-cmyk/amit-photos/actions/runs/37182427171.


## ⚡ הדבר הכי חשוב לדעת עכשיו

**תשלומים כבויים באתר החי, בכוונה, ולא באג.**

```
PAYMENTS_ENABLED = "false"   ב-wrangler.toml (production)
```

- כל נתיב שמזיז כסף (`/api/verify-payment`, `/api/print/order-complete`) מחזיר `503 PAYMENTS_TEMPORARILY_DISABLED` בשרת — לא רק כפתורים מוסתרים בצד לקוח.
- **הסיבה:** מעבר מ-PayPal Payments Standard (הישן, redirect-based) ל-**PayPal Orders API v2**. עד שההפעלה המחודשת תבוצע, האתר בפאזת תיקוני UX/אבטחה/אנליטיקה.
- **זו החלטה עומדת, לא נבדקת מחדש בכל שיחה:** התוכנית (`docs/analytics-driven-ux-plan-2026-09-26.md`) קבעה לתת לאירועי אנליטיקה חדשים לצבור **baseline של 14–28 יום** לפני שמשווים שוב ושוקלים הפעלה מחודשת. כלומר — **אל תציע להדליק את הדגל בחזרה בלי לבדוק תאריך ה-baseline קודם.**
- **מסמך תכנון המעבר בפועל ל-Orders API v2 כבר קיים:** `docs/paypal-orders-v2-migration-2026-09-30.md` (עיצוב בלבד, אין עדיין קוד). מחכה ל-Sandbox App + Client ID/Secret + חשבון קונה-בדיקה מעמית (חד-פעמי, דרך developer.paypal.com) לפני שהעבודה בפועל יכולה להתחיל — הבנייה עצמה יכולה להתקדם במקביל לחלון ה-baseline, לא צריך לחכות לו.
- הורדות של רכישות ישנות (טוקנים תקפים שכבר נוצרו) **ממשיכות לעבוד** — הנעילה חוסמת רק יצירת עסקאות/טוקנים חדשים.
- מי שיפעיל בחזרה: לשנות `PAYMENTS_ENABLED = "true"` ב-`wrangler.toml`, לפרוס, ולוודא `GET /api/payments-status` מחזיר `{"enabled":true}`.

---

## 🖼️ הפרויקט בקצרה

- **מה:** פורטפוליו צילום עברי (Fine Art / נוף / טבע / מאקרו) של עמית ארז. ~2,300+ תמונות מפורסמות.
- **URL:** https://amitphotos.com
- **Stack:** Cloudflare Worker (`worker.js`, קובץ ענק אחד — כל ה-API) + D1 (SQLite) + R2 (תמונות) + Assets. Frontend: HTML/CSS/Vanilla JS, דו-לשוני HE (ראשי) / EN.
- **Repo:** ציבורי ב-GitHub (`erezfamily-cmyk/amit-photos`) — **לא לחשוף סודות בקוד!**
- **Deploy:** `git push` ל-`main` → GitHub Actions (`deploy.yml`) → `wrangler deploy` אוטומטי. אין deploy ידני נדרש בדרך כלל.
- **בעל הפרויקט:** עמית (זכר, לפנות בלשון זכר).

לארכיטקטורה מלאה (מיזוג גלריה D1+JSON, מבנה keys ב-R2, auth, קבצים מרכזיים, סקריפטי מיגרציה) — **`CLAUDE.md`** הוא המקור המחייב, לא כפול כאן.

---


## 📈 Lead funnel measurement audit — 1.10.2026

נמצא פער מדידה חשוב בזמן בניית המודל העסקי:
- טופס ה-newsletter בדף הבית שלח `generate_lead` על כל submit מוצלח, גם אם האימייל כבר היה קיים.
- עמוד `/free-guide/` לא שלח `generate_lead` בכלל.
- לכן `generate_lead` לא היה KPI אמין להשוואת free-guide מול newsletter.

תיקון מוצע ב-Draft PR נפרד:
- ה-API של subscribers מחזיר metadata לא-רגיש בלבד: `created`, `already`, `marketing_upgraded`.
- `generate_lead` נשלח רק כשנוצר subscriber חדש או כשיש upgrade אמיתי להסכמה שיווקית.
- `guide_request_success` מודד בקשת מדריך מוצלחת גם כשהמשתמש בוחר לא להצטרף לשיווק.
- הדוח השבועי מפריד בין בקשות מדריך לבין לידים חדשים/משודרגים.
- לא נשלח email/PII ל-GA.
- אין שינוי ב-`PAYMENTS_ENABLED` ואין שינוי במסלול התשלומים.

המשמעות העסקית: רק אחרי שהתיקון נפרס ומצטברים נתונים אפשר להשוות באופן הוגן `free-guide -> guide_request_success -> generate_lead`.

## 🗓️ מה קרה לאחרונה (מהחשוב לפחות חשוב)

### השבוע האחרון (25–30.9.2026)
1. **כיבוי תשלומים בפרודקשן** (25.9) — מתג `PAYMENTS_ENABLED` fail-closed, `GET /api/payments-status`, חסימת שרת ב-`handleVerifyPayment`/`handlePrintOrderComplete`, UI מותאם. ראה `git show 306d0a01`.
2. **יישור UX לנעילת התשלומים** (PR #12/#13, 27.9) — הודעות רכישה + cache-busting לנכסי מצב-תשלום.
3. **ביקורת UX חיה מבוססת-נתונים** (26.9, יום מלא) — עיצוב מחדש להיררכיית דף הבית (הירו, ניווט, featured grid, הסרת עדויות אירועים סותרות מיצוב), תיקון SW cache-first קריטי (מבקרים חוזרים לא ראו עדכוני תמונות), 58 רשומות עם טקסט עברי פגום תוקנו, אדמין מותאם מובייל. פירוט מלא: `docs/daily-summary-2026-09-26.md`.
4. **סבב תיקוני מובייל לאדמין** (27.9, ~8 PR-ים) — טפסים, טבלאות, כלי מדיה, ניווט צד, סושיאל — כל האדמין.
5. **אנליטיקה → החלטות UX** (PR #62–64, 28.9) — מדידת UX ציבורי, קיצור נתיב יצירת קשר מתמונה, הפיכת אנליטיקס להחלטות עיצוב.
6. **תיקוני אבטחה/יציבות** (28–30.9) — XSS בשם נרשם לניוזלטר (#65), ייחוס תנועה סושיאל אוטומטית (#67), URL אנליטיקס דף הבית (#66), stale cache-busting hashes אחרי גלי PR מקבילים (#54, #68).
7. **ייבוא תמונות גאורגיה + באג טקסט פגום חוזר** (30.9) — 12/13 תמונות חדשות מדרייב עלו לגלריה (1 תקלה חולפת, ממתינה לריצה הבאה). תוך כדי כך התגלה שהבאג "טקסט עברי פגום" מ-26.9 **עדיין פעיל בפועל** (2 רשומות חדשות + 11 ישנות שחזרו למצב פגום) — כי `agent_photos.py` (צינור ה-Drive, לא `worker.js`) מעולם לא בדק את פלט ה-AI שלו. תוקן ב-PR #69 (ולידציה+ניסיון חוזר, כמו ב-`generateHebrewTitle`). תיעוד מתוקן: `docs/corrupted-photo-titles-2026-09-26.md`.
8. **סגירת cherry-pick מיושן** (30.9) — כל 8 הפריטים שנרשמו כ"עדיין חסרים" ב-`docs/security-ux-audit-status-2026-09-26.md` נבדקו מול `main` הנוכחי ונמצאו **כולם כבר פתורים** דרך עבודה עצמאית — אין יותר צורך לשחזר מהענף הישן.
9. **מסמך תכנון PayPal Orders API v2** (ערב 30.9) — `docs/paypal-orders-v2-migration-2026-09-30.md`, מוכן לסקירת עמית מחר בבוקר. ראה גם למעלה.
10. **ייבוא תמונות נוסף + באג CI אמיתי** (לילה 30.9) — 38 תמונות חדשות נוספות מכל התיקיות שעמית העלה היום (22 גאורגיה, 10 טבע דומם, 5 פרחים וצמחים, 1 מאקרו). סריקת ביקורת מלאה על כל 2,424 התמונות החיות — **0 שדות פגומים**, אישוש בריצת-אמת (לא רק טסטים) שתיקון PR #69 עובד. תוך כדי בדיקה למה תמונה אחת ספציפית (`DSC_9287.jpg`, גאורגיה — קובץ Drive תקין לגמרי) לא נכנסת בשום ריצה, התגלה ש-`update-photos.yml` **מעולם לא commit את `data/copyright_flagged.json`** — כל סימון זכויות-יוצרים חדש (מאז יולי) נמחק בשקט בסוף כל ריצת CI, והתמונה המסומנת מנותחת מחדש (ומבזבזת קריאת API) בכל ריצה עתידית לנצח, בלי שום עקבות. תוקן ב-PR #74 (שני חצאים: commit + change-detection, אחרת התיקון לא באמת מופעל). `DSC_9287.jpg` אמור להיפתר לבד בריצה היומית הבאה.

### הקשר חשוב: כמה סשנים מקבילים
יש תקופות שבהן **כמה סשנים של Claude Code רצים במקביל באותה תיקיית עבודה בדיוק** (לא git worktrees נפרדים — אותו `.git/index` ואותם קבצים על הדיסק). זה קרה בפועל ב-25.9 (זיהוי + תיאום עם סשן "amit-photos-46" שעבד על ביקורת אבטחה/UX/אנליטיקה, ועדיין פעיל נכון ל-30.9 — הוא אחראי לחלק ניכר מה-PRs ברשימה למעלה).

**כללי זהב אם זה קורה שוב:**
- `git status` **תמיד** ממש לפני `git add`/`git commit` — לא לסמוך על מה שראית לפני כמה פעולות.
- לעולם לא `git add -A` / `git add .` — רק נתיבים מפורשים.
- אם רואים קבצים שהשתנו ולא נגעת בהם — כנראה סשן אחר. לתאם דרך `SendMessage` לפני commit.
- לפני merge/cherry-pick/deploy לענף משותף — לבדוק אם יש PR-ים פתוחים או קומיטים חדשים שאולי מתנגשים.
- ענף ישן (`fix/security-analytics-ux-audit`, 19+ קומיטים) **קיים אך אף פעם לא מוזג במלואו** — ראה `docs/security-ux-audit-status-2026-09-26.md` לרשימת קומיטים ספציפיים שעדיין לא הגיעו ל-`main` (למשל HSTS/CSP, נגישות מודלים/לייטבוקס, `<main>` landmarks, דליפת עברית/אנגלית בווידג'טים). **לפני שמנסים לשחזר קומיט משם — לבדוק קודם אם PR חדש יותר כבר כיסה את זה אחרת**, כדי לא לכפול עבודה או לדרוס גרסה עדכנית יותר.

---

## 📚 מפת תיעוד — איפה למצוא מה

| קובץ | מה יש בו | עדכני נכון ל- |
|---|---|---|
| `CLAUDE.md` (וגם `AGENTS.md` — עותק זהה לתאימות כלים) | ארכיטקטורה מחייבת: מיזוג גלריה, R2 keys, auth, קבצים מרכזיים, i18n, SEO | מתעדכן שוטף |
| `docs/daily-summary-2026-09-26.md` | סיכום יום עבודה מלא — הכי מפורט על מה קרה ב-26.9 | 26.9.2026 |
| `docs/security-ux-audit-status-2026-09-26.md` | סטטוס אמיתי (מאומת בקוד, לא מזיכרון) של מה מוזג מהענף הישן ומה לא | 26.9.2026 |
| `docs/analytics-driven-ux-plan-2026-09-26.md` | התוכנית שקובעת למה תשלומים כבויים ומתי לבדוק שוב | 26.9.2026 |
| `docs/paypal-orders-v2-migration-2026-09-30.md` | מסמך עיצוב מלא למעבר בפועל ל-Orders API v2 — ארכיטקטורה, סכמת D1, endpoints, checklist אבטחה, תוכנית בדיקות. אין קוד עדיין, ממתין לסקירת עמית | 30.9.2026 |
| `docs/paypal-flow.md` | זרימת PayPal **הישנה** (Payments Standard) — עדיין רלוונטי להבנת המנגנון הקיים לפני המעבר ל-Orders API v2 | אפריל 2026 (ישן, אבל המנגנון לא השתנה) |
| `docs/gallery-merge-architecture.md` | פירוט מיזוג D1+photos.json | — |
| `docs/site-overview.md` | מפת עמודים, טבלאות D1, רשימת API — **ישן (17.5.2026), חלק מהמספרים לא מעודכנים**, אבל שימושי כסקירה מבנית | 17.5.2026 ⚠️ |
| `docs/CHANGELOG.md` | ⚠️ לא מתעדכן — אל תסמוך עליו לפעילות אחרונה | 17.5.2026 ⚠️ |
| `memory/` (מחוץ לריפו, `~/.claude/projects/.../memory/`) | זיכרון ארוך-טווח בין שיחות — סטטוס פרויקטים, לקחים, החלטות. `MEMORY.md` הוא האינדקס | מתעדכן שוטף |

**עצה:** לפני שסומכים על מספר/תאריך/סטטוס — לבדוק בקוד/ב-git החי, לא רק בתיעוד. גם המסמכים האלה יכולים להתיישן (ראה איך `site-overview.md` כבר מיושן).

---

## 🧩 החלטות ולקחים שחוזרים (לפי נושא)

- **תשלומים כבויים** — ראה למעלה. לא לגעת בלי לבדוק סטטוס baseline קודם.
- **סשנים מקבילים** — `git status` תמיד לפני commit, ראה למעלה.
- **"תוקן" לא אמין בלי אימות חי** — כל ממצא בביקורת ה-UX מ-26.9 אומת בדפדפן אמיתי (screenshots, console errors), לא רק קריאת קוד. שני ממצאים (ספירה סטטית, קיר קטגוריות) התגלו רק ככה. תעדוף בדיקה חיה על פני "זה אמור לעבוד".
- **עמית עונה "כן" גם לשאלת A-או-B** — לפעולות פרסום/רכישה אמיתיות תמיד לנסח אישור מפורש מחדש, לא להסיק מדפוס.
- **כל עמוד ציבורי חדש** חייב `data-he`/`data-en` + `setLang()` מהרגע הראשון (לא בדיעבד).
- **עמית עובד בעיקר מהנייד** — כל שינוי אדמין/UI כדאי לבדוק ב-viewport צר (390px), לא רק דסקטופ.
- **לכתוב תשובות בעברית, לפנות בלשון זכר.**

לרשימה המלאה והמפורטת יותר — קובצי `feedback_*.md` ב-memory.

---

## ✅ מה עובד ומה עדיין פתוח (תמונת מצב)

**עובד ופרוס:** גלריה + פילטרים + לייטבוקס, בית ספר לצילום (24 מדריכים ב-`/camera/`), מקומות לצילום, ניתוח תמונות (`/learn/`), משחקים (פאזל/קוויז), ניוזלטר, אדמין מלא (כולל מובייל), אנליטיקה מפורטת, אוטומציות סושיאל (Instagram/Facebook/Pinterest/Threads/Redbubble/Zazzle), GA weekly report.

**כבוי בכוונה:** רכישות (PayPal) — ראה למעלה.

**ידוע כפתוח / ממתין:**

- **מעבר בפועל ל-PayPal Orders API v2** — עיצוב מוכן (`docs/paypal-orders-v2-migration-2026-09-30.md`), ממתין ל-(1) סקירת עמית למסמך עצמו, (2) חשבון Sandbox + Client ID/Secret + חשבון קונה-בדיקה מעמית (חד-פעמי, developer.paypal.com), (3) סיום חלון ה-baseline לפני הפעלה בפועל — אבל הבנייה עצמה לא צריכה לחכות לתנאי #3.
- `DSC_9287.jpg` (גאורגיה) — הסיבה כבר ידועה (ראה #10 למעלה: סימון זכויות-יוצרים שנמחק בשקט בגלל באג CI, עכשיו מתוקן ב-PR #74). לבדוק שהיא נכנסת בפועל בריצה היומית הבאה; אם לא, לבדוק את `data/copyright_flagged.json` (עכשיו נשמר בפועל) לראות אם היא שם ולמה.
- להמשיך לעקוב אחרי metrics אחרי כל שינוי UX גדול לפני שממשיכים הלאה.

**עודכן 30.9.2026:** שחזור הענף הישן (`fix/security-analytics-ux-audit`) שהיה רשום כאן כפתוח —
**נבדק מול `main` הנוכחי ונמצא מיותר: כל 8 הפריטים כבר פתורים** דרך עבודה עצמאית מאוחרת יותר,
לא דרך הענף הישן עצמו. פירוט מלא ב-`docs/security-ux-audit-status-2026-09-26.md` (עודכן). אל
תבזבזו זמן על cherry-pick מהענף הזה בלי לבדוק שוב קודם.

---

*אם אתה סוכן AI שנכנס לפרויקט הזה: קרא את `CLAUDE.md` ואת המסמך הזה קודם, ואז תסתכל אם יש `docs/*-2026-*.md` חדש יותר מהתאריך שרשום כאן — אם כן, זה כנראה מעודכן יותר ממה שכתוב פה.*


### Lead source attribution audit — 1.10.2026

נבדקו כל מקורות ההרשמה הפעילים בקוד:
- `lead_magnet` — עמוד `/free-guide/`
- `popup` — popup בדף הבית
- `subpage_strip` — strip שמוזרק לעמודי משנה דרך `assets/js/nav.js`
- `homepage_section` — טופס newsletter בדף הבית
- `newsletter_issue` — הרשמה מתוך גיליון newsletter

פער נוסף שנמצא:
- `popup` ו-`subpage_strip` שלחו בעבר `generate_lead` גם כשאותו email כבר היה קיים.
- `newsletter_issue` לא שלח `generate_lead` בכלל.
- לכן source attribution של leads לא היה עקבי בין כל 5 המקורות.

תיקון נוסף באותו Draft PR:
- כל חמשת המקורות משתמשים באותה הגדרה של lead חדש/שדרוג הסכמה.
- בקשות guide נשמרות בנפרד מ-lead marketing אמיתי.
- אין PII ב-GA.
- אין שינוי ב-payment flow.



### Weekly Business Review automation — 1.10.2026

נמצא שכבר קיימת אוטומציה שבועית ב-`.github/workflows/ga-weekly-analysis.yml`:
- רצה בכל יום שני ב-07:00 UTC.
- מפעילה `src/ga_weekly_report.py`.
- שולחת דוח במייל ושומרת את `data/ga_reports.json`.

לכן **לא נוספה אוטומציה מקבילה**. במקום זאת, Draft PR #79 מרחיב את הדוח השבועי הקיים:
- מוסיף D1 subscriber summary לפי source, ללא PII.
- מוסיף KPI עסקיים דטרמיניסטיים: Direct share, lead rate, marketing opt-in, digital intent, print intent.
- מוסיף sample-size guardrail.
- מפיק **next_action אחד בלבד** לשבוע הבא + reason.
- שומר את `business_review` בתוך `data/ga_reports.json`.
- מציג את ההחלטה גם במייל השבועי לפני ניתוח ה-AI.

החלטת ה-next_action אינה מבוססת רק על Claude: היא מחושבת בקוד לפי כללים שקופים, ורק אחר כך Claude מוסיף ניתוח טקסטואלי. כך נמנעת החלפת אסטרטגיה בגלל ניסוח משתנה של מודל AI.

אין שינוי ב-schedule, אין workflow חדש, אין payment enablement ואין deploy במסגרת ה-Draft.



### Acquisition attribution — 1.10.2026

המשך התוכנית העסקית זיהה ש-Direct הוא עדיין צוואר בקבוק מרכזי למדידה. Draft PR #79 הורחב:
- GA weekly report מושך כעת גם `sessionSource`, `sessionMedium`, `sessionCampaignName`.
- Source / Medium / Campaign מופיעים בדוח הטקסט ובמייל השבועי.
- נוספו מראש אירועי העסק החדשים לרשימת הדוח:
  - `licensing_personal_interest`
  - `licensing_commercial_contact`
  - `b2b_intent`
  - `b2b_package_select`
  - `b2b_contact_start`
- אין PII.
- אין שינוי בתשלומים.

Business docs מגדירים UTM convention וניסוי attribution של 7 ימים. אין להתחיל paid ads לפני שיש attribution יציב ויכולת לזהות איזה קמפיין מביא פעולות עסקיות.



### PR #79 QA pass — 1.10.2026

בוצע סבב QA ממוקד על lead measurement / weekly business review.

ממצאים ותיקונים:
- נמצא שהדוח השבועי משך Source/Medium/Campaign אבל לא שמר אותם ב-`data/ga_reports.json`; תוקן כדי לשמור היסטוריית campaign.
- הוסר KPI מטעה `guide_to_lead_pct` שחילק את כלל ה-`generate_lead` (מכל המקורות) רק בבקשות מדריך; הוחלף ב-`guide_request_rate_pct` עקבי.
- אומת ש-`nav.js` כבר טוען את `assets/js/analytics.js` בעמודי משנה שחסרה בהם טעינת GA ישירה, ולכן אין צורך להוסיף סקריפט כפול.
- אומת שה-endpoint החדש `/api/admin/subscriber-summary` מוגן ב-`checkAuth`.
- אומת שה-summary מחזיר aggregates בלבד ולא email/PII.

נוסף workflow ממוקד:
- `.github/workflows/lead-funnel-ci.yml`
- מריץ `node --test tests/subscriber-consent-model.test.mjs`
- מריץ `python3 -m py_compile src/ga_weekly_report.py`
- read-only permissions בלבד.

הערה: סביבת העבודה של ChatGPT לא הצליחה לבצע clone ישיר מ-GitHub בגלל חסימת DNS, ולכן האימות המקומי לא נחשב. ה-CI ב-GitHub הוא מקור האימות הבא לפני Ready/Merge.



### PR #79 final QA — 1.10.2026

סבב QA נוסף מצא ותיקן שני פערי סמנטיקה במדידה:
- `generate_lead` נשלח בעבר גם עבור subscriber חדש שביקש Free Guide אך **לא** נתן marketing consent. זה היה מערבב lead magnet delivery עם owned marketing audience.
- נוסף flag שרת לא-רגיש `lead_created`, והוא true רק כאשר:
  - subscriber חדש נתן marketing consent, או
  - subscriber קיים שודרג כעת מ-0/NULL ל-1.
- כל מקורות ההרשמה משתמשים כעת ב-`lead_created` במקום להסיק lead מ-`already`.

בנוסף:
- subscriber summary מפריד כעת בין:
  - new subscribers בתקופה לפי source,
  - marketing opt-ins/upgrades בתקופה לפי `consent_marketing_at`,
  - current marketing audience.
- ה-KPI בדוח נקרא במפורש `new_subscriber_marketing_opt_in_pct`, ובנפרד נשמר `period_marketing_opt_ins`.
- נוספו tests שמכסים guide-only ללא marketing consent לעומת guide+marketing.
- Lead Funnel CI עבר בהצלחה: Node tests + Python syntax check.

PR #79 יכול לעבור ל-Ready for Review. אין merge/deploy אוטומטי במסגרת הסבב הזה.



### Admin UTM campaign link builder — 1.10.2026

נוסף כלי פנימי ב-Admin תחת אזור Analytics:
- יוצר deep links ליעדים העסקיים: `/free-guide/`, `/licensing/`, `/business/`, `/#gallery`, `/camera/`, `/locations/`.
- משתמש ב-`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`.
- source/medium/destination מוגבלים לרשימות בטוחות.
- campaign/content עוברים normalization ל-`a-z0-9_-`.
- אין PII.
- כולל copy/open לבדיקה.
- mobile-friendly.
- לא שולח קישורים החוצה ולא מפרסם אוטומטית; זה רק generator פנימי.

מטרת הכלי: לאפשר discipline עקבי ב-UTM בלי להקליד ידנית בטלפון, כדי שהדוח השבועי החדש יוכל לזהות קמפיינים במקום שכולם ייראו כ-Direct.


### Business-model work status — 1.10.2026

מצב העבודה המתועד להמשך:

- **PR #79 — Lead funnel measurement**
  - עבר סבב QA ממוקד.
  - Lead Funnel CI עבר בהצלחה: Node subscriber/consent tests + Python syntax check.
  - `generate_lead` מוגדר כעת רק ל-marketing lead אמיתי דרך `lead_created`; בקשת Free Guide בלי marketing consent נשארת `guide_request_success` בלבד.
  - subscriber summary מפריד בין new subscribers, opt-ins/upgrades בתקופה, ו-current marketing audience.
  - Source / Medium / Campaign נשמרים גם בהיסטוריית `data/ga_reports.json`.
  - PR #79 הועבר מ-Draft ל-**Ready for Review**.
  - עדיין **לא מוזג ולא נפרס**.

- **PR #82 — Admin UTM campaign link builder**
  - עדיין Draft.
  - מוסיף כלי פנימי ב-Admin > Analytics ליצירת deep links עם UTM.
  - אין PII, אין פרסום אוטומטי, אין הרשאות חיצוניות ואין שינוי בתשלומים.
  - זהו הכלי הבא שמיועד ל-QA לפני הפעלת ניסוי acquisition.

- **PR #80 — Digital Licensing MVP**
  - עדיין Draft, ללא deploy.
  - מחירי הבסיס נטענים מאותה תשתית מחירים קיימת של ההורדות; checkout הסופי נשאר server-authoritative.
  - אין הפעלת תשלומים.

- **PR #81 — B2B Art & Licensing MVP**
  - עדיין Draft, ללא deploy.
  - כולל attribution מחבילת B2B עד `contact_form_success`, ללא PII.

- **PR #78 — Business-model TODO/scorecard**
  - עדיין Draft.
  - מכיל KPI scorecard, acquisition playbook ו-Acquisition Experiment 01.

- **PR #76 — PayPal Orders v2**
  - נשאר Draft; אינו חוסם את ניסויי המודל העסקי.
  - `PAYMENTS_ENABLED=false` נשאר כלל מחייב.


### PR #82 QA pass — 1.10.2026

בוצע סבב QA על Admin UTM campaign link builder.

שינויים שבוצעו:
- הוצא logic של בניית URL למודול testable:
  - `assets/js/admin-campaign-links.mjs`
- נוספו guardrails:
  - destination/source/medium allowlists.
  - normalization ל-campaign/content.
  - חסימה בסיסית של email/phone בתוך UTM לפני normalization.
  - כפתור "פתח לבדיקה" נשאר disabled עד שנוצר URL חוקי.
  - שדות campaign/content מוגדרים ללא autocomplete/autocapitalize כדי לצמצם טעויות במובייל.
- נוספו tests:
  - בניית UTM תקין.
  - שמירת `#gallery`.
  - חסימת destination/source/medium לא חוקיים.
  - חסימת PII ברור.
  - דרישת campaign לא-ריק.
- נוסף CI ממוקד:
  - `.github/workflows/admin-campaign-links-ci.yml`
  - מריץ `node --test tests/admin-campaign-links.test.mjs`.

עדיין אין merge/deploy. יש להמתין ל-CI לפני מעבר PR #82 ל-Ready.


### Digital Licensing MVP — 1.10.2026

נפתח כיוון MVP מסחרי ראשון, בלי להפעיל תשלומים:
- מסמך מוצר: `docs/digital-licensing-mvp-2026-10-01.md`
- עמוד ציבורי דו-לשוני: `/licensing/`
- שימוש אישי נשען על ה-SKU הקיימים `small / medium / large` והמחירים הקיימים כ-test prices.
- שימוש מסחרי נשאר inquiry/quote בלבד בשלב הראשון — לא נבנה עדיין checkout מסחרי אוטומטי.
- אין שינוי ב-PayPal backend ואין שינוי ב-`PAYMENTS_ENABLED`.
- לא נוסף קישור לניווט הראשי עדיין; קודם review של copy/UX.
- נוספו אירועי analytics לא-PII:
  - `licensing_personal_interest`
  - `licensing_commercial_contact`
- `.github/workflows/deploy.yml` עודכן כך ששינויים תחת `licensing/**` יפעילו deploy אחרי merge עתידי.
- Gelato לא חלק מ-MVP הרישוי הדיגיטלי.


### Licensing acquisition readiness — 1.10.2026

עמוד `/licensing/` קיבל metadata מלא לשיתוף ומדידה:
- canonical + hreflang כבר קיימים.
- נוספו Open Graph ו-Twitter Card.
- social preview משתמש כרגע בתמונת המותג הקיימת של האתר.
- המטרה היא לאפשר בדיקת קישורי UTM ב-social/newsletter עם preview תקין.
- אין שינוי בתשלומים ואין checkout activation.


### PR #80 replacement QA — 1.10.2026

Digital Licensing MVP נבנה מחדש מענף נקי מ-main לאחר מיזוגי #79/#83.

ממצא QA חשוב:
- העמוד הסטטי `/licensing/` כלל `analytics.js` אך לא את bootstrap של GA/gtag.
- המשמעות: אירועי `licensing_personal_interest` / `licensing_commercial_contact` לא היו נשלחים בעמוד הזה.
- תוקן על ידי טעינת gtag עם Measurement ID הקיים של האתר לפני `analytics.js`.

בנוסף:
- מקור המחירים נשאר `GET /api/admin/prices`; אין price table נפרד.
- fallback מוצג רק אם API המחירים לא זמין; checkout עתידי נשאר server-authoritative.
- `PAYMENTS_ENABLED=false` ללא שינוי.
- אין PayPal/Gelato activation.


### B2B Art & Licensing MVP — 1.10.2026

המשך התוכנית העסקית פתח ניסוי B2B מינימלי:
- מסמך: `docs/b2b-art-mvp-2026-10-01.md`
- עמוד דו-לשוני: `/business/`
- שלוש הצעות בלבד:
  1. Digital Display License
  2. Wall Art Selection
  3. Custom Collection
- אין מחירון B2B קשיח בשלב הזה; משתמשים ב-tailored quote כדי ללמוד מהשוק.
- אין CRM, אין checkout עסקי אוטומטי, אין Gelato commitment.
- אירועי analytics לא-PII:
  - `b2b_intent`
  - `b2b_package_select`
  - `b2b_contact_start`
- ה-CTA מפנה לטופס הקשר הקיים באתר, שבו כבר קיימת אפשרות "רישיון מסחרי".
- לא נוסף קישור לניווט הראשי לפני review.
- `PAYMENTS_ENABLED=false` נשאר ללא שינוי.


### B2B contact funnel refinement — 1.10.2026

נוסף חיבור בין `/business/` לטופס הקשר הקיים:
- בחירת חבילה בעמוד העסקי נשמרת זמנית ב-`sessionStorage` רק כ-context לא רגיש:
  - `digital_display`
  - `wall_art`
  - `custom_collection`
  - `business_quote`
- המעבר לטופס הקשר בוחר מראש "רישיון מסחרי".
- subject פנימי מקבל את סוג החבילה, בלי PII.
- placeholder מותאם להקשר העסקי שנבחר.
- `contact_form_success` מקבל attribution `source=business` + package label בטוח.
- אין שם/אימייל/טקסט חופשי שנשלחים ל-GA.
- ה-context פג אחרי 30 דקות ונמחק אחרי שליחה מוצלחת.

כך אפשר למדוד איזה offer עסקי מביא פניות אמיתיות בלי לבנות CRM חדש ובלי לשכפל טפסים.


### B2B acquisition readiness — 1.10.2026

עמוד `/business/` הוכן להפצה מבוקרת:
- נוספו canonical + hreflang.
- נוספו Open Graph ו-Twitter Card.
- social preview משתמש כרגע בתמונת המותג הקיימת של האתר.
- העמוד מוכן לניסוי deep-link/UTM לאחר review ו-merge.
- אין paid ads, אין checkout עסקי ואין Gelato commitment.


### PR #81 replacement QA — 1.10.2026

B2B MVP נבנה מחדש מענף נקי מ-main לאחר מיזוגי #79/#83/#84.

ממצאי QA ותיקונים:
- הוסר canonical כפול מ-`/business/`.
- נמנעה ספירה כפולה של `b2b_contact_start` ב-CTA הראשי: האירוע נשלח פעם אחת בלבד דרך funnel logic.
- בחירת "רישיון מסחרי" בטופס אינה תלויה עוד ב-`selectedIndex=2`; היא מאתרת את option לפי `data-i18n="contact.f.t2"`.
- context לא חוקי/ישן ב-`sessionStorage` נמחק; TTL נשאר 30 דקות.
- `contact_form_success` ממשיך לקבל רק `source=business` + package label בטוח, ללא PII.
- `analytics.js` כבר מבצע GA bootstrap בעצמו, לכן אין צורך ב-gtag script כפול בעמוד B2B.
- `PAYMENTS_ENABLED=false` ללא שינוי; אין checkout עסקי ואין Gelato activation.


### Business model execution — current status 1.10.2026

מצב עדכני מאומת מול GitHub:

#### כבר מוזג ל-`main`
- **PR #79 — Lead funnel measurement**
  - מדידת `guide_request_success` נפרדת מ-`generate_lead`.
  - `generate_lead` מייצג marketing lead אמיתי בלבד.
  - subscriber summary אגרגטיבי ללא PII.
  - Source / Medium / Campaign בדוח השבועי.
  - Business Review דטרמיניסטי + next action אחד.

- **PR #83 — Admin UTM Campaign Link Builder**
  - כלי mobile-friendly תחת Admin > Analytics.
  - allowlists + normalization + PII guardrails.
  - ללא פרסום אוטומטי וללא הרשאות חיצוניות.

- **PR #84 — Digital Licensing MVP**
  - עמוד `/licensing/` דו-לשוני.
  - מחירי בסיס מגיעים מ-`/api/admin/prices`.
  - GA/analytics תקינים.
  - Personal-use digital licensing + commercial inquiry.
  - אין checkout activation.

- **PR #85 — B2B Art & Licensing MVP**
  - עמוד `/business/`.
  - Digital Display / Wall Art / Custom Collection.
  - package context קצר-חיים עובר לטופס הקשר הקיים.
  - attribution עד `contact_form_success`, ללא PII.
  - אין checkout עסקי ואין Gelato commitment.

#### PRs ישנים שהוחלפו
- #80 נסגר והוחלף ב-#84.
- #81 נסגר והוחלף ב-#85.
- #82 נסגר והוחלף ב-#83.

#### Deploy verification
המיזוגים ל-`main` בוצעו, אבל דרך GitHub connector לא הופיעו workflow runs על merge commits #84/#85 בזמן הבדיקה. לכן אין לתעד כרגע “live verified” רק על בסיס merge.
לפני פתיחת חלון הניסוי יש לבצע אימות חי של:
- `/licensing/`
- `/business/`
- Admin UTM builder
- GA events הרלוונטיים
- טופס B2B end-to-end ללא שליחת PII ל-GA

#### Business-model experiment
היעד הבא הוא **Acquisition Experiment 01**:
1. Free Guide
2. Personal Digital Licensing
3. B2B Wall Art

חלון המדידה המתוכנן: 7 ימים, ורק לאחר live verification של התשתית שמוזגה.

במהלך חלון הניסוי:
- לא משנים pricing.
- לא משנים hero.
- לא משנים checkout.
- לא מתחילים paid ads.
- לא מעמיקים Gelato.
- משתמשים ב-UTM בכל הפצה יזומה.
- בסוף השבוע בוחרים follow-up אחד בלבד.

#### Payment / Gelato guardrails
- `PAYMENTS_ENABLED=false` נשאר מחייב.
- PR #76 PayPal Orders v2 נשאר נפרד ואינו חוסם את הניסוי העסקי.
- Gelato נשאר אפשרות fulfillment בלבד; לא מקדמים אינטגרציה עמוקה לפני signal של print demand + margin/quality validation.

#### Strategy documentation
הענף `strategy/business-model-todo-clean-2026-10-01` נפתח מחדש מ-`main` הנוכחי כדי להחליף את PR #78 הישן והמסוכסך.
המטרה: להכניס ל-`main` מקור אמת אחד ל-`TODO.md`, acquisition playbook ו-Acquisition Experiment 01, לאחר יישור הסטטוסים למה שכבר מוזג.



### Business-model strategy source of truth — 1.10.2026

המסמכים הבאים יושרו לסטטוס בפועל לאחר מיזוגי #79/#83/#84/#85:
- `TODO.md`
- `docs/acquisition-playbook-2026-10-01.md`
- `docs/acquisition-experiment-01-2026-10-01.md`

הסטטוס העדכני:
- measurement, UTM builder, Digital Licensing ו-B2B כבר מוזגו ל-`main`.
- ניסוי Acquisition Experiment 01 עדיין **לא התחיל**.
- launch gate שנותר: live verification של העמודים/אירועים לאחר deploy.
- לאחר האימות מתחיל חלון 7 ימים ללא שינויי pricing/hero/checkout.
- בסוף 7 ימים בוחרים follow-up אחד בלבד לפי הנתונים.
- `PAYMENTS_ENABLED=false` נשאר.
- PayPal PR #76 ו-Gelato אינם חלק מהפעלת הניסוי.

PR #78 הישן מבוסס על base מיושן והוא מוחלף בענף:
`strategy/business-model-todo-clean-2026-10-01`.



### Business-model docs merged + live verification status — 1.10.2026

- PR #87 (business-model TODO / acquisition playbook / Experiment 01) merged to `main`.
- `TODO.md` is now the current business-model execution source of truth.
- Acquisition Experiment 01 remains **not launched** until live verification is complete.
- Attempts to verify `https://amitphotos.com/licensing/`, `/business/` and `/admin.html` from the current ChatGPT environment were blocked by network/DNS access.
- Opera Browser Connector was available as a capability but the browser was not connected (`Allow AI connection` disabled/not connected), so no claim of live verification is made.
- This does **not** roll back or change the merged code; it only means the launch gate remains open.

### PR #77 photo-strength QA replacement — 1.10.2026

PR #77 was based on an older `main` and is being replaced by a clean branch from current `main`.

QA found two concrete bugs in the old draft:
- `src/instagram_post.py` called `save_social_photo_mapping(...)` without importing it — runtime `NameError` after a successful Instagram publish.
- `src/weekly_report.py::build_reel_summary()` used `post_lookup` without defining it — runtime `NameError` when building reel summaries.

Clean replacement fixes both and keeps the pipeline advisory-only:
- persists Instagram/Facebook post → photo mapping;
- stores per-photo website analytics in GA report history;
- builds `data/photo_strength_report.json` conservatively;
- does **not** auto-reorder the public gallery;
- low-sample photos stay low confidence;
- adds compile checks + unit tests for the wiring.

No payment, checkout, Gelato or gallery-order behavior is changed.



### Photo-strength pipeline merged — 1.10.2026

- PR #88 merged to `main` after both relevant checks passed:
  - Python Data Tests ✅
  - Lead Funnel CI ✅
- Merge commit: `d9295bcebc2726caaa385229fd2a5d2359b36493`.

What is now in `main`:
- persistent social post → photo mapping for Instagram/Facebook;
- per-photo website analytics stored in weekly GA history;
- conservative `data/photo_strength_report.json`;
- confidence penalties for low-sample photos;
- `featured_review_shortlist` for editorial review;
- no automatic public-gallery reorder;
- compile + unit tests for the pipeline wiring.

Important:
- this pipeline is advisory only.
- do not use a low-sample score as a merchandising decision.
- `PAYMENTS_ENABLED=false` remains unchanged.
- no PayPal/Gelato behavior changed.

Next business gate remains live verification of the already-merged acquisition stack before launching Acquisition Experiment 01.



### Fulfillment guardrail — 1.10.2026

החלטה מפורשת: **לא מקדמים Gelato בשלב הנוכחי**.

עד להחלטה חדשה:
- אין אינטגרציית Gelato חדשה.
- אין checkout להדפסות שמסתמך על Gelato.
- אין בחירת ספק fulfillment או אוטומציית הזמנות הדפסה.
- ניסויי המודל העסקי מתמקדים ב-Free Guide, Digital Licensing ו-B2B.
- Print יכול להישאר כרעיון/מדד ביקוש בלבד, ללא התחייבות לספק fulfillment.
- `PAYMENTS_ENABLED=false` נשאר ללא שינוי.



### PayPal reactivation plan — 1.10.2026

החלטת עבודה:
- PayPal Production **לא חוזר עכשיו**.
- Acquisition Experiment 01 רץ קודם עם payments off כדי למדוד demand נקי.
- checkpoint ראשון להחלטה: סביב 10.10.2026, אחרי 7 ימים מלאים של תנועה עם UTM.
- זו נקודת החלטה בלבד, לא תאריך הפעלה אוטומטי.

קריטריונים ראשוניים ל-Digital-only canary:
- לפחות 20 qualified sessions ב-/licensing/;
- לפחות 3 digital purchase-intent actions או intent rate של 10%+;
- attribution ו-GA events עובדים;
- PR #76 נבנה מחדש מ-main הנוכחי ועובר שוב Sandbox E2E/security.

Guardrail חשוב:
- לא הופכים את PAYMENTS_ENABLED הגלובלי ל-true, כי הוא פותח גם legacy print paths.
- לפני Production צריך flag נפרד כגון DIGITAL_PAYPAL_ENABLED.
- legacy print/Gelato נשארים כבויים.
- Gelato מחוץ לתוכנית הנוכחית.

נוסף מסמך:
- `docs/paypal-reactivation-gate-2026-10-01.md`

נוסף גם שדרוג ל-health-check:
- תיקון thumbnail URL יחסי.
- smoke checks ל-/licensing/ ול-/business/.
- בדיקת Admin UTM builder.
- בדיקה אוטומטית ש-/api/payments-status מחזיר enabled=false.


### Live acquisition smoke verification passed — 1.10.2026

GitHub Actions `Business Live Verification` עבר בהצלחה מול האתר החי.

אומת בפועל:
- `/licensing/` נטען ומכיל:
  - `licensing_personal_interest`
  - מקור המחירים `/api/admin/prices`
  - GA measurement marker
- `/business/` נטען ומכיל:
  - `b2b_contact_start`
  - `amit_b2b_context`
  - analytics helper
- `/admin.html` לאחר cache-busting redirect מכיל את UTM builder.
- `/api/payments-status` מחזיר `enabled=false`.
- thumbnail ציבורי לדוגמה נטען בהצלחה אחרי תיקון URL יחסי.

תוקנו תוך כדי שני false negatives ב-health verification:
1. Admin מחזיר redirect עם `_v`, ולכן הבדיקה צריכה `curl -L`.
2. `set -o pipefail` + `grep -q` יצר Broken Pipe אחרי match; הוחלף ב-here-string.

מה עדיין לא מסומן כמאומת:
- receipt בפועל של אירועי licensing/B2B בתוך GA/weekly report.
- לכן Acquisition Experiment 01 עדיין לא מתחיל עד אימות analytics receipt.

PayPal נשאר כבוי.
Gelato נשאר מחוץ לתוכנית.


### Professional photo curation review added — 1.10.2026

נוסף מסלול ביקורת מקצועי לתמונות, בנפרד מ-photo-strength analytics.

מטרת הבדיקה:
- לאתר תמונות חלשות טכנית או קומפוזיציונית;
- לאתר near-duplicates / סצנות חוזרות;
- לבדוק האם קטגוריות גדולות מדי או לא עקביות;
- להפריד בין קטגוריית נושא לבין location collection ו-style tags;
- לזהות תמונות עם resolution נמוך, metadata חסר או התאמה חלשה ל-licensing/B2B;
- להמליץ KEEP / KEEP_SECONDARY / REVIEW_DUPLICATE / REVIEW_CATEGORY / REVIEW_TECHNICAL / ARCHIVE_CANDIDATE / HIDE_CANDIDATE / LEGAL_REVIEW.

Guardrail:
- אין מחיקה אוטומטית.
- אין hide אוטומטי.
- החלטה להסיר תמונה מהפורטפוליו הציבורי דורשת visual review בפועל.

Snapshot נוכחי:
- 1,390 תמונות.
- 27 קטגוריות.
- 120 ללא description.
- 142 rows בתוך קבוצות title חוזרות.
- 650 ללא parent_category.
- 78 תמונות עם long edge < 2000px או short edge < 1200px — מועמדות לבדיקה, לא להסרה אוטומטית.
- 164 ללא EXIF.
- photo-strength עדיין waiting_for_mapped_data ולכן לא משתמשים בו כרגע לדירוג מלא.

ממצא taxonomy:
המערכת מערבבת באותה רמה subject/genre (למשל בעלי חיים, צילום מופשט) עם geography (ישראל, גאורגיה, איטליה וכו') ו-style (שחור-לבן). הכיוון המומלץ הוא:
- primary visual category
- collection/location נפרד
- style tags

קטגוריות ראשונות ל-review:
1. פרחים וצמחים
2. בעלי חיים
3. ישראל
4. צילום מופשט
5. מאקרו-צילומי תקריב

נוספו:
- `docs/photo-curation-review-2026-10-01.md`
- `src/photo_catalog_audit.py`
- `tests/test_photo_catalog_audit.py`
- `.github/workflows/photo-catalog-audit-ci.yml`

הבדיקה הזו לא תלויה ב-PayPal או Gelato ולא משנה public gallery ordering אוטומטית.



### Admin flower-curation pilot — 1.10.2026

הוחלט שקטגוריית `פרחים וצמחים` היא הפיילוט הראשוני לתהליך הקיורציה.

בענף:
`feature/admin-flower-curation-pilot-2026-10-01`

נוסף:
- `data/flower-curation-pilot.json` — דוח פרטני ל-162 תמונות.
- סימוני Admin לכל תמונת פיילוט.
- פילטרים:
  - פיילוט פרחים
  - לבדיקה
  - עדיפות גבוהה
  - כפילויות לבדיקה
  - רזולוציה לבדיקה
- badge על כרטיסי התמונות.
- דוח פרטני מתוך תפריט התמונה עם:
  - recommendation
  - priority
  - resolution
  - filename
  - reasons
  - הנחיית פעולה.
- פתיחה מהדוח למסך עריכת התמונה.

Snapshot:
- 162 תמונות בפיילוט.
- 43 מסומנות עם לפחות flag אחד.
- 12 בעדיפות גבוהה.
- 17 מועמדות עקב כותרת כפולה.
- 6 מועמדות כ-probable file duplicate.
- 8 מועמדות לבדיקת רזולוציה.
- 18 ללא description.
- 23 ללא EXIF.

Guardrails:
- אין hide אוטומטי.
- אין delete אוטומטי.
- כל המלצה דורשת visual review.
- הסתרה תתבצע רק בהחלטה ידנית דרך published=0.
- מחיקה נשארת destructive action נפרדת עם confirmation.

המטרה: להשתמש בפיילוט הפרחים כדי לכייל את תהליך הסימון, הדוח והחלטות הקיורציה לפני הרחבה לקטגוריות נוספות.


### Flower curation pilot in Admin — 1.10.2026

הוחלט שקטגוריית **פרחים וצמחים** תהיה פיילוט ראשון לתהליך קיורציה מקצועי באדמין.

מטרת הפיילוט:
- לסמן באדמין תמונות שמומלץ לבדוק;
- להציג סיבה מפורטת לכל סימון;
- להבדיל בין recommendation לבין החלטה סופית;
- לקבל החלטה ידנית אם KEEP / KEEP_SECONDARY / HIDE / DELETE / שינוי קטגוריה.

נוצר דוח פיילוט:
- `data/flower-curation-pilot.json`
- 162 תמונות בקטגוריה.
- 43 תמונות עם לפחות flag אחד.
- 12 high-priority review candidates.
- 17 מועמדות בגלל duplicate title.
- 6 מועמדות בגלל probable file duplicate / copy variant.
- 8 מועמדות בגלל low resolution ל-Licensing.
- 18 ללא description.
- 23 ללא EXIF.

Guardrails:
- אין מחיקה אוטומטית.
- אין hide אוטומטי.
- אין שינוי published אוטומטי.
- אין שינוי קטגוריה אוטומטי.
- כל recommendation הוא review-only עד החלטה ידנית.
- מחיקה פיזית מ-R2/D1 מתבצעת רק לאחר אישור מפורש.
- הסתרה צריכה להיות reversible דרך `published=0` לפני ששוקלים מחיקה.

הכוונה ב-Admin:
- להוסיף מצב/פילטר "פיילוט קיורציה — פרחים וצמחים".
- להציג badge לפי recommendation כגון REVIEW_DUPLICATE / REVIEW_TECHNICAL / REVIEW_METADATA.
- להציג reasons פרטניים לכל תמונה.
- לאפשר מעבר מהיר ל-lightbox/עריכה לפני החלטה.
- לייצר דוח פרטני שמרכז recommendation + reason + החלטת בעל האתר.

הפיילוט נועד לבדוק את UX ואת איכות ההמלצות לפני הרחבה לקטגוריות נוספות.



### Flower curation owner-decision workflow — 1.10.2026

PR #93 (Draft) הורחב כך שהפיילוט אינו רק advisory אלא מאפשר החלטת בעלים ידנית ומתועדת.

נוסף:
- endpoint פנימי ומוגן auth: `/api/admin/curation-decisions`.
- persistence פיילוטי ב-`settings` תחת `flower_curation_decisions_v1` — ללא migration חדש ל-D1.
- החלטות נתמכות: `KEEP`, `KEEP_SECONDARY`, `HIDE`, `DELETE`, `CHANGE_CATEGORY`.
- recommendation נשאר נפרד מהחלטת הבעלים; שום recommendation לא מבצע פעולה אוטומטית.
- `HIDE` משתמש ב-`published=0` ולכן הפיך.
- `DELETE` נשאר פעולה נפרדת עם confirmation מפורש למחיקה לצמיתות.
- `CHANGE_CATEGORY` נשמר כהחלטה רק אחרי ששינוי קטגוריה אמיתי נשמר דרך מסך העריכה.
- נוסף מעבר ישיר ל-Lightbox מהדוח לפני החלטה.
- נוספו פילטרים `טרם הוחלט` / `הוחלט`.
- נוסף export של `flower-curation-owner-review.json` לכל 162 תמונות עם:
  - `photo_id`
  - `title`
  - `thumbnail`
  - `recommendation`
  - `reasons`
  - `resolution`
  - `current_published_status`
  - `final_owner_decision`
  - `final_category`
  - timestamp של ההחלטה.

Guardrails נשארו:
- אין hide/delete/change-category אוטומטי.
- אין שינוי אוטומטי בסדר הגלריה.
- visual review נדרש לפני החלטה אמנותית.
- PayPal/Gelato לא שונו.
- `PAYMENTS_ENABLED=false` נשאר ללא שינוי.
- PR #93 נשאר Draft עד QA.


### End-of-day handoff — Flower curation pilot — 1.10.2026

- PR #93 נשאר **Draft** ולא מוזג ל-`main`.
- כל ארבעת ה-checks האחרונים עברו:
  - Admin Flower Curation Pilot CI ✅
  - Admin Campaign Links CI ✅
  - Lead Funnel CI ✅
  - Business Live Verification ✅
- תוקן טסט ישן שהיה תלוי בניסוח מדויק של guardrail; לא הייתה רגרסיה התנהגותית.
- ה-Admin כולל כעת:
  - פילטר `פיילוט קיורציה — פרחים וצמחים`;
  - פילטר `עדיפות גבוהה`;
  - recommendation + reasons + resolution + published status;
  - פתיחה ל-Lightbox ולעריכה;
  - החלטות ידניות `KEEP / KEEP_SECONDARY / HIDE / DELETE / CHANGE_CATEGORY`;
  - persistence של final owner decision;
  - export מלא של דוח הפיילוט.
- לא בוצע שום `HIDE` או `DELETE` בפועל.
- אין שינוי אוטומטי בקטגוריה או בסדר הגלריה.
- `PAYMENTS_ENABLED=false` נשאר ללא שינוי.
- PayPal PR #76 נשאר נפרד ולא למזג.
- Gelato מחוץ לתוכנית.

### נקודת המשך למחר

1. להיכנס ל-Admin → תמונות.
2. לבחור `פיילוט קיורציה — פרחים וצמחים` ואז `עדיפות גבוהה`.
3. לבצע visual review ידני ל-12 התמונות בעדיפות גבוהה.
4. לכל תמונה לבחור רק אחרי צפייה: `KEEP`, `KEEP_SECONDARY`, `HIDE`, `DELETE` או `CHANGE_CATEGORY`.
5. אם יש ספק — להשאיר REVIEW ולא להסתיר/למחוק.
6. אחרי סיום 12 התמונות: לייצא `flower-curation-owner-review.json` ולעבור על התוצאות לפני הרחבה לקטגוריה נוספת.

מצב branch בסיום היום: `feature/admin-flower-curation-pilot-2026-10-01`; PR #93 Draft; head `3d3982b18f8ab3dbd7375ae02c3497d5353aca77`.


### Drive sync preservation guard — Flower curation — 2.10.2026

נבדקה שרשרת Google Drive → `data/photos.json` → D1/R2 כדי לוודא שהחלטות ידניות באדמין נשמרות.

ממצאים:
- `title` / `description` / `category` שנערכים באדמין נשמרים ב-D1, שהוא המקור הראשי בגלריה, ולכן סריקת Drive לא דורסת אותם.
- `HIDE` נשמר כ-`published=0` ב-D1.
- נמצא פער: `auto_import_new_photos.py` קרא בעבר את `/api/photos` הציבורי ולכן לא ראה hidden photos; בנוסף, תמונה שנמחקה מ-D1 אך עדיין נשארה ב-Drive הייתה יכולה להיחשב חדשה ולהיות מיובאת מחדש.

תיקון:
- importer קורא מעכשיו `/api/photos?admin=1` עם auth, ולכן רואה גם `published=0` ולא מעלה hidden photos מחדש.
- importer קורא גם `/api/admin/curation-decisions` ומייצר tombstone לכל `DELETE`.
- Drive ID שסומן `DELETE` לא ייובא מחדש כל עוד החלטת הקיורציה נשמרת, גם אם הקובץ עדיין קיים ב-Google Drive.
- קריאת tombstones היא fail-closed: אם אי אפשר לקרוא את החלטות הקיורציה, הייבוא נעצר במקום להסתכן בהחזרת תמונה שנמחקה.
- ב-Admin נשמר `DELETE` tombstone לפני המחיקה מ-D1/R2; אם המחיקה נכשלת, ההחלטה הקודמת משוחזרת.

משמעות לעבודה הידנית:
- `KEEP` / `KEEP_SECONDARY`: נשמרים כהחלטת בעלים.
- `HIDE`: נשאר hidden גם אחרי הסריקה היומית.
- `CHANGE_CATEGORY`: הקטגוריה ב-D1 נשמרת ואינה נדרסת על ידי Drive.
- `DELETE`: לא חוזר לפרודקשן בריצה היומית, גם אם המקור נשאר ב-Drive.

אין שינוי ב-PayPal/Gelato, אין שינוי אוטומטי בסדר הגלריה.


### Admin navigation hotfix — 2.10.2026

לאחר מיזוג PR #93 התגלה שה-sidebar באדמין מוצג אך רוב הפריטים אינם מגיבים ללחיצה.

Root cause:
- ב-`admin.html` נכנסו בטעות שתי הצהרות פונקציה כפולות:
  - `function renderGrid() { function renderGrid() {`
  - `async function confirmDelete(id) { async function confirmDelete(id) {`
- השגיאה יצרה `SyntaxError: Unexpected token ')'` והפילה את כל סקריפט ה-JavaScript הראשי, ולכן listeners של `.nav-item` לא נרשמו.

Fix:
- הוסרו שתי הכפילויות בלבד.
- נוספה בדיקת Node שמוודאת שכל inline scripts של `admin.html` עוברים parsing לפני merge.
- אין שינוי בנתוני התמונות, בהחלטות הקיורציה, ב-PayPal או ב-Gelato.


### Admin navigation resilience follow-up — 2.10.2026

לאחר hotfix PR #94 בוצעה בדיקה חיה דרך Opera Browser Connector. ה-sidebar עדיין לא הציג click handlers באופן אמין, ולכן נוסף hardening נוסף:

- ניווט ה-Admin נקשר עכשיו בתחילת הסקריפט, לפני אתחול מודולי התמונות/לקוחות/אנליטיקה.
- כך תקלה עתידית במודול feature לא תשבית את הניווט כולו.
- נמנעת קשירה כפולה של handlers בהמשך הסקריפט.
- אם מתרחשת שגיאת JavaScript לא מטופלת, כותרת הטאב מסומנת ב-⚠ ובטקסט השגיאה לצורך אבחון מיידי.
- אין שינוי בנתוני תמונות, החלטות קיורציה, תשלומים או Gelato.


### Flower curation scoring + reversible production hide — 2.10.2026

Owner approved moving clearly problematic flower images out of production and assigning scores across the full pilot.

Scoring:
- Added `data/flower-curation-scores.json` for all 162 flower photos.
- 12 photos already inspected visually receive a full 0–100 visual score.
- Remaining 150 receive a clearly labeled `technical_provisional` score only.
- Provisional technical formula: 55% resolution, 30% uniqueness/duplicate risk, 15% metadata completeness.
- Visual formula: 25% sharpness, 20% composition, 15% light/color, 15% resolution, 10% uniqueness, 10% category fit, 5% metadata.
- Admin now shows score badges: `V` = full visual review, `T` = technical provisional.
- Added filters for score <60 and visual-review-complete, plus score fields in the curation dialog/export.

Approved production HIDE actions (reversible; no DELETE):
- חמניות צהובות — `15h8IlkqnlorfEseEFBHjNikOSgMvsCQ_`
- זרעים של דנדליון — `1Tpaw2ooFcWip-poF5_tXOxN1K-PQHpWA` (weaker duplicate)
- עלים ירוקים בשמש — `1yu2k9PJbstdauHCz0dVbM9QMNSiPR-lI` (duplicate variant)
- פרח דליל סגול — `1PcDKeeJvmjYmuSALPGTVgclA0mmup8z7` (duplicate variant)

A dedicated GitHub Action applies only HIDE, records owner decision HIDE, and verifies the four IDs are `published=0` and absent from the public gallery. It contains no DELETE action.

Important: technical provisional scores are not artistic verdicts. Continue visual review before additional HIDE/DELETE/category actions.


### Flower HIDE workflow auth follow-up — 2.10.2026

The first production HIDE run failed before changing any photo because the GitHub `ADMIN_PASSWORD` secret returned HTTP 403 against the live Admin API.

The HIDE workflow was changed to use the existing Cloudflare deployment credentials and update D1 directly:
- only `published=0` for the four approved photo IDs;
- preserves the four `HIDE` owner decisions inside `flower_curation_decisions_v1` using SQLite JSON functions;
- purges Cloudflare cache;
- verifies all four rows are `published=0`;
- verifies none of the four IDs appears in the public `/api/photos` response.

No DELETE or R2 removal is performed.


### Admin review cue for flower scores 0–89 — 2.10.2026

Added a non-destructive Admin cue for the 29 flower photos currently scored below 90:
- new filter chip: `⚠ לבחינה 0–89 (29)`;
- each scored photo below 90 shows a separate `⚠ לבחינה` badge next to its V/T score;
- wording is intentionally review-oriented, not an automatic quality verdict;
- no photo is hidden, deleted, recategorized, or reordered by this change.


### Flower review overlay in Admin — 2.10.2026

Improved the 0–89 review cue in the photo grid:
- every flower photo scored below 90 now shows a visible overlay directly on the image: `⚠ לבחינה <score>`;
- overlay sits at the top-left of the thumbnail, avoiding the selection checkbox at top-right and Pinterest badge at bottom-left;
- V/T numeric score remains in the title area for detail;
- the separate text `⚠ לבחינה` badge was removed from the title area to avoid duplication;
- the `⚠ לבחינה 0–89 (29)` filter remains unchanged;
- no photo state, category, ordering, HIDE, or DELETE action is changed.


### Flower Review Mode MVP — 2.10.2026

Added a guided manual review workflow for the 29 flower photos scored 0–89.

Admin behavior:
- new `▶ מצב Review reviewed/total` control;
- review queue is sorted lowest score first;
- dialog shows progress `נבדקו X מתוך 29` with a progress bar;
- full score-component breakdown is shown when available;
- large action buttons: KEEP / SECONDARY / HIDE / CHANGE_CATEGORY;
- after a successful decision, Review Mode advances automatically to the next undecided image;
- `דלג לתמונה הבאה` leaves the current photo undecided and moves on;
- reviewed thumbnails change from `⚠ לבחינה` to `✅ נבדק`;
- completion closes Review Mode and reports that all candidates were reviewed.

Safety:
- HIDE still requires the existing explicit confirmation and remains reversible via `published=0`;
- DELETE remains outside the large Review Mode action row and still requires its destructive confirmation;
- scores do not auto-hide, auto-delete, auto-recategorize or auto-reorder photos.


### KEEP_SECONDARY public-gallery behavior — 2.10.2026

`KEEP_SECONDARY` now has a concrete public-site meaning:
- the photo stays published and remains in its current category;
- it is moved behind regular / KEEP photos in the public gallery;
- existing manual / newest ordering is preserved inside the primary tier and inside the secondary tier (stable partition);
- category filtering inherits the same behavior because the public API ordering is preserved by the gallery client;
- Featured ordering is intentionally unchanged for now;
- Admin ordering is unchanged;
- changing a curation decision invalidates the cached public photo response so the new ordering can appear immediately;
- Drive scan behavior is unchanged: KEEP_SECONDARY remains an owner decision and the Drive source file is untouched.

No HIDE, DELETE, category change, or payment behavior is triggered by KEEP_SECONDARY.


### Gallery taxonomy consolidation — 2.10.2026

Business decision implemented at the public-navigation layer:
- 7 subject galleries remain top-level.
- `מקומות בעולם` is the 8th primary destination and contains all 18 geographic categories.
- Added missing `גאורגיה` to the location grouping.
- `שחור-לבן` and `צילומי לילה` are shown in a separate Style row instead of as primary galleries.
- All 1,390 photos remain available; this is a discovery/navigation change, not content deletion.
- Google Drive remains the master archive. No file was deleted, moved or renamed in Drive.
- Added `data/gallery-taxonomy.json` and `docs/gallery-taxonomy-business-2026-10-02.md` as the canonical taxonomy snapshot.

Curation direction:
- flower-pilot workflow is the template for rollout to other galleries;
- owner decisions are preserved;
- KEEP_SECONDARY remains public but at gallery tail;
- HIDE remains reversible;
- no automatic Drive deletion.


### All-gallery visual scoring policy — 2.10.2026

Owner approved expanding the successful flower-pilot curation model to the rest of the portfolio.

Scoring policy:
- preserve existing owner-reviewed decisions; do not overwrite photos the owner already reviewed;
- all remaining photos must receive actual visual review for sharpness, composition, and light/color before those components are scored;
- missing visual review must display `טרם נבדק`, never misleading `0/100`;
- full weighted score is authoritative only after visual components are populated;
- owner Review queue contains only score <=85 or materially problematic photos;
- score >85 does not require owner confirmation;
- low-resolution below the approved threshold may be auto-HIDE (reversible) but never auto-DELETE;
- Google Drive remains the untouched master archive.

This policy supersedes the earlier technical-provisional-only display as the target rollout model.


### Admin null visual-score display fix — 2.10.2026

- technical provisional visual components are intentionally null until actual visual review;
- Admin no longer converts null to misleading 0/100;
- null visual components now display `טרם נבדק`;
- real numeric components continue to display their actual score;
- no underlying score data was changed.


### Full-portfolio visual curation rollout — 2.10.2026

PR #105 merged to `main` (squash merge `6feb0e658ce1e59646cac495292bbc619218ab96`).

What changed:
- The flower-pilot scoring model is now generalized to all 1,390 photos through `data/portfolio-curation-scores.json`.
- Existing completed flower visual reviews are preserved; owner decisions are not overwritten.
- Remaining photos start with `score_kind=pending_visual`.
- Sharpness, composition, light/color and category-fit stay `null` until an actual Claude Vision review is completed. Admin shows `טרם נבדק`, never a misleading 0/100.
- Full score formula remains:
  - 25% sharpness
  - 20% composition
  - 15% light/color
  - 15% resolution
  - 10% uniqueness
  - 10% category fit
  - 5% metadata
- Owner Review queue now follows the approved rule: only completed visual scores <=85 or a material problem enter Review.
- Scores >85 do not require owner confirmation.
- Admin export is now full-portfolio: `portfolio-curation-owner-review.json`.
- New incremental workflow: `.github/workflows/portfolio-visual-curation.yml`, default batch 200 still-unreviewed photos per run, with completed reviews preserved between runs.
- CI: Portfolio Visual Curation, Portfolio Visual Curation CI, Admin Flower Curation Pilot CI, Admin Campaign Links CI and Python Data Tests were green before merge.

Initial portfolio snapshot at merge:
- total: 1,390
- visual_complete preserved from flower pilot: 12
- pending_visual: 1,378
- initial owner-review-required among preserved completed scores: 11
- initial completed score >85 and clear: 1
- critical low-resolution candidates under the conservative threshold (long edge <1200 or short edge <800): 42

Safety / next step:
- The scoring pipeline itself is advisory and does not change D1/R2, category, published state or Google Drive.
- It performs no automatic DELETE.
- Automatic low-resolution HIDE has NOT yet been connected in PR #105. Keep it as a separate reversible production action so it can explicitly protect any existing KEEP / KEEP_SECONDARY owner decisions.
- Google Drive remains the untouched master archive.
- PAYMENTS_ENABLED remains false; PayPal PR #76 and Gelato remain separate/out of scope.


### Critical low-resolution auto-HIDE — 2.10.2026

PR #106 added the reversible auto-HIDE policy for critically low-resolution photos.
Its first production run stopped before changing any photo because the Cloudflare deployment token could not read D1 directly.

Hotfix PR #108 then moved the production action to the existing authenticated Admin API and merged as:
`22b8a5d969057bcb86893d153e43f7b59a47714e`.

Final production result:
- critical candidates under threshold (long edge <1200px OR short edge <800px): 42
- existing owner decisions found overall: 30
- critical candidates protected because they already had an owner decision: 6
- eligible critical candidates: 36
- actually HIDDEN: 36
- late protected during per-photo recheck: 0
- public-gallery verification: all 36 applied IDs are absent ✅
- DELETE operations: 0
- Google Drive changes: 0
- public cache purge: success

Safety behavior:
- any existing owner decision protects a photo from the resolution automation;
- HIDE is applied only through `published=false` and a stored HIDE curation decision;
- owner decisions are re-checked immediately before every individual mutation;
- if saving the HIDE decision fails after publication is changed, the workflow attempts to roll `published` back to true;
- no file is removed from R2 or Google Drive.

The visual-scoring workflow from PR #105 is independent of this resolution action and continues filling real visual scores incrementally.


### Business + PayPal progression — 2.10.2026

Acquisition Experiment 01:
- PR #109 merged to `main` as `73061ad1c2710fd6dd1f14d954b6fa93b1d737f3`.
- Business Live Verification now includes `/free-guide/` in addition to `/licensing/`, `/business/`, Admin UTM builder and payments-disabled guardrail.
- Technical launch gate is complete.
- The experiment is **launch-ready**, but the 7-day clock has NOT started yet because no first distribution action has been published/sent.
- No paid traffic, no automatic social publishing, no mass outreach.

PayPal Orders v2:
- Old PR #76 remains unmerged and should be treated as superseded for implementation purposes because it accumulated unrelated historical changes and is no longer suitable to merge onto current `main`.
- Clean replacement Draft PR #110 was created from current `main`.
- It preserves the previously validated PayPal security architecture: server-side Orders v2 create/capture, authoritative amount/currency/order identity checks, idempotency, rate limiting, duplicate capture recovery, verified webhook signature + dedup/recovery, isolated Sandbox staging, and permanent 410 for the legacy insecure completion endpoints.
- `PAYMENTS_ENABLED=false` remains unchanged.
- No checkout UI, PayPal Live, print activation or Gelato activation is included.
- PR #110 latest focused checks are all green: PayPal Orders v2 CI, Lead Funnel CI, Digital Licensing CI and B2B Funnel CI.
- The earlier unrelated full Node-suite failures were stale Admin dialog-count and homepage cache-busting expectations, not PayPal security failures.
- PR #110 remains Draft; do not merge or enable production payments until the deliberate next gate.


### PayPal Orders v2 merged safely — 2.10.2026

PR #110 merged to `main` as `f4f1f4438f1c4bd33e69f357ac2e7f21fe2c7e7f`.

Post-merge verification:
- Deploy Worker ✅
- Pages build/deployment ✅
- PayPal Orders v2 CI ✅
- Cloudflare deploy log explicitly shows `PAYMENTS_ENABLED: "false"` ✅
- Production D1 binding remains `amit-photos-db`.
- Production R2 binding remains `amit-photos-images`.
- Cache purge succeeded.
- Public PayPal create/capture routes remain fail-closed because the production flag is false.
- Legacy insecure payment completion endpoints remain permanently retired with HTTP 410.
- No PayPal Live activation and no Gelato activation occurred.

Acquisition Experiment 01:
- launch package merged in PR #111.
- Technical setup is complete.
- The 7-day window has not started because no real distribution action has been published/sent yet.
- First recommended distribution path remains Free Guide / Instagram.


### Continuation checkpoint — 2.10.2026

Current `main`: `44b958e94ee5c59c7cc215df263d0eb026aa5329`.

Verified after the PayPal merge and subsequent automation:
- latest Pages build/deployment on current main: success ✅
- scheduled automatic photo update run `37001467768`: success ✅
- PayPal Orders v2 remains merged and production payments remain disabled;
- Acquisition Experiment 01 remains technically launch-ready;
- the 7-day acquisition measurement window has **not** started because no real distribution action has been published/sent yet.

Documentation correction:
- PR #110 is now the canonical PayPal Orders v2 implementation merged to main.
- old PR #76 is superseded and must not be treated as the active implementation path.

Next execution order:
1. Keep production PayPal disabled.
2. Start Acquisition Experiment 01 with the Free Guide as the first distribution path when an actual external post/share is made.
3. Record the exact first-distribution timestamp as Day 1.
4. Keep campaign URL, offer, consent text, Free Guide asset and primary KPI frozen for the 7-day window.
5. Continue portfolio visual curation and owner review independently; do not let curation work alter the acquisition experiment variables.


### Acquisition Experiment 01 scorecard — 2.10.2026

PR #112 merged to `main` as `41a92befbf84def7dc2fa05c525fc78fbf8e2d26`.

What was added to the existing weekly GA report:
- campaign-level event attribution using `eventName + sessionCampaignName`;
- only the three frozen Acquisition Experiment 01 campaigns are included;
- deterministic scorecard for:
  - Free Guide — primary `guide_request_success`, secondary `generate_lead`;
  - Personal Licensing — primary `licensing_personal_interest`, secondary `purchase_intent`;
  - B2B Wall Art — primary `b2b_contact_start`, secondary `contact_form_success`;
- sessions, active users, primary-event count/rate and secondary-event count are persisted in `data/ga_reports.json`;
- the scorecard is included in the weekly email;
- no new workflow was added; the existing weekly GA workflow remains the single reporting path.

Validation before merge:
- Python Data Tests ✅
- Lead Funnel CI ✅

Experiment state is still **not started** until the first real external distribution action is actually published/sent.
Production payments remain disabled.


### Acquisition Experiment 01 launched — 2.10.2026

The first real distribution action is now verified live on Instagram.

Verified directly from the connected Instagram account `amite`:
- story id: `17882329722524331`
- published at: `2026-10-02T12:03:19Z`
- local Israel time: `2026-10-02 15:03:19 Asia/Jerusalem`
- channel/path: Free Guide / Instagram Story
- campaign: `202610_freeguide_photo_tips`

This timestamp is the official Day 1 start of Acquisition Experiment 01.
The 7-day measurement window is now active.

Freeze rules remain in force during the window:
- do not change destination pages;
- do not change campaign names;
- do not change primary KPI;
- do not change the core offer, licensing prices, consent wording, or Free Guide asset;
- do not add paid traffic or production PayPal.

Production payments remain disabled.


### Personal Licensing distribution — 2.10.2026

Second Acquisition Experiment 01 path published and verified on Threads:
- account: `Amit Erez (amite)`
- post id: `17906411154574588`
- permalink: `https://www.threads.com/@amite/post/Dd_dv6lDZUX`
- published at: `2026-10-02T12:17:23Z`
- local Israel time: `2026-10-02 15:17:23 Asia/Jerusalem`
- campaign: `202610_licensing_personal`
- UTM source/medium: `threads / social`

This is the second live distribution action.
The experiment's Day 1 clock remains anchored to the earlier Free Guide Instagram Story at 15:03:19 Israel time.


### Full-image visual curation merged — 2.10.2026

PR #107 `fix: use full images for visual curation scoring` was squash-merged to `main` as:
`e93dc43f5d71364375ae8eb8f0666939f6ba5052`.

What is now active:
- visual scoring starts from the full portfolio image, not the thumbnail;
- full images are normalized to a high-quality 1800px JPEG for Vision review;
- sharpness, composition, light/color and category-fit therefore use a materially better review source;
- rollout proceeds gallery-by-gallery;
- owner-review threshold remains <=85 or material problem;
- no automatic DELETE, category mutation, Google Drive mutation, or publication change is introduced by this scoring pipeline.

Post-merge workflow:
- Portfolio Visual Curation run `37008370236`;
- tests job: success ✅;
- score job: started automatically and is currently processing the next gallery batch;
- Pages deployment also started from the same merge commit.

Production payments remain disabled with `PAYMENTS_ENABLED=false`.
Acquisition Experiment 01 remains in its active 7-day measurement window and its frozen variables must not be changed.


### Maintenance cleanup — 2.10.2026

Completed:
- legacy PR #76 was closed without merge; PR #110 remains the canonical PayPal Orders v2 implementation;
- `TODO.md` was synced to the real acquisition state: Instagram Free Guide + Threads Personal Licensing live, B2B pending, 7-day freeze active;
- production payments remain disabled with `PAYMENTS_ENABLED=false`.

Open maintenance PR:
- PR #113 `chore: remove duplicate Spain and Andorra category key`;
- scope: one-file cleanup in `worker.js`;
- removes the duplicate `ספרד ואנדורה` key from `HE_TO_EN_CATEGORY`;
- surviving value is identical, so no behavior change is intended;
- no acquisition variables, payments, D1/R2 data, or Google Drive content are changed;
- CI was started and must be green before merge.


### Maintenance PR #113 merged — 2.10.2026

PR #113 `chore: remove duplicate Spain and Andorra category key` was squash-merged to `main` as:
`a798cc10a77f42eae01ae09bec4157ac5888f42b`.

Pre-merge CI:
- Lead Funnel CI ✅
- PayPal Orders v2 CI ✅

Change:
- removed the duplicate `ספרד ואנדורה` key in `worker.js`;
- surviving mapping value is unchanged;
- intended behavior change: none;
- removes the Wrangler duplicate-object-key warning source.

No acquisition experiment variables, production payment state, D1/R2 data, or Google Drive content were changed.


### Free Guide email-delivery reliability fix — 2.10.2026

User reported that the Free Guide signup appeared successful but no automatic email arrived.

Verified:
- Gmail contained no recent automatic Free Guide PDF message to the connected account;
- other Amit Photos emails from contact@amitphotos.com do arrive, so the symptom is specific to the Free Guide delivery path;
- the live /free-guide/ page is rendered by handleFreeGuide() in worker.js;
- existing-subscriber delivery previously swallowed Resend failures and still returned HTTP 200 / UI “Sent”.

PR #114 `fix: surface free-guide email delivery failures` was merged to main as:
`7fec9abd7c7eafa1877ff933b195a08f83c96845`.

Fix now live:
- Resend success/failure is checked for both new and existing subscribers;
- API returns `email_sent`, `email_delivery_attempted`, and a direct `download_url` for guide requests;
- Free Guide UI shows “Sent” only when the provider accepted the email;
- on delivery failure, signup still remains saved and the user gets a direct PDF download fallback;
- Lead Funnel CI now runs subscriber confirmation-email regression tests;
- explicit Resend 4xx regression tests cover both new and existing subscribers.

Pre-merge CI:
- Lead Funnel CI ✅
- PayPal Orders v2 CI ✅
- confirmation-email regression suite ✅

Production deploy:
- Deploy Worker run #461 / run id 37017099130 ✅
- Wrangler deploy ✅
- Cloudflare cache purge ✅

Important limitation:
- this fixes false-success reporting and guarantees a direct-download fallback, but the underlying Resend provider rejection/secret/domain cause is not yet independently confirmed from provider logs in this session.
- PAYMENTS_ENABLED remains false.
- Acquisition Experiment 01 offer/copy/UTM/primary KPI remain unchanged.


### Free Guide email root cause fixed and production-verified — 2.10.2026

Root cause confirmed:
- `RESEND_API_KEY` existed in GitHub Actions, but the production Cloudflare Worker had no `RESEND_API_KEY` binding;
- deploy logs before the fix listed DB, PHOTOS and PAYMENTS_ENABLED only;
- Resend showed no `POST /emails` calls from the Free Guide flow on the failure day;
- `amitphotos.com` is verified in Resend with sending enabled;
- the recipient address used for verification was not suppressed.

Fixes:
- PR #115 added secure sync of the existing GitHub Actions `RESEND_API_KEY` into the Worker using `wrangler secret put`;
- the first ordering attempt failed because Cloudflare requires the latest Worker version to be deployed before modifying secrets;
- PR #116 reordered deploy to: Worker deploy -> Resend secret sync -> cache purge;
- merge SHA for #116: `71583be0e839b9e8feac9f8cfc4ab6faa9c321fb`;
- Deploy Worker run #463 / run id `37018703520` completed successfully, including:
  - Deploy with Wrangler ✅
  - Sync Resend secret to Worker ✅
  - Cloudflare cache purge ✅

Live production smoke:
- a real `lead_magnet` signup was submitted with privacy consent and `consent_marketing=false`;
- smoke run `37019025883` passed and verified `email_sent=true` plus `email_delivery_attempted=true`;
- Resend recorded subject `הנה ה-PDF שלך — 50 טיפים לצילום` with status `delivered`;
- Gmail independently showed the same message in INBOX;
- no marketing consent was added by the test.

The temporary smoke workflow was removed after verification.
Production payments remain disabled with `PAYMENTS_ENABLED=false`.
Acquisition Experiment 01 offer/copy/UTM/primary KPI remain unchanged.


### Free Guide redesign — bilingual visual edition — 2.10.2026

Goal:
- replace the old `50tips-heb.pdf` and `50tips-eng.pdf` assets with a significantly more visual, beginner-friendly edition;
- preserve the existing file names/URLs so current signup/download flows continue to work;
- use the replacement moment as the new measurement baseline for the Free Guide asset;
- drive measurable return traffic from the PDF into relevant educational and portfolio pages.

Implementation branch:
- `feature/free-guide-redesign-2026-10-02`
- PR #117: `feat: redesign bilingual photography free guide`

What changed:
- both Hebrew and English guides rebuilt as 13-page photography-magazine style PDFs;
- 50 tips organized into visual chapters: composition, light/exposure, focus/sharpness, depth-of-field/macro, motion/timing, landscape/architecture, portrait/storytelling, night/color, black-and-white/editing;
- cover, chapter photography, practice page, and resource/end page use Amit's own portfolio images;
- image selection restricted to photos already marked:
  - `visual_complete`
  - score > 85
  - `owner_review_required=false`
  - `material_problem=false`
- contextual “why this works” explanations were added on chapter images;
- language was rewritten for beginner photographers, with shorter explanations and reduced unexplained jargon;
- a short beginner glossary was added;
- supported technical terms inside the PDF are themselves clickable, linking to the matching guide on amitphotos.com;
- examples include ISO/aperture/shutter speed/exposure, histogram, focus/continuous focus, depth of field, macro, white balance, panning, portrait, black-and-white, crop/editing;
- chapter-level “read the full guide” links remain available in addition to term-level links;
- end page links to:
  - galleries: `/#gallery`
  - all photography guides: `/camera/`
  - photo analysis/learning: `/learn/`
  - photography locations in Israel: `/locations/`
  - photography videos: `/videos/`

Measurement:
- PDF outbound links use:
  - `utm_source=free_guide`
  - `utm_medium=pdf`
  - `utm_campaign=202610_freeguide_photo_tips`
  - per-link `utm_content` values;
- final successful build contained:
  - Hebrew: 13 pages, 70 clickable links;
  - English: 13 pages, 71 clickable links;
- replacement of the live PDFs should be treated as the new Day 1 / baseline for evaluating the redesigned guide's downstream site engagement.

Build + QA:
- repeatable builder: `scripts/build_free_guide.py`
- build workflow: `.github/workflows/build-free-guide.yml`
- build metadata: `data/free-guide-build.json`
- final successful workflow run: `37026971570`
- generated PDF sizes are ~5.4 MB each;
- both PDFs rendered page-by-page after generation and were visually reviewed as full montages;
- no visible clipping, overlap, broken glyphs, or RTL layout failures were found in the final render;
- final guide build was also verified by `pdfinfo` as A4 / 13 pages for each language.

Important:
- the old guide content is being replaced in place at the same filenames rather than archived as a second public download;
- this does not re-enable payments; `PAYMENTS_ENABLED=false` remains unchanged;
- the Free Guide delivery reliability fixes from PRs #114-#116 remain in place;
- the design/copy/link changes are limited to the PDF asset and its build tooling.


### Free Guide redesign experiment — official restart — 2.10.2026

The redesigned Free Guide is now live in production and the measurement window has been explicitly restarted by user instruction.

Production release:
- PR #117 merged to `main` as `8ad3fee0a58a0f3f3c76cdd5859f290bec7f7a19`;
- Deploy Worker run `37028858995` completed successfully;
- GitHub Pages run `37028857612` completed successfully at 2026-10-02 18:45:13 Asia/Jerusalem;
- live assets remain at the same public filenames:
  - `50tips-heb.pdf`
  - `50tips-eng.pdf`

Official experiment restart:
- start timestamp: **2026-10-02 18:55:27 Asia/Jerusalem**;
- ISO timestamp: **2026-10-02T18:55:27+03:00**;
- this is the new Day 1 baseline for the redesigned Free Guide;
- planned 7-day measurement window: through **2026-10-09 18:55:27 Asia/Jerusalem**.

Measurement for the Free Guide path:
- campaign: `202610_freeguide_photo_tips`;
- primary KPI: `guide_request_success`;
- secondary KPI: `generate_lead`;
- PDF downstream engagement is additionally attributable through:
  - `utm_source=free_guide`
  - `utm_medium=pdf`
  - `utm_campaign=202610_freeguide_photo_tips`
  - per-link `utm_content`.

Freeze for this 7-day Free Guide measurement window:
- do not change the PDF asset;
- do not change the Free Guide destination page or core offer;
- do not change campaign naming / UTM schema;
- do not change the primary KPI definition;
- do not change consent wording specifically for the experiment;
- do not add paid traffic to this Free Guide experiment;
- keep production payments disabled with `PAYMENTS_ENABLED=false`.

Interpretation note:
- the earlier Acquisition Experiment 01 timestamps remain historical records for the previous asset/distribution phase;
- for evaluating the redesigned Free Guide itself, use **2026-10-02 18:55:27 Asia/Jerusalem** as the new baseline and do not mix pre-relaunch Free Guide performance into the 7-day redesigned-guide result.


### Admin bulk curation actions — 2.10.2026

Added owner-controlled bulk review helpers in Admin Photos:
- `בחר <1000px` selects every photo whose **short edge** is below 1000px.
- `בחר ציון <80` selects only photos with a **completed visual score** below 80; pending/provisional scores are excluded.
- Added matching stat/filter chips with live counts.
- Added `HIDE מהפרודקשיין` to the bulk action bar. It sets `published=0` and records owner decision `HIDE`.
- Existing bulk DELETE stays a separate destructive action with confirmation.
- No automatic delete/hide runs from these controls; the owner must select and confirm.
- Mobile-first toolbar behavior is preserved by the existing responsive Admin layout.
- PayPal/Gelato/payment configuration is unchanged.


### Bulk DELETE tombstone hotfix — 2.10.2026

User reported that photos deleted via the new bulk selector reappeared after refresh.

Root cause:
- bulk DELETE removed rows from D1/R2 but did not first persist a curation `DELETE` tombstone;
- Admin reload merges D1 with Drive-backed `data/photos.json`, so a deleted D1 row could immediately reappear as a Drive-only card after refresh, even before the scheduled importer ran.

Fix:
- bulk DELETE now writes the `DELETE` owner decision before destructive deletion, with rollback of the decision if deletion fails;
- regular photo-menu DELETE now uses the same tombstone-first behavior;
- Admin Drive merge excludes any Drive photo whose owner decision is `DELETE`;
- existing importer protection already honors the same `DELETE` tombstones, so deleted photos remain excluded on later Drive sync runs.

No Google Drive source file is deleted. PayPal/Gelato/payment configuration unchanged.


### Bulk HIDE <80 hardening — 2.10.2026

Before merging the DELETE tombstone hotfix, the bulk HIDE path was re-verified and hardened:
- `בחר ציון <80` now selects only photos that are actually in D1/R2 (production-managed), excluding Drive-only cards.
- It still requires `score_kind=visual_complete`; pending/provisional scores never qualify.
- Bulk HIDE sets `published=0` and then persists owner decision `HIDE`.
- If saving the HIDE decision fails after publication was changed, Admin attempts to roll the photo back to `published=1`.
- Already-hidden photos can still receive/refresh their owner `HIDE` decision without unnecessary publication writes.

This keeps bulk HIDE reversible and prevents silent partial state.


### Admin curation persistence + bulk actions — status after PR #120

Current merged state:
- PR #119 merged to `main`: owner-controlled bulk curation actions.
- PR #120 merged to `main` at merge SHA `c1b9c0bc7727a8635e1b72d08adbe4853ce5f03c`.
- CI for PR #120 passed 5/5 before merge.
- Production deploy for the PR #120 merge SHA has not yet been independently verified in GitHub Actions at the time of this handoff update.

Admin bulk curation capabilities now intended in `main`:
- `בחר <1000px` selects photos whose short edge is below 1000px.
- `בחר ציון <80` selects only D1/R2 photos with `score_kind=visual_complete` and visual score below 80.
- Bulk `HIDE מהפרודקשיין` sets `published=0` and persists owner decision `HIDE`.
- Bulk HIDE is transactional: if persisting the HIDE decision fails after publication was changed, Admin attempts rollback to `published=1`.
- Bulk DELETE now persists a `DELETE` tombstone before deleting the photo from D1/R2.
- Single-photo DELETE now uses the same tombstone-first behavior.
- Admin Drive merge excludes photos whose owner decision is `DELETE`, so deleted photos should not reappear after refresh.
- Existing Drive importer already respects DELETE tombstones and blocks re-import from Google Drive.
- Google Drive source files are not deleted by these Admin actions.

Incident that triggered PR #120:
- User bulk-deleted the <1000px group.
- Photos reappeared after refresh because the initial bulk DELETE path removed D1/R2 rows but did not write DELETE tombstones.
- Root cause fixed in PR #120.
- Photos deleted before the hotfix may need to be selected and deleted one more time after the corrected Production deploy is verified.

Next required verification:
1. Verify Deploy Worker / Production is running merge SHA `c1b9c0bc7727a8635e1b72d08adbe4853ce5f03c`.
2. In Admin, select `<1000px`, delete a small sample, refresh, and confirm they do not return.
3. Select `ציון <80`, run bulk HIDE, refresh, and confirm all selected photos remain `published=0` and retain owner decision `HIDE`.
4. After both pass, user can safely process the full batches.
5. Recount how many owner-review photos remain.

Operational constraints unchanged:
- `PAYMENTS_ENABLED=false`.
- Do not enable PayPal Production.
- Gelato remains out of scope.
- PR #76 PayPal remains separate and must not be merged as part of curation work.


### Drive-only bulk DELETE fix — 3.10.2026

After PR #120 reached Production, owner reported that bulk DELETE still appeared to do nothing after selection + confirmation.

Root cause:
- photos deleted before the tombstone hotfix had already lost their D1/R2 rows;
- after refresh they appeared as Drive-only cards from `data/photos.json`;
- the new bulk DELETE handler intentionally skipped non-R2 cards, so confirming DELETE on those returned cards incremented failures and left them visible.

Fix branch: `fix/bulk-delete-drive-only-2026-10-03`
- Drive-only cards are now deletable from the site by persisting owner decision `DELETE` only;
- no D1/R2 DELETE call is attempted when no D1/R2 row exists;
- after the tombstone is saved, the Drive-only card is removed from the Admin UI immediately;
- the existing Admin merge and Drive importer both honor the tombstone, so it stays gone after refresh and future sync;
- Google Drive source file remains untouched;
- R2-backed photos still use tombstone-first + real D1/R2 deletion with rollback on failure.


### Processed curation items hidden from action queues — 3.10.2026

Owner reported that after completing DELETE/HIDE work, logging out and back into Admin still showed already-treated photos in the bulk action queues.

Root cause:
- `<1000px` and `<80` filters/counts were derived only from dimensions/scores.
- persisted owner decisions were not used to exclude already-processed items.

Fix:
- `<1000px` queue excludes photos with owner decision `DELETE`.
- `<80` queue excludes photos with owner decision `HIDE` or `DELETE`.
- quick-select buttons apply the same exclusion rules.
- live counters apply the same exclusion rules.
- after login/reload, persisted curation decisions should therefore keep already-treated photos out of the actionable queues.


## 2026-10-03 — Reversible Google Drive HIDE archive
- Connected Google Drive account verified and root Portfolio folder identified as `1LpmT9PNKjCq5kb_GReuavkJPPbeMawMW`.
- Created external root folder `Amit Photos Hidden` (Drive id `1LxJF0lQecSZ5EFxTHu0Njr616CEaOmf5`). It is outside Portfolio, so the recursive Portfolio scanner will not index it.
- Added `src/sync_drive_curation.py` on branch `feature/drive-hide-archive-2026-10-03`.
- Intended behavior: owner decision `HIDE` moves the original Drive image out of Portfolio into the Hidden folder and records the exact original parent in `data/drive-curation-state.json`; changing the owner decision away from HIDE restores the image to that exact parent.
- The sync never permanently deletes Drive files. DELETE remains a separate tombstone/archive policy.
- Parent moves force removal of `data/last_scan.json` so the next agent run performs a full Portfolio rescan; Drive parent changes do not reliably change file modifiedTime.
- The daily `update-photos.yml` runs the HIDE sync before `agent_photos.py` and tracks the sync state file in commits.
- Admin HIDE now dispatches `update-photos.yml` best-effort immediately; bulk HIDE dispatches once after the batch. A dispatch failure never rolls back the website HIDE.
- `KEEP` / `KEEP_SECONDARY` now detects a previous curation HIDE, restores `published=1`, saves the new owner decision, and dispatches the Drive workflow so the original file can return to its recorded Portfolio parent.
- Safety fallback: production Google credentials are currently historically configured with Drive read-only scope. If the token lacks `https://www.googleapis.com/auth/drive`, the sync exits successfully with a PENDING message; website HIDE remains intact and the daily photo workflow is not broken. One-time Google reauthorization with Drive write scope is still required before automatic moves can execute from GitHub Actions.


## 2026-10-03 — Google Drive write re-authorization
- `src/refresh_token.py` now requests `https://www.googleapis.com/auth/drive` instead of `drive.readonly`.
- This is required for the reversible HIDE/RESTORE workflow to move files between `Portfolio` and `Amit Photos Hidden`.
- One-time owner action on a trusted local machine:
  1. Ensure `credentials.json` exists in the repo root.
  2. Run `python src/refresh_token.py` and approve the Google Drive permission in the browser.
  3. Update GitHub Actions secret with `gh secret set GOOGLE_TOKEN < token.json`.
  4. Run `gh workflow run update-photos.yml` and verify the sync step no longer reports PENDING.
- Do not paste `token.json` into chat or commit it to Git.


## 2026-10-03 — Drive HIDE/RESTORE live verification after write-scope reauth
- Owner regenerated the Google OAuth token locally and successfully updated GitHub Actions secret `GOOGLE_TOKEN`.
- PR #124 (`fix: Drive HIDE sync state and write-scope reauth`) merged to `main` at `62c926b6f67660978d4b6a2a040f8bffbcb94252`.
- Root cause of earlier runs #276/#277: `data/drive-curation-state.json` had literal escaped newlines and was invalid JSON; fixed in PR #124 and covered by a regression test.
- Workflow run #278 (`update-photos.yml`, manual dispatch) completed successfully end-to-end. Critically, step `סנכרון HIDE הפיך מול Google Drive` passed, followed by Agent, R2/D1 import, token refresh, Cloudflare secret sync, deploy, cache purge and DB migration — all green. This confirms the new GitHub token is accepted by the Drive HIDE/RESTORE sync path.
- A second manual run #279 was started almost simultaneously. Its Drive HIDE sync, Agent and import steps also passed. It later failed only at `Commit ו-push אם יש תמונות חדשות` because run #278 had already pushed changes to `main`, producing a rebase conflict in `data/last_scan.json`. This is a workflow concurrency/race issue, not a Drive permission failure.
- In #279, Cloudflare secret sync still succeeded for both `GOOGLE_CREDENTIALS` and `GOOGLE_TOKEN` after the git conflict.
- Follow-up hardening recommended: add workflow-level `concurrency` for `update-photos.yml` (single in-flight run, ideally `cancel-in-progress: false`) or otherwise serialize the commit/push stage so two update-photo runs cannot race on `data/last_scan.json`.
- Current operational meaning: reversible Drive HIDE/RESTORE is authorized and functioning at the workflow level. Do not start duplicate manual update-photo runs in parallel until concurrency hardening is merged.


## 2026-10-03 — Final OAuth write-scope verification (run #281)
- The local OAuth refresh flow was fixed by fully rewriting `src/refresh_token.py`; owner successfully generated a new `token.json`, updated GitHub Actions secret `GOOGLE_TOKEN`, and manually dispatched `update-photos.yml`.
- Run #281 (`37119359650`, SHA `9d8b49840735b216a2f544d4968958b300aea0cf`) completed successfully end-to-end.
- Crucially, the Drive curation step no longer logged `PENDING: Google Drive write scope is not authorized`. This confirms the new OAuth token has the required Google Drive write scope and the previous `drive.readonly` blocker is resolved.
- Drive curation summary from run #281: `moved=0, restored=0, skipped=18, tracked_hidden=0`.
- The 18 skipped HIDE decisions were skipped with `no verified Portfolio parent`. This is now the remaining functional issue: authorization is fixed, but those existing HIDE decision file IDs are not currently being verified as descendants of the configured Portfolio folder, so no Drive files were moved during #281.
- Operational status: website HIDE remains applied; OAuth write authorization is healthy; Drive move/restore still needs parent-mapping/Portfolio-parent diagnosis for the 18 existing skipped decisions before claiming end-to-end HIDE movement is complete.
- Do not reintroduce a read-only token. Keep using the regenerated OAuth token with `https://www.googleapis.com/auth/drive` scope.


## 2026-10-03 — Task closure pass
- PR #125 merged: empty `PORTFOLIO_FOLDER_ID` no longer disables the known Portfolio root fallback. One manual `update-photos.yml` run is still needed when owner is back at the terminal to verify the 18 existing HIDE decisions physically move to the external Hidden folder.
- PR #126 merged as `8ab9ef0ac881d62bedc1459127645d735d8dcdf3`: `update-photos.yml` now has workflow-level concurrency (`cancel-in-progress: false`), preventing duplicate runs from racing on `data/last_scan.json`.
- Old draft PR #118 was confirmed still conceptually needed but stale against current Admin code, so it was closed without merge.
- Replacement PR #127 merged as `d033bea373df586af7075f783740eead7bbd0e42`: Admin now retries persisted curation-decision loading, never interprets a failed load as an empty owner-decision map, and no longer invokes login twice.
- `TODO.md` was reconciled with current code/merged PRs: full-portfolio curation rollout, pending-score display, <=85 review routing, >85 auto-clear routing, photo-strength pipeline, and relogin persistence are marked complete where verified.
- Operational constraints unchanged: `PAYMENTS_ENABLED=false`; PayPal Production remains disabled; Gelato remains out of scope; redesigned Free Guide experiment remains frozen through the 7-day measurement window.


## 2026-10-03 — update-photos run #282 follow-up + visual curation unblock
- Manual `update-photos.yml` run #282 (`37124947838`) failed before HIDE processing because the Google access token had expired and google-auth attempted a refresh that re-sent scopes; Google returned `invalid_scope`.
- The same run also hit a separate Wrangler failure while syncing Worker secrets before deployment: current Wrangler refuses `secret put` when the latest Worker version is not yet deployed.
- PR #129 merged as `32bf611f2bc6a5114893ce19fe14cfe4f8d2bc07`:
  - Drive OAuth refresh now uses a direct refresh-token grant without re-sending scope.
  - refreshed authorized-user JSON preserves refresh token/scopes and writes `token_refreshed.json` so the existing GitHub secret update step can persist it.
  - Cloudflare Google secret sync now runs after deploy and only on runs that actually deploy.
- PR #128 merged as `70f550677ff8f64faa3efd72c6276db575ff3fd8`:
  - visual curation falls back to the original Google Drive image when the public/R2 full-image URL is missing (the six remaining flower items were returning 404).
  - one batch can now continue into the next gallery instead of wasting unused batch capacity.
  - the curation workflow receives `GOOGLE_TOKEN_JSON`, installs `google-auth`, and normalizes score state before validation instead of relying on a stale hard-coded portfolio count.
- Next verification required: dispatch `update-photos.yml` once more from current `main` and inspect the HIDE step logs. Success criteria: no `invalid_scope`, no `PENDING`, and actual `HIDE moved ...` lines for eligible decisions (or an explicit justified skip count).
- After that, the scheduled Portfolio Visual Curation workflow should be able to continue beyond the six previously-blocking flower images.


## 2026-10-03 — Drive HIDE end-to-end verification complete
- Manual `update-photos.yml` run #284 (`37126343871`) completed **successfully** on `dd5823362268f8800323d46f167904e0c5675b08`.
- Drive HIDE sync result: `moved=18, restored=0, skipped=0, tracked_hidden=18`.
- No `PENDING` or `invalid_scope` remained in the successful run.
- Google Drive readback of `Amit Photos Hidden` confirmed exactly 18 files present, matching the 18 moved IDs from the Actions log.
- `data/drive-curation-state.json` now tracks 18 hidden items, each with the original `source_parent_id`, so KEEP/KEEP_SECONDARY restoration remains reversible.
- The rest of run #284 also passed: Agent, token update, R2/D1 import, sitemap/assets, commit/push, Cloudflare deploy, Worker secret sync, cache purge, and DB migration.
- Next Drive-specific verification is only the reverse path: choose one hidden photo in Admin, set KEEP or KEEP_SECONDARY, then verify it returns to its exact recorded original Drive parent and is removed from Hidden.


## 2026-10-03 — RESTORE verified; queued checkout and push recovery fix

- Run #289 succeeded; Run #292 (37133231482) restored photo `1V2x1O-7f6CMhpmNghfzq3ce5r9yI-HKB` to original parent `1bTahC57r7wmDgzNXzm7t8U9RoF8vCVDO`. Its Drive summary was `moved=0, restored=1, skipped=0, tracked_hidden=24`.
- Run #292 then failed rebasing `data/drive-curation-state.json`, `data/last_scan.json`, and `data/photos.json`. Main still tracks 25 Hidden entries. Do not repeat the physical move or manually guess state from counts.
- Root cause: concurrency already serializes update-photo runs, but queued dispatches retain their original event SHA. Both #289 and #292 started at `47307afa658459f7f379b66ddf53208f35501229`; the default checkout let #292 process stale state after #289 had pushed.
- Fix prepared: checkout current `main` after acquiring the existing non-cancelling workflow lock; checkpoint Drive state and scan invalidation immediately, before agent/import/deploy; retry non-fast-forward pushes up to five times with rebase; fail on conflicts without force-push or automatic data replacement.
- Drive sync checkpoints each successful operation. An already-restored photo is removed from state only after verifying its exact original parent, and forces a catalog rescan. Partial failures preserve the completed operations; a failure artifact retains state for diagnosis.
- Asset version rewriting now happens after Git persistence, before deployment, so unrelated HTML changes cannot interfere with rebase.
- A narrow push trigger on the sync implementation/workflow/helper starts a fresh reconciliation after the fix merges, without requiring another manual dispatch.
- Local verification: 14 targeted tests, including real local bare-repository push rejection/rebase/conflict/exhaustion cases. Drive Sync CI added for the PR.
- Still pending at preparation: merge/check live reconciliation run, confirm state and actual Drive parents agree, and verify deploy/cache purge. Do not claim 24/24 until live readback.
- Payments stay disabled; no PayPal Production or Gelato changes.


## 2026-10-03 — Drive persistence fix CLOSED after live verification

- PR #132 merged as `20ba24a92ba3485b390af68bbc9daae5684955f6`; all three PR checks passed. Local targeted suite: 14/14.
- Automatic reconciliation run #293 (`37137012698`) completed successfully end-to-end: https://github.com/erezfamily-cmyk/amit-photos/actions/runs/37137012698
- Verified log: `RESTORE reconciled 1V2x1O-7f6CMhpmNghfzq3ce5r9yI-HKB: already in original parent 1bTahC57r7wmDgzNXzm7t8U9RoF8vCVDO`.
- Summary: `moved=0, restored=0, reconciled=1, skipped=0, tracked_hidden=24`. No second physical move was needed. Main readback confirmed 24 Hidden entries and the stale entry absent, correcting the 25-entry mismatch reported after #292. The exact photo parent was queried in Drive during #293; this is not a separate full Hidden-folder inventory count.
- State checkpoint pushed as `6049a57`; catalog/scan update pushed as `9ba49524bf390a9c51ec1bd55937354814efc9df`. Both persistence steps passed. Deployment, Worker secret sync, cache purge and DB migration all passed.
- Production Worker version reported by this run: `f4eb3e00-738a-47f6-8dc9-0b1bd2dbb0b9`.
- This supersedes the pending verification statements in the preparation entry above. Root cause was a stale queued checkout, not a failed RESTORE or missing Google write scope.
- Keep the existing workflow lock (`cancel-in-progress: false`) and `ref: main`; retries protect against unrelated remote commits but deliberately stop on same-file conflicts. GitHub concurrency may replace older pending runs; curation state is read afresh rather than treating dispatches as an ordered event journal.
- No owner terminal action needed for this fix. Next existing queue: continue remaining visual reviews; preserve the current acquisition experiment window and payment guardrails.


## 2026-10-03 — Full portfolio visual scoring COMPLETE

- PR #134 merged as `39f5d5c14c7d35e497744775b6afce103077275d`, expanding the scoring batch to the remaining portfolio and using the safe generated-data push helper.
- Run #23 (`37137970332`) passed and scored 832 photos. Nine items remained because public image retrieval failed and the score job lacked `google-auth`, so its authorized Drive fallback could not initialize.
- PR #135 merged as `b4362f76ae1c23cf20ca64a97b9f0cd20f076ca3`, adding `google-auth` to the score runtime. The follow-up run #25 (`37141784579`) scored the remaining 9 with `failures=0`.
- Final state committed to `main` as `9ee8a17f480c9cdc6099e23afaa55fc4cf72ceb0`: `total=1322`, `visual_complete=1322`, `pending_visual=0`, `completed_galleries=27/27`, `owner_review_required=569`, `auto_clear_above_85=753`, `critical_low_resolution=0`.
- The total is the current published catalog after Drive HIDE/RESTORE cleanup; the earlier pre-cleanup snapshot contained 1,346 items. All 1,322 items currently in the scoring state have complete visual components.
- `owner_review_required=569` is the score-based candidate count (score <=85 or a material problem) before Admin removes photos with an existing owner decision. Admin should continue showing only unresolved candidates, with problematic scores first. No image was automatically hidden or deleted by this scoring pipeline.
- Payments remain disabled (`PAYMENTS_ENABLED=false`); PayPal Production and Gelato were not changed.
