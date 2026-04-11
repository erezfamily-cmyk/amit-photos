#!/usr/bin/env python3
"""
Facebook Auto-Post Agent
מפרסם תמונה אחת לעמוד הפייסבוק בכל הרצה, עם תיאור יצירתי שנוצר ע"י Claude Vision.
"""

import json
import os
import sys
import random
import base64
import requests
import anthropic
from pathlib import Path

# ===== הגדרות =====
PHOTOS_FILE = Path(__file__).parent.parent / "data" / "photos.json"
POSTED_FILE = Path(__file__).parent.parent / "data" / "facebook_posted.json"
SITE_URL = "https://amitphotos.com"
GRAPH_API = "https://graph.facebook.com/v21.0"

PAGE_ID = os.environ.get("FACEBOOK_PAGE_ID", "")
ACCESS_TOKEN = os.environ.get("FACEBOOK_PAGE_TOKEN", "")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()


def load_photos():
    if not PHOTOS_FILE.exists():
        print("❌ לא נמצא data/photos.json")
        sys.exit(1)
    photos = json.loads(PHOTOS_FILE.read_text(encoding="utf-8"))
    # סנן תמונות ללא כותרת גנרית (DSC_...)
    valid = [
        p for p in photos
        if p.get("title") and not p["title"].upper().startswith("DSC_")
    ]
    return valid


def load_posted():
    if POSTED_FILE.exists():
        return json.loads(POSTED_FILE.read_text(encoding="utf-8"))
    return {"posted_ids": []}


def save_posted(data):
    POSTED_FILE.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )


def pick_photo(photos, posted_ids):
    unposted = [p for p in photos if p["id"] not in posted_ids]
    if not unposted:
        # כל התמונות פורסמו — התחל מחדש (rotation)
        print("🔄 כל התמונות פורסמו — מתחיל rotation מחדש")
        return random.choice(photos)
    return random.choice(unposted)


def fetch_image_as_base64(url):
    """מוריד תמונה ומחזיר אותה כ-base64."""
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    content_type = resp.headers.get("Content-Type", "image/jpeg").split(";")[0].strip()
    b64 = base64.standard_b64encode(resp.content).decode("utf-8")
    return b64, content_type


def generate_caption(photo):
    """משתמש ב-Claude Vision כדי לכתוב פוסט פייסבוק יצירתי בעברית."""
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    title = photo.get("title", "")
    category = photo.get("category", "")
    description = photo.get("description", "")
    exif = photo.get("exif") or {}
    photo_id = photo["id"]
    link = f"{SITE_URL}/#photo-{photo_id}"

    # נסה להוריד את התמונה (thumbnail)
    thumbnail_url = photo.get("thumbnail") or photo.get("url")
    image_content = []
    try:
        b64, mime_type = fetch_image_as_base64(thumbnail_url)
        image_content = [{
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": mime_type,
                "data": b64,
            },
        }]
        print("🖼️  תמונה הורדה בהצלחה לניתוח Vision")
    except Exception as e:
        print(f"⚠️  לא הצלחתי להוריד תמונה ({e}) — ממשיך בלי Vision")

    # בנה context למטה
    meta_lines = []
    if title:
        meta_lines.append(f"שם התמונה: {title}")
    if category:
        meta_lines.append(f"קטגוריה: {category}")
    if description:
        meta_lines.append(f"תיאור: {description}")
    if exif.get("camera"):
        meta_lines.append(f"מצלמה: {exif['camera']}")
    if exif.get("focal"):
        meta_lines.append(f"מרחק מוקד: {exif['focal']}mm")
    if exif.get("aperture"):
        meta_lines.append(f"צמצם: f/{exif['aperture']}")
    if exif.get("shutter"):
        meta_lines.append(f"חשיפה: {exif['shutter']}s")
    meta_text = "\n".join(meta_lines) if meta_lines else "(אין מטה-דאטה)"

    system_prompt = """אתה מנהל סושיאל-מדיה לצלם ישראלי בשם עמית.
אתה כותב פוסטים לפייסבוק בעברית — קצרים, רגשיים, מושכים.
סגנון: אינטימי, אמנותי, מעורר השראה. לא שיווקי-מדי.
אל תשתמש ב-hashtags מסוימים — רק אם הם טבעיים.
הפוסט צריך להרגיש כמו סיפור קצר על הרגע בתמונה."""

    user_content = image_content + [
        {
            "type": "text",
            "text": f"""תכתוב פוסט פייסבוק עבור התמונה הזו.

מטה-דאטה:
{meta_text}

קישור לאתר: {link}

הנחיות:
- 3-6 שורות בעברית
- תאר את הרגש / האווירה / הרגע שנלכד בתמונה
- בסוף הפוסט שים את הקישור לאתר (בשורה נפרדת)
- אל תכתוב "קישור:" לפני הקישור — רק את ה-URL
- אפשר להוסיף 1-3 emoji מתאימים (לא יותר)
- כתוב רק את טקסט הפוסט, ללא הסברים נוספים"""
        }
    ]

    msg = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=400,
        system=system_prompt,
        messages=[{"role": "user", "content": user_content}],
    )

    return msg.content[0].text.strip()


def upload_to_public_host(source_url):
    """מוריד תמונה ומעלה לשרת ציבורי — נדרש כי Facebook לא ניגש ל-Google Drive."""
    resp = requests.get(source_url, timeout=30)
    resp.raise_for_status()
    upload = requests.post(
        "https://catbox.moe/user/api.php",
        data={"reqtype": "fileupload"},
        files={"fileToUpload": ("photo.jpg", resp.content, "image/jpeg")},
        timeout=60,
    )
    upload.raise_for_status()
    public_url = upload.text.strip()
    print(f"⬆️  תמונה הועלתה: {public_url}")
    return public_url


def post_to_facebook(photo, message):
    """מפרסם תמונה עם הודעה לעמוד הפייסבוק."""
    source_url = photo.get("thumbnail") or photo.get("url")
    print("⬆️  מעלה תמונה לשרת ציבורי...")
    image_url = upload_to_public_host(source_url)

    url = f"{GRAPH_API}/{PAGE_ID}/photos"
    payload = {
        "url": image_url,
        "message": message,
        "access_token": ACCESS_TOKEN,
    }

    resp = requests.post(url, data=payload, timeout=30)
    if not resp.ok:
        print(f"❌ שגיאת Facebook API: {resp.status_code} — {resp.text}")
        sys.exit(1)
    result = resp.json()

    if "id" in result:
        return result["id"]
    else:
        print(f"❌ תשובה לא צפויה מ-Facebook: {result}")
        sys.exit(1)


def main():
    if not PAGE_ID or not ACCESS_TOKEN:
        print("❌ חסרים: FACEBOOK_PAGE_ID או FACEBOOK_PAGE_TOKEN")
        sys.exit(1)
    if not ANTHROPIC_API_KEY:
        print("❌ חסר: ANTHROPIC_API_KEY")
        sys.exit(1)

    photos = load_photos()
    posted_data = load_posted()
    posted_ids = set(posted_data.get("posted_ids", []))

    photo = pick_photo(photos, posted_ids)
    print(f"📸 תמונה נבחרה: {photo['title']}")

    print("✍️  מייצר כיתוב עם Claude Vision...")
    caption = generate_caption(photo)
    print(f"\n--- פוסט ---\n{caption}\n-----------\n")

    print("📤 מפרסם לפייסבוק...")
    post_id = post_to_facebook(photo, caption)
    print(f"✅ פורסם בהצלחה! Facebook post ID: {post_id}")

    # עדכן מעקב
    posted_data["posted_ids"] = list(posted_ids | {photo["id"]})
    save_posted(posted_data)
    print("💾 עודכן data/facebook_posted.json")


if __name__ == "__main__":
    main()
