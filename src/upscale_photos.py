#!/usr/bin/env python3
"""
מגדיל תמונות קטנות עם Real-ESRGAN דרך Replicate API (חינמי).
מעלה את התוצאה חזרה ל-R2 ומעדכן ממדים ב-DB.
"""
import base64
import io
import os
import sys

import requests
from PIL import Image

SITE_URL        = "https://amitphotos.com"
ADMIN_TOKEN     = os.environ.get("ADMIN_TOKEN", "")
REPLICATE_TOKEN = os.environ.get("REPLICATE_API_TOKEN", "")

MIN_PX = 600    # דלג על תמונות קטנות מ-600px (בלתי ניתנות לשיקום)
MAX_PX = 3000   # שדרג רק תמונות שה-max-dim שלהן < 3000


def get_small_photos():
    r = requests.get(f"{SITE_URL}/api/photos", timeout=30)
    r.raise_for_status()
    photos = r.json()
    return [
        p for p in photos
        if p.get("width") and p.get("height")
        and MIN_PX <= max(p["width"], p["height"]) < MAX_PX
    ]


def upscale(img_bytes, scale):
    b64 = base64.b64encode(img_bytes).decode()
    data_url = f"data:image/jpeg;base64,{b64}"

    r = requests.post(
        "https://api.replicate.com/v1/predictions",
        headers={
            "Authorization": f"Token {REPLICATE_TOKEN}",
            "Content-Type": "application/json",
        },
        json={
            "version": "42fed1c4974146d4d2414e2be2c5277c7fcf05fcc3a73abf41610695738c1d7b",
            "input": {"image": data_url, "scale": scale, "face_enhance": False},
        },
        timeout=30,
    )
    r.raise_for_status()
    prediction_id = r.json()["id"]

    # poll until done
    import time
    for _ in range(60):
        time.sleep(4)
        poll = requests.get(
            f"https://api.replicate.com/v1/predictions/{prediction_id}",
            headers={"Authorization": f"Token {REPLICATE_TOKEN}"},
            timeout=15,
        )
        poll.raise_for_status()
        data = poll.json()
        status = data.get("status")
        if status == "succeeded":
            output_url = data["output"]
            result = requests.get(output_url, timeout=60)
            result.raise_for_status()
            return result.content
        if status in ("failed", "canceled"):
            raise RuntimeError(f"Replicate נכשל: {data.get('error')}")
    raise TimeoutError("Replicate timeout")


def replace_photo(photo_id, img_bytes, width, height):
    r = requests.post(
        f"{SITE_URL}/api/admin/replace-photo/{photo_id}?width={width}&height={height}",
        data=img_bytes,
        headers={"X-Admin-Password": ADMIN_TOKEN, "Content-Type": "image/jpeg"},
        timeout=60,
    )
    r.raise_for_status()


def main():
    if not REPLICATE_TOKEN:
        print("❌ REPLICATE_API_TOKEN חסר")
        sys.exit(1)
    if not ADMIN_TOKEN:
        print("❌ ADMIN_TOKEN חסר")
        sys.exit(1)

    photos = get_small_photos()
    print(f"📊 {len(photos)} תמונות לשדרוג (בין {MIN_PX}px ל-{MAX_PX}px)")

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

            upscaled_bytes = upscale(orig.content, scale)

            img = Image.open(io.BytesIO(upscaled_bytes))
            new_w, new_h = img.width, img.height

            replace_photo(photo["id"], upscaled_bytes, new_w, new_h)
            print(f"    ✅ {new_w}×{new_h}")
            ok += 1
        except Exception as e:
            print(f"    ❌ {e}")
            fail += 1

    print(f"\n✅ הושלם: {ok} שודרגו, {fail} נכשלו")


if __name__ == "__main__":
    main()
