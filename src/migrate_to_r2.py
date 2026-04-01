"""
migrate_to_r2.py
----------------
מעביר תמונות מ-Google Drive ל-Cloudflare R2 + שומר מטא-דאטה ב-D1 דרך Worker API.

הרצה:
  python src/migrate_to_r2.py            # מעביר הכל
  python src/migrate_to_r2.py --dry-run  # רק מציג, לא מעביר
"""
import json, os, sys, time
from pathlib import Path
import requests

ROOT = Path(__file__).parent.parent
DATA_FILE = ROOT / "data" / "photos.json"

WORKER_URL = os.environ.get("WORKER_URL", "https://amitphotos.com")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")

def auth_headers():
    return {"X-Admin-Password": ADMIN_PASSWORD}

def already_migrated():
    """שלוף IDs שכבר ב-D1"""
    try:
        r = requests.get(f"{WORKER_URL}/api/photos", headers=auth_headers(), timeout=15)
        if r.ok:
            return {p["filename"] for p in r.json()}
    except Exception as e:
        print(f"⚠️  לא ניתן לגשת ל-API: {e}")
    return set()

def migrate_photo(photo, dry_run=False):
    """הורד מ-Drive והעלה ל-R2 דרך Worker"""
    file_id = photo.get("id", "")
    thumb_url = f"https://drive.google.com/uc?export=download&id={file_id}"

    # הורד תמונה
    try:
        res = requests.get(thumb_url, timeout=30, stream=True)
        if not res.ok:
            print(f"  ⚠️  לא ניתן להוריד (status {res.status_code})")
            return False
        content = res.content
        content_type = res.headers.get("Content-Type", "image/jpeg")
        ext = "jpg" if "jpeg" in content_type else content_type.split("/")[-1].split(";")[0].strip()
        filename = photo.get("filename") or f"{file_id}.{ext}"
    except Exception as e:
        print(f"  ⚠️  שגיאת הורדה: {e}")
        return False

    if dry_run:
        print(f"  [dry-run] היה מעלה {filename} ({len(content)/1024:.0f}KB)")
        return True

    # העלה ל-R2 דרך Worker
    try:
        upload = requests.post(
            f"{WORKER_URL}/api/upload",
            headers=auth_headers(),
            files={"file": (filename, content, content_type)},
            data={
                "title": photo.get("title", ""),
                "category": photo.get("category", ""),
                "description": photo.get("description", ""),
            },
            timeout=60,
        )
        if upload.ok:
            return True
        else:
            print(f"  ⚠️  שגיאת העלאה: {upload.status_code} {upload.text[:100]}")
            return False
    except Exception as e:
        print(f"  ⚠️  שגיאת העלאה: {e}")
        return False

def main():
    sys.stdout.reconfigure(encoding="utf-8")
    dry_run = "--dry-run" in sys.argv

    if not ADMIN_PASSWORD:
        print("❌ חסר ADMIN_PASSWORD כ-environment variable")
        sys.exit(1)

    with open(DATA_FILE, encoding="utf-8") as f:
        photos = json.load(f)

    print(f"📂 נמצאו {len(photos)} תמונות ב-photos.json")

    migrated_set = set() if dry_run else already_migrated()
    print(f"✅ כבר מועברות: {len(migrated_set)}")

    to_migrate = [p for p in photos if p.get("filename") not in migrated_set]
    print(f"🔄 נשארות להעברה: {len(to_migrate)}\n")

    success, fail = 0, 0
    for i, photo in enumerate(to_migrate):
        title = photo.get("title") or photo.get("id", "")
        print(f"[{i+1}/{len(to_migrate)}] {title} ({photo.get('category', '')})...", end=" ", flush=True)
        ok = migrate_photo(photo, dry_run=dry_run)
        if ok:
            success += 1
            print("✓")
        else:
            fail += 1
            print("✗")
        if not dry_run:
            time.sleep(0.3)  # נחכה קצת בין העלאות

    print(f"\n{'[dry-run] ' if dry_run else ''}✅ הועברו: {success} | ✗ נכשלו: {fail}")

if __name__ == "__main__":
    main()
