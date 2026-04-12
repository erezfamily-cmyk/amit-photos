# Auto-Recovery לאוטומציות יומיות — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** מערכת שמחדשת טוקני Meta אוטומטית כל חודש ומנסה שוב אוטומטית כשיש כשל זמני, ללא התערבות אנושית.

**Architecture:** סקריפט Python (`refresh_meta_token.py`) שמחדש USER token ב-Meta API ומעדכן GitHub Secrets ע"י GitHub API עם הצפנת libsodium. ה-workflows הקיימים מקבלים retry loop של 3 ניסיונות עם המתנה של 60 שניות בין כל ניסיון.

**Tech Stack:** Python 3.11, requests, PyNaCl, Meta Graph API v21.0, GitHub REST API, GitHub Actions

---

## File Map

| קובץ | סוג | תיאור |
|------|-----|--------|
| `src/refresh_meta_token.py` | חדש | מחדש USER token + Page token + מעדכן GitHub Secrets |
| `.github/workflows/token-refresh.yml` | חדש | workflow חודשי שמריץ את הסקריפט |
| `src/facebook_post.py` | שינוי | תיקון upload_to_public_host (החלפת catbox שבור) |
| `.github/workflows/instagram-post.yml` | שינוי | הוספת retry loop |
| `.github/workflows/facebook-post.yml` | שינוי | הוספת retry loop |
| `.github/workflows/pinterest-post.yml` | שינוי | הוספת retry loop |
| `.github/workflows/update-photos.yml` | שינוי | הוספת retry loop |

---

## Task 1: תיקון facebook_post.py — upload_to_public_host

**Files:**
- Modify: `src/facebook_post.py:153-166`

- [ ] **Step 1: החלף את פונקציית upload_to_public_host**

ב-`src/facebook_post.py`, החלף את הפונקציה `upload_to_public_host` (שורות 153–166) בגרסה המתוקנת:

```python
def upload_to_public_host(source_url):
    """מוריד תמונה ומעלה לשרת ציבורי — נדרש כי Facebook לא ניגש ל-Google Drive."""
    if source_url.startswith("https://amitphotos.com/photos/"):
        print(f"⬆️  תמונה ב-R2, URL ישיר: {source_url}")
        return source_url

    resp = requests.get(source_url, timeout=30)
    resp.raise_for_status()
    img_bytes = resp.content

    try:
        upload = requests.post(
            "https://litterbox.catbox.moe/resources/internals/api.php",
            data={"reqtype": "fileupload", "time": "1h"},
            files={"fileToUpload": ("photo.jpg", img_bytes, "image/jpeg")},
            timeout=60,
        )
        upload.raise_for_status()
        public_url = upload.text.strip()
        if public_url.startswith("http"):
            print(f"⬆️  תמונה הועלתה (litterbox): {public_url}")
            return public_url
    except Exception as e:
        print(f"⚠️  litterbox נכשל ({e}), מנסה 0x0.st...")

    upload = requests.post(
        "https://0x0.st",
        files={"file": ("photo.jpg", img_bytes, "image/jpeg")},
        timeout=60,
    )
    upload.raise_for_status()
    public_url = upload.text.strip()
    print(f"⬆️  תמונה הועלתה (0x0.st): {public_url}")
    return public_url
```

- [ ] **Step 2: Commit**

```bash
git add src/facebook_post.py
git commit -m "fix: החלפת catbox שבור ב-facebook_post עם litterbox + fallback"
git push origin main
```

---

## Task 2: הוספת retry ל-instagram-post.yml

**Files:**
- Modify: `.github/workflows/instagram-post.yml`

- [ ] **Step 1: עדכן את שלב הפרסום**

ב-`.github/workflows/instagram-post.yml`, החלף את ה-step "פרסום תמונה לאינסטגרם":

```yaml
      - name: פרסום תמונה לאינסטגרם
        env:
          INSTAGRAM_USER_ID: ${{ secrets.INSTAGRAM_USER_ID }}
          INSTAGRAM_PAGE_TOKEN: ${{ secrets.INSTAGRAM_PAGE_TOKEN }}
          ANTHROPIC_API_KEY: ${{ secrets.AMIT_PHOTO_AGENT }}
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

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/instagram-post.yml
git commit -m "feat: retry אוטומטי (3 ניסיונות) ב-instagram workflow"
git push origin main
```

---

## Task 3: הוספת retry ל-facebook-post.yml

**Files:**
- Modify: `.github/workflows/facebook-post.yml`

- [ ] **Step 1: עדכן את שלב הפרסום**

ב-`.github/workflows/facebook-post.yml`, החלף את ה-step "פרסום תמונה לפייסבוק":

```yaml
      - name: פרסום תמונה לפייסבוק
        env:
          FACEBOOK_PAGE_ID: ${{ secrets.FACEBOOK_PAGE_ID }}
          FACEBOOK_PAGE_TOKEN: ${{ secrets.FACEBOOK_PAGE_TOKEN }}
          ANTHROPIC_API_KEY: ${{ secrets.AMIT_PHOTO_AGENT }}
        run: |
          for attempt in 1 2 3; do
            python src/facebook_post.py && break
            if [ $attempt -lt 3 ]; then
              echo "ניסיון $attempt נכשל — ממתין 60 שניות..."
              sleep 60
            else
              echo "כל הניסיונות נכשלו"
              exit 1
            fi
          done
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/facebook-post.yml
git commit -m "feat: retry אוטומטי (3 ניסיונות) ב-facebook workflow"
git push origin main
```

---

## Task 4: הוספת retry ל-pinterest-post.yml

**Files:**
- Modify: `.github/workflows/pinterest-post.yml`

- [ ] **Step 1: עדכן את שלב הפרסום**

ב-`.github/workflows/pinterest-post.yml`, החלף את ה-step "פרסום ל-Pinterest":

```yaml
      - name: פרסום ל-Pinterest
        env:
          PINTEREST_ACCESS_TOKEN: ${{ secrets.PINTEREST_ACCESS_TOKEN }}
        run: |
          for attempt in 1 2 3; do
            python src/pinterest_post.py && break
            if [ $attempt -lt 3 ]; then
              echo "ניסיון $attempt נכשל — ממתין 60 שניות..."
              sleep 60
            else
              echo "כל הניסיונות נכשלו"
              exit 1
            fi
          done
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/pinterest-post.yml
git commit -m "feat: retry אוטומטי (3 ניסיונות) ב-pinterest workflow"
git push origin main
```

---

## Task 5: הוספת retry ל-update-photos.yml

**Files:**
- Modify: `.github/workflows/update-photos.yml`

- [ ] **Step 1: עדכן את שלב הרצת ה-Agent**

ב-`.github/workflows/update-photos.yml`, החלף את ה-step "הרצת Agent":

```yaml
      - name: הרצת Agent
        env:
          ANTHROPIC_API_KEY: ${{ secrets.AMIT_PHOTO_AGENT }}
          GOOGLE_CREDENTIALS_JSON: ${{ secrets.GOOGLE_CREDENTIALS }}
          GOOGLE_TOKEN_JSON: ${{ secrets.GOOGLE_TOKEN }}
        run: |
          for attempt in 1 2 3; do
            python src/agent_photos.py && break
            if [ $attempt -lt 3 ]; then
              echo "ניסיון $attempt נכשל — ממתין 60 שניות..."
              sleep 60
            else
              echo "כל הניסיונות נכשלו"
              exit 1
            fi
          done
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/update-photos.yml
git commit -m "feat: retry אוטומטי (3 ניסיונות) ב-update-photos workflow"
git push origin main
```

---

## Task 6: יצירת src/refresh_meta_token.py

**Files:**
- Create: `src/refresh_meta_token.py`

- [ ] **Step 1: צור את הסקריפט**

צור קובץ חדש `src/refresh_meta_token.py`:

```python
#!/usr/bin/env python3
"""
refresh_meta_token.py
---------------------
מחדש טוקני Meta (Instagram USER token + Facebook Page token) ומעדכן GitHub Secrets.
רץ אוטומטית פעם בחודש ע"י token-refresh.yml.

דורש משתני סביבה:
  META_APP_ID, META_APP_SECRET   — מ-Meta Developer Console (Amit Post API)
  INSTAGRAM_PAGE_TOKEN           — הטוקן הנוכחי (USER token)
  GH_PAT                         — GitHub Personal Access Token עם repo scope
"""

import os
import sys
import requests
from base64 import b64encode
from nacl import encoding, public

GRAPH_API = "https://graph.facebook.com/v21.0"
GITHUB_API = "https://api.github.com"
REPO = "erezfamily-cmyk/amit-photos"
FACEBOOK_PAGE_ID = "339707206917"

META_APP_ID = os.environ.get("META_APP_ID", "")
META_APP_SECRET = os.environ.get("META_APP_SECRET", "")
INSTAGRAM_PAGE_TOKEN = os.environ.get("INSTAGRAM_PAGE_TOKEN", "")
GH_PAT = os.environ.get("GH_PAT", "")


def refresh_user_token(current_token):
    """מחדש Meta long-lived USER token."""
    resp = requests.get(
        f"{GRAPH_API}/oauth/access_token",
        params={
            "grant_type": "fb_exchange_token",
            "client_id": META_APP_ID,
            "client_secret": META_APP_SECRET,
            "fb_exchange_token": current_token,
        },
        timeout=30,
    )
    if not resp.ok:
        print(f"❌ שגיאת Meta API: {resp.status_code} — {resp.text}")
        sys.exit(1)
    data = resp.json()
    if "access_token" not in data:
        print(f"❌ שגיאה בחידוש: {data}")
        sys.exit(1)
    return data["access_token"]


def get_page_token(user_token, page_id):
    """מקבל Page Access Token מה-USER token דרך /me/accounts."""
    resp = requests.get(
        f"{GRAPH_API}/me/accounts",
        params={"access_token": user_token},
        timeout=30,
    )
    if not resp.ok:
        print(f"❌ שגיאת /me/accounts: {resp.status_code} — {resp.text}")
        sys.exit(1)
    data = resp.json()
    for page in data.get("data", []):
        if page["id"] == page_id:
            return page["access_token"]
    print(f"❌ לא נמצא Page ID {page_id} ב-/me/accounts. עמודים זמינים: {[p['id'] for p in data.get('data', [])]}")
    sys.exit(1)


def get_repo_public_key():
    """מקבל את המפתח הציבורי של ה-repo להצפנת secrets."""
    resp = requests.get(
        f"{GITHUB_API}/repos/{REPO}/actions/secrets/public-key",
        headers={
            "Authorization": f"Bearer {GH_PAT}",
            "Accept": "application/vnd.github+json",
        },
        timeout=30,
    )
    if not resp.ok:
        print(f"❌ שגיאת GitHub API: {resp.status_code} — {resp.text}")
        sys.exit(1)
    data = resp.json()
    return data["key_id"], data["key"]


def encrypt_secret(public_key_b64, secret_value):
    """מצפין ערך secret עם המפתח הציבורי של ה-repo (libsodium SealedBox)."""
    pk = public.PublicKey(public_key_b64.encode("utf-8"), encoding.Base64Encoder())
    sealed_box = public.SealedBox(pk)
    encrypted = sealed_box.encrypt(secret_value.encode("utf-8"))
    return b64encode(encrypted).decode("utf-8")


def update_github_secret(secret_name, secret_value, key_id, public_key_b64):
    """מעדכן GitHub Secret."""
    encrypted_value = encrypt_secret(public_key_b64, secret_value)
    resp = requests.put(
        f"{GITHUB_API}/repos/{REPO}/actions/secrets/{secret_name}",
        headers={
            "Authorization": f"Bearer {GH_PAT}",
            "Accept": "application/vnd.github+json",
        },
        json={"encrypted_value": encrypted_value, "key_id": key_id},
        timeout=30,
    )
    if not resp.ok:
        print(f"❌ שגיאה בעדכון {secret_name}: {resp.status_code} — {resp.text}")
        sys.exit(1)
    print(f"✅ עודכן: {secret_name}")


def validate_token(token, label):
    """בודק שהטוקן תקין ע"י קריאת /me."""
    resp = requests.get(
        f"{GRAPH_API}/me",
        params={"access_token": token, "fields": "id,name"},
        timeout=30,
    )
    if resp.ok:
        data = resp.json()
        print(f"✅ {label} תקין — ID: {data.get('id')}, שם: {data.get('name')}")
    else:
        print(f"⚠️  {label} אימות נכשל: {resp.text}")


def main():
    if not all([META_APP_ID, META_APP_SECRET, INSTAGRAM_PAGE_TOKEN, GH_PAT]):
        print("❌ חסרים משתני סביבה: META_APP_ID, META_APP_SECRET, INSTAGRAM_PAGE_TOKEN, GH_PAT")
        sys.exit(1)

    print("🔄 מחדש Meta USER token...")
    new_user_token = refresh_user_token(INSTAGRAM_PAGE_TOKEN)
    validate_token(new_user_token, "USER token חדש")

    print("🔄 מקבל Facebook Page token...")
    new_page_token = get_page_token(new_user_token, FACEBOOK_PAGE_ID)
    validate_token(new_page_token, "Page token חדש")

    print("🔐 מקבל מפתח הצפנה של GitHub...")
    key_id, public_key = get_repo_public_key()

    print("💾 מעדכן GitHub Secrets...")
    update_github_secret("INSTAGRAM_PAGE_TOKEN", new_user_token, key_id, public_key)
    update_github_secret("FACEBOOK_PAGE_TOKEN", new_page_token, key_id, public_key)

    print("🎉 חידוש טוקנים הושלם בהצלחה!")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Commit**

```bash
git add src/refresh_meta_token.py
git commit -m "feat: סקריפט חידוש טוקני Meta אוטומטי"
git push origin main
```

---

## Task 7: יצירת .github/workflows/token-refresh.yml

**Files:**
- Create: `.github/workflows/token-refresh.yml`

- [ ] **Step 1: צור את ה-workflow**

צור קובץ חדש `.github/workflows/token-refresh.yml`:

```yaml
name: חידוש טוקני Meta אוטומטי

on:
  # ה-1 בכל חודש, 04:30 UTC — לפני כל שאר האוטומציות
  schedule:
    - cron: '30 4 1 * *'
  # הפעלה ידנית לבדיקה
  workflow_dispatch:

jobs:
  token-refresh:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Python setup
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: התקנת חבילות
        run: pip install requests PyNaCl

      - name: חידוש טוקנים
        env:
          META_APP_ID: ${{ secrets.META_APP_ID }}
          META_APP_SECRET: ${{ secrets.META_APP_SECRET }}
          INSTAGRAM_PAGE_TOKEN: ${{ secrets.INSTAGRAM_PAGE_TOKEN }}
          GH_PAT: ${{ secrets.GH_PAT }}
        run: python src/refresh_meta_token.py
```

- [ ] **Step 2: Commit ו-push**

```bash
git add .github/workflows/token-refresh.yml
git commit -m "feat: workflow חודשי לחידוש טוקני Meta"
git push origin main
```

---

## Task 8: הוספת GitHub Secrets חדשים (ידני)

**Files:** אין — פעולה ידנית ב-GitHub UI

- [ ] **Step 1: הוסף META_APP_ID**

כנס ל-GitHub → Settings → Secrets and variables → Actions → New repository secret:
- Name: `META_APP_ID`
- Secret: `1263941552517505`

- [ ] **Step 2: הוסף META_APP_SECRET**

- Name: `META_APP_SECRET`
- Secret: App Secret של "Amit Post API" מה-[Meta Developer Console](https://developers.facebook.com/apps/1263941552517505/settings/basic/)

- [ ] **Step 3: צור GH_PAT והוסף כ-Secret**

כנס ל-GitHub → User Settings → Developer Settings → Personal access tokens → Tokens (classic) → Generate new token:
- Note: `amit-photos-secrets-writer`
- Expiration: `No expiration` (או שנה)
- Scopes: סמן `repo` (כולל secrets:write)
- לחץ Generate ← העתק את הטוקן

הוסף כ-Secret:
- Name: `GH_PAT`
- Secret: הטוקן שהעתקת

- [ ] **Step 4: אמת שהכל קיים**

```bash
gh secret list
```

צפוי לראות:
```
META_APP_ID         ...
META_APP_SECRET     ...
GH_PAT              ...
INSTAGRAM_PAGE_TOKEN ...
FACEBOOK_PAGE_TOKEN  ...
```

---

## Task 9: בדיקת workflow_dispatch

**Files:** אין

- [ ] **Step 1: הרץ token-refresh ידנית**

```bash
gh workflow run token-refresh.yml
```

- [ ] **Step 2: עקוב אחרי הריצה**

```bash
gh run watch $(gh run list --workflow=token-refresh.yml --limit=1 --json databaseId -q '.[0].databaseId')
```

צפוי:
```
✅ חידוש Meta USER token
✅ קבלת Facebook Page token
✅ עדכון INSTAGRAM_PAGE_TOKEN
✅ עדכון FACEBOOK_PAGE_TOKEN
🎉 חידוש טוקנים הושלם בהצלחה!
```

- [ ] **Step 3: אם נכשל — בדוק לוגים**

```bash
gh run view --log $(gh run list --workflow=token-refresh.yml --limit=1 --json databaseId -q '.[0].databaseId') 2>&1 | grep -E "❌|Error|error" | head -20
```
