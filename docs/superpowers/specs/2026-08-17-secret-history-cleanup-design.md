# עיצוב: ניקוי סודות מהיסטוריית Git

**תאריך:** 2026-08-17
**סטטוס:** מאושר — לביצוע בסבב עבודה נפרד, לא דחוף

---

## רקע

בדיקת אבטחה שבועית אוטומטית מצאה מפתח API אמיתי של Gelato חשוף בטקסט גלוי ב-`.claude/settings.json` (9 שורות הרשאת Bash עם `X-API-KEY` מוטבע). הריפו **ציבורי** בגיטהאב (`erezfamily-cmyk/amit-photos`).

טופל באותו יום (2026-08-17):
1. הוסרו 9 השורות מ-`.claude/settings.json`, קומיט `ac12ada`, נדחף ל-`main`.
2. מפתח API חדש נוצר ב-Gelato (`amitphotos-worker-2026-08`) ועודכן כ-secret ב-Cloudflare Worker (`wrangler secret put GELATO_API_KEY`).
3. אומת end-to-end מול `/api/print/quote` החי.
4. המפתח הישן (`amit-photos`, מ-2026-04-09) הושבת (Deactivate) ואז נמחק (Delete) ב-Gelato.

**המשמעות: החשיפה כבר נוטרלה.** מפתח מבוטל הוא מחרוזת מתה — אין סיכון אבטחתי בפועל בהשארתו בהיסטוריה. המסמך הזה עוסק אך ורק **בהיגיינה** — הסרת הטקסט ההיסטורי, ולא בסגירת חור אבטחה פעיל.

---

## ממצאי חקירה

בדיקת ההיסטוריה (`git log -S`, `git for-each-ref`, `git fsck`, `git ls-remote`) העלתה שני ממצאים נפרדים:

### 1. מפתח ה-Gelato עדיין חי בהיסטוריה הנגישה מ-`origin/main`

```
git log --oneline -S "<GELATO_KEY>" origin/main
→ f8e80ef  feat: migrate from Prodigi to Gelato print fulfillment
```

המחרוזת נכנסה בקומיט `f8e80ef` (מיגרציית Gelato) ונשארה ללא שינוי עד `ac12ada` (התיקון של היום). זה הטווח שצריך ניקוי בפועל, כי הוא **חי על GitHub עכשיו**.

### 2. ניקוי היסטוריה קודם היה לא-שלם — אבל רק מקומית, לא על GitHub

הריפו הזה כבר עבר `git filter-branch` בעבר (ככל הנראה כדי להסיר סיסמת אדמין ישנה `Hadas2409` וסוד OAuth שהודלפו — קומיטים `acd4f79` ו-`169acbc`). filter-branch יוצר אוטומטית גיבוי תחת `refs/original/refs/heads/main` ולא מוחק אותו — וזה בדיוק מה שנשאר:

```
git for-each-ref
→ refs/original/refs/heads/main   ← קיים! (filter-branch לא ניקה אחריו)

git merge-base --is-ancestor refs/original/refs/heads/main origin/main
→ NOT an ancestor   ← מאשר: זה קו ה-history הישן, טרם-הניקוי

git ls-remote origin
→ אין refs/original/... בכלל   ← מאשר: זה מקומי בלבד, אף פעם לא נדחף
```

**מסקנה:** הסיסמה הישנה וה-OAuth secret **כבר לא נגישים ב-GitHub** — הניקוי הקודם עבד שם. מה שנשאר הוא רק שהעותקים הישנים (blobs לא-נגישים + reflog) עדיין יושבים בפועל בדיסק המקומי של המחשב הזה, ברי-שחזור עם `git show` ל-hash הישן. זה סיכון מקומי בלבד (מי שיש לו גישה למחשב/לקלון הזה), לא סיכון-ריפו-ציבורי.

### ממצא נלווה (לא קשור לאבטחה, לא בטיפול כאן)

שלושה קבצים מתוך `node_modules/` עדיין עוקבים ב-git למרות ש-`node_modules/` ב-`.gitignore` (נבדק תוכן — לא מכיל סודות, רק מזהה חשבון Cloudflare ומטא-דאטה של Miniflare). ניקוי אופציונלי, נפרד מהמשימה הזו.

`refs/heads/cloudflare/workers-autoconfig` (branch נפרד שנוצר אוטומטית ע"י אינטגרציית Cloudflare, ה-PR שמוזג ממנו כבר merged מ-2026-03-30) נבדק בנפרד — לא מכיל את מפתח ה-Gelato, לא נוגעים בו.

---

## החלטה: שני חלקים נפרדים, סיכון שונה לכל אחד

### חלק א' — ניקוי מקומי (סיכון: אפס, בלי force-push)

מחיקת `refs/original/refs/heads/main`, `git reflog expire --all`, `git gc --prune=now`. זה לא נוגע ב-`origin` בכלל — רק מפנה את ה-blobs הישנים (סיסמה + OAuth secret) מהדיסק המקומי כך שגם `git show <old-hash>` כבר לא יעבוד.

### חלק ב' — ניקוי היסטוריה חיה (סיכון: אמיתי, דורש force-push לריפו ציבורי)

`git-filter-repo --replace-text` על מחרוזת מפתח ה-Gelato בלבד, בכל ההיסטוריה, ואז force-push ל-`origin/main`.

**תנאי מוקדם קריטי:** יש **47 GitHub Actions workflows** בריפו הזה שדוחפים קומיטים אוטומטיים על בסיס שעון (בוטים של Pinterest/Instagram/Facebook/Threads/YouTube/Redbubble/Zazzle, דוחות GA, סנכרון תמונות מ-Drive וכו'). אם קומיט אוטומטי נדחף תוך כדי כתיבת ההיסטוריה מחדש, נוצרת התנגשות ו/או פיצול היסטוריה חדש — בדיוק התבנית שגרמה לבלגן ב-`refs/original` בפעם הקודמת. **כל ה-workflows חייבים להיות מושבתים** (`gh workflow disable`) לפני ה-force-push, ומופעלים מחדש רק אחרי שהכל אומת.

### למה לא לשלב את שני החלקים לפעולת filter-repo אחת

הסיסמה הישנה וה-OAuth secret כבר לא נגישים מ-`origin/main` — אין מה "לתקן" שם, ה-force-push לא יזיז את הבעיה שלהם כלל (הם פשוט לא בטווח שנכתב מחדש). לכן זה נשאר ניקוי מקומי טהור (חלק א'), נפרד ופשוט הרבה יותר מחלק ב'.

### למה לא לכתוב את המפתח החי בתוך קובץ שנשמר ב-git (כולל תוכנית זו)

התוכנית ליישום לא מכילה את מחרוזת המפתח המלאה. במקום זאת, שלב הביצוע שולף אותה בזמן אמת מתוך `git show f8e80ef:.claude/settings.json` לקובץ זמני **מחוץ לריפו** (למשל `%TEMP%`), שנמחק מיד לאחר השימוש. הטבעת המפתח (גם כשהוא מבוטל) בתוך `docs/superpowers/plans/` הייתה מוסיפה עוד עותק שנשמר לצמיתות בריפו הציבורי — בדיוק ההפך ממטרת המשימה.

---

## מה לא מטפלים כאן

| מצב | סיבה |
|-----|-------|
| קבצי `node_modules/` שעוקבים בטעות | לא סוד, לא דחוף — ניקוי נפרד אם רוצים |
| `refs/heads/cloudflare/workers-autoconfig` | נבדק, נקי, לא קשור |
| שינוי תהליך העבודה שמונע את זה מלקרות שוב | דיברנו על pre-commit hook לזיהוי סודות — לא בטיפול כאן, החלטה נפרדת אם המשתמש ירצה |

---

## קבצים/משאבים מעורבים

| מה | תיאור |
|------|--------|
| `.git` (מקומי) | `refs/original/refs/heads/main`, reflog, blobs לא-נגישים |
| `origin/main` (GitHub) | ההיסטוריה שתיכתב מחדש (`f8e80ef` ואילך) ותידחף מחדש |
| 47 GitHub Actions workflows | מושבתים זמנית ומופעלים מחדש בסוף |
| `git-filter-repo` | כלי חיצוני (Python), לא מותקן כרגע — `pip install git-filter-repo` |
