"""
pinterest_auth.py
-----------------
יוצר Pinterest Access Token עם הרשאות כתיבה דרך OAuth 2.0.

הרצה:
  python src/pinterest_auth.py

נדרש:
  PINTEREST_APP_ID     — App ID מ-developers.pinterest.com
  PINTEREST_APP_SECRET — App Secret מ-developers.pinterest.com
"""

import os
import sys
import json
import secrets
import webbrowser
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, urlencode
import urllib.request

APP_ID = os.environ.get("PINTEREST_APP_ID", "").strip()
APP_SECRET = os.environ.get("PINTEREST_APP_SECRET", "").strip()

REDIRECT_URI = "http://localhost:8888/callback"
SCOPES = "boards:read,boards:write,pins:read,pins:write"
AUTH_URL = "https://www.pinterest.com/oauth/"
TOKEN_URL = "https://api.pinterest.com/v5/oauth/token"

received_code = None


class CallbackHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        global received_code
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        if "code" in params:
            received_code = params["code"][0]
            self.send_response(200)
            self.send_header("Content-type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(b"<h1>Authorization successful! You can close this tab.</h1>")
        else:
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b"Error: no code received")

    def log_message(self, format, *args):
        pass  # suppress server logs


def main():
    if not APP_ID or not APP_SECRET:
        print("Usage:")
        print("  $env:PINTEREST_APP_ID='1560076'")
        print("  $env:PINTEREST_APP_SECRET='your-secret-here'")
        print("  python src/pinterest_auth.py")
        sys.exit(1)

    state = secrets.token_urlsafe(16)

    auth_params = {
        "client_id": APP_ID,
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "scope": SCOPES,
        "state": state,
    }

    auth_link = f"{AUTH_URL}?{urlencode(auth_params)}"
    print(f"\nפותח דפדפן לאימות Pinterest...")
    print(f"URL: {auth_link}\n")
    webbrowser.open(auth_link)

    print("ממתין לאימות...")
    server = HTTPServer(("localhost", 8888), CallbackHandler)
    server.handle_request()

    if not received_code:
        print("❌ לא התקבל code")
        sys.exit(1)

    print(f"✅ Code התקבל! מחליף ל-token...")

    # החלף code ל-token
    import base64
    credentials = base64.b64encode(f"{APP_ID}:{APP_SECRET}".encode()).decode()

    data = urlencode({
        "grant_type": "authorization_code",
        "code": received_code,
        "redirect_uri": REDIRECT_URI,
    }).encode()

    req = urllib.request.Request(TOKEN_URL, data=data, method="POST")
    req.add_header("Authorization", f"Basic {credentials}")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")

    with urllib.request.urlopen(req) as res:
        token_data = json.loads(res.read())

    access_token = token_data.get("access_token", "")
    if not access_token:
        print(f"❌ שגיאה: {token_data}")
        sys.exit(1)

    print(f"\n{'='*50}")
    print(f"✅ Token נוצר בהצלחה!")
    print(f"Scopes: {token_data.get('scope', '')}")
    print(f"\nעכשיו הרץ:")
    print(f'  gh secret set PINTEREST_ACCESS_TOKEN')
    print(f"  (הדבק את ה-token כשתתבקש)")
    print(f"\nה-Token:")
    print(access_token)


if __name__ == "__main__":
    main()
