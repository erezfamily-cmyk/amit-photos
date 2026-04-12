# עיצוב: Auto-Recovery לאוטומציות יומיות
**תאריך:** 2026-04-12  
**סטטוס:** מאושר

---

## מטרה

לאחר כישלון חוזר של Instagram בגלל token פג — יש צורך במנגנון שמטפל בכשלים אוטומטית, ללא התערבות אנושית.

---

## רכיב 1 — חידוש טוקנים אוטומטי (Meta)

### בעיה
טוקני Meta (Instagram + Facebook) פגים כל ~60 יום. Meta מאפשרת לחדש טוקן בעוד הוא תקף ע"י קריאת API פשוטה.

### פתרון
**workflow חדש: `.github/workflows/token-refresh.yml`**  
- רץ ב-1 בכל חודש, 04:30 UTC (לפני כל שאר האוטומציות)
- מריץ: `python src/refresh_meta_token.py`

**סקריפט חדש: `src/refresh_meta_token.py`**  
1. קורא ל-Meta Graph API:
   ```
   GET /oauth/access_token
     ?grant_type=fb_exchange_token
     &client_id={APP_ID}
     &client_secret={APP_SECRET}
     &fb_exchange_token={CURRENT_TOKEN}
   ```
2. מקבל טוקן חדש עם תוקף של 60 יום
3. מצפין את הטוקן החדש עם המפתח הציבורי של ה-repo (pynacl)
4. מעדכן את GitHub Secret ע"י GitHub API:
   ```
   PUT /repos/{owner}/{repo}/actions/secrets/{secret_name}
   ```
5. מאמת שהטוקן החדש תקין ע"י קריאת `/me` לפני ואחרי

**Secrets נדרשים (חדשים):**
| Secret | תיאור |
|--------|--------|
| `META_APP_ID` | App ID של "Amit Post API" (`1263941552517505`) — משמש גם ל-Instagram וגם ל-Facebook |
| `META_APP_SECRET` | App Secret של "Amit Post API" (מה-Meta Developer Console) |
| `GH_PAT` | GitHub Personal Access Token עם הרשאת `secrets:write` |

> **הערה:** אותה אפליקציה ("Amit Post API") מטפלת בשניהם — Instagram User Token + Facebook Page Token נגזר ממנו דרך `/me/accounts`.
> `GITHUB_TOKEN` המובנה ב-Actions אינו מאפשר עדכון secrets — נדרש PAT.

**Failure handling:**  
אם החידוש נכשל → workflow נכשל → GitHub שולח email אוטומטית (built-in behavior).

---

## רכיב 2 — Retry אוטומטי בכל workflow

### בעיה
שגיאות רשת, timeouts, וחריגות זמניות גורמות לכישלון חד-פעמי שחוזר בניסיון נוסף.

### פתרון
כל 4 ה-workflows הקיימים (instagram, facebook, pinterest, update-photos) מקבלים לוגיקת retry:

```yaml
- name: פרסום תמונה
  run: |
    for attempt in 1 2 3; do
      python src/instagram_post.py && break
      if [ $attempt -lt 3 ]; then
        echo "ניסיון $attempt נכשל — ממתין 60 שניות..."
        sleep 60
      else
        echo "כל הניסיונות נכשלו"
        exit 1
      fi
    done
```

- **3 ניסיונות** עם המתנה של **60 שניות** ביניהם
- אם כל הניסיונות נכשלו: exit 1 → GitHub שולח email לבעל ה-repo

---

## מה לא מטפלים (ידני)

| מצב | סיבה |
|-----|-------|
| Pinterest token פג | Pinterest auth דורש browser flow — לא ניתן לאוטומציה |
| Google token פג | כבר יש `refresh_token.py` — תהליך ידני קיים |
| שגיאת לוגיקה בקוד | דורש תיקון מפתח |
| Instagram token פג לגמרי (לא ניתן לחידוש API) | חידוש חודשי אמור למנוע זאת |

---

## לו"ז ריצה אחרי השינוי

| זמן (UTC) | תהליך |
|-----------|--------|
| 04:30, ה-1 בחודש | `token-refresh.yml` — חידוש טוקני Meta |
| 06:00, כל יום | `update-photos.yml` (עם retry) |
| 07:00, כל יום | `pinterest-post.yml` (עם retry) |
| 08:00, ג+ו | `facebook-post.yml` (עם retry) |
| 09:00, א+ד+ו | `instagram-post.yml` (עם retry) |

---

## קבצים שמשתנים

| קובץ | שינוי |
|------|-------|
| `src/refresh_meta_token.py` | **חדש** — סקריפט חידוש טוקן Meta (Instagram + Facebook ביחד) |
| `.github/workflows/token-refresh.yml` | **חדש** — workflow חודשי |
| `src/facebook_post.py` | תיקון `upload_to_public_host` — החלפת catbox.moe בלitterbox + 0x0.st (זהה ל-instagram_post.py) |
| `.github/workflows/instagram-post.yml` | הוספת retry לשלב הפרסום |
| `.github/workflows/facebook-post.yml` | הוספת retry לשלב הפרסום |
| `.github/workflows/pinterest-post.yml` | הוספת retry לשלב הפרסום |
| `.github/workflows/update-photos.yml` | הוספת retry לשלב הרצת ה-Agent |

---

## Secrets חדשים לצור ב-GitHub

1. `META_APP_ID` = `1263941552517505`
2. `META_APP_SECRET` = (מה-Meta Developer Console — לא נשמר בזיכרון)
3. `GH_PAT` = Personal Access Token חדש עם `repo` scope (כולל secrets write)
