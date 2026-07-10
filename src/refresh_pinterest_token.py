#!/usr/bin/env python3
"""
refresh_pinterest_token.py
---------------------------
מחדש את Pinterest access token (וrefresh token אם התקבל חדש) ומעדכן GitHub Secrets.
נועד לרוץ אוטומטית (שבועי) כדי שהטוקן לא יפוג בשקט כמו שקרה עד 10.7.2026
(PINTEREST_ACCESS_TOKEN לא עודכן מ-7.5.2026 וכל הפרסום ל-Pinterest נכשל עם 401 בלי שאף אחד שם לב).

דורש משתני סביבה:
  PINTEREST_APP_ID       — מ-Pinterest Developer Console (קבוע: 1562228)
  PINTEREST_APP_SECRET   — Pinterest app secret
  PINTEREST_REFRESH_TOKEN — הrefresh token הנוכחי
  GH_PAT                 — GitHub Personal Access Token עם repo scope
"""

import os
import sys
import requests
from base64 import b64encode
from nacl import encoding, public

PINTEREST_API = "https://api.pinterest.com/v5"
GITHUB_API = "https://api.github.com"
REPO = "erezfamily-cmyk/amit-photos"

PINTEREST_APP_ID = os.environ.get("PINTEREST_APP_ID", "1562228")
PINTEREST_APP_SECRET = os.environ.get("PINTEREST_APP_SECRET", "")
PINTEREST_REFRESH_TOKEN = os.environ.get("PINTEREST_REFRESH_TOKEN", "")
GH_PAT = os.environ.get("GH_PAT", "")


def refresh_access_token():
    """מחדש Pinterest access token באמצעות refresh_token grant."""
    resp = requests.post(
        f"{PINTEREST_API}/oauth/token",
        auth=(PINTEREST_APP_ID, PINTEREST_APP_SECRET),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        data={
            "grant_type": "refresh_token",
            "refresh_token": PINTEREST_REFRESH_TOKEN,
        },
        timeout=30,
    )
    if not resp.ok:
        print(f"❌ שגיאת Pinterest API: {resp.status_code} — {resp.text}")
        sys.exit(1)
    data = resp.json()
    if "access_token" not in data:
        print(f"❌ שגיאה בחידוש: {data}")
        sys.exit(1)
    return data["access_token"], data.get("refresh_token")


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


def validate_token(token):
    """בודק שהטוקן תקין ע"י קריאת /v5/boards."""
    resp = requests.get(
        f"{PINTEREST_API}/boards",
        headers={"Authorization": f"Bearer {token}"},
        params={"page_size": 1},
        timeout=30,
    )
    if resp.ok:
        print(f"✅ טוקן תקין — boards API הגיב בהצלחה")
    else:
        print(f"⚠️  אימות טוקן נכשל: {resp.status_code} — {resp.text}")


def main():
    if not all([PINTEREST_APP_SECRET, PINTEREST_REFRESH_TOKEN, GH_PAT]):
        print("❌ חסרים משתני סביבה: PINTEREST_APP_SECRET, PINTEREST_REFRESH_TOKEN, GH_PAT")
        sys.exit(1)

    print("🔄 מחדש Pinterest access token...")
    new_access_token, new_refresh_token = refresh_access_token()
    validate_token(new_access_token)

    print("🔐 מקבל מפתח הצפנה של GitHub...")
    key_id, public_key = get_repo_public_key()

    print("💾 מעדכן GitHub Secret: PINTEREST_ACCESS_TOKEN...")
    update_github_secret("PINTEREST_ACCESS_TOKEN", new_access_token, key_id, public_key)

    if new_refresh_token:
        print("💾 מעדכן GitHub Secret: PINTEREST_REFRESH_TOKEN...")
        update_github_secret("PINTEREST_REFRESH_TOKEN", new_refresh_token, key_id, public_key)
    else:
        print("ℹ️  לא התקבל refresh_token חדש — נשאר עם הקיים")

    print("🎉 חידוש טוקן Pinterest הושלם בהצלחה!")


if __name__ == "__main__":
    main()
