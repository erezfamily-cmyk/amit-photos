#!/usr/bin/env python3
"""
Puzzle Promo Post
מפרסם פוסט שבועי לאינסטגרם ופייסבוק עם הזמנה לשחק בפאזל ולקבל 20% הנחה.
"""

import os
import sys
import random
import base64
import requests
import anthropic
from pathlib import Path

SITE_URL   = "https://amitphotos.com"
GRAPH_API  = "https://graph.facebook.com/v21.0"
PUZZLE_URL = "https://amitphotos.com/puzzle/"

IG_USER_ID        = os.environ.get("INSTAGRAM_USER_ID", "")
IG_TOKEN          = os.environ.get("INSTAGRAM_PAGE_TOKEN", "")
FB_PAGE_ID        = os.environ.get("FACEBOOK_PAGE_ID", "")
FB_TOKEN          = os.environ.get("FACEBOOK_PAGE_TOKEN", "")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()
ADMIN_TOKEN       = os.environ.get("ADMIN_TOKEN", "")


def load_photos():
    try:
        resp = requests.get(f"{SITE_URL}/api/photos", timeout=15)
        resp.raise_for_status()
        photos = resp.json()
        valid = [p for p in photos if p.get("title") and not p["title"].upper().startswith("DSC_")]
        if valid:
            return valid
    except Exception as e:
        print(f"⚠️  API נכשל ({e})")
    sys.exit(1)


def fetch_image_as_base64(url, max_bytes=3_750_000):
    if url.startswith("/"):
        url = f"{SITE_URL}{url}"
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    img_bytes = resp.content
    try:
        from PIL import Image
        import io
        img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        if max(img.size) > 2000:
            img.thumbnail((2000, 2000), Image.LANCZOS)
        quality = 85
        while quality >= 40:
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=quality)
            img_bytes = buf.getvalue()
            if len(img_bytes) <= max_bytes:
                break
            quality -= 15
    except ImportError:
        pass
    return base64.standard_b64encode(img_bytes).decode("utf-8"), "image/jpeg"


def generate_caption(photo):
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    title    = photo.get("title", "")
    category = photo.get("category", "")

    thumbnail_url = photo.get("thumbnail") or photo.get("url")
    if thumbnail_url and thumbnail_url.startswith("/"):
        thumbnail_url = f"{SITE_URL}{thumbnail_url}"

    image_content = []
    try:
        b64, mime = fetch_image_as_base64(thumbnail_url)
        image_content = [{"type": "image", "source": {"type": "base64", "media_type": mime, "data": b64}}]
        print("🖼️  תמונה נטענה לניתוח Vision")
    except Exception as e:
        print(f"⚠️  לא הצלחתי להוריד תמונה ({e}) — ממשיך בלי Vision")

    prompt = f"""Write a social media post for Israeli photographer Amit inviting followers to play a sliding puzzle game.

The photo shown is: "{title}" (category: {category}).
The puzzle is at: {PUZZLE_URL}

Post structure:
1. One catchy opening sentence in Hebrew about this specific photo — what's in it, make it intriguing.
2. One sentence inviting to play: "פצחו את הפאזל וקבלו 20% הנחה על התמונה"
3. One sentence: the link is in the bio / {PUZZLE_URL}

Rules:
- Hebrew only
- Friendly, playful tone (not formal)
- No hashtags (added separately)
- Output only the post text"""

    msg = client.messages.create(
        model="claude-opus-4-8",
        max_tokens=300,
        messages=[{"role": "user", "content": image_content + [{"type": "text", "text": prompt}]}],
    )
    caption = msg.content[0].text.strip()
    hashtags = "#puzzle #פאזל #amitphotos #photography #צילום #ישראל #discount #art"
    return f"{caption}\n\n{hashtags}"


def get_image_url_for_post(photo):
    source_url = photo.get("url") or photo.get("thumbnail")
    if source_url and source_url.startswith("/"):
        source_url = f"{SITE_URL}{source_url}"
    if source_url and source_url.startswith(f"{SITE_URL}/"):
        print(f"⬆️  תמונה ב-R2, URL ישיר: {source_url}")
        return source_url

    print("⬆️  מעלה תמונה לשרת ציבורי...")
    resp = requests.get(source_url, timeout=30)
    resp.raise_for_status()
    img_bytes = resp.content

    if ADMIN_TOKEN:
        try:
            r = requests.post(
                f"{SITE_URL}/api/admin/upload-story",
                data=img_bytes,
                headers={"Authorization": f"Bearer {ADMIN_TOKEN}", "Content-Type": "image/jpeg"},
                timeout=60,
            )
            if r.ok:
                url = r.json().get("url", "")
                if url:
                    print(f"⬆️  הועלה (R2): {url}")
                    return url
        except Exception as e:
            print(f"⚠️  R2 upload נכשל ({e})")

    r = requests.post("https://0x0.st", files={"file": ("photo.jpg", img_bytes, "image/jpeg")}, timeout=60)
    r.raise_for_status()
    url = r.text.strip()
    print(f"⬆️  הועלה (0x0.st): {url}")
    return url


def post_to_instagram(image_url, caption):
    if not IG_USER_ID or not IG_TOKEN:
        print("⚠️  חסרים פרטי אינסטגרם — מדלג")
        return

    container = requests.post(f"{GRAPH_API}/{IG_USER_ID}/media", data={
        "image_url": image_url, "caption": caption, "access_token": IG_TOKEN,
    }, timeout=30)
    if not container.ok:
        print(f"❌ IG container נכשל: {container.status_code} — {container.text}")
        return
    container_id = container.json().get("id")

    import time
    for _ in range(10):
        time.sleep(5)
        status = requests.get(f"{GRAPH_API}/{container_id}", params={
            "fields": "status_code", "access_token": IG_TOKEN,
        }, timeout=30).json().get("status_code", "")
        if status == "FINISHED":
            break
        if status == "ERROR":
            print("❌ Container שגיאה")
            return

    publish = requests.post(f"{GRAPH_API}/{IG_USER_ID}/media_publish", data={
        "creation_id": container_id, "access_token": IG_TOKEN,
    }, timeout=30)
    if publish.ok:
        print(f"✅ פורסם לאינסטגרם! ID: {publish.json().get('id')}")
    else:
        print(f"❌ IG publish נכשל: {publish.status_code} — {publish.text}")


def post_to_facebook(image_url, caption):
    if not FB_PAGE_ID or not FB_TOKEN:
        print("⚠️  חסרים פרטי פייסבוק — מדלג")
        return

    resp = requests.post(f"{GRAPH_API}/{FB_PAGE_ID}/photos", data={
        "url": image_url, "message": caption, "access_token": FB_TOKEN,
    }, timeout=30)
    if resp.ok:
        print(f"✅ פורסם לפייסבוק! ID: {resp.json().get('id')}")
    else:
        print(f"❌ FB post נכשל: {resp.status_code} — {resp.text}")


def main():
    if not ANTHROPIC_API_KEY:
        print("❌ חסר ANTHROPIC_API_KEY")
        sys.exit(1)

    photos = load_photos()
    photo = random.choice(photos)
    print(f"📸 תמונה נבחרה: {photo['title']}")

    print("✍️  מייצר כיתוב...")
    caption = generate_caption(photo)
    print(f"\n--- פוסט ---\n{caption}\n-----------\n")

    image_url = get_image_url_for_post(photo)

    print("📤 מפרסם לסושיאל...")
    post_to_instagram(image_url, caption)
    post_to_facebook(image_url, caption)


if __name__ == "__main__":
    main()
