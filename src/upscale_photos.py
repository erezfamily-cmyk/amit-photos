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


def download_model(scale):
    import os
    model_name = f"EDSR_x{scale}.pb"
    if os.path.exists(model_name):
        return model_name
    url = f"https://github.com/Saafke/EDSR_Tensorflow/raw/master/models/{model_name}"
    r = requests.get(url, timeout=60)
    r.raise_for_status()
    with open(model_name, "wb") as f:
        f.write(r.content)
    return model_name


def upscale_opencv(img_bytes, scale):
    import numpy as np
    import cv2
    from cv2 import dnn_superres

    model_path = download_model(scale)
    sr = dnn_superres.DnnSuperResImpl_create()
    sr.readModel(model_path)
    sr.setModel("edsr", scale)

    nparr = np.frombuffer(img_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    output = sr.upsample(img)
    _, buf = cv2.imencode(".jpg", output, [cv2.IMWRITE_JPEG_QUALITY, 92])
    return buf.tobytes(), output.shape[1], output.shape[0]


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

            upscaled_bytes, new_w, new_h = upscale_opencv(orig.content, scale)
            replace_photo(photo["id"], upscaled_bytes, new_w, new_h)
            print(f"    ✅ {new_w}×{new_h}")
            ok += 1
        except Exception as e:
            print(f"    ❌ {e}")
            fail += 1

    print(f"\n✅ הושלם: {ok} שודרגו, {fail} נכשלו")


if __name__ == "__main__":
    main()
