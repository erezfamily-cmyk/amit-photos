#!/usr/bin/env python3
"""
Week Photo Social Agent
כשתמונת השבוע מוגדרת — מייצר כיתוב בגוף ראשון עם Claude Vision ומפרסם לאינסטגרם ופייסבוק.
"""

import base64
import os
import random
import sys

import anthropic
import requests

SITE_URL   = "https://amitphotos.com"
GRAPH_API  = "https://graph.facebook.com/v21.0"

IG_USER_ID    = os.environ.get("INSTAGRAM_USER_ID", "")
IG_TOKEN      = os.environ.get("INSTAGRAM_PAGE_TOKEN", "")
FB_PAGE_ID    = os.environ.get("FACEBOOK_PAGE_ID", "")
FB_TOKEN      = os.environ.get("FACEBOOK_PAGE_TOKEN", "")
ANTHROPIC_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()
ADMIN_TOKEN   = os.environ.get("ADMIN_TOKEN", "")

_anthropic = None

def get_anthropic_client():
    global _anthropic
    if _anthropic is None:
        _anthropic = anthropic.Anthropic(api_key=ANTHROPIC_KEY)
    return _anthropic

HASHTAGS_BY_CATEGORY = {
    "default": "#photography #photooftheday #israeliphotographer #amitphotos #צילום #ישראל",
    "טבע":     "#nature #naturephotography #wildlife #israel_nature #הטבע_הישראלי #amitphotos",
    "פורטרט":  "#portrait #portraitphotography #צילום_פורטרט #amitphotos #israeliphotographer",
    "עירוני":  "#urban #streetphotography #architecture #israel_urban #amitphotos",
    "אירועים": "#events #weddingphotography #momentscaptured #amitphotos #צילום",
}


def get_week_photo():
    """מושך את תמונת השבוע מה-API."""
    resp = requests.get(f"{SITE_URL}/api/photos", timeout=15)
    resp.raise_for_status()
    photos = resp.json()
    week = next((p for p in photos if p.get("is_week_photo")), None)
    if not week:
        print("❌ לא נמצאה תמונת שבוע מוגדרת")
        sys.exit(1)
    print(f"📸 תמונת השבוע: {week['title']} (id: {week['id']})")
    return week


def fetch_image_as_base64(url, max_bytes=4_500_000):
    """מוריד תמונה ומחזיר base64 + mime type. דוחס אם צריך."""
    if url.startswith("/"):
        url = f"{SITE_URL}{url}"
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    img_bytes = resp.content

    try:
        from PIL import Image
        import io
        img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        if max(img.size) > 7000:
            img.thumbnail((7000, 7000), Image.LANCZOS)
        quality = 85
        while quality >= 40:
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=quality)
            img_bytes = buf.getvalue()
            if len(img_bytes) <= max_bytes:
                break
            quality -= 15
        print(f"🗜️  תמונה עובדה: {len(img_bytes)//1024}KB")
    except ImportError:
        pass

    b64 = base64.standard_b64encode(img_bytes).decode("utf-8")
    return b64, "image/jpeg"


def generate_caption(photo):
    """Claude Vision מנתח את התמונה וכותב כיתוב בגוף ראשון בעברית."""
    client = get_anthropic_client()

    img_url = photo.get("url") or photo.get("thumbnail")
    image_content = []
    try:
        b64, mime = fetch_image_as_base64(img_url)
        image_content = [{"type": "image", "source": {"type": "base64", "media_type": mime, "data": b64}}]
        print("🖼️  תמונה הורדה לניתוח Vision")
    except Exception as e:
        print(f"⚠️  לא הצלחתי להוריד תמונה ({e}) — ממשיך בלי Vision")

    title    = photo.get("title", "")
    category = photo.get("category", "")
    exif     = photo.get("exif") or {}
    meta_lines = []
    if title:                 meta_lines.append(f"שם: {title}")
    if category:              meta_lines.append(f"קטגוריה: {category}")
    if exif.get("camera"):    meta_lines.append(f"מצלמה: {exif['camera']}")
    if exif.get("focal"):     meta_lines.append(f"עדשה: {exif['focal']}mm")
    if exif.get("aperture"):  meta_lines.append(f"צמצם: f/{exif['aperture']}")
    if exif.get("shutter"):   meta_lines.append(f"חשיפה: {exif['shutter']}s")
    if exif.get("iso"):       meta_lines.append(f"ISO: {exif['iso']}")
    meta_text = "\n".join(meta_lines) if meta_lines else ""

    prompt = f"""אתה עמית, צלם ישראלי. נתח את התמונה וכתוב פוסט בגוף ראשון בעברית.

כתוב:
- מה צילמת ואיפה
- מה הרגשת ברגע הצילום
- איך צילמת — אור, זמן, טכניקה (בהתבסס על מה שאתה רואה בתמונה ועל המטא-דאטה)

כללים:
- גוף ראשון (אני, צילמתי, הלכתי)
- עברית בלבד, ללא תווי ערבית
- סגנון אישי, חם, אמיתי — לא פרסומי
- אל תתחיל ב"אני" — תתחיל ישירות מהסצנה
- כ-120 מילים

{f"מטא-דאטה:{chr(10)}{meta_text}" if meta_text else ""}

כתוב רק את הטקסט עצמו, ללא כותרת."""

    msg = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=600,
        messages=[{"role": "user", "content": image_content + [{"type": "text", "text": prompt}]}],
    )
    caption = msg.content[0].text.strip()
    print(f"✍️  כיתוב נוצר ({len(caption)} תווים)")
    return caption


def translate_caption(caption_he):
    """מתרגם את הכיתוב העברי לאנגלית."""
    client = get_anthropic_client()
    msg = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=600,
        messages=[{"role": "user", "content": f"Translate the following Hebrew photo caption to English. Keep the first-person voice, personal tone, and authentic feel. Output only the translated text.\n\n{caption_he}"}],
    )
    caption_en = msg.content[0].text.strip()
    print(f"🌐 תרגום לאנגלית ({len(caption_en)} chars)")
    return caption_en


def save_caption_to_db(caption, caption_en=""):
    """שומר את הכיתוב ל-DB דרך ה-API."""
    resp = requests.post(
        f"{SITE_URL}/api/admin/photo-of-week/caption",
        json={"caption": caption, "caption_en": caption_en},
        headers={"Authorization": f"Bearer {ADMIN_TOKEN}"},
        timeout=15,
    )
    if resp.ok:
        print("💾 כיתוב נשמר ל-DB")
    else:
        print(f"⚠️  שמירת כיתוב נכשלה: {resp.status_code} — {resp.text}")


def upload_to_public_host(source_url):
    """מעלה תמונה לשרת ציבורי (R2 ישיר / litterbox / 0x0.st)."""
    if source_url.startswith(f"{SITE_URL}/photos/"):
        print(f"⬆️  תמונה ב-R2, URL ישיר: {source_url}")
        return source_url

    resp = requests.get(source_url, timeout=30)
    resp.raise_for_status()
    img_bytes = resp.content

    try:
        upload = requests.post(
            "https://litterbox.catbox.moe/resources/internals/api.php",
            data={"reqtype": "fileupload", "time": "1h"},
            files={"fileToUpload": ("photo.jpg", img_bytes, "image/jpeg")},
            timeout=60,
        )
        if upload.ok and upload.text.strip().startswith("http"):
            print(f"⬆️  תמונה הועלתה (litterbox): {upload.text.strip()}")
            return upload.text.strip()
    except Exception as e:
        print(f"⚠️  litterbox נכשל ({e})")

    upload = requests.post("https://0x0.st", files={"file": ("photo.jpg", img_bytes, "image/jpeg")}, timeout=60)
    upload.raise_for_status()
    print(f"⬆️  תמונה הועלתה (0x0.st): {upload.text.strip()}")
    return upload.text.strip()


def prepare_post_assets(photo):
    """מחזיר image_url ו-hashtags מוכנים לפרסום."""
    source_url = photo.get("url") or photo.get("thumbnail")
    if source_url and source_url.startswith("/"):
        source_url = f"{SITE_URL}{source_url}"
    image_url = upload_to_public_host(source_url)
    hashtags  = HASHTAGS_BY_CATEGORY.get(photo.get("category", ""), HASHTAGS_BY_CATEGORY["default"])
    return image_url, hashtags


def post_to_instagram(photo, caption, image_url, hashtags):
    """מפרסם לאינסטגרם עם הכיתוב + hashtags."""
    if not IG_USER_ID or not IG_TOKEN:
        print("⚠️  חסרים INSTAGRAM_USER_ID / INSTAGRAM_PAGE_TOKEN — מדלג")
        return

    full_caption = f"{caption}\n\n🛍️ זמין לרכישה — amitphotos.com (link in bio)\n\n{hashtags}"

    container = requests.post(f"{GRAPH_API}/{IG_USER_ID}/media", data={
        "image_url": image_url, "caption": full_caption, "access_token": IG_TOKEN,
    }, timeout=30)
    if not container.ok:
        print(f"❌ IG container נכשל: {container.status_code} — {container.text}")
        return
    container_id = container.json().get("id")

    publish = requests.post(f"{GRAPH_API}/{IG_USER_ID}/media_publish", data={
        "creation_id": container_id, "access_token": IG_TOKEN,
    }, timeout=30)
    if publish.ok:
        print(f"✅ פורסם לאינסטגרם! ID: {publish.json().get('id')}")
    else:
        print(f"❌ IG publish נכשל: {publish.status_code} — {publish.text}")


def post_to_facebook(photo, caption, image_url, hashtags):
    """מפרסם לפייסבוק עם הכיתוב + hashtags."""
    if not FB_PAGE_ID or not FB_TOKEN:
        print("⚠️  חסרים FACEBOOK_PAGE_ID / FACEBOOK_PAGE_TOKEN — מדלג")
        return

    buy_link     = f"{SITE_URL}/photo/{photo['id']}"
    full_caption = f"{caption}\n\n🛍️ לרכישת התמונה: {buy_link}\n\n{hashtags}"

    resp = requests.post(f"{GRAPH_API}/{FB_PAGE_ID}/photos", data={
        "url": image_url, "message": full_caption, "access_token": FB_TOKEN,
    }, timeout=30)
    if resp.ok:
        print(f"✅ פורסם לפייסבוק! ID: {resp.json().get('id')}")
    else:
        print(f"❌ FB post נכשל: {resp.status_code} — {resp.text}")


def main():
    if not ANTHROPIC_KEY:
        print("❌ חסר ANTHROPIC_API_KEY")
        sys.exit(1)

    photo      = get_week_photo()
    caption    = generate_caption(photo)
    caption_en = translate_caption(caption)
    print(f"\n--- כיתוב עברית ---\n{caption}\n--- English ---\n{caption_en}\n-----------\n")

    image_url, hashtags = prepare_post_assets(photo)
    save_caption_to_db(caption, caption_en)
    post_to_instagram(photo, caption, image_url, hashtags)
    post_to_facebook(photo, caption, image_url, hashtags)


if __name__ == "__main__":
    main()
