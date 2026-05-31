#!/usr/bin/env python3
"""
generate_fb_token.py
--------------------
מריץ OAuth flow מקומי חד-פעמי כדי לקבל Facebook token עם הרשאות קריאה מלאות.
מעדכן אוטומטית את FACEBOOK_PAGE_TOKEN ב-GitHub Secrets.

שימוש:
    python src/generate_fb_token.py

דורש:
    META_APP_ID, META_APP_SECRET, FACEBOOK_PAGE_ID, GH_PAT כמשתני סביבה
    או: ערכים ישירות ב-CONSTANTS למטה.

תלויות:
    pip install requests PyNaCl
"""

import os
import sys
import json
import webbrowser
import requests
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, urlencode
from base64 import b64encode
from nacl import encoding, public

GRAPH_API  = "https://graph.facebook.com/v21.0"
GITHUB_API = "https://api.github.com"
REPO       = "erezfamily-cmyk/amit-photos"

REDIRECT_URI = "http://localhost:8989/callback"
PORT         = 8989

SCOPES = [
    "pages_manage_posts",
    "pages_read_engagement",
    "pages_show_list",
    "pages_read_user_content",
    "public_profile",
]

META_APP_ID     = os.environ.get("META_APP_ID", "")
META_APP_SECRET = os.environ.get("META_APP_SECRET", "")
FACEBOOK_PAGE_ID = os.environ.get("FACEBOOK_PAGE_ID", "")
GH_PAT          = os.environ.get("GH_PAT", "")

captured_code = None


class OAuthCallbackHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        global captured_code
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        if "code" in params:
            captured_code = params["code"][0]
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(b"<h2>&#10003; Token received! You can close this tab.</h2>")
        elif "error" in params:
            self.send_response(400)
            self.end_headers()
            self.wfile.write(f"Error: {params.get('error_description', ['Unknown'])[0]}".encode())
        else:
            self.send_response(200)
            self.end_headers()
        self.server._BaseServer__is_shut_down.set()

    def log_message(self, *args):
        pass


def get_long_lived_token(short_token):
    resp = requests.get(f"{GRAPH_API}/oauth/access_token", params={
        "grant_type":    "fb_exchange_token",
        "client_id":     META_APP_ID,
        "client_secret": META_APP_SECRET,
        "fb_exchange_token": short_token,
    }, timeout=30)
    if not resp.ok:
        print(f"❌ שגיאה בהמרה ל-long-lived: {resp.text}")
        sys.exit(1)
    return resp.json()["access_token"]


def get_page_token(user_token, page_id):
    resp = requests.get(f"{GRAPH_API}/me/accounts", params={
        "access_token": user_token,
        "limit": 50,
    }, timeout=30)
    if not resp.ok:
        print(f"❌ /me/accounts נכשל: {resp.text}")
        sys.exit(1)
    pages = resp.json().get("data", [])
    for page in pages:
        if page.get("id") == page_id:
            print(f"✅ נמצא עמוד: {page.get('name')} (ID: {page_id})")
            return page.get("access_token")
    print(f"❌ עמוד {page_id} לא נמצא. עמודים זמינים: {[(p.get('name'), p.get('id')) for p in pages]}")
    sys.exit(1)


def encrypt_secret(public_key_b64, secret_value):
    pk = public.PublicKey(public_key_b64.encode("utf-8"), encoding.Base64Encoder())
    sealed_box = public.SealedBox(pk)
    encrypted = sealed_box.encrypt(secret_value.encode("utf-8"))
    return b64encode(encrypted).decode("utf-8")


def update_github_secret(name, value):
    resp = requests.get(
        f"{GITHUB_API}/repos/{REPO}/actions/secrets/public-key",
        headers={"Authorization": f"Bearer {GH_PAT}", "Accept": "application/vnd.github+json"},
        timeout=30,
    )
    if not resp.ok:
        print(f"❌ GitHub public key: {resp.text}")
        sys.exit(1)
    key_data = resp.json()
    encrypted = encrypt_secret(key_data["key"], value)
    resp2 = requests.put(
        f"{GITHUB_API}/repos/{REPO}/actions/secrets/{name}",
        headers={"Authorization": f"Bearer {GH_PAT}", "Accept": "application/vnd.github+json"},
        json={"encrypted_value": encrypted, "key_id": key_data["key_id"]},
        timeout=30,
    )
    if not resp2.ok:
        print(f"❌ עדכון {name}: {resp2.text}")
        sys.exit(1)
    print(f"✅ עודכן GitHub Secret: {name}")


def main():
    missing = [v for v in ["META_APP_ID", "META_APP_SECRET", "FACEBOOK_PAGE_ID", "GH_PAT"] if not os.environ.get(v)]
    if missing:
        print(f"❌ חסרים משתני סביבה: {', '.join(missing)}")
        print("\nהרץ כך:")
        print("  $env:META_APP_ID='...'; $env:META_APP_SECRET='...'; $env:FACEBOOK_PAGE_ID='...'; $env:GH_PAT='...'; python src/generate_fb_token.py")
        sys.exit(1)

    auth_url = (
        f"https://www.facebook.com/dialog/oauth?"
        + urlencode({
            "client_id":     META_APP_ID,
            "redirect_uri":  REDIRECT_URI,
            "scope":         ",".join(SCOPES),
            "response_type": "code",
        })
    )

    print("🌐 פותח דפדפן לאישור הרשאות...")
    print(f"   אם הדפדפן לא נפתח אוטומטית, היכנס ל:\n   {auth_url}\n")
    webbrowser.open(auth_url)

    print(f"⏳ מחכה לאישור ב-http://localhost:{PORT}/callback ...")
    server = HTTPServer(("localhost", PORT), OAuthCallbackHandler)
    server.handle_request()

    if not captured_code:
        print("❌ לא התקבל authorization code")
        sys.exit(1)

    print("🔄 מחליף code ב-access token...")
    resp = requests.get(f"{GRAPH_API}/oauth/access_token", params={
        "client_id":     META_APP_ID,
        "client_secret": META_APP_SECRET,
        "redirect_uri":  REDIRECT_URI,
        "code":          captured_code,
    }, timeout=30)
    if not resp.ok:
        print(f"❌ שגיאה בחילוף code: {resp.text}")
        sys.exit(1)
    short_token = resp.json()["access_token"]
    print("✅ Short-lived user token התקבל")

    print("🔄 ממיר ל-long-lived token (60 יום)...")
    long_token = get_long_lived_token(short_token)
    print("✅ Long-lived user token")

    print(f"🔄 שולף Page token עבור {FACEBOOK_PAGE_ID}...")
    page_token = get_page_token(long_token, FACEBOOK_PAGE_ID)

    print("🔐 מעדכן GitHub Secrets...")
    update_github_secret("INSTAGRAM_PAGE_TOKEN", long_token)
    update_github_secret("FACEBOOK_PAGE_TOKEN", page_token)

    print("\n🎉 הכל עודכן! הדוח השבועי יציג עכשיו נתוני פייסבוק מלאים.")


if __name__ == "__main__":
    main()
