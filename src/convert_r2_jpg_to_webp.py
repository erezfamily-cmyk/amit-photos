"""
convert_r2_jpg_to_webp.py
--------------------------
ממיר 804 תמונות JPG ב-R2 ל-WebP.
מוריד מ-/photos/{key}, ממיר, מעלה מחדש, מעדכן D1.

הרצה:
  python src/convert_r2_jpg_to_webp.py             # הכל
  python src/convert_r2_jpg_to_webp.py --limit 5  # בדיקה
  python src/convert_r2_jpg_to_webp.py --dry-run
"""

import argparse, io, json, os, sys, time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from PIL import Image
import requests

REPO           = Path(__file__).parent.parent
WORKER_URL     = os.environ.get("WORKER_URL", "https://amitphotos.com")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")
PROGRESS       = REPO / "data" / ".jpg2webp_progress.json"

FULL_QUALITY  = 85
THUMB_QUALITY = 75
THUMB_MAX_PX  = 800

def to_webp(data, quality, max_px=None):
    img = Image.open(io.BytesIO(data))
    if img.mode != "RGB":
        img = img.convert("RGB")
    if max_px and max(img.size) > max_px:
        ratio = max_px / max(img.size)
        img = img.resize((int(img.width*ratio), int(img.height*ratio)), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "WEBP", quality=quality, method=6)
    return buf.getvalue()

def download_r2(key):
    """מוריד תמונה מ-R2 דרך ה-Worker."""
    r = requests.get(f"{WORKER_URL}/photos/{key}", timeout=60)
    if not r.ok:
        raise RuntimeError(f"download {r.status_code}: {key}")
    ct = r.headers.get("Content-Type", "")
    if "image" not in ct:
        raise RuntimeError(f"לא תמונה: {ct}")
    return r.content

def upload_r2(key, data, content_type="image/webp"):
    """מעלה ל-R2 דרך /api/repair-r2."""
    r = requests.post(
        f"{WORKER_URL}/api/repair-r2",
        headers={"X-Admin-Password": ADMIN_PASSWORD},
        files={"file": (key.split("/")[-1], data, content_type)},
        data={"key": key},
        timeout=60,
    )
    if not r.ok:
        raise RuntimeError(f"upload {r.status_code}: {r.text[:100]}")

def update_d1(photo_id, url, thumbnail, r2_key):
    """מעדכן D1 עם URLs החדשים."""
    r = requests.patch(
        f"{WORKER_URL}/api/photos",
        headers={"X-Admin-Password": ADMIN_PASSWORD, "Content-Type": "application/json"},
        json={"id": photo_id, "url": url, "thumbnail": thumbnail, "r2_key": r2_key},
        timeout=30,
    )
    if not r.ok:
        raise RuntimeError(f"D1 update {r.status_code}: {r.text[:100]}")

def process_one(photo, progress, dry_run):
    pid     = photo["id"]
    r2_key  = photo.get("r2_key") or photo.get("url", "").replace("/photos/", "")

    if not r2_key or not r2_key.endswith(".jpg") or pid in progress:
        return None  # דלג

    # מפתחות WebP חדשים
    base      = r2_key.replace(".jpg", "")
    new_key   = f"{base}.webp"
    new_thumb = f"thumb/{base}.webp"

    # הורד מקור
    raw = download_r2(r2_key)

    # המר
    full_webp  = to_webp(raw, FULL_QUALITY)
    thumb_webp = to_webp(raw, THUMB_QUALITY, max_px=THUMB_MAX_PX)

    if not dry_run:
        upload_r2(new_key,   full_webp)
        upload_r2(new_thumb, thumb_webp)
        update_d1(pid, f"/photos/{new_key}", f"/photos/{new_thumb}", new_key)

    orig_kb = len(raw) // 1024
    new_kb  = (len(full_webp) + len(thumb_webp)) // 1024
    saving  = round((1 - (len(full_webp) / len(raw))) * 100) if len(raw) else 0

    return {"key": new_key, "orig_kb": orig_kb, "new_kb": new_kb, "saving_pct": saving}

def main():
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit",   type=int, default=0)
    parser.add_argument("--workers", type=int, default=3)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if not ADMIN_PASSWORD and not args.dry_run:
        print("❌ חסר ADMIN_PASSWORD")
        sys.exit(1)

    # טען רשימה מ-D1
    r = requests.get(f"{WORKER_URL}/api/photos", timeout=30)
    all_photos = r.json()
    pending = [
        p for p in all_photos
        if (p.get("r2_key") or "").endswith(".jpg")
        or (p.get("url") or "").endswith(".jpg")
    ]

    progress = json.loads(PROGRESS.read_text()) if PROGRESS.exists() else {}
    pending  = [p for p in pending if p["id"] not in progress]
    if args.limit:
        pending = pending[:args.limit]

    total_orig = total_new = done = 0
    errors = []
    prefix = "[DRY-RUN] " if args.dry_run else ""
    print(f"{prefix}JPG→WebP: {len(pending)} תמונות | workers: {args.workers}")

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(process_one, p, progress, args.dry_run): p for p in pending}
        for i, fut in enumerate(as_completed(futures), 1):
            photo = futures[fut]
            pid   = photo["id"]
            try:
                result = fut.result()
                if result is None:
                    continue
                progress[pid] = result
                done += 1
                total_orig += result["orig_kb"]
                total_new  += result["new_kb"]
                print(f"[{done:>4}/{len(pending)}] ✓  {result['orig_kb']:>5}KB → {result['new_kb']:>5}KB  (-{result['saving_pct']}%)  {result['key'][-30:]}")
            except Exception as e:
                errors.append(pid)
                print(f"[ERR ] ✗  {str(e)[:80]}")

            if done % 20 == 0 and done > 0:
                PROGRESS.write_text(json.dumps(progress))

    PROGRESS.write_text(json.dumps(progress))
    saving_total = round((1 - total_new / total_orig) * 100) if total_orig else 0
    print(f"\n{prefix}סיים: ✓ {done} | ✗ {len(errors)}")
    print(f"גודל: {total_orig//1024}MB → {total_new//1024}MB (חיסכון {saving_total}%)")

if __name__ == "__main__":
    main()
