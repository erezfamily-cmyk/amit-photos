# ניקוי סודות מהיסטוריית Git — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** להסיר את מחרוזת מפתח ה-Gelato שהודלף (כבר מבוטל, ראו spec) מכל היסטוריית ה-git החיה ב-`origin/main`, ולנקות מקומית שאריות של ניקוי-סודות קודם ולא-שלם (סיסמת אדמין ישנה + OAuth secret, שכבר לא נגישים ב-GitHub אבל עדיין ברי-שחזור מקומית).

**Architecture:** שני חלקים בלתי-תלויים. חלק א' (Tasks 1-2) הוא ניקוי מקומי טהור — אפס סיכון, לא נוגע ב-`origin`. חלק ב' (Tasks 3-8) הוא `git-filter-repo --replace-text` על המחרוזת החיה + force-push, עם השבתה זמנית של 47 GitHub Actions workflows כדי למנוע התנגשות עם קומיטים אוטומטיים תוך כדי הכתיבה מחדש.

**Tech Stack:** git, git-filter-repo (Python), GitHub CLI (`gh`)

**Spec:** [`docs/superpowers/specs/2026-08-17-secret-history-cleanup-design.md`](../specs/2026-08-17-secret-history-cleanup-design.md)

## Global Constraints

- אין להריץ שום שלב מ-Task 5 ואילך (force-push) בזמן שאחד מ-47 ה-workflows עדיין פעיל — Task 4 (השבתה) חייב לרוץ לפני, ולהיפתח שוב רק ב-Task 8.
- אסור לכתוב את מחרוזת המפתח המלאה (גם מבוטל) לתוך שום קובץ שנשמר ב-git, כולל התוכנית הזו עצמה — היא נשלפת בזמן ריצה (Task 5) לקובץ זמני מחוץ לריפו, ונמחקת בסוף (Task 9).
- Task 6 (force-push) הוא בלתי-הפיך בפועל (גם אם טכנית ניתן לשחזור מהגיבוי של Task 1) — לא להריץ אותו בלי לוודא שכל Task קודם עבר ואומת.

---

## Task 1: גיבוי בטיחות מלא לפני כל שינוי

**Files:** אין (פעולה מחוץ לריפו)

- [ ] **Step 1: צור bare mirror clone עצמאי**

```bash
cd /c/Users/erezf
git clone --mirror https://github.com/erezfamily-cmyk/amit-photos.git amit-photos-backup-20260817.git
```

- [ ] **Step 2: אמת שהגיבוי שלם**

```bash
cd amit-photos-backup-20260817.git
git rev-parse refs/heads/main
```
Expected: מחזיר את אותו hash כמו `git -C /c/Users/erezf/amit-photos rev-parse origin/main` (בזמן כתיבת התוכנית: `ac12ada`).

- [ ] **Step 3: העתק גם את הגיבוי המקומי (refs/original) שעדיין לא בטיפול**

```bash
cd /c/Users/erezf/amit-photos
git bundle create /c/Users/erezf/amit-photos-original-backup-20260817.bundle refs/original/refs/heads/main
```
זה שומר עותק נפרד של קו ה-history הישן (עם הסיסמה/OAuth secret) *לפני* שמוחקים אותו ב-Task 2 — ליתר ביטחון, ניתן למחוק את קובץ ה-bundle הזה בעצמו בסוף (Task 9) ברגע שברור שלא צריך אותו.

---

## Task 2: ניקוי מקומי — הסרת refs/original ו-reflog ישן (חלק א', אפס סיכון ל-origin)

**Files:** אין (מטא-דאטה של git מקומי בלבד)

- [ ] **Step 1: אמת מה קיים לפני המחיקה**

```bash
cd /c/Users/erezf/amit-photos
git for-each-ref --format='%(refname)'
```
Expected: הרשימה כוללת `refs/original/refs/heads/main`.

- [ ] **Step 2: מחק את ה-ref**

```bash
git update-ref -d refs/original/refs/heads/main
```

- [ ] **Step 3: פג-תוקף לכל ה-reflog**

```bash
git reflog expire --expire=now --all
```

- [ ] **Step 4: gc אגרסיבי לפינוי בפועל**

```bash
git gc --prune=now --aggressive
```

- [ ] **Step 5: אמת שהעותק הישן כבר לא נגיש**

```bash
git for-each-ref --format='%(refname)'
```
Expected: `refs/original/refs/heads/main` כבר לא ברשימה.

```bash
git cat-file -e 169acbc 2>&1
git cat-file -e 6a0e7b0 2>&1
```
Expected: `169acbc` (הקומיט החי) עדיין תקין; `6a0e7b0` (הקומיט המקורי, טרום-ניקוי) מחזיר שגיאה — כבר לא בהישג יד.

> אין commit בשלב הזה — זו פעולה על מטא-דאטה מקומית של git, לא על תוכן הריפו.

---

## Task 3: התקנת git-filter-repo

**Files:** אין

- [ ] **Step 1: התקן**

```bash
pip install git-filter-repo
```

- [ ] **Step 2: אמת גרסה**

```bash
git filter-repo --version
```
Expected: מדפיס מספר גרסה (לא שגיאת "not a git command").

---

## Task 4: השבתת כל ה-GitHub Actions workflows

**Files:** אין (state ב-GitHub, לא בריפו)

- [ ] **Step 1: שמור את הרשימה הנוכחית (כדי להחזיר בדיוק את אותו מצב ב-Task 8)**

```bash
cd /c/Users/erezf/amit-photos
gh workflow list --all --json id,name,state > /c/Users/erezf/workflow-state-before-20260817.json
cat /c/Users/erezf/workflow-state-before-20260817.json | grep -c '"id"'
```
Expected: `47` (מספר ה-workflows הפעילים כרגע בריפו — ודא שהמספר תואם למה שרשום כאן; אם השתנה מאז כתיבת התוכנית, זה עדיין תקין, פשוט מספר אחר).

- [ ] **Step 2: השבת את כולם**

```bash
for id in $(cat /c/Users/erezf/workflow-state-before-20260817.json | grep -o '"id": *[0-9]*' | grep -o '[0-9]*'); do
  gh workflow disable "$id"
done
```

- [ ] **Step 3: אמת שכולם disabled**

```bash
gh workflow list --all
```
Expected: כל השורות מסומנות `disabled_manually`, אף אחת לא `active`.

---

## Task 5: שליפת מחרוזת המפתח מההיסטוריה לקובץ replace-text זמני (מחוץ לריפו)

**Files:**
- Create (מחוץ לריפו): `%TEMP%\filter-repo-replacements.txt`

- [ ] **Step 1: שלוף את המחרוזת המדויקת מהקומיט שבו היא נכנסה**

```bash
cd /c/Users/erezf/amit-photos
git show f8e80ef:.claude/settings.json | grep -o 'X-API-KEY: [a-f0-9-]*:[a-f0-9-]*' | head -1
```
Expected: שורה בפורמט `X-API-KEY: 490bdbe7-...:7ae7c558-...` (המפתח המבוטל).

- [ ] **Step 2: בנה את קובץ ה-replace-text (מחוץ לריפו, לא נשמר ב-git לעולם)**

```bash
KEY=$(git show f8e80ef:.claude/settings.json | grep -o 'X-API-KEY: [a-f0-9:-]*' | head -1 | sed 's/X-API-KEY: //')
echo "${KEY}==>***REMOVED-ROTATED-KEY***" > /c/Users/erezf/filter-repo-replacements.txt
cat /c/Users/erezf/filter-repo-replacements.txt | sed 's/[a-f0-9]\{8\}-[a-f0-9-]\{20,\}/[KEY-REDACTED-FOR-DISPLAY]/'
```
(אותה שיטת חילוץ בדיוק כמו ב-Step 1, כדי שלא יהיה פער בין מה שנבדק למה שנכתב בפועל לקובץ.)
Expected: מדפיס שורה עם `==>***REMOVED-ROTATED-KEY***` (הפלט המוצג כאן מוסתר בכוונה — ודא שהקובץ עצמו כן מכיל את המחרוזת המלאה, אחרת filter-repo לא ימצא התאמה).

---

## Task 6: הרצת git-filter-repo וניקוי ההיסטוריה

**Files:** כל ההיסטוריה של הריפו (בעותק עבודה מקומי בלבד בשלב זה, עדיין לא נדחף)

- [ ] **Step 1: ודא working tree נקי לפני שמריצים filter-repo**

```bash
cd /c/Users/erezf/amit-photos
git status --short
```
Expected: אם יש שינויים לא-מקומיטים (למשל index.html, style.css מעבודה שוטפת) — או `git stash push -u` אותם קודם, או תדחוף/תקמט אותם לפני שממשיכים. filter-repo דורש working tree נקי.

- [ ] **Step 2: הרץ filter-repo, מוגבל ל-main בלבד**

```bash
git filter-repo --replace-text /c/Users/erezf/filter-repo-replacements.txt --refs main --force
```
`--refs main` מגביל את הכתיבה-מחדש לענף `main` בלבד — לא נוגע ב-`refs/heads/cloudflare/workers-autoconfig` (נבדק בspec, לא מכיל את המפתח) ולא ב-tag `v1.0.0`, כדי למנוע שינוי hash מיותר במקומות שלא צריך.

Expected: מדפיס סיכום (`Parsed X commits`, `New history written`), ללא שגיאות. שים לב: `git filter-repo` מסיר את ה-`origin` remote אוטומטית כאמצעי בטיחות (למניעת push בטעות) — זה צפוי, מטופל ב-Task 7 Step 1.

- [ ] **Step 3: אמת שהמחרוזת נעלמה מכל ההיסטוריה**

```bash
git log -S "$(cat /c/Users/erezf/filter-repo-replacements.txt | cut -d= -f1)" --all --oneline
```
Expected: פלט ריק — אין אף קומיט עם המחרוזת יותר.

- [ ] **Step 4: אמת שהתוכן הנוכחי (HEAD) עדיין תקין**

```bash
python -c "import json; json.load(open('.claude/settings.json', encoding='utf-8')); print('valid JSON')"
git log --oneline -5
```
Expected: `valid JSON`, וה-5 קומיטים האחרונים נראים הגיוניים (עם hashes חדשים — זה צפוי, filter-repo כותב hash לכל קומיט).

---

## Task 7: Force-push ההיסטוריה הנקייה ל-origin

**Files:** `origin/main` על GitHub

- [ ] **Step 1: החזר את ה-remote (filter-repo הסיר אותו)**

```bash
cd /c/Users/erezf/amit-photos
git remote add origin https://github.com/erezfamily-cmyk/amit-photos.git
git fetch origin
```

- [ ] **Step 2: ודא שוב שכל ה-workflows disabled (בדיקה כפולה לפני force-push)**

```bash
gh workflow list --all | grep -c active
```
Expected: `0`

- [ ] **Step 3: force-push עם lease (לא force גס — נכשל אם מישהו/בוט דחף בינתיים בלי שידעת)**

```bash
git push origin main --force-with-lease
```
Expected: מצליח. אם נכשל עם "stale info" — עצור, בדוק מי דחף (`git fetch && git log origin/main -5`), ולא להמשיך עם `--force` גס בלי להבין למה קודם.

- [ ] **Step 4: אמת מול GitHub ישירות**

```bash
git ls-remote origin refs/heads/main
git log -S "490bdbe7" --oneline $(git ls-remote origin refs/heads/main | cut -f1)
```
Expected: השורה השנייה מחזירה פלט ריק — המחרוזת נעלמה גם לפי GitHub, לא רק לפי ה-clone המקומי.

---

## Task 8: הפעלה מחדש של כל ה-workflows ואימות האתר

**Files:** אין

- [ ] **Step 1: הפעל מחדש בדיוק את מה שהיה פעיל לפני (מהקובץ ששמרנו ב-Task 4)**

```bash
for id in $(cat /c/Users/erezf/workflow-state-before-20260817.json | grep -o '"id": *[0-9]*' | grep -o '[0-9]*'); do
  gh workflow enable "$id"
done
```

- [ ] **Step 2: אמת שכולם חזרו ל-active**

```bash
gh workflow list --all | grep -c active
```
Expected: `47` (או המספר ששמרת ב-Task 4 Step 1).

- [ ] **Step 3: אמת שהאתר החי עדיין עובד (אותה בדיקה שכבר עשינו קודם על ה-Gelato quote)**

```bash
curl -s -w "\nHTTP_STATUS:%{http_code}\n" -X POST "https://amitphotos.com/api/print/quote" -H "Content-Type: application/json" -d '{"sku":"canvas_16x20-inch-400x500-mm_canvas_wood-fsc-slim_4-0_ver"}'
```
Expected: `HTTP_STATUS:200` עם מחיר תקין.

- [ ] **Step 4: הרץ workflow_dispatch ידני אחד לוודא ש-Actions עדיין עובד תקין אחרי הכתיבה מחדש**

```bash
gh workflow run token-refresh.yml
sleep 15
gh run list --workflow=token-refresh.yml --limit=1
```
Expected: הרצה עם status `completed` / `success` (או לפחות `in_progress` בלי שגיאת setup מיידית).

---

## Task 9: ניקוי קבצים זמניים

**Files:** אין (קבצים מחוץ לריפו)

- [ ] **Step 1: מחק את קובץ ה-replace-text (מכיל את המפתח המבוטל בטקסט גלוי)**

```bash
rm /c/Users/erezf/filter-repo-replacements.txt
rm /c/Users/erezf/workflow-state-before-20260817.json
```

- [ ] **Step 2: החלטה על הגיבויים מ-Task 1**

```bash
ls -la /c/Users/erezf/amit-photos-backup-20260817.git /c/Users/erezf/amit-photos-original-backup-20260817.bundle
```
לאחר שהאתר עובד (Task 8) והבדיקה ב-Task 7 Step 4 חיובית — אפשר למחוק את שניהם, או להשאיר אותם כגיבוי צד לצד למשך כמה ימים לפני מחיקה. זו החלטה של המשתמש, לא אוטומטית.

---

## Self-Review

**כיסוי ה-spec:** חלק א' (ref מקומי + reflog + gc) = Task 2. חלק ב' (filter-repo + force-push + השבתת workflows) = Tasks 3-8. איסור הטבעת המפתח בקובץ שנשמר = Task 5 (שליפה דינמית ל-`%TEMP%`, לא לתוך הריפו). גיבוי לפני שינוי הרסני = Task 1. ניקוי אחרי = Task 9. כל סעיף ב-spec מכוסה.

**Placeholder scan:** כל הפקודות קונקרטיות עם ערכים אמיתיים (hashes, שמות workflow files, URL). אין "TODO" / "handle appropriately".
