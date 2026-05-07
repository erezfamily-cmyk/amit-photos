#!/usr/bin/env python3
"""
Threads Auto-Post Agent
מפרסם תמונה אחת ל-Threads בכל הרצה, עם כיתוב יצירתי שנוצר ע"י Claude Vision.
API: graph.threads.net/v1.0
"""

import json
import os
import sys
import random
import base64
import time
import requests
import anthropic
from pathlib import Path

# ===== הגדרות =====
POSTED_FILE = Path(__file__).parent.parent / "data" / "threads_posted.json"
SITE_URL    = "https://amitphotos.com"
THREADS_API = "https://graph.threads.net/v1.0"

THREADS_USER_ID   = os.environ.get("THREADS_USER_ID", "")
ACCESS_TOKEN      = os.environ.get("THREADS_ACCESS_TOKEN", "")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()
ADMIN_TOKEN       = os.environ.get("ADMIN_TOKEN", "")

# ===== Hashtag pools (Threads — מינימלי, 3-5) =====
HASHTAG_POOLS = {
    "default":  ["#צילום #photography #ישראל", "#photographer #art #digitalart", "#photooftheday #israel #visualart"],
    "טבע":      ["#טבע #nature #naturephotography", "#wildlife #ישראל_יפה #naturelover", "#macro #outdoors #הטבע_הישראלי"],
    "פורטרט":   ["#פורטרט #portrait #portraitphotography", "#people #humanportrait #צילום_אנשים"],
    "עירוני":   ["#עיר #urban #streetphotography", "#architecture #cityscape #israel"],
    "אירועים":  ["#אירועים #events #celebration", "#wedding #חתונה #moments"],
}


def load_photos():
    try:
        resp = requests.get(f"{SITE_URL}/api/photos", timeout=15)
        resp.raise_for_status()
        photos = resp.json()
        valid = [p for p in photos if p.get("title") and not p["title"].upper().startswith("DSC_")]
        if valid:
            print(f"✅ נטענו {len(valid)} תמונות מ-D1 API")
            return valid
    except Exception as e:
        print(f"⚠️  D1 API נכשל ({e}) — fallback ל-JSON")
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


def fetch_image_as_base64(url, max_bytes=3_750_000):
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    content_type = resp.headers.get("Content-Type", "image/jpeg").split(";")[0].strip()
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
        content_type = "image/jpeg"
        print(f"🗜️  דחוס ל-{len(img_bytes)//1024}KB (quality={quality})")
    except ImportError:
        pass
    b64 = base64.standard_b64encode(img_bytes).decode("utf-8")
    return b64, content_type


def generate_caption(photo):
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
        print(f"⚠️  לא הצלחתי להוריד תמונה ({e})")

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

    system_prompt = """You are writing Threads posts for an Israeli photographer named Amit.
Threads is conversational and direct — shorter than Instagram, more like Twitter but visual.
Style: factual, concise, confident — one strong observation about the photo.
CRITICAL: Write in Hebrew only.
Do not include hashtags."""

    user_content = image_content + [{"type": "text", "text": f"""Write a Threads post for this photo.

Metadata:
{meta_text}
EXIF: {exif_line or '(not available)'}

Post structure (keep it short — Threads is conversational):
1. One punchy sentence: what's in the frame and what makes it interesting technically or visually.
2. If EXIF available — one compact technical line (aperture · shutter · focal · ISO). Skip if unavailable.
3. One open-ended question to spark conversation (about the technique, mood, or subject).
4. Empty line
5. 🛍️ {buy_link}

Keep the whole post under 200 characters excluding the link line. Write in Hebrew. Output only the post text.
"""}]

    msg = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=400,
        system=system_prompt,
        messages=[{"role": "user", "content": user_content}],
    )
    post_text = msg.content[0].text.strip()
    return f"{post_text}\n\n{hashtags}"


def get_public_image_url(photo):
    source_url = photo.get("url") or photo.get("thumbnail")
    if source_url and source_url.startswith("/"):
        source_url = f"{SITE_URL}{source_url}"
    if source_url and source_url.startswith(f"{SITE_URL}/"):
        print(f"⬆️  תמונה ב-R2 ישירות: {source_url}")
        return source_url

    resp = requests.get(source_url, timeout=30)
    resp.raise_for_status()
    img_bytes = resp.content

    for name, fn in [("r2", _try_r2), ("litterbox", _try_litterbox), ("catbox", _try_catbox), ("0x0", _try_0x0)]:
        try:
            url = fn(img_bytes)
            if url:
                print(f"⬆️  הועלה ל-{name}: {url}")
                return url
        except Exception as e:
            print(f"⚠️  {name} נכשל ({e})")

    raise RuntimeError("כל שירותי ה-upload נכשלו")


def _try_r2(img_bytes):
    if not ADMIN_TOKEN:
        return None
    r = requests.post(f"{SITE_URL}/api/admin/upload-story",
        data=img_bytes,
        headers={"Authorization": f"Bearer {ADMIN_TOKEN}", "Content-Type": "image/jpeg"},
        timeout=60)
    r.raise_for_status()
    url = r.json().get("url", "")
    return url if url.startswith("http") else None


def _try_litterbox(img_bytes):
    r = requests.post("https://litterbox.catbox.moe/resources/internals/api.php",
        data={"reqtype": "fileupload", "time": "1h"},
        files={"fileToUpload": ("photo.jpg", img_bytes, "image/jpeg")}, timeout=60)
    r.raise_for_status()
    url = r.text.strip()
    return url if url.startswith("http") else None


def _try_catbox(img_bytes):
    r = requests.post("https://catbox.moe/user/api.php",
        data={"reqtype": "fileupload"},
        files={"fileToUpload": ("photo.jpg", img_bytes, "image/jpeg")}, timeout=60)
    r.raise_for_status()
    url = r.text.strip()
    return url if url.startswith("http") else None


def _try_0x0(img_bytes):
    r = requests.post("https://0x0.st",
        files={"file": ("photo.jpg", img_bytes, "image/jpeg")}, timeout=60)
    r.raise_for_status()
    url = r.text.strip()
    return url if url.startswith("http") else None


def post_to_threads(photo, text):
    image_url = get_public_image_url(photo)

    # שלב 1: יצירת container
    container_resp = requests.post(
        f"{THREADS_API}/{THREADS_USER_ID}/threads",
        params={"access_token": ACCESS_TOKEN},
        json={"media_type": "IMAGE", "image_url": image_url, "text": text},
        timeout=30,
    )
    if not container_resp.ok:
        print(f"❌ Threads container: {container_resp.status_code} — {container_resp.text}")
        sys.exit(1)
    container_id = container_resp.json().get("id")
    if not container_id:
        print(f"❌ חסר container id: {container_resp.json()}")
        sys.exit(1)
    print(f"📦 Container נוצר: {container_id}")

    # שלב 2: המתנה לסיום עיבוד
    for _ in range(10):
        time.sleep(5)
        status_resp = requests.get(
            f"{THREADS_API}/{container_id}",
            params={"fields": "status,error_message", "access_token": ACCESS_TOKEN},
            timeout=30,
        )
        status = status_resp.json().get("status", "")
        print(f"⏳ סטטוס: {status}")
        if status == "FINISHED":
            break
        if status == "ERROR":
            err = status_resp.json().get("error_message", "")
            print(f"❌ שגיאת עיבוד: {err}")
            sys.exit(1)
    else:
        print("❌ Container לא הושלם בזמן")
        sys.exit(1)

    # שלב 3: פרסום
    publish_resp = requests.post(
        f"{THREADS_API}/{THREADS_USER_ID}/threads_publish",
        params={"access_token": ACCESS_TOKEN},
        json={"creation_id": container_id},
        timeout=30,
    )
    if not publish_resp.ok:
        print(f"❌ Threads publish: {publish_resp.status_code} — {publish_resp.text}")
        sys.exit(1)
    result = publish_resp.json()
    if "id" not in result:
        print(f"❌ תשובה לא צפויה: {result}")
        sys.exit(1)
    return result["id"]


def main():
    if not THREADS_USER_ID or not ACCESS_TOKEN:
        print("❌ חסרים: THREADS_USER_ID או THREADS_ACCESS_TOKEN")
        sys.exit(1)
    if not ANTHROPIC_API_KEY:
        print("❌ חסר: ANTHROPIC_API_KEY")
        sys.exit(1)

    photos      = load_photos()
    posted_data = load_posted()
    posted_ids  = set(posted_data.get("posted_ids", []))

    photo = pick_photo(photos, posted_ids)
    print(f"📸 תמונה נבחרה: {photo.get('title', photo['id'])}")

    print("✍️  מייצר כיתוב עם Claude Vision...")
    caption = generate_caption(photo)
    print(f"\n--- פוסט Threads ---\n{caption}\n-------------------\n")

    print("📤 מפרסם ל-Threads...")
    post_id = post_to_threads(photo, caption)
    print(f"✅ פורסם בהצלחה! Threads post ID: {post_id}")

    posted_data["posted_ids"] = list(posted_ids | {photo["id"]})
    save_posted(posted_data)
    print("💾 עודכן data/threads_posted.json")


if __name__ == "__main__":
    main()
