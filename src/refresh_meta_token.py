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


FACEBOOK_PAGE_ID = os.environ.get("FACEBOOK_PAGE_ID", "")


def get_facebook_page_token(user_token, page_id):
    """שולף Facebook page access token מ-/me/accounts."""
    resp = requests.get(
        f"{GRAPH_API}/me/accounts",
        params={"access_token": user_token, "limit": 50},
        timeout=30,
    )
    if not resp.ok:
        print(f"⚠️  /me/accounts נכשל: {resp.status_code} — {resp.text}")
        return None
    pages = resp.json().get("data", [])
    for page in pages:
        if page.get("id") == page_id:
            token = page.get("access_token")
            print(f"✅ נמצא עמוד: {page.get('name')} (ID: {page_id})")
            return token
    print(f"⚠️  עמוד {page_id} לא נמצא ב-/me/accounts. עמודים זמינים: {[p.get('id') for p in pages]}")
    return None


def main():
    if not all([META_APP_ID, META_APP_SECRET, INSTAGRAM_PAGE_TOKEN, GH_PAT]):
        print("❌ חסרים משתני סביבה: META_APP_ID, META_APP_SECRET, INSTAGRAM_PAGE_TOKEN, GH_PAT")
        sys.exit(1)

    print("🔄 מחדש Meta USER token...")
    new_user_token = refresh_user_token(INSTAGRAM_PAGE_TOKEN)
    validate_token(new_user_token, "USER token חדש")

    print("🔐 מקבל מפתח הצפנה של GitHub...")
    key_id, public_key = get_repo_public_key()

    print("💾 מעדכן GitHub Secret: INSTAGRAM_PAGE_TOKEN...")
    update_github_secret("INSTAGRAM_PAGE_TOKEN", new_user_token, key_id, public_key)

    if FACEBOOK_PAGE_ID:
        print("🔄 שולף Facebook Page token מ-/me/accounts...")
        fb_token = get_facebook_page_token(new_user_token, FACEBOOK_PAGE_ID)
        if fb_token:
            update_github_secret("FACEBOOK_PAGE_TOKEN", fb_token, key_id, public_key)
        else:
            print("⚠️  לא עודכן FACEBOOK_PAGE_TOKEN — עמוד לא נמצא")
    else:
        print("ℹ️  FACEBOOK_PAGE_ID לא מוגדר — מדלג על Facebook token")

    print("🎉 חידוש טוקן הושלם בהצלחה!")


if __name__ == "__main__":
    main()
