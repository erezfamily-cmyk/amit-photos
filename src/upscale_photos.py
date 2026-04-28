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


def upscale_realesrgan(img_bytes, scale):
    import numpy as np
    import cv2
    from realesrgan import RealESRGANer
    from basicsr.archs.rrdbnet_arch import RRDBNet

    model = RRDBNet(num_in_ch=3, num_out_ch=3, num_feat=64,
                    num_block=23, num_grow_ch=32, scale=scale)
    model_url = (
        f"https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/"
        f"RealESRGAN_x{scale}plus.pth"
    )
    upsampler = RealESRGANer(
        scale=scale,
        model_path=model_url,
        model=model,
        tile=256,
        tile_pad=10,
        pre_pad=0,
        half=False,
    )
    nparr = np.frombuffer(img_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    output, _ = upsampler.enhance(img, outscale=scale)
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

            upscaled_bytes, new_w, new_h = upscale_realesrgan(orig.content, scale)
            replace_photo(photo["id"], upscaled_bytes, new_w, new_h)
            print(f"    ✅ {new_w}×{new_h}")
            ok += 1
        except Exception as e:
            print(f"    ❌ {e}")
            fail += 1

    print(f"\n✅ הושלם: {ok} שודרגו, {fail} נכשלו")


if __name__ == "__main__":
    main()
