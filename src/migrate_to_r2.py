"""
migrate_to_r2.py
----------------
מעביר תמונות מ-Google Drive ל-Cloudflare R2 + שומר מטא-דאטה ב-D1 דרך Worker API.
משתמש ב-Google Drive API עם authentication כדי להימנע ממגבלות quota אנונימיות.

הרצה:
  python src/migrate_to_r2.py            # מעביר תמונות חדשות
  python src/migrate_to_r2.py --repair   # מתקן קבצים פגומים ב-R2 (HTML במקום תמונה)
  python src/migrate_to_r2.py --dry-run  # רק מציג, לא מעביר
"""
import json, os, sys, time
from pathlib import Path
import requests

ROOT = Path(__file__).parent.parent
DATA_FILE = ROOT / "data" / "photos.json"
CREDENTIALS_FILE = ROOT / "credentials.json"
TOKEN_FILE = ROOT / "token.json"
SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]
DRIVE_API = "https://www.googleapis.com/drive/v3"

WORKER_URL = os.environ.get("WORKER_URL", "https://amitphotos.com")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")

def auth_headers():
    return {"X-Admin-Password": ADMIN_PASSWORD}

def get_drive_session():
    """מחזיר requests.Session מאומת מול Google Drive."""
    try:
        from google.oauth2.credentials import Credentials
        from google.auth.transport.requests import Request
    except ImportError:
        print("❌ חסרות חבילות. הרץ: pip install google-auth google-auth-oauthlib google-auth-httplib2")
        sys.exit(1)

    creds = None
    creds_json = os.environ.get("GOOGLE_CREDENTIALS_JSON")
    token_json = os.environ.get("GOOGLE_TOKEN_JSON")

    if creds_json and token_json:
        tmp_token = ROOT / "token_tmp.json"
        tmp_token.write_text(token_json)
        creds = Credentials.from_authorized_user_file(str(tmp_token), SCOPES)
        if creds.expired and creds.refresh_token:
            creds.refresh(Request())
        tmp_token.unlink(missing_ok=True)
    elif TOKEN_FILE.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)
        if creds.expired and creds.refresh_token:
            creds.refresh(Request())
    else:
        print("❌ לא נמצאו Google credentials")
        return None

    session = requests.Session()
    session.headers.update({"Authorization": f"Bearer {creds.token}"})
    return session

def download_photo(drive_session, file_id):
    """הורד תמונה מ-Drive עם auth — מחזיר (content, content_type) או (None, None)."""
    # נסה Drive API עם alt=media
    res = drive_session.get(
        f"{DRIVE_API}/files/{file_id}",
        params={"alt": "media"},
        timeout=60,
    )
    if not res.ok:
        return None, None
    ct = res.headers.get("Content-Type", "image/jpeg")
    if "html" in ct or len(res.content) < 1000:
        return None, None  # HTML error page
    return res.content, ct

def already_migrated():
    """שלוף מ-D1 רשומות שכבר ב-R2 (url מתחיל ב-/photos/)."""
    try:
        r = requests.get(f"{WORKER_URL}/api/photos?admin=1", headers=auth_headers(), timeout=15)
        if r.ok:
            return {p["filename"]: p for p in r.json()
                    if p.get("filename") and (p.get("url") or "").startswith("/photos/")}
    except Exception as e:
        print(f"⚠️  לא ניתן לגשת ל-API: {e}")
    return {}

def is_r2_photo_valid(url):
    """בדוק אם ה-URL ב-R2 מחזיר תמונה אמיתית (לא HTML)."""
    try:
        res = requests.get(f"{WORKER_URL}{url}", timeout=15)
        ct = res.headers.get("Content-Type", "")
        return res.ok and "image" in ct
    except Exception:
        return False

def migrate_photo(drive_session, photo, dry_run=False):
    """הורד מ-Drive (עם auth) והעלה ל-R2 כרשומה חדשה ב-D1."""
    file_id = photo.get("id", "")
    filename = photo.get("filename") or f"{file_id}.jpg"

    content, content_type = download_photo(drive_session, file_id)
    if content is None:
        print(f"  ⚠️  לא ניתן להוריד")
        return False

    if dry_run:
        print(f"  [dry-run] היה מעלה {filename} ({len(content)/1024:.0f}KB)")
        return True

    try:
        upload = requests.post(
            f"{WORKER_URL}/api/upload",
            headers=auth_headers(),
            files={"file": (filename, content, content_type)},
            data={
                "title": photo.get("title", ""),
                "category": photo.get("category", ""),
                "description": photo.get("description", ""),
                "parent_category": photo.get("parent_category", ""),
                "published": "1",
            },
            timeout=60,
        )
        if upload.ok:
            return True
        print(f"  ⚠️  שגיאת העלאה: {upload.status_code} {upload.text[:100]}")
        return False
    except Exception as e:
        print(f"  ⚠️  שגיאת העלאה: {e}")
        return False

def repair_photo(drive_session, file_id, r2_key, dry_run=False):
    """הורד מ-Drive והחלף את תוכן R2 בלי לגעת ב-D1."""
    content, content_type = download_photo(drive_session, file_id)
    if content is None:
        print(f"  ⚠️  לא ניתן להוריד")
        return False

    if dry_run:
        print(f"  [dry-run] היה מתקן {r2_key} ({len(content)/1024:.0f}KB)")
        return True

    try:
        repair = requests.post(
            f"{WORKER_URL}/api/repair-r2",
            headers=auth_headers(),
            files={"file": (r2_key, content, content_type)},
            data={"key": r2_key},
            timeout=60,
        )
        if repair.ok:
            return True
        print(f"  ⚠️  שגיאת repair: {repair.status_code} {repair.text[:100]}")
        return False
    except Exception as e:
        print(f"  ⚠️  שגיאת repair: {e}")
        return False

def main():
    sys.stdout.reconfigure(encoding="utf-8")
    dry_run = "--dry-run" in sys.argv
    repair_mode = "--repair" in sys.argv

    if not ADMIN_PASSWORD:
        print("❌ חסר ADMIN_PASSWORD כ-environment variable")
        sys.exit(1)

    drive_session = get_drive_session()
    if not drive_session and not dry_run:
        print("❌ לא ניתן להתחבר ל-Google Drive")
        sys.exit(1)

    with open(DATA_FILE, encoding="utf-8") as f:
        photos = json.load(f)

    print(f"📂 נמצאו {len(photos)} תמונות ב-photos.json")

    if repair_mode:
        # מצא תמונות ב-D1 עם R2 URL שמחזירות HTML במקום תמונה
        print("🔍 בודק תמונות פגומות ב-R2...")
        migrated = set() if dry_run else already_migrated()
        json_by_filename = {p["filename"]: p for p in photos if p.get("filename")}

        to_repair = []
        for filename, d1_photo in (migrated.items() if migrated else {}.items()):
            r2_key = d1_photo.get("r2_key") or d1_photo.get("url", "").replace("/photos/", "")
            url = d1_photo.get("url", "")
            if not is_r2_photo_valid(url):
                json_photo = json_by_filename.get(filename)
                if json_photo:
                    to_repair.append((json_photo, r2_key))

        print(f"🔧 נמצאו {len(to_repair)} תמונות לתיקון\n")
        success, fail = 0, 0
        for i, (photo, r2_key) in enumerate(to_repair):
            title = photo.get("title") or photo.get("id", "")
            print(f"[{i+1}/{len(to_repair)}] {title}...", end=" ", flush=True)
            ok = repair_photo(drive_session, photo["id"], r2_key, dry_run=dry_run)
            if ok:
                success += 1
                print("✓")
            else:
                fail += 1
                print("✗")
            if not dry_run:
                time.sleep(0.5)

        print(f"\n{'[dry-run] ' if dry_run else ''}🔧 תוקנו: {success} | ✗ נכשלו: {fail}")
        return

    # מצב רגיל: העלאת תמונות חדשות
    migrated_set = set() if dry_run else set(already_migrated().keys())
    print(f"✅ כבר מועברות: {len(migrated_set)}")

    to_migrate = [p for p in photos if p.get("filename") not in migrated_set]
    print(f"🔄 נשארות להעברה: {len(to_migrate)}\n")

    success, fail = 0, 0
    for i, photo in enumerate(to_migrate):
        title = photo.get("title") or photo.get("id", "")
        print(f"[{i+1}/{len(to_migrate)}] {title} ({photo.get('category', '')})...", end=" ", flush=True)
        ok = migrate_photo(drive_session, photo, dry_run=dry_run)
        if ok:
            success += 1
            print("✓")
        else:
            fail += 1
            print("✗")
        if not dry_run:
            time.sleep(0.3)

    print(f"\n{'[dry-run] ' if dry_run else ''}✅ הועברו: {success} | ✗ נכשלו: {fail}")

if __name__ == "__main__":
    main()
