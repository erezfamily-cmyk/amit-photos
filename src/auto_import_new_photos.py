"""
auto_import_new_photos.py
--------------------------
מזהה תמונות חדשות ב-photos.json שלא קיימות ב-D1,
מוריד מ-Drive, ממיר ל-WebP, מעלה ל-R2, ומכניס ל-D1.

מריץ אחרי fetch_photos.py ב-update-photos.yml.

הרצה:
  python src/auto_import_new_photos.py
  python src/auto_import_new_photos.py --dry-run
"""

import argparse, io, json, os, sys, time
from pathlib import Path
from PIL import Image
import requests

REPO           = Path(__file__).parent.parent
PHOTOS_JSON    = REPO / "data" / "photos.json"
WORKER_URL     = os.environ.get("WORKER_URL", "https://amitphotos.com")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")
SCOPES         = ["https://www.googleapis.com/auth/drive.readonly"]
DRIVE_API      = "https://www.googleapis.com/drive/v3"
FULL_QUALITY   = 85
THUMB_QUALITY  = 75
THUMB_MAX_PX   = 800
UA             = {"User-Agent": "Mozilla/5.0"}

def get_drive_session():
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
    token_file = REPO / "token.json"
    creds = Credentials.from_authorized_user_file(str(token_file), SCOPES)
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {creds.token}", **UA})
    return s

def download(session, drive_id):
    try:
        r = session.get(f"{DRIVE_API}/files/{drive_id}", params={"alt": "media"}, timeout=60)
        ct = r.headers.get("Content-Type", "")
        if r.ok and "html" not in ct and len(r.content) > 5000:
            return r.content
    except Exception:
        pass
    for attempt in range(3):
        try:
            r = requests.get(f"https://drive.google.com/thumbnail?id={drive_id}&sz=w1600", headers=UA, timeout=30)
            if r.ok and len(r.content) > 5000:
                return r.content
        except Exception:
            pass
        time.sleep(2 ** attempt)
    raise RuntimeError(f"הורדה נכשלה: {drive_id}")

def to_webp(data, quality, max_px=None):
    img = Image.open(io.BytesIO(data))
    if img.mode != "RGB":
        img = img.convert("RGB")
    if max_px and max(img.size) > max_px:
        ratio = max_px / max(img.size)
        img = img.resize((int(img.width * ratio), int(img.height * ratio)), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "WEBP", quality=quality, method=6)
    return buf.getvalue()

def upload_r2(key, data):
    r = requests.post(
        f"{WORKER_URL}/api/repair-r2",
        headers={"X-Admin-Password": ADMIN_PASSWORD},
        files={"file": (key.split("/")[-1], data, "image/webp")},
        data={"key": key},
        timeout=60,
    )
    if not r.ok:
        raise RuntimeError(f"R2 upload {r.status_code}: {r.text[:100]}")

def import_to_d1(photo, url, thumbnail, r2_key, dry_run):
    if dry_run:
        print(f"  [dry-run] INSERT id={photo['id'][:20]} url={url}")
        return
    r = requests.post(
        f"{WORKER_URL}/api/admin/photos/import",
        headers={"X-Admin-Password": ADMIN_PASSWORD, "Content-Type": "application/json"},
        json={
            "id":          photo["id"],
            "title":       photo.get("title", ""),
            "category":    photo.get("category", ""),
            "description": photo.get("description", ""),
            "filename":    photo.get("filename", ""),
            "r2_key":      r2_key,
            "url":         url,
            "thumbnail":   thumbnail,
            "width":       photo.get("width", 0),
            "height":      photo.get("height", 0),
            "exif":        photo.get("exif", {}),
            "added_at":    photo.get("added_at", ""),
        },
        timeout=30,
    )
    if not r.ok:
        raise RuntimeError(f"D1 import {r.status_code}: {r.text[:100]}")
    result = r.json()
    if result.get("skipped"):
        return "skipped"
    return "inserted"

def main():
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not ADMIN_PASSWORD and not args.dry_run:
        print("❌ חסר ADMIN_PASSWORD")
        sys.exit(1)

    # מי כבר ב-D1 — לפי id ולפי filename (לזיהוי תמונות שעלו ב-UUID)
    print("🔍 מביא רשימת D1...")
    r = requests.get(f"{WORKER_URL}/api/photos", timeout=30)
    d1_photos = r.json()
    d1_ids       = {p["id"] for p in d1_photos}
    d1_filenames = {(p.get("filename") or "").strip() for p in d1_photos if p.get("filename")}
    print(f"   D1: {len(d1_ids)} תמונות, {len(d1_filenames)} עם filename")

    # מה ב-photos.json — חדש = לא ב-D1 לפי id ולא ב-D1 לפי filename
    photos_json = json.loads(PHOTOS_JSON.read_text(encoding="utf-8"))
    new_photos = [
        p for p in photos_json
        if p.get("id")
        and p["id"] not in d1_ids
        and (p.get("filename") or "").strip() not in d1_filenames
        and "drive.google" in (p.get("url") or "")
    ]
    print(f"   חדשות ממש מ-Drive: {len(new_photos)}")

    if not new_photos:
        print("✅ אין תמונות חדשות — הכל מסונכרן")
        return

    session = get_drive_session()
    done = skipped = errors = 0

    for i, photo in enumerate(new_photos, 1):
        drive_id = photo["id"]
        title    = photo.get("title", drive_id[:20])
        print(f"[{i}/{len(new_photos)}] {title[:35]}...", end=" ", flush=True)

        try:
            raw        = download(session, drive_id)
            full_webp  = to_webp(raw, FULL_QUALITY)
            thumb_webp = to_webp(raw, THUMB_QUALITY, max_px=THUMB_MAX_PX)

            full_key  = f"{drive_id}.webp"
            thumb_key = f"thumb/{drive_id}.webp"

            if not args.dry_run:
                upload_r2(full_key, full_webp)
                upload_r2(thumb_key, thumb_webp)

            new_url   = f"/photos/{full_key}"
            new_thumb = f"/photos/{thumb_key}"

            result = import_to_d1(photo, new_url, new_thumb, full_key, args.dry_run)

            if result == "skipped":
                skipped += 1
                print("⏭ כבר קיים")
            else:
                done += 1
                kb = (len(full_webp) + len(thumb_webp)) // 1024
                print(f"✓ ({kb}KB WebP)")

            # עדכן גם photos.json
            if not args.dry_run:
                photo["url"]       = new_url
                photo["thumbnail"] = new_thumb

        except Exception as e:
            errors += 1
            print(f"✗ {str(e)[:70]}")

        time.sleep(0.3)

    # שמור photos.json מעודכן
    if done > 0 and not args.dry_run:
        PHOTOS_JSON.write_text(
            json.dumps(photos_json, ensure_ascii=False, indent=2),
            encoding="utf-8"
        )
        print(f"\n✅ photos.json עודכן")

    print(f"\nסיים: ✓ {done} יובאו | ⏭ {skipped} קיימים | ✗ {errors} שגיאות")

if __name__ == "__main__":
    main()
