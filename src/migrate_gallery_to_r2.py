"""
migrate_gallery_to_r2.py
-------------------------
מעביר גלריית photos.json מ-Google Drive ל-Cloudflare R2 (WebP).
שומר את ה-Drive ID כ-R2 key — לא יוצר UUIDs חדשים, לא שובר את ה-merge.

מה מעלה לכל תמונה:
  {drive_id}.webp        ← מלאה (1600px, quality 85) — לייטבוקס
  thumb/{drive_id}.webp  ← thumbnail (800px, quality 75) — רשת הגלריה

מעדכן photos.json ישירות (url + thumbnail).
ניתן לעצור ולחזור — שומר progress.

הרצה:
  python src/migrate_gallery_to_r2.py             # הכל
  python src/migrate_gallery_to_r2.py --limit 5  # בדיקה על 5
  python src/migrate_gallery_to_r2.py --dry-run  # בלי העלאה
"""

import argparse, io, json, os, sys, time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from PIL import Image
import requests

# ── קבועים ────────────────────────────────────────────────────────────
REPO      = Path(__file__).parent.parent
BUCKET    = "amit-photos-images"
PHOTOS    = REPO / "data" / "photos.json"
PROGRESS  = REPO / "data" / ".gallery_r2_progress.json"
SCOPES    = ["https://www.googleapis.com/auth/drive.readonly"]
DRIVE_API = "https://www.googleapis.com/drive/v3"

FULL_PX      = 1600
THUMB_PX     = 800
FULL_QUALITY = 85
THUMB_QUALITY = 75
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
WORKER_URL     = os.environ.get("WORKER_URL", "https://amitphotos.com")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")

# ── Google Drive auth ─────────────────────────────────────────────────
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

# ── הורדה מ-Drive ─────────────────────────────────────────────────────
def download(session, drive_id):
    """מנסה Drive API עם auth, fallback לthumbnail endpoint."""
    # Drive API — מקבל קובץ מקורי
    try:
        r = session.get(
            f"{DRIVE_API}/files/{drive_id}", params={"alt": "media"}, timeout=60
        )
        ct = r.headers.get("Content-Type", "")
        if r.ok and "html" not in ct and len(r.content) > 5_000:
            return r.content
    except Exception:
        pass

    # fallback: thumbnail endpoint (ללא auth)
    for attempt in range(3):
        try:
            r = requests.get(
                f"https://drive.google.com/thumbnail?id={drive_id}&sz=w{FULL_PX}",
                headers=UA, timeout=30,
            )
            if r.ok and len(r.content) > 5_000:
                return r.content
        except Exception:
            pass
        time.sleep(2 ** attempt)

    raise RuntimeError("הורדה נכשלה")

# ── המרה ל-WebP ───────────────────────────────────────────────────────
def to_webp(data, quality, max_px=None):
    img = Image.open(io.BytesIO(data))
    if img.mode != "RGB":
        img = img.convert("RGB")
    if max_px and max(img.size) > max_px:
        ratio = max_px / max(img.size)
        img = img.resize(
            (int(img.width * ratio), int(img.height * ratio)), Image.LANCZOS
        )
    buf = io.BytesIO()
    img.save(buf, "WEBP", quality=quality, method=6)
    return buf.getvalue()

# ── העלאה ל-R2 דרך Worker endpoint ──────────────────────────────────
def upload_r2(key, data):
    """שולח WebP ל-Worker שמאחסן ב-R2 עם key מדויק (ללא UUID חדש)."""
    r = requests.post(
        f"{WORKER_URL}/api/repair-r2",
        headers={"X-Admin-Password": ADMIN_PASSWORD},
        files={"file": (key.split("/")[-1], data, "image/webp")},
        data={"key": key},
        timeout=60,
    )
    if not r.ok:
        raise RuntimeError(f"Worker {r.status_code}: {r.text[:200]}")

# ── עיבוד תמונה אחת ──────────────────────────────────────────────────
def process_one(session, photo, progress, dry_run):
    drive_id = photo.get("id", "").strip()
    if not drive_id or drive_id in progress:
        return None  # כבר בוצע

    raw        = download(session, drive_id)
    full_webp  = to_webp(raw, FULL_QUALITY)
    thumb_webp = to_webp(raw, THUMB_QUALITY, max_px=THUMB_PX)

    if not dry_run:
        upload_r2(f"{drive_id}.webp", full_webp)
        upload_r2(f"thumb/{drive_id}.webp", thumb_webp)

    return {
        "url":       f"/photos/{drive_id}.webp",
        "thumbnail": f"/photos/thumb/{drive_id}.webp",
        "kb":        (len(full_webp) + len(thumb_webp)) // 1024,
    }

# ── Main ──────────────────────────────────────────────────────────────
def main():
    sys.stdout.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser()
    parser.add_argument("--limit",   type=int, default=0, help="בדיקה על N תמונות")
    parser.add_argument("--workers", type=int, default=3, help="הורדות מקבילות (ברירה: 3)")
    parser.add_argument("--dry-run", action="store_true", help="בלי העלאה לR2")
    args = parser.parse_args()

    photos   = json.loads(PHOTOS.read_text(encoding="utf-8"))
    progress = json.loads(PROGRESS.read_text()) if PROGRESS.exists() else {}
    photo_map = {p["id"]: p for p in photos if p.get("id")}

    pending = [p for p in photos if p.get("id") and p["id"] not in progress]
    if args.limit:
        pending = pending[:args.limit]

    prefix = "[DRY-RUN] " if args.dry_run else ""
    print(f"{prefix}סה\"כ: {len(photos)} | כבר בוצעו: {len(progress)} | נשארו: {len(pending)}")
    print(f"WebP: full={FULL_PX}px q{FULL_QUALITY} | thumb={THUMB_PX}px q{THUMB_QUALITY}")

    session = get_drive_session()
    done, errors = 0, []

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {
            pool.submit(process_one, session, p, progress, args.dry_run): p
            for p in pending
        }

        for i, fut in enumerate(as_completed(futures), 1):
            photo = futures[fut]
            pid   = photo.get("id", "")
            try:
                result = fut.result()
                if result is None:
                    continue
                # עדכן photos.json בזיכרון
                photo_map[pid]["url"]       = result["url"]
                photo_map[pid]["thumbnail"] = result["thumbnail"]
                progress[pid] = {"url": result["url"], "thumbnail": result["thumbnail"]}
                done += 1
                print(f"[{done+len(progress)-done:>4}/{len(photos)}] ✓ {pid[:20]}  {result['kb']}KB")
            except Exception as e:
                errors.append(pid)
                print(f"[{'ERR':>4}] ✗ {pid[:20]} — {str(e)[:80]}")

            # שמור כל 10 תמונות
            if done % 10 == 0 and done > 0:
                _save(photos, progress)

    _save(photos, progress)
    print(f"\n{'DRY-RUN — ' if args.dry_run else ''}סיים: ✓ {done} הועלו | ✗ {len(errors)} שגיאות")
    if errors:
        print("שגיאות (10 ראשונות):", errors[:10])

def _save(photos, progress):
    PROGRESS.write_text(json.dumps(progress, ensure_ascii=False))
    PHOTOS.write_text(json.dumps(photos, ensure_ascii=False, indent=2), encoding="utf-8")

if __name__ == "__main__":
    main()
