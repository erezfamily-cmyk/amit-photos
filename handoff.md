# Handoff — amit-photos

> מסמך כניסה לכל מי (אדם או סוכן AI) שנכנס לפרויקט הזה בפעם הראשונה, או חוזר אחרי הפסקה.
> עודכן: **1.10.2026**. זה מסמך חי — לעדכן אותו כשקורה משהו מהותי, לא לתת לו להתיישן.
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

## 🚧 עבודה פעילה — 1.10.2026

### PayPal Orders API v2 — Phase 1

**החלטת בעל הפרויקט כרגע: לא לאפשר רכישה אמיתית, לא למזג את PR #76, ולא להפעיל PayPal Live.**

מצב נוכחי:
- PR #76 נשאר **Draft ולא ממוזג**.
- `PAYMENTS_ENABLED = "false"` נשאר ללא שינוי.
- אין רכישות ציבוריות פעילות.
- אין PayPal Live credentials.
- אין Webhook פעיל.
- אין UI רכישה חדש.
- המסלולים הציבוריים החדשים של PayPal, גם אם ייפרסו בעתיד, בנויים Fail-closed כל עוד `PAYMENTS_ENABLED != "true"`.

מה כן הושלם כהכנה:
- PayPal Developer Sandbox הוכן: Business test account, Personal buyer test account ו-Sandbox App.
- ב-Cloudflare Production נשמרו כ-Secrets מוצפנים:
  - `PAYPAL_CLIENT_ID`
  - `PAYPAL_CLIENT_SECRET`
  אלו credentials של Sandbox בלבד; הערכים עצמם אינם ב-Git.
- D1 migration הוחל על `amit-photos-db` אחרי יצירת Time Travel bookmark:
  - `paypal_orders`
  - `paypal_webhook_events`
  - `idx_paypal_orders_status`
- מבנה שתי הטבלאות אומת ידנית ב-D1 Console.
- נוסף backend חדש ב-`paypal-orders.js`:
  - OAuth מול PayPal Sandbox בלבד
  - `create-order`
  - `capture-order`
  - חישוב מחיר בצד השרת
  - בדיקת amount + currency מול PayPal
  - idempotent digital fulfillment
- נוספו admin-only Sandbox test hooks, המוגנים ב-admin session, כדי לאפשר בעתיד בדיקות Sandbox בלי לפתוח קנייה לציבור.
- נוסף GitHub Actions workflow להרצת כל `tests/*.test.mjs` על PRs.
- full Node suite: **318/318 pass, 0 fail**.
- security audit checkpoint: תוקנו persistence verification, capture identity binding ו-recovery אחרי `ORDER_ALREADY_CAPTURED`; לאחר מכן נוספו rate limiting ו-create-order idempotency. הסוויטה כעת **323/323 pass, 0 fail**. migration `0002_paypal_security_hardening.sql` מוכנה אך לא הורצה בפרודקשן. שני legacy payment routes נותקו ומחזירים 410 תמיד; CORS/idempotency headers הוקשחו; בדיקת diff לא מצאה secret literal או PayPal Live endpoint. הסוויטה כעת **325/325 pass, 0 fail**. לאחר מכן ה-webhook הוקשח עם signature verification, dedup, authoritative reconciliation ו-processing lease recoverable; regression tests ל-crash/retry נוספו והסוויטה כעת **331/331 pass, 0 fail**. לאחר מכן נוסף staging D1 bootstrap מינימלי + CI isolation guard שמונע הפניה ל-production D1/R2/domain ושומר production `PAYMENTS_ENABLED=false`; הסוויטה כעת **334/334 pass, 0 fail**.
- במהלך ה-CI נמצא ותוקן baseline bug ישן ב-cache-busting של `index.html`; הוא לא נגרם משינויי PayPal.

### משמעות המיזוג בעתיד
מיזוג PR #76 ל-`main` יפרוס את קוד ה-Sandbox החדש ל-Cloudflare, אבל כשלעצמו **לא אמור לפתוח רכישות לציבור** כי `PAYMENTS_ENABLED=false` נשאר kill switch. למרות זאת, לפי החלטת בעל הפרויקט מ-1.10.2026, **לא לבצע את המיזוג כרגע**.

### השלב הבא
- מקור עבודה מחייב נוסף: `docs/pre-commerce-readiness-2026-10-01.md`; staging plan: `docs/paypal-sandbox-staging-2026-10-01.md`.
- Security audit ברמת קוד: S1–S5 ו-S7–S10 נסגרו. webhook עם signature verification + dedup + authoritative order cross-check נוסף; הסוויטה כעת **329/329 pass, 0 fail**. פתוח לפני E2E: S6 staging isolation. webhook עדיין דורש E2E אמיתי מול Sandbox staging לפני Go-Live.
לא לבצע merge, deploy, Webhook, UI checkout או Live PayPal עד אישור מפורש חדש של בעל הפרויקט.
אפשר להמשיך בעתיד בבדיקות Sandbox בלבד, ורצוי בסביבה מבודדת/מוגנת, בלי לשנות `PAYMENTS_ENABLED`.

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

- **מעבר ל-PayPal Orders API v2** — Phase 1 מיושם ב-Draft PR #76. Sandbox App + buyer account הוכנו, `PAYPAL_CLIENT_ID`/`PAYPAL_CLIENT_SECRET` נשמרו ב-Cloudflare כ-Secrets, migration הוחל ואומת ב-D1, וה-backend הדיגיטלי עבר full Node suite של 318/318. עדיין לא הושלמו: security review מלא, Sandbox E2E אמיתי בסביבה מבודדת, webhook מאומת-חתימה, print flow ב-Orders v2, client SDK/UI, והסרה/חסימה קבועה של legacy PayPal endpoints לפני כל הפעלה. לפי החלטת בעל הפרויקט: לא למזג ולא לאפשר רכישה אמיתית כרגע.
- `DSC_9287.jpg` (גאורגיה) — הסיבה כבר ידועה (ראה #10 למעלה: סימון זכויות-יוצרים שנמחק בשקט בגלל באג CI, עכשיו מתוקן ב-PR #74). לבדוק שהיא נכנסת בפועל בריצה היומית הבאה; אם לא, לבדוק את `data/copyright_flagged.json` (עכשיו נשמר בפועל) לראות אם היא שם ולמה.
- להמשיך לעקוב אחרי metrics אחרי כל שינוי UX גדול לפני שממשיכים הלאה.

**עודכן 30.9.2026:** שחזור הענף הישן (`fix/security-analytics-ux-audit`) שהיה רשום כאן כפתוח —
**נבדק מול `main` הנוכחי ונמצא מיותר: כל 8 הפריטים כבר פתורים** דרך עבודה עצמאית מאוחרת יותר,
לא דרך הענף הישן עצמו. פירוט מלא ב-`docs/security-ux-audit-status-2026-09-26.md` (עודכן). אל
תבזבזו זמן על cherry-pick מהענף הזה בלי לבדוק שוב קודם.

---

*אם אתה סוכן AI שנכנס לפרויקט הזה: קרא את `CLAUDE.md` ואת המסמך הזה קודם, ואז תסתכל אם יש `docs/*-2026-*.md` חדש יותר מהתאריך שרשום כאן — אם כן, זה כנראה מעודכן יותר ממה שכתוב פה.*


### PayPal staging deployment decision — 1.10.2026

- GitHub `workflow_dispatch` for `.github/workflows/paypal-sandbox-staging.yml` cannot be relied on before that workflow exists on the default branch.
- Because PR #76 must remain Draft and unmerged, the chosen path is **direct branch deployment to the separate Cloudflare Worker**.
- Added `wrangler.paypal-sandbox.toml` pinned to:
  - Worker `amit-photos-paypal-sandbox`
  - D1 `amit-photos-paypal-sandbox-db` / ID `7b027b93-c548-4ceb-bbe9-42c45264fc23`
  - R2 `amit-photos-paypal-sandbox-images`
  - workers.dev only
  - no routes
  - no cron
  - `keep_vars=true` so dashboard-managed Sandbox secrets are preserved.
- Production remains untouched and `PAYMENTS_ENABLED=false`.
- Next action: connect/deploy the staging Worker from branch `prep/paypal-orders-v2-2026-10-01`, then verify Sandbox OAuth and E2E.


### Cloudflare Git staging connection — 1.10.2026

- Worker `amit-photos-paypal-sandbox` connected to GitHub repo `erezfamily-cmyk/amit-photos`.
- Production branch for this staging Worker is explicitly `prep/paypal-orders-v2-2026-10-01` — not `main`.
- Build command: none.
- Deploy command: `npx wrangler@4.4.0 deploy --config wrangler.paypal-sandbox.toml`.
- Root directory: `/`.
- The staging Worker remains workers.dev-only.
- This documentation commit intentionally triggers the first staging build after Git connection.
- Production site remains untouched and production `PAYMENTS_ENABLED=false`.


### First Cloudflare staging build — 1.10.2026

- After Git connection, commit `7334f8088c381a3b3bd4103157101007aa305f36` triggered the first build for `amit-photos-paypal-sandbox`.
- Cloudflare Deployments currently shows the branch build as **In progress**.
- The currently active version is still the prior dashboard-created Worker version; do not run PayPal OAuth/E2E until the branch build finishes successfully and becomes active.
- No production deployment or payment enablement occurred.


### Cloudflare staging build result — 1.10.2026

- Cloudflare Recent builds for branch `prep/paypal-orders-v2-2026-10-01` are green/success.
- However, the Deployments page still shows active version `78ddcde1`, the prior dashboard-created version.
- Do **not** start PayPal OAuth/E2E until build details confirm the wrangler deploy step actually published the branch code and the active deployment is updated.
- Production remains untouched and `PAYMENTS_ENABLED=false`.


### PayPal staging deploy verified — 1.10.2026

- Cloudflare build log confirms branch deploy completed successfully for `amit-photos-paypal-sandbox`.
- Deployed URL: `https://amit-photos-paypal-sandbox.erez-family.workers.dev`.
- Bound resources in deploy log:
  - D1 `DB -> amit-photos-paypal-sandbox-db` (staging ID).
  - R2 `PHOTOS -> amit-photos-paypal-sandbox-images`.
  - Images binding `IMAGES`.
  - `PAYMENTS_ENABLED="true"` in staging only.
- Wrangler reported a new staging Worker version and `Success: Deploy command completed`.
- A non-fatal duplicate-key warning around an existing Hebrew category key in `worker.js` appeared during build; it did not block deployment and should be cleaned separately.
- Production remains untouched and `PAYMENTS_ENABLED=false`.
- Next: external smoke test of staging, then Sandbox OAuth test.


### PayPal staging smoke test — 1.10.2026

- Browser smoke test on `https://amit-photos-paypal-sandbox.erez-family.workers.dev/api/payments-status` returned `{"enabled":true}`.
- This confirms the branch code is active on the isolated Sandbox Worker and the staging-only payment flag is effective.
- Production remains `PAYMENTS_ENABLED=false`.
- Next: authenticated admin Sandbox OAuth test.


### PayPal Sandbox OAuth smoke test — 1.10.2026

- Authenticated request to `/api/admin/paypal/sandbox-status` succeeded from PowerShell using the staging-only `ADMIN_PASSWORD` header.
- Response confirmed:
  - `ok=true`
  - `environment=sandbox`
  - `paymentsEnabled=true`
  - `credentialsConfigured=true`
- This verifies the staging Worker can authenticate server-to-server with PayPal Sandbox using the rotated Sandbox secret stored in Cloudflare.
- Production remains `PAYMENTS_ENABLED=false`.
- Next: create a real PayPal Sandbox order for fixture `paypal-sandbox-test-photo`, approve with Sandbox buyer, then capture and verify D1/token state.


### PayPal Sandbox create-order E2E — 1.10.2026

- Authenticated POST to `/api/admin/paypal/create-order` succeeded against the isolated staging Worker.
- Fixture: `paypal-sandbox-test-photo`, SKU `small`, currency `ILS`.
- PayPal Sandbox returned a real `paypalOrderId` and `approveUrl`.
- This confirms staging can create an Orders v2 order server-to-server and persist the local order path far enough to return approval.
- No real payment occurred; next step is approval using the PayPal Sandbox Personal buyer account, then capture and D1/token verification.


### PayPal Sandbox credentials refresh — 1.10.2026

- After OAuth began failing following secret rotation, the active Sandbox app credentials were copied again from PayPal Developer and re-saved in Cloudflare Worker `amit-photos-paypal-sandbox`.
- Both `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` were refreshed together from the same Sandbox app.
- Next action: rerun authenticated `/api/admin/paypal/sandbox-status` and require `ok=true` before creating another order.
- Production remains untouched and `PAYMENTS_ENABLED=false`.


### PayPal Sandbox direct OAuth diagnosis — 1.10.2026

- Direct PowerShell POST to `https://api-m.sandbox.paypal.com/v1/oauth2/token` using the Sandbox Client ID + Secret returned:
  - `error=invalid_client`
  - `error_description=Client Authentication failed`
- This reproduces the failure outside Cloudflare, so the current blocker is the PayPal Sandbox credential pair itself, not Worker bindings, D1, R2, routing, or Cloudflare secret access.
- Do not continue create/capture testing until direct OAuth succeeds.
- Next recovery step: create a second Sandbox secret for the same app, copy Client ID and the new secret using PayPal's copy controls, test them directly against OAuth, then update Cloudflare only after the direct test passes. Keep production untouched.


### PayPal Sandbox second-key verification — 1.10.2026

- A second Sandbox secret was created for the existing PayPal Sandbox app.
- Direct PowerShell OAuth against `https://api-m.sandbox.paypal.com/v1/oauth2/token` succeeded with the existing Client ID + new second secret.
- This proves the new second secret is valid; the previous secret was the source of `invalid_client`.
- The OAuth response displayed a temporary access token in the local terminal/screenshot. Treat that token as exposed and do not reuse or store it; it is ephemeral and not needed for the Worker.
- Next: update only `PAYPAL_CLIENT_SECRET` in Cloudflare staging Worker to the verified second secret, redeploy, rerun `/api/admin/paypal/sandbox-status`, then resume E2E with a new order.


### PayPal Sandbox OAuth restored — 1.10.2026

- Cloudflare staging Worker was updated to the verified second Sandbox secret.
- Authenticated `/api/admin/paypal/sandbox-status` now returns:
  - `ok=true`
  - `environment=sandbox`
  - `paymentsEnabled=true`
  - `credentialsConfigured=true`
- This confirms the staging Worker can authenticate server-to-server with PayPal Sandbox again after secret rotation.
- Next: create a fresh Sandbox order with a new Idempotency-Key using the fixed approval flow, approve it with the Personal Sandbox buyer, then capture and verify D1 + download token state.


### PayPal Sandbox approval-link E2E — 1.10.2026

- Fresh Sandbox order created successfully with Idempotency-Key `sandbox-e2e-20261001-004`.
- PayPal returned a non-empty checkout URL after the payer-action compatibility fix.
- This confirms the Worker now handles both `approve` and `payer-action` link relations correctly.
- Next: open the Sandbox checkout URL, sign in with the Personal Sandbox buyer, approve, verify return to `/api/paypal/approved`, then run capture and verify D1 + download token state.


### PayPal checkout return handler deploy verified — 1.10.2026

- Cloudflare staging deployment containing the missing `handlePayPalCheckoutReturn` import completed.
- GitHub CI for head `8fa10bb55349d9ac8720fbbe4ec0194603b3a93a` is green:
  - Node Tests: success.
  - Python Data Tests: success.
- Regression tests now cover both `/api/paypal/approved` and `/api/paypal/cancelled`.
- The previous Error 1101 root cause was the missing import; code fix is deployed to the isolated staging Worker.
- Next: attempt capture of the last Sandbox order that reached the return URL. If PayPal reports it was not approved, create a fresh order and repeat approval.


### PayPal capture custom_id compatibility deploy verified — 1.10.2026

- Staging deployment containing the optional-custom_id capture fix completed.
- GitHub CI for head `bdc5cb994c6c339465cc6e084c7690b15fe579b1` is green:
  - Node Tests: success.
  - Python Data Tests: success.
- Capture validation now still requires exact PayPal order ID, COMPLETED status, exact currency and exact amount; `custom_id` is enforced when PayPal returns it, but its omission no longer causes a false identity mismatch.
- Next: retry capture on the same already-approved Sandbox order. The existing `ORDER_ALREADY_CAPTURED` recovery path must complete fulfillment without a second charge.


### Digital Sandbox capture E2E passed — 1.10.2026

- Retry capture on the approved Sandbox order succeeded after the custom_id compatibility fix.
- Worker returned a digital fulfillment response with a `/api/download/<token>` URL and title `PayPal Sandbox Test Photo`.
- This confirms the end-to-end path reached successful fulfillment:
  PayPal Sandbox approval -> capture -> server-side validation -> local fulfillment claim -> download token creation -> fulfillment response.
- The recovery path handled the previously captured/partially-processed order without creating a second charge.
- Remaining verification before marking digital E2E complete:
  1. repeat capture callback must return the stored fulfillment idempotently;
  2. D1 must show one COMPLETED order and exactly one download token for that order.
