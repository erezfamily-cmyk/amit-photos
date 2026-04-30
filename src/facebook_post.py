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
POSTED_FILE = Path(__file__).parent.parent / "data" / "facebook_posted.json"
SITE_URL    = "https://amitphotos.com"
GRAPH_API   = "https://graph.facebook.com/v21.0"

PAGE_ID           = os.environ.get("FACEBOOK_PAGE_ID", "")
ACCESS_TOKEN      = os.environ.get("FACEBOOK_PAGE_TOKEN", "")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()

# ===== Hashtag pools לפייסבוק (פחות מאינסטגרם — 3-5 בלבד) =====
HASHTAG_POOLS = {
    "default":  ["#צילום #photography #ישראל", "#אמנות #art #photographer", "#digitalart #israel #fineartphotography"],
    "טבע":      ["#טבע #nature #naturephotography", "#wildlife #ישראל_יפה #macro", "#הטבע_הישראלי #outdoors #naturelover"],
    "פורטרט":   ["#פורטרט #portrait #portraitphotography", "#people #humanportrait #צילום_אנשים"],
    "עירוני":   ["#עיר #urban #streetphotography", "#architecture #cityscape #israel_urban"],
    "אירועים":  ["#אירועים #events #celebration", "#wedding #חתונה #moments #eventphotography"],
}


def load_photos():
    """טוען תמונות מ-D1 API (מקור האמת), עם fallback ל-JSON."""
    try:
        resp = requests.get(f"{SITE_URL}/api/photos", timeout=15)
        resp.raise_for_status()
        photos = resp.json()
        valid = [p for p in photos if p.get("title") and not p["title"].upper().startswith("DSC_")]
        if valid:
            print(f"✅ נטענו {len(valid)} תמונות מ-D1 API")
            return valid
    except Exception as e:
        print(f"⚠️  D1 API נכשל ({e}) — נסיון fallback ל-JSON")

    json_file = Path(__file__).parent.parent / "data" / "photos.json"
    if json_file.exists():
        photos = json.loads(json_file.read_text(encoding="utf-8"))
        valid = [p for p in photos if p.get("title") and not p["title"].upper().startswith("DSC_")]
        print(f"📁 נטענו {len(valid)} תמונות מ-JSON (fallback)")
        return valid

    print("❌ לא נמצא מקור תמונות")
    sys.exit(1)


def load_posted():
    if POSTED_FILE.exists():
        return json.loads(POSTED_FILE.read_text(encoding="utf-8"))
    return {"posted_ids": []}


def save_posted(data):
    POSTED_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def pick_photo(photos, posted_ids):
    unposted = [p for p in photos if p["id"] not in posted_ids]
    if not unposted:
        print("🔄 כל התמונות פורסמו — מתחיל rotation מחדש")
        return random.choice(photos)
    return random.choice(unposted)


def get_hashtags(category):
    pool = HASHTAG_POOLS.get(category, HASHTAG_POOLS["default"])
    return random.choice(pool)


def fetch_image_as_base64(url):
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    content_type = resp.headers.get("Content-Type", "image/jpeg").split(";")[0].strip()
    b64 = base64.standard_b64encode(resp.content).decode("utf-8")
    return b64, content_type


def generate_caption(photo):
    """משתמש ב-Claude Vision כדי לכתוב פוסט פייסבוק יצירתי."""
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    title       = photo.get("title", "")
    category    = photo.get("category", "")
    description = photo.get("description", "")
    exif        = photo.get("exif") or {}
    photo_id    = photo["id"]
    buy_link    = f"{SITE_URL}/photo/{photo_id}"

    thumbnail_url = photo.get("thumbnail") or photo.get("url")
    if thumbnail_url and thumbnail_url.startswith("/"):
        thumbnail_url = f"{SITE_URL}{thumbnail_url}"

    image_content = []
    try:
        b64, mime_type = fetch_image_as_base64(thumbnail_url)
        image_content = [{"type": "image", "source": {"type": "base64", "media_type": mime_type, "data": b64}}]
        print("🖼️  תמונה הורדה לניתוח Vision")
    except Exception as e:
        print(f"⚠️  לא הצלחתי להוריד תמונה ({e}) — ממשיך בלי Vision")

    meta_lines = []
    if title:                meta_lines.append(f"Photo name: {title}")
    if category:             meta_lines.append(f"Category: {category}")
    if description:          meta_lines.append(f"Description: {description}")
    if exif.get("camera"):   meta_lines.append(f"Camera: {exif['camera']}")
    if exif.get("focal"):    meta_lines.append(f"Focal length: {exif['focal']}mm")
    if exif.get("aperture"): meta_lines.append(f"Aperture: f/{exif['aperture']}")
    if exif.get("shutter"):  meta_lines.append(f"Shutter: {exif['shutter']}s")
    if exif.get("iso"):      meta_lines.append(f"ISO: {exif['iso']}")
    meta_text = "\n".join(meta_lines) if meta_lines else "(no metadata)"

    exif_parts = []
    if exif.get("aperture"): exif_parts.append(f"f/{exif['aperture']}")
    if exif.get("shutter"):  exif_parts.append(f"{exif['shutter']}s")
    if exif.get("focal"):    exif_parts.append(f"{exif['focal']}mm")
    if exif.get("iso"):      exif_parts.append(f"ISO {exif['iso']}")
    if exif.get("camera"):   exif_parts.append(exif['camera'])
    exif_line = " · ".join(exif_parts) if exif_parts else ""

    hashtags = get_hashtags(category)

    system_prompt = """You are writing Facebook posts for an Israeli photographer named Amit.
Style: factual, informative, educational — explain what was photographed and how it was shot.
CRITICAL: Write in Hebrew only. Never mix Arabic script with Hebrew characters.
Do not include hashtags."""

    user_content = image_content + [{"type": "text", "text": f"""Write a Facebook post for this photo.

Metadata:
{meta_text}
EXIF summary: {exif_line or '(not available)'}

Post structure (exactly in this order):
1. One sentence: what is in the frame — subject, genre (macro/landscape/portrait/long exposure/etc.), location if identifiable.
2. One sentence: the key technical or compositional decision — lighting conditions, time of day, framing choice.
3. If EXIF data is available — one line listing the shooting settings (aperture, shutter speed, focal length, ISO, camera). If not available, skip this line entirely.
4. Empty line
5. 🛍️ לרכישת התמונה: {buy_link}

Write in Hebrew. Be specific and factual — no metaphors, no poetic language. Output only the post text.
"""}]

    msg = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=500,
        system=system_prompt,
        messages=[{"role": "user", "content": user_content}],
    )

    post_text = msg.content[0].text.strip()
    return f"{post_text}\n\n{hashtags}"


def upload_to_public_host(source_url):
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
        upload.raise_for_status()
        public_url = upload.text.strip()
        if public_url.startswith("http"):
            print(f"⬆️  תמונה הועלתה (litterbox): {public_url}")
            return public_url
    except Exception as e:
        print(f"⚠️  litterbox נכשל ({e}), מנסה 0x0.st...")

    upload = requests.post("https://0x0.st", files={"file": ("photo.jpg", img_bytes, "image/jpeg")}, timeout=60)
    upload.raise_for_status()
    public_url = upload.text.strip()
    print(f"⬆️  תמונה הועלתה (0x0.st): {public_url}")
    return public_url


def post_to_facebook(photo, message):
    source_url = photo.get("thumbnail") or photo.get("url")
    if source_url and source_url.startswith("/"):
        source_url = f"{SITE_URL}{source_url}"

    print("⬆️  מעלה תמונה לשרת ציבורי...")
    image_url = upload_to_public_host(source_url)

    resp = requests.post(f"{GRAPH_API}/{PAGE_ID}/photos", data={
        "url": image_url, "message": message, "access_token": ACCESS_TOKEN,
    }, timeout=30)
    if not resp.ok:
        print(f"❌ שגיאת Facebook API: {resp.status_code} — {resp.text}")
        sys.exit(1)
    result = resp.json()
    if "id" in result:
        return result["id"]
    print(f"❌ תשובה לא צפויה מ-Facebook: {result}")
    sys.exit(1)


def main():
    if not PAGE_ID or not ACCESS_TOKEN:
        print("❌ חסרים: FACEBOOK_PAGE_ID או FACEBOOK_PAGE_TOKEN")
        sys.exit(1)
    if not ANTHROPIC_API_KEY:
        print("❌ חסר: ANTHROPIC_API_KEY")
        sys.exit(1)

    photos      = load_photos()
    posted_data = load_posted()
    posted_ids  = set(posted_data.get("posted_ids", []))

    photo = pick_photo(photos, posted_ids)
    print(f"📸 תמונה נבחרה: {photo['title']}")

    print("✍️  מייצר כיתוב עם Claude Vision...")
    caption = generate_caption(photo)
    print(f"\n--- פוסט ---\n{caption}\n-----------\n")

    print("📤 מפרסם לפייסבוק...")
    post_id = post_to_facebook(photo, caption)
    print(f"✅ פורסם בהצלחה! Facebook post ID: {post_id}")

    posted_data["posted_ids"] = list(posted_ids | {photo["id"]})
    save_posted(posted_data)
    print("💾 עודכן data/facebook_posted.json")


if __name__ == "__main__":
    main()
