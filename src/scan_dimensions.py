#!/usr/bin/env python3
"""
סורק את כל התמונות, מודד רזולוציה עם PIL, ומעדכן width/height ב-DB.
"""
import io
import os
import sys
import requests
from PIL import Image

SITE_URL    = "https://amitphotos.com"
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "")
BATCH_SIZE  = 50


def fetch_all_photos():
    r = requests.get(f"{SITE_URL}/api/photos", timeout=30)
    r.raise_for_status()
    return r.json()


def measure(url):
    full = url if url.startswith("http") else f"{SITE_URL}{url}"
    r = requests.get(full, timeout=30)
    r.raise_for_status()
    img = Image.open(io.BytesIO(r.content))
    return img.width, img.height


def push_batch(updates):
    r = requests.post(
        f"{SITE_URL}/api/admin/photo-dimensions",
        json={"updates": updates},
        headers={"Authorization": f"Bearer {ADMIN_TOKEN}"},
        timeout=30,
    )
    r.raise_for_status()


def main():
    if not ADMIN_TOKEN:
        print("❌ ADMIN_TOKEN חסר")
        sys.exit(1)

    photos = fetch_all_photos()
    missing = [p for p in photos if not p.get("width")]
    total   = len(missing)
    print(f"📊 {len(photos)} תמונות בסה\"כ, {total} ללא ממדים")

    updates = []
    ok = fail = 0

    for i, photo in enumerate(missing, 1):
        url = photo.get("url") or photo.get("thumbnail", "")
        try:
            w, h = measure(url)
            updates.append({"id": photo["id"], "width": w, "height": h})
            ok += 1
            print(f"  [{i}/{total}] {photo['title'][:40]}: {w}×{h}")
        except Exception as e:
            fail += 1
            print(f"  [{i}/{total}] ⚠️  {photo['title'][:40]}: {e}")

        if len(updates) >= BATCH_SIZE:
            push_batch(updates)
            print(f"  💾 שמרתי {len(updates)} רשומות")
            updates.clear()

    if updates:
        push_batch(updates)
        print(f"  💾 שמרתי {len(updates)} רשומות")

    print(f"\n✅ הושלם: {ok} עודכנו, {fail} נכשלו")


if __name__ == "__main__":
    main()
