# Handoff — amit-photos

> מסמך כניסה לכל מי (אדם או סוכן AI) שנכנס לפרויקט הזה בפעם הראשונה, או חוזר אחרי הפסקה.
> עודכן: **30.9.2026**. זה מסמך חי — לעדכן אותו כשקורה משהו מהותי, לא לתת לו להתיישן.
> לא מחליף את `CLAUDE.md` (כללי ארכיטקטורה מחייבים) — משלים אותו עם "מה המצב עכשיו ולמה".

---

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

