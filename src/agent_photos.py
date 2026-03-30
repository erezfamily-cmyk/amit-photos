"""
agent_photos.py
---------------
Agent אוטומטי שסורק את Google Drive, מנתח תמונות עם Claude Vision,
מייצר כותרות בעברית וקטגוריות, ומעדכן את data/photos.json.

מבנה תיקיות ב-Drive:
  My Drive/
  └── Portfolio/
      ├── טבע/
      ├── ישראל/
      └── כל ספרייה חדשה = קטגוריה חדשה

הרצה:
  python src/agent_photos.py           # סריקה מלאה
  python src/agent_photos.py --dry-run # רק מציג, לא שומר
"""

import base64
import json
import os
import sys
import time
from pathlib import Path

# ===== PATHS =====
ROOT = Path(__file__).parent.parent
DATA_FILE = ROOT / "data" / "photos.json"
CREDENTIALS_FILE = ROOT / "credentials.json"
TOKEN_FILE = ROOT / "token.json"

# ===== CONFIG =====
PORTFOLIO_FOLDER = "Portfolio"
SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]
DRIVE_API = "https://www.googleapis.com/drive/v3"
ANTHROPIC_API = "https://api.anthropic.com/v1/messages"
ANTHROPIC_MODEL = "claude-haiku-4-5-20251001"  # מהיר וזול לניתוח תמונות

DRY_RUN = "--dry-run" in sys.argv


def get_drive_session():
    """מחזיר requests.Session מאומת מול Google Drive."""
    try:
        from google.oauth2.credentials import Credentials
        from google.auth.transport.requests import Request
        from google_auth_oauthlib.flow import InstalledAppFlow
    except ImportError:
        print("❌ חסרות חבילות. הרץ: pip install -r requirements.txt")
        sys.exit(1)

    import requests

    creds = None

    # תמיכה ב-GitHub Actions: קריאה ממשתני סביבה
    creds_json = os.environ.get("GOOGLE_CREDENTIALS_JSON")
    token_json = os.environ.get("GOOGLE_TOKEN_JSON")

    if creds_json and token_json:
        # כתוב לקבצים זמניים
        tmp_creds = ROOT / "credentials_tmp.json"
        tmp_token = ROOT / "token_tmp.json"
        tmp_creds.write_text(creds_json)
        tmp_token.write_text(token_json)
        creds = Credentials.from_authorized_user_file(str(tmp_token), SCOPES)
        if creds.expired and creds.refresh_token:
            creds.refresh(Request())
        tmp_creds.unlink(missing_ok=True)
        tmp_token.unlink(missing_ok=True)
    elif TOKEN_FILE.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)
        if creds.expired and creds.refresh_token:
            creds.refresh(Request())
    else:
        if not CREDENTIALS_FILE.exists():
            print("❌ לא נמצא credentials.json")
            sys.exit(1)
        flow = InstalledAppFlow.from_client_secrets_file(str(CREDENTIALS_FILE), SCOPES)
        creds = flow.run_local_server(port=0)
        with open(TOKEN_FILE, "w") as f:
            f.write(creds.to_json())

    session = requests.Session()
    session.headers.update({"Authorization": f"Bearer {creds.token}"})
    return session


def drive_get(session, endpoint, params=None):
    import requests
    res = session.get(f"{DRIVE_API}/{endpoint}", params=params)
    res.raise_for_status()
    return res.json()


def find_folder(session, name, parent_id="root"):
    q = f"name='{name}' and mimeType='application/vnd.google-apps.folder' and '{parent_id}' in parents and trashed=false"
    data = drive_get(session, "files", {"q": q, "fields": "files(id,name)"})
    files = data.get("files", [])
    return files[0] if files else None


def list_subfolders(session, parent_id):
    q = f"mimeType='application/vnd.google-apps.folder' and '{parent_id}' in parents and trashed=false"
    data = drive_get(session, "files", {"q": q, "fields": "files(id,name)", "orderBy": "name"})
    return data.get("files", [])


def list_images(session, folder_id):
    files = []
    page_token = None
    while True:
        params = {
            "q": f"'{folder_id}' in parents and mimeType contains 'image/' and trashed=false",
            "fields": "nextPageToken,files(id,name,description,imageMediaMetadata)",
            "pageSize": 100,
            "orderBy": "name",
        }
        if page_token:
            params["pageToken"] = page_token
        data = drive_get(session, "files", params)
        files.extend(data.get("files", []))
        page_token = data.get("nextPageToken")
        if not page_token:
            break
    return files


def download_thumbnail(session, file_id, max_size=800):
    """מוריד thumbnail מ-Drive לצורך ניתוח."""
    import requests
    url = f"https://drive.google.com/thumbnail?id={file_id}&sz=w{max_size}"
    res = session.get(url)
    if res.ok:
        return res.content
    # fallback — הורד ישירות
    res = session.get(f"{DRIVE_API}/files/{file_id}", params={"alt": "media"})
    res.raise_for_status()
    return res.content


def analyze_with_claude(image_bytes, filename, category, anthropic_key):
    """מנתח תמונה עם Claude Vision ומחזיר כותרת ותיאור בעברית."""
    import requests

    b64 = base64.standard_b64encode(image_bytes).decode("utf-8")

    prompt = f"""אתה עוזר לצלם מקצועי ישראלי לתייג תמונות.

הקטגוריה של התמונה: {category}
שם הקובץ המקורי: {filename}

תן לתמונה:
1. כותרת קצרה ויפה בעברית (2-5 מילים, ללא סימני פיסוק)
2. תיאור קצר בעברית (משפט אחד, עד 15 מילים)

ענה בפורמט JSON בלבד:
{{"title": "כותרת כאן", "description": "תיאור כאן"}}"""

    headers = {
        "x-api-key": anthropic_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }

    body = {
        "model": ANTHROPIC_MODEL,
        "max_tokens": 200,
        "messages": [{
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": "image/jpeg",
                        "data": b64,
                    }
                },
                {"type": "text", "text": prompt}
            ]
        }]
    }

    try:
        res = requests.post(ANTHROPIC_API, headers=headers, json=body, timeout=30)
        res.raise_for_status()
        content = res.json()["content"][0]["text"].strip()
        # נקה JSON אם יש ```
        if "```" in content:
            content = content.split("```")[1].replace("json", "").strip()
        data = json.loads(content)
        return data.get("title", ""), data.get("description", "")
    except Exception as e:
        print(f"⚠️  שגיאה בניתוח Claude: {e}")
        return Path(filename).stem, ""


def load_existing_photos():
    """טוען photos.json קיים כדי לא לנתח מחדש תמונות שכבר יש."""
    if DATA_FILE.exists():
        try:
            return {p["id"]: p for p in json.loads(DATA_FILE.read_text(encoding="utf-8"))}
        except Exception:
            pass
    return {}


def main():
    sys.stdout.reconfigure(encoding="utf-8")

    anthropic_key = os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("AMIT_PHOTO_AGENT")
    if not anthropic_key:
        print("❌ חסר ANTHROPIC_API_KEY במשתני הסביבה")
        sys.exit(1)

    print("🔐 מתחבר ל-Google Drive...")
    session = get_drive_session()

    print(f"📂 מחפש תיקייה '{PORTFOLIO_FOLDER}'...")
    portfolio = find_folder(session, PORTFOLIO_FOLDER)
    if not portfolio:
        print(f"❌ לא נמצאה תיקייה '{PORTFOLIO_FOLDER}' ב-Drive")
        sys.exit(1)

    categories = list_subfolders(session, portfolio["id"])
    if not categories:
        print("⚠️  לא נמצאו תת-תיקיות")
        sys.exit(1)

    print(f"✓ נמצאו {len(categories)} קטגוריות: {', '.join(c['name'] for c in categories)}")

    existing = load_existing_photos()
    print(f"📋 תמונות קיימות ב-JSON: {len(existing)}")

    all_photos = []
    new_count = 0

    for cat in categories:
        files = list_images(session, cat["id"])
        print(f"\n📁 {cat['name']}: {len(files)} תמונות")

        for f in files:
            file_id = f["id"]
            meta = f.get("imageMediaMetadata", {})

            # אם התמונה כבר קיימת — שמור כמות שהיא
            if file_id in existing:
                all_photos.append(existing[file_id])
                print(f"   ✓ {f['name']} (קיים)")
                continue

            # תמונה חדשה — נתח עם Claude
            print(f"   🤖 מנתח: {f['name']}...", end=" ", flush=True)

            try:
                img_bytes = download_thumbnail(session, file_id)
                title, description = analyze_with_claude(
                    img_bytes, f["name"], cat["name"], anthropic_key
                )
            except Exception as e:
                print(f"שגיאה: {e}")
                title = Path(f["name"]).stem
                description = ""

            photo = {
                "id": file_id,
                "title": title or Path(f["name"]).stem,
                "category": cat["name"],
                "url": f"https://drive.google.com/uc?export=view&id={file_id}",
                "thumbnail": f"https://drive.google.com/thumbnail?id={file_id}&sz=w600",
                "description": description,
                "filename": f["name"],
                "width": meta.get("width", 1920),
                "height": meta.get("height", 1080),
            }
            all_photos.append(photo)
            new_count += 1
            print(f'"{title}"')

            # המתן קצת כדי לא לחרוג ממגבלות API
            time.sleep(0.5)

    print(f"\n{'=' * 40}")
    print(f"✅ סה\"כ: {len(all_photos)} תמונות ({new_count} חדשות)")

    if DRY_RUN:
        print("🔍 Dry run — לא שומר")
        return

    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    DATA_FILE.write_text(
        json.dumps(all_photos, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )
    print(f"💾 נשמר ל-{DATA_FILE}")


if __name__ == "__main__":
    main()
