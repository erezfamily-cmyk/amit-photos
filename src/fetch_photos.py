"""
fetch_photos.py
---------------
שולף תמונות מ-Google Drive, מייצר שתי גרסאות לכל תמונה:
  - thumb: מוקטן לרשת (600px, איכות 80)
  - full:  לתצוגה מלאה בלייטבוקס (1920px, איכות 85)

ומייצר data/photos.json עם נתיבים מקומיים.

מבנה התיקיות ב-Drive:
  My Drive/
  └── Portfolio/
      ├── טבע/
      ├── ישראל/
      └── ...

הרצה:
  python src/fetch_photos.py --list    # רק מציג קטגוריות
  python src/fetch_photos.py           # שולף + יוצר כותרות AI אוטומטיות
  python src/fetch_photos.py --no-ai   # בלי AI, כותרות = שם קובץ

נדרש: ANTHROPIC_API_KEY מוגדר בסביבה לצורך כותרות AI.
"""

import io
import json
import sys
from pathlib import Path

# ===== PATHS =====
ROOT = Path(__file__).parent.parent
DATA_FILE = ROOT / "data" / "photos.json"
PHOTOS_DIR = ROOT / "assets" / "photos"
CREDENTIALS_FILE = ROOT / "credentials.json"
TOKEN_FILE = ROOT / "token.json"

# ===== CONFIG =====
PORTFOLIO_FOLDER = "Portfolio"

SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]

DRIVE_API = "https://www.googleapis.com/drive/v3"

# רזולוציות
THUMB_MAX = 600    # px — תמונות ברשת הגלריה
FULL_MAX  = 1920   # px — תצוגה מלאה בלייטבוקס

THUMB_QUALITY = 80
FULL_QUALITY  = 85


def get_credentials():
    try:
        from google.oauth2.credentials import Credentials
        from google.auth.transport.requests import Request
        from google_auth_oauthlib.flow import InstalledAppFlow
    except ImportError:
        print("❌ חסרות חבילות Python. הרץ: pip install -r requirements.txt")
        sys.exit(1)

    creds = None
    if TOKEN_FILE.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not CREDENTIALS_FILE.exists():
                print("❌ לא נמצא credentials.json.")
                sys.exit(1)
            flow = InstalledAppFlow.from_client_secrets_file(str(CREDENTIALS_FILE), SCOPES)
            creds = flow.run_local_server(port=0)

        with open(TOKEN_FILE, "w") as f:
            f.write(creds.to_json())
        print("✓ אימות הצליח, token נשמר.")

    return creds


def drive_get(session, endpoint, params=None):
    import requests
    res = session.get(f"{DRIVE_API}/{endpoint}", params=params)
    if not res.ok:
        print(f"❌ שגיאה {res.status_code}: {res.text[:200]}")
        res.raise_for_status()
    return res.json()


def find_folder(session, name, parent_id="root"):
    q = f"name='{name}' and mimeType='application/vnd.google-apps.folder' and '{parent_id}' in parents and trashed=false"
    data = drive_get(session, "files", {"q": q, "fields": "files(id,name)"})
    files = data.get("files", [])
    return files[0] if files else None


def list_subfolders(session, parent_id):
    q = f"mimeType='application/vnd.google-apps.folder' and '{parent_id}' in parents and trashed=false"
    data = drive_get(session, "files", {
        "q": q, "fields": "files(id,name)", "orderBy": "name"
    })
    return data.get("files", [])


def list_drive_images(session, folder_id):
    """מחזיר מטא-דאטה של תמונות בתיקייה."""
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


def resize_and_save(img_bytes, out_path, max_px, quality):
    """מקטין תמונה ושומר כ-JPEG."""
    from PIL import Image
    img = Image.open(io.BytesIO(img_bytes))
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    img.thumbnail((max_px, max_px), Image.LANCZOS)
    img.save(out_path, "JPEG", quality=quality, optimize=True)


def download_image(session, file_id):
    """מוריד קובץ מ-Drive ומחזיר bytes."""
    import requests
    res = session.get(
        f"{DRIVE_API}/files/{file_id}",
        params={"alt": "media"},
        stream=True,
    )
    res.raise_for_status()
    return res.content


def load_existing_titles(data_file):
    """טוען כותרות קיימות מ-photos.json כדי לא לחשב מחדש."""
    if not data_file.exists():
        return {}
    try:
        with open(data_file, encoding="utf-8") as f:
            existing = json.load(f)
        return {p["id"]: p["title"] for p in existing if p.get("title")}
    except Exception:
        return {}


def is_generic_title(title, filename_stem):
    """בודק אם הכותרת היא שם קובץ גנרי (IMG_001 וכו')."""
    import re
    if title == filename_stem:
        return True
    return bool(re.match(r'^(IMG|DSC|DSCN|P|PIC|photo|image)[_\-]?\d+$', title, re.IGNORECASE))


def generate_title_ai(session, file_id, category):
    """שולח את התמונה ל-Claude Vision ומקבל כותרת עברית."""
    import base64
    try:
        import anthropic
    except ImportError:
        return None

    try:
        res = session.get(f"https://drive.google.com/thumbnail?id={file_id}&sz=w600", timeout=15)
        if not res.ok:
            return None
        img_b64 = base64.standard_b64encode(res.content).decode("utf-8")

        client = anthropic.Anthropic()
        message = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=30,
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {"type": "base64", "media_type": "image/jpeg", "data": img_b64},
                    },
                    {
                        "type": "text",
                        "text": (
                            f"זוהי תמונה מגלריית הצילום של הצלם עמית ארז, קטגוריה: {category}.\n"
                            "תן לתמונה כותרת קצרה ויפה בעברית — 2 עד 4 מילים בלבד.\n"
                            "החזר רק את הכותרת, ללא פיסוק נוסף."
                        ),
                    },
                ],
            }],
        )
        return message.content[0].text.strip().strip('"').strip("'")
    except Exception as e:
        print(f" ⚠️({e})", end="", flush=True)
        return None


def process_photo(session, f, category, existing_titles=None, use_ai=True):
    """מייצר dict לפוטוס.json עם URLs של Google Drive (ללא הורדה מקומית)."""
    file_id = f["id"]
    meta = f.get("imageMediaMetadata", {})
    filename_stem = Path(f["name"]).stem
    drive_desc = f.get("description", "").strip()

    # עדיפות: description בדרייב > כותרת קיימת לא-גנרית > AI > שם קובץ
    if drive_desc:
        title = drive_desc
    elif existing_titles and file_id in existing_titles and \
            not is_generic_title(existing_titles[file_id], filename_stem):
        title = existing_titles[file_id]  # שמור כותרת AI קיימת
    elif use_ai:
        print(" 🤖", end="", flush=True)
        title = generate_title_ai(session, file_id, category) or filename_stem
    else:
        title = filename_stem

    return {
        "id": file_id,
        "title": title,
        "category": category,
        "url":       f"https://drive.google.com/uc?export=view&id={file_id}",
        "thumbnail": f"https://drive.google.com/thumbnail?id={file_id}&sz=w600",
        "description": drive_desc,
        "filename": f["name"],
        "width":  meta.get("width",  1920),
        "height": meta.get("height", 1080),
    }


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    list_only = "--list" in sys.argv
    use_ai    = "--no-ai" not in sys.argv

    print("🔐 מתחבר ל-Google Drive...")
    creds = get_credentials()

    import requests
    from google.auth.transport.requests import Request as GoogleRequest
    if not creds.valid:
        creds.refresh(GoogleRequest())

    session = requests.Session()
    session.headers.update({"Authorization": f"Bearer {creds.token}"})

    print(f"📂 מחפש תיקייה '{PORTFOLIO_FOLDER}'...")
    portfolio = find_folder(session, PORTFOLIO_FOLDER)
    if not portfolio:
        print(f"\n❌ לא נמצאה תיקייה '{PORTFOLIO_FOLDER}' ב-Google Drive.")
        print(f"   צור תיקייה בשם '{PORTFOLIO_FOLDER}' ובתוכה תת-תיקיות לפי קטגוריה.")
        return

    categories = list_subfolders(session, portfolio["id"])
    if not categories:
        print(f"\n⚠️  לא נמצאו תת-תיקיות ב-'{PORTFOLIO_FOLDER}'.")
        return

    print(f"\n✓ נמצאו {len(categories)} קטגוריות:")
    for cat in categories:
        print(f"   📁 {cat['name']}")

    if list_only:
        print(f"\n💡 להריץ עם שליפה: python src/fetch_photos.py")
        return

    existing_titles = load_existing_titles(DATA_FILE)
    if use_ai:
        import os
        if not os.environ.get("ANTHROPIC_API_KEY"):
            print("⚠️  לא נמצא ANTHROPIC_API_KEY — כותרות יילקחו משם הקובץ.")
            print("   כדי להפעיל AI: set ANTHROPIC_API_KEY=sk-...")
            use_ai = False
        else:
            print(f"🤖 מצב AI פעיל — כותרות יווצרו אוטומטית")

    print("\n📸 מוריד ומעבד תמונות...")
    all_photos = []
    for cat in categories:
        files = list_drive_images(session, cat["id"])
        print(f"   📁 {cat['name']}: {len(files)} תמונות", end="", flush=True)
        for f in files:
            photo = process_photo(session, f, cat["name"], existing_titles, use_ai)
            all_photos.append(photo)
            print(".", end="", flush=True)
        print()

    if not all_photos:
        print("\n⚠️  לא נמצאו תמונות.")
        return

    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(all_photos, f, ensure_ascii=False, indent=2)

    thumb_total = sum((PHOTOS_DIR / "thumb").glob("*.jpg") and [1] or [0])
    print(f"\n✅ הושלם!")
    print(f"   {len(all_photos)} תמונות → data/photos.json")
    print(f"   תמונות שמורות ב-assets/photos/")
    print(f"\n💡 כדי לפרסם: git add . && git commit -m 'עדכון תמונות' && git push")


if __name__ == "__main__":
    main()
