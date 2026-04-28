"""
refresh_token.py
----------------
מחדש את ה-Google OAuth token ומדפיס פקודה לעדכון ה-secret ב-GitHub.

הרצה:
  python src/refresh_token.py

נדרש: credentials.json בתיקיית הפרויקט (מוריד מ-Google Cloud Console)
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
CREDENTIALS_FILE = ROOT / "credentials.json"
TOKEN_FILE = ROOT / "token.json"
SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]


def main():
    sys.stdout.reconfigure(encoding="utf-8")

    if not CREDENTIALS_FILE.exists():
        print("❌ חסר credentials.json בתיקיית הפרויקט.")
        sys.exit(1)

    try:
        from google_auth_oauthlib.flow import InstalledAppFlow
    except ImportError:
        print("❌ חסרות חבילות. הרץ:")
        print("   pip install google-auth google-auth-oauthlib google-auth-httplib2")
        sys.exit(1)

    print("🔐 מאמת Google — יפתח דפדפן...")
    print("   אחרי שתאשר בדפדפן, הטרמינל יסיים אוטומטית.")
    print()

    flow = InstalledAppFlow.from_client_secrets_file(str(CREDENTIALS_FILE), SCOPES)
    creds = flow.run_local_server(port=8765, open_browser=True, timeout_seconds=120)

    TOKEN_FILE.write_text(creds.to_json(), encoding="utf-8")
    print(f"✅ Token נשמר ל: {TOKEN_FILE}")
    print()
    print("=" * 50)
    print("עדכן את ה-secret ב-GitHub:")
    print()
    print("  gh secret set GOOGLE_TOKEN < token.json")
    print()
    print("ואז הרץ מחדש את ה-workflow:")
    print()
    print("  gh workflow run update-photos.yml")
    print("=" * 50)


if __name__ == "__main__":
    main()
