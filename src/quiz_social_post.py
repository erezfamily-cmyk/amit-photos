#!/usr/bin/env python3
"""
Quiz Promo Post
מפרסם פוסט שבועי לאינסטגרם ופייסבוק עם הזמנה לשחק בקוויז ולקבל 20% הנחה.
"""

import os
import sys
import random
import base64
import requests
import anthropic

SITE_URL  = "https://amitphotos.com"
GRAPH_API = "https://graph.facebook.com/v21.0"
QUIZ_URL  = "https://amitphotos.com/quiz/"

IG_USER_ID        = os.environ.get("INSTAGRAM_USER_ID", "")
IG_TOKEN          = os.environ.get("INSTAGRAM_PAGE_TOKEN", "")
FB_PAGE_ID        = os.environ.get("FACEBOOK_PAGE_ID", "")
FB_TOKEN          = os.environ.get("FACEBOOK_PAGE_TOKEN", "")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()
ADMIN_TOKEN       = os.environ.get("ADMIN_TOKEN", "")


def load_quiz_photos():
    try:
        resp = requests.get(f"{SITE_URL}/api/photos", timeout=15)
        resp.raise_for_status()
        photos = resp.json()
        valid = [p for p in photos if p.get("quiz_eligible") and p.get("title")]
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
    desc     = photo.get("quiz_description", "")
    category = photo.get("category", "")

    thumbnail_url = photo.get("thumbnail") or photo.get("url")
    if thumbnail_url and thumbnail_url.startswith("/"):
        thumbnail_url = f"{SITE_URL}{thumbnail_url}"

    image_content = []
    try:
        b64, mime = fetch_image_as_base64(thumbnail_url)
        image_content = [{"type": "image", "source": {"type": "base64", "media_type": mime, "data": b64}}]
    except Exception as e:
        print(f"⚠️  Vision נכשל ({e})")

    place_hint = f'"{desc}"' if desc else f'"{title}" (קטגוריה: {category})'

    prompt = f"""Write a social media post for Israeli photographer Amit.
The photo shows: {place_hint}
Quiz URL: {QUIZ_URL}

Post structure:
1. One intriguing question: "מאיפה הצילום הזה?" or a variation — don't reveal the answer.
2. Invite to play the quiz: "נחשו נכון 3 מתוך 5 ותקבלו 20% הנחה על כל תמונה בגלריה"
3. "הלינק בביו / {QUIZ_URL}"

Rules:
- Hebrew only
- Friendly, playful tone
- No hashtags (added separately)
- Output only the post text"""

    msg = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=300,
        messages=[{"role": "user", "content": image_content + [{"type": "text", "text": prompt}]}],
    )
    caption = msg.content[0].text.strip()
    hashtags = "#quiz #קוויז #amitphotos #photography #צילום #ישראל #discount #travel"
    return f"{caption}\n\n{hashtags}"


def get_image_url_for_post(photo):
    source_url = photo.get("url") or photo.get("thumbnail")
    if source_url and source_url.startswith("/"):
        source_url = f"{SITE_URL}{source_url}"
    if source_url and source_url.startswith(f"{SITE_URL}/"):
        return source_url

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
                    return url
        except Exception as e:
            print(f"⚠️  R2 upload נכשל ({e})")

    r = requests.post("https://0x0.st", files={"file": ("photo.jpg", img_bytes, "image/jpeg")}, timeout=60)
    r.raise_for_status()
    return r.text.strip()


def post_to_instagram(image_url, caption):
    if not IG_USER_ID or not IG_TOKEN:
        print("⚠️  חסרים פרטי אינסטגרם — מדלג")
        return
    import time
    container = requests.post(f"{GRAPH_API}/{IG_USER_ID}/media", data={
        "image_url": image_url, "caption": caption, "access_token": IG_TOKEN,
    }, timeout=30)
    if not container.ok:
        print(f"❌ IG container נכשל: {container.text}")
        return
    cid = container.json().get("id")
    for _ in range(10):
        time.sleep(5)
        status = requests.get(f"{GRAPH_API}/{cid}", params={"fields": "status_code", "access_token": IG_TOKEN}, timeout=30).json().get("status_code", "")
        if status == "FINISHED":
            break
        if status == "ERROR":
            print("❌ Container שגיאה")
            return
    publish = requests.post(f"{GRAPH_API}/{IG_USER_ID}/media_publish", data={"creation_id": cid, "access_token": IG_TOKEN}, timeout=30)
    if publish.ok:
        print(f"✅ פורסם לאינסטגרם! ID: {publish.json().get('id')}")
    else:
        print(f"❌ IG publish נכשל: {publish.text}")


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
        print(f"❌ FB post נכשל: {resp.text}")


def main():
    if not ANTHROPIC_API_KEY:
        print("❌ חסר ANTHROPIC_API_KEY")
        sys.exit(1)

    photos = load_quiz_photos()
    photo  = random.choice(photos)
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
