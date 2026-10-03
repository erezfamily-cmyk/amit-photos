"""
refresh_token.py
----------------
Refreshes the Google OAuth token and writes token.json for GitHub Actions.

Run:
  python src/refresh_token.py

Requires:
  credentials.json in the repository root.
"""

import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
CREDENTIALS_FILE = ROOT / "credentials.json"
TOKEN_FILE = ROOT / "token.json"
SCOPES = ["https://www.googleapis.com/auth/drive"]


def main():
    sys.stdout.reconfigure(encoding="utf-8")

    if not CREDENTIALS_FILE.exists():
        print("Missing credentials.json in the repository root.")
        sys.exit(1)

    try:
        from google_auth_oauthlib.flow import InstalledAppFlow
    except ImportError:
        print("Missing packages. Run:")
        print("pip install google-auth google-auth-oauthlib google-auth-httplib2")
        sys.exit(1)

    print("Opening Google authorization in your browser...")
    print("Approve full Google Drive access for automatic HIDE/RESTORE.")
    print()

    flow = InstalledAppFlow.from_client_secrets_file(str(CREDENTIALS_FILE), SCOPES)
    creds = flow.run_local_server(port=8765, open_browser=True, timeout_seconds=120)

    TOKEN_FILE.write_text(creds.to_json(), encoding="utf-8")
    print(f"Token saved to: {TOKEN_FILE}")
    print()
    print("PowerShell:")
    print("Get-Content -Raw token.json | gh secret set GOOGLE_TOKEN")
    print("gh workflow run update-photos.yml")


if __name__ == "__main__":
    main()
