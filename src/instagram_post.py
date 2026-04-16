#!/usr/bin/env python3
"""
Instagram Auto-Post Agent
מפרסם תמונה אחת לאינסטגרם בכל הרצה, עם כיתוב יצירתי + hashtags שנוצרים ע"י Claude Vision.
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
POSTED_FILE = Path(__file__).parent.parent / "data" / "instagram_posted.json"
SITE_URL    = "https://amitphotos.com"
GRAPH_API   = "https://graph.facebook.com/v21.0"

IG_USER_ID        = os.environ.get("INSTAGRAM_USER_ID", "")
ACCESS_TOKEN      = os.environ.get("INSTAGRAM_PAGE_TOKEN", "")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()

# ===== Hashtag pools לפי קטגוריה (rotation למניעת shadowban) =====
HASHTAG_POOLS = {
    "default": [
        "#photography #photooftheday #naturephotography #landscapephotography",
        "#photographer #artphotography #fineartphotography #visualart",
        "#photographylovers #naturelover #earthpix #discoverearth",
        "#israeliphotographer #israelphoto #ig_israel #wildlife_photography",
    ],
    "טבע": [
        "#nature #naturephotography #wildlife #macro #flowers #botanicalphotography",
        "#naturelover #earthpix #outdoorphotography #wildlifephotography #plantsofinstagram",
        "#israel_nature #הטבע_הישראלי #macro_photography #insect_photography",
    ],
    "פורטרט": [
        "#portrait #portraitphotography #people #humanportrait #faceportrait",
        "#portraiture #portraitmode #naturallight #emotionalportrait",
        "#israel_portraits #צילום_פורטרט #editorialphotography",
    ],
    "עירוני": [
        "#urban #streetphotography #city #architecture #urbanphotography",
        "#streetphoto #cityscape #architecturephotography #urbanscape",
        "#israel_architecture #tel_aviv #jerusalem #citylights",
    ],
    "אירועים": [
        "#events #weddingphotography #celebration #moments #eventphotography",
        "#wedding #barMitzvah #familyphotography #lifephotography",
        "#israel_wedding #חתונה #ברמצווה #momentscaptured",
    ],
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
    """בוחר pool רנדומלי של hashtags לפי קטגוריה."""
    pool = HASHTAG_POOLS.get(category, HASHTAG_POOLS["default"])
    base = random.choice(pool)
    # הוסף תמיד כמה בסיסיים
    always = "#amitphotos #ישראל #צילום #digitalart"
    return f"{base} {always}"


def fetch_image_as_base64(url):
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    content_type = resp.headers.get("Content-Type", "image/jpeg").split(";")[0].strip()
    b64 = base64.standard_b64encode(resp.content).decode("utf-8")
    return b64, content_type


def generate_caption(photo):
    """משתמש ב-Claude Vision כדי לכתוב כיתוב אינסטגרם יצירתי."""
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    title       = photo.get("title", "")
    category    = photo.get("category", "")
    description = photo.get("description", "")
    exif        = photo.get("exif") or {}

    thumbnail_url = photo.get("thumbnail") or photo.get("url")
    # המר URL יחסי למוחלט
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
    if title:                 meta_lines.append(f"Photo name: {title}")
    if category:              meta_lines.append(f"Category: {category}")
    if description:           meta_lines.append(f"Description: {description}")
    if exif.get("camera"):    meta_lines.append(f"Camera: {exif['camera']}")
    if exif.get("focal"):     meta_lines.append(f"Focal length: {exif['focal']}mm")
    if exif.get("aperture"):  meta_lines.append(f"Aperture: f/{exif['aperture']}")
    if exif.get("shutter"):   meta_lines.append(f"Shutter: {exif['shutter']}s")
    meta_text = "\n".join(meta_lines) if meta_lines else "(no metadata)"

    hashtags = get_hashtags(category)

    system_prompt = """You are a social media manager for an Israeli photographer named Amit.
Write Instagram captions in Hebrew — visual, emotional, inspiring.
Style: short, intimate, artistic. Feels like a real moment.
CRITICAL: Use ONLY Hebrew characters for the Hebrew text. Never mix Arabic script with Hebrew.
Do not include URLs in the text body — only "🔗 amitphotos.com (link in bio)" at the end of the main text.
Do not write the hashtags — they will be added separately."""

    user_content = image_content + [{"type": "text", "text": f"""Write an Instagram caption for this photo.

Metadata:
{meta_text}

Caption structure (exactly in this order):
1. 2-4 lines in Hebrew — emotional/artistic description of the moment (Hebrew letters only, no Arabic)
2. Empty line
3. 🛍️ זמין לרכישה — amitphotos.com (link in bio)

Output only the caption text (no hashtags, no extra explanations).
"""}]

    msg = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=500,
        system=system_prompt,
        messages=[{"role": "user", "content": user_content}],
    )

    caption_text = msg.content[0].text.strip()
    return f"{caption_text}\n\n{hashtags}"


def upload_to_public_host(source_url):
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


def post_to_instagram(photo, caption):
    source_url = photo.get("thumbnail") or photo.get("url")
    if source_url and source_url.startswith("/"):
        source_url = f"{SITE_URL}{source_url}"

    print("⬆️  מעלה תמונה לשרת ציבורי...")
    image_url = upload_to_public_host(source_url)

    container_resp = requests.post(f"{GRAPH_API}/{IG_USER_ID}/media", data={
        "image_url": image_url, "caption": caption, "access_token": ACCESS_TOKEN,
    }, timeout=30)
    if not container_resp.ok:
        print(f"❌ שגיאת Instagram API: {container_resp.status_code} — {container_resp.text}")
        sys.exit(1)
    container_data = container_resp.json()
    if "id" not in container_data:
        print(f"❌ שגיאה ביצירת container: {container_data}")
        sys.exit(1)

    creation_id = container_data["id"]
    print(f"📦 Container נוצר: {creation_id}")

    import time
    for attempt in range(10):
        time.sleep(5)
        status_resp = requests.get(
            f"{GRAPH_API}/{creation_id}",
            params={"fields": "status_code", "access_token": ACCESS_TOKEN}, timeout=30,
        )
        status = status_resp.json().get("status_code", "")
        print(f"⏳ סטטוס container: {status}")
        if status == "FINISHED":
            break
        if status == "ERROR":
            print(f"❌ שגיאת עיבוד container: {status_resp.json()}")
            sys.exit(1)
    else:
        print("❌ Container לא הושלם בזמן")
        sys.exit(1)

    publish_resp = requests.post(f"{GRAPH_API}/{IG_USER_ID}/media_publish", data={
        "creation_id": creation_id, "access_token": ACCESS_TOKEN,
    }, timeout=30)
    publish_resp.raise_for_status()
    result = publish_resp.json()
    if "id" in result:
        return result["id"]
    print(f"❌ שגיאה בפרסום: {result}")
    sys.exit(1)


def main():
    if not IG_USER_ID or not ACCESS_TOKEN:
        print("❌ חסרים: INSTAGRAM_USER_ID או INSTAGRAM_PAGE_TOKEN")
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
    print(f"\n--- כיתוב ---\n{caption}\n-------------\n")

    print("📤 מפרסם לאינסטגרם...")
    post_id = post_to_instagram(photo, caption)
    print(f"✅ פורסם בהצלחה! Instagram post ID: {post_id}")

    posted_data["posted_ids"] = list(posted_ids | {photo["id"]})
    save_posted(posted_data)
    print("💾 עודכן data/instagram_posted.json")


if __name__ == "__main__":
    main()
