#!/usr/bin/env python3
"""
YouTube OAuth — הרץ פעם אחת על המחשב שלך.

שלבים:
  1. pip install google-auth-oauthlib google-api-python-client
  2. Google Cloud Console → YouTube Data API v3 → OAuth 2.0 Client (Desktop)
  3. הורד client_secrets.json לתיקיית הפרויקט
  4. python src/youtube_auth.py
  5. העתק את הפלט (base64) → GitHub Secret: YOUTUBE_TOKEN_JSON
"""

import json, base64, sys
from pathlib import Path

try:
    from google_auth_oauthlib.flow import InstalledAppFlow
except ImportError:
    print("חסר: pip install google-auth-oauthlib")
    sys.exit(1)

SCOPES = ["https://www.googleapis.com/auth/youtube.upload"]
SECRETS = Path("client_secrets.json")

if not SECRETS.exists():
    print("❌ חסר client_secrets.json")
    print("   הורד מ: Google Cloud Console → APIs & Services → Credentials")
    sys.exit(1)

flow  = InstalledAppFlow.from_client_secrets_file(str(SECRETS), SCOPES)
creds = flow.run_local_server(port=0)

encoded = base64.b64encode(creds.to_json().encode()).decode()
print("\n" + "=" * 60)
print("הוסף את זה כ-GitHub Secret בשם: YOUTUBE_TOKEN_JSON")
print("=" * 60)
print(encoded)
print("=" * 60)
