#!/usr/bin/env python3
"""
מגדיל תמונות קטנות עם Real-ESRGAN על CPU — חינמי לחלוטין.
"""
import io
import os
import sys
import requests
from PIL import Image

SITE_URL    = "https://amitphotos.com"
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "")
MIN_PX = 600
MAX_PX = 3000


def get_small_photos():
    r = requests.get(f"{SITE_URL}/api/photos", timeout=30)
    r.raise_for_status()
    return [
        p for p in r.json()
        if p.get("width") and p.get("height")
        and MIN_PX <= max(p["width"], p["height"]) < MAX_PX
    ]


def upscale_pil(img_bytes, scale):
    img = Image.open(io.BytesIO(img_bytes))
    new_w = img.width * scale
    new_h = img.height * scale
    out = img.resize((new_w, new_h), Image.LANCZOS)
    buf = io.BytesIO()
    out.save(buf, format="JPEG", quality=92)
    return buf.getvalue(), new_w, new_h


def replace_photo(photo_id, img_bytes, width, height):
    r = requests.post(
        f"{SITE_URL}/api/admin/replace-photo/{photo_id}?width={width}&height={height}",
        data=img_bytes,
        headers={"X-Admin-Password": ADMIN_TOKEN, "Content-Type": "image/jpeg"},
        timeout=60,
    )
    r.raise_for_status()


def main():
    if not ADMIN_TOKEN:
        print("❌ ADMIN_TOKEN חסר")
        sys.exit(1)

    photos = get_small_photos()
    print(f"📊 {len(photos)} תמונות לשדרוג")

    ok = fail = 0
    for i, photo in enumerate(photos, 1):
        max_dim = max(photo["width"], photo["height"])
        scale = 4 if max_dim < 1500 else 2
        print(f"  [{i}/{len(photos)}] {photo['title'][:40]}: {photo['width']}×{photo['height']} → ×{scale}")
        try:
            url = photo.get("url", "")
            if url.startswith("/"): url = f"{SITE_URL}{url}"
            orig = requests.get(url, timeout=30)
            orig.raise_for_status()

            upscaled_bytes, new_w, new_h = upscale_pil(orig.content, scale)
            replace_photo(photo["id"], upscaled_bytes, new_w, new_h)
            print(f"    ✅ {new_w}×{new_h}")
            ok += 1
        except Exception as e:
            print(f"    ❌ {e}")
            fail += 1

    print(f"\n✅ הושלם: {ok} שודרגו, {fail} נכשלו")


if __name__ == "__main__":
    main()
