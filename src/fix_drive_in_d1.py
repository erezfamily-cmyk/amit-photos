"""
fix_drive_in_d1.py
-------------------
מוצא תמונות ב-D1 שעדיין מצביעות ל-Drive, מוריד, ממיר ל-WebP, מעלה ל-R2,
ומעדכן את D1 עם ה-URL החדש דרך Worker API.

הרצה:
  python src/fix_drive_in_d1.py
  python src/fix_drive_in_d1.py --dry-run
"""

import io, json, os, re, sys, time, argparse
from pathlib import Path
import requests
from PIL import Image

REPO           = Path(__file__).parent.parent
WORKER_URL     = os.environ.get("WORKER_URL", "https://amitphotos.com")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")
SCOPES         = ["https://www.googleapis.com/auth/drive.readonly"]
DRIVE_API      = "https://www.googleapis.com/drive/v3"
WEBP_QUALITY   = 85
UA             = {"User-Agent": "Mozilla/5.0"}

def get_drive_session():
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
    creds = Credentials.from_authorized_user_file(str(REPO / "token.json"), SCOPES)
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {creds.token}", **UA})
    return s

def extract_drive_id(url):
    """מחלץ Drive file ID מ-URL."""
    m = re.search(r'[?&]id=([A-Za-z0-9_-]{10,})', url or '')
    return m.group(1) if m else None

def download(session, drive_id):
    """מוריד מ-Drive API. Fallback לthumbnail endpoint."""
    try:
        r = session.get(f"{DRIVE_API}/files/{drive_id}", params={"alt": "media"}, timeout=60)
        ct = r.headers.get("Content-Type", "")
        if r.ok and "html" not in ct and len(r.content) > 5000:
            return r.content
    except Exception:
        pass
    # fallback thumbnail
    for attempt in range(3):
        try:
            r = requests.get(f"https://drive.google.com/thumbnail?id={drive_id}&sz=w1600", headers=UA, timeout=30)
            if r.ok and len(r.content) > 5000:
                return r.content
        except Exception:
            pass
        time.sleep(2 ** attempt)
    raise RuntimeError(f"לא ניתן להוריד {drive_id}")

def to_webp(data, quality=WEBP_QUALITY):
    img = Image.open(io.BytesIO(data))
    if img.mode != "RGB":
        img = img.convert("RGB")
    buf = io.BytesIO()
    img.save(buf, "WEBP", quality=quality, method=6)
    return buf.getvalue()

def upload_r2(key, data):
    """מעלה ל-R2 דרך /api/repair-r2 עם key מוגדר."""
    r = requests.post(
        f"{WORKER_URL}/api/repair-r2",
        headers={"X-Admin-Password": ADMIN_PASSWORD},
        files={"file": (key.split("/")[-1], data, "image/webp")},
        data={"key": key},
        timeout=60,
    )
    if not r.ok:
        raise RuntimeError(f"R2 upload {r.status_code}: {r.text[:150]}")

def update_d1(photo_id, url, thumbnail, r2_key, dry_run):
    """מעדכן url+thumbnail+r2_key ב-D1 דרך Worker PATCH API."""
    if dry_run:
        print(f"  [dry-run] PATCH id={photo_id} url={url}")
        return
    r = requests.patch(
        f"{WORKER_URL}/api/photos",
        headers={"X-Admin-Password": ADMIN_PASSWORD, "Content-Type": "application/json"},
        json={"id": photo_id, "url": url, "thumbnail": thumbnail, "r2_key": r2_key},
        timeout=30,
    )
    if not r.ok:
        raise RuntimeError(f"D1 update {r.status_code}: {r.text[:150]}")

def main():
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not ADMIN_PASSWORD:
        print("❌ חסר ADMIN_PASSWORD")
        sys.exit(1)

    # שלוף תמונות Drive מ-API
    print("🔍 שולף תמונות Drive מ-D1...")
    r = requests.get(f"{WORKER_URL}/api/photos", timeout=30)
    all_photos = r.json()
    drive_photos = [
        p for p in all_photos
        if "drive.google" in (p.get("url") or "") or "drive.google" in (p.get("thumbnail") or "")
    ]
    print(f"נמצאו {len(drive_photos)} תמונות עם Drive URL\n")

    session = get_drive_session()
    done, errors = 0, []

    for i, photo in enumerate(drive_photos, 1):
        pid   = photo["id"]
        title = photo.get("title", pid[:16])
        url   = photo.get("url", "")
        thumb = photo.get("thumbnail", "")

        drive_id = extract_drive_id(url) or extract_drive_id(thumb)
        if not drive_id:
            print(f"[{i}/{len(drive_photos)}] ⚠️  לא נמצא Drive ID: {pid}")
            continue

        print(f"[{i}/{len(drive_photos)}] {title[:35]}...", end=" ", flush=True)
        try:
            raw       = download(session, drive_id)
            webp      = to_webp(raw)
            full_key  = f"{pid}.webp"          # key = D1 record id
            thumb_key = f"thumb/{pid}.webp"

            if not args.dry_run:
                upload_r2(full_key, webp)
                # thumbnail קטן יותר
                from PIL import Image as _I
                img = _I.open(io.BytesIO(raw)).convert("RGB")
                if max(img.size) > 800:
                    ratio = 800 / max(img.size)
                    img = img.resize((int(img.width*ratio), int(img.height*ratio)), _I.LANCZOS)
                buf = io.BytesIO()
                img.save(buf, "WEBP", quality=75, method=6)
                upload_r2(thumb_key, buf.getvalue())

            new_url   = f"/photos/{full_key}"
            new_thumb = f"/photos/{thumb_key}"
            update_d1(pid, new_url, new_thumb, full_key, args.dry_run)

            kb = len(webp) // 1024
            print(f"✓ ({kb}KB)")
            done += 1
        except Exception as e:
            print(f"✗ {str(e)[:70]}")
            errors.append(pid)
        time.sleep(0.5)

    print(f"\n{'[dry-run] ' if args.dry_run else ''}סיים: ✓ {done} | ✗ {len(errors)}")
    if errors:
        print("שגיאות:", errors)

if __name__ == "__main__":
    main()
