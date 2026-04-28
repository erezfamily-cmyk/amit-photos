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


def fetch_image_as_base64(url, max_bytes=4_500_000):
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    content_type = resp.headers.get("Content-Type", "image/jpeg").split(";")[0].strip()
    img_bytes = resp.content

    if True:  # תמיד נעבד כדי לבדוק מימדים וגודל
        try:
            from PIL import Image
            import io
            img = Image.open(io.BytesIO(img_bytes))
            img = img.convert("RGB")
            # הגבל מימדים ל-7000 פיקסל בצד הארוך
            max_dim = 7000
            if max(img.size) > max_dim:
                img.thumbnail((max_dim, max_dim), Image.LANCZOS)
                print(f"📐 שינוי גודל: {img.size}")
            # דחוס עד שמתאים ל-4.5MB
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


def describe_image(client, image_content, meta_text):
    """שלב ראשון: Claude מתאר מה הוא רואה בתמונה."""
    if not image_content:
        return ""
    msg = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=300,
        messages=[{"role": "user", "content": image_content + [{"type": "text", "text": f"""Describe this photo in detail. Focus on:
- Exact subject (what/who is in the frame)
- Setting and environment
- Lighting conditions (direction, quality, time of day)
- Composition technique (macro, wide, portrait, long exposure, etc.)
- Any notable visual elements or details

Metadata available: {meta_text}

Be factual and precise. 3-5 sentences in English."""}]}],
    )
    return msg.content[0].text.strip()


def generate_caption(photo):
    """שלב ראשון: Vision תיאור. שלב שני: caption מבוסס תיאור + EXIF."""
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    title       = photo.get("title", "")
    category    = photo.get("category", "")
    description = photo.get("description", "")
    exif        = photo.get("exif") or {}

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
    if title:                 meta_lines.append(f"Photo name: {title}")
    if category:              meta_lines.append(f"Category: {category}")
    if description:           meta_lines.append(f"Description: {description}")
    if exif.get("camera"):    meta_lines.append(f"Camera: {exif['camera']}")
    if exif.get("focal"):     meta_lines.append(f"Focal length: {exif['focal']}mm")
    if exif.get("aperture"):  meta_lines.append(f"Aperture: f/{exif['aperture']}")
    if exif.get("shutter"):   meta_lines.append(f"Shutter: {exif['shutter']}s")
    if exif.get("iso"):       meta_lines.append(f"ISO: {exif['iso']}")
    meta_text = "\n".join(meta_lines) if meta_lines else "(no metadata)"

    # שלב 1: תיאור Vision
    vision_description = describe_image(client, image_content, meta_text)
    if vision_description:
        print(f"👁️  תיאור Vision: {vision_description[:80]}…")

    hashtags = get_hashtags(category)

    exif_parts = []
    if exif.get("aperture"): exif_parts.append(f"f/{exif['aperture']}")
    if exif.get("shutter"):  exif_parts.append(f"{exif['shutter']}s")
    if exif.get("focal"):    exif_parts.append(f"{exif['focal']}mm")
    if exif.get("iso"):      exif_parts.append(f"ISO {exif['iso']}")
    if exif.get("camera"):   exif_parts.append(exif['camera'])
    exif_line = " · ".join(exif_parts) if exif_parts else ""

    system_prompt = """You are writing Instagram captions for an Israeli photographer named Amit.
Style: factual, precise, informative — like a photographer explaining their craft to fellow photographers.
CRITICAL: Write in Hebrew only. Never mix Arabic script with Hebrew characters.
Do not include URLs. Do not write hashtags."""

    caption_prompt = f"""Write an Instagram caption based on this photo analysis.

Vision description: {vision_description or '(not available)'}
Metadata: {meta_text}
EXIF summary: {exif_line or '(not available)'}

Caption structure (in this exact order):
1. One precise sentence: what is in the frame, technique used (macro/long exposure/portrait/etc.), location if identifiable.
2. One sentence: what compositional or lighting choice Amit made and why it works.
3. If EXIF data is available — one technical line listing the settings (aperture, shutter, focal length, ISO, camera). If not available, skip this line entirely.
4. Empty line
5. 🛍️ זמין לרכישה — amitphotos.com (link in bio)

Write in Hebrew. Be specific — no metaphors, no emotional language. Output only the caption."""

    user_content = image_content + [{"type": "text", "text": caption_prompt}]

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

    hosts = [
        ("litterbox", _try_litterbox),
        ("catbox", _try_catbox),
        ("tmpfiles", _try_tmpfiles),
        ("0x0.st", _try_0x0),
    ]
    last_err = None
    for name, fn in hosts:
        try:
            url = fn(img_bytes)
            if url:
                print(f"⬆️  תמונה הועלתה ({name}): {url}")
                return url
        except Exception as e:
            print(f"⚠️  {name} נכשל ({e}), מנסה הבא...")
            last_err = e

    raise RuntimeError(f"כל שירותי ה-upload נכשלו. שגיאה אחרונה: {last_err}")


def _try_litterbox(img_bytes):
    r = requests.post(
        "https://litterbox.catbox.moe/resources/internals/api.php",
        data={"reqtype": "fileupload", "time": "1h"},
        files={"fileToUpload": ("photo.jpg", img_bytes, "image/jpeg")},
        timeout=60,
    )
    r.raise_for_status()
    url = r.text.strip()
    return url if url.startswith("http") else None


def _try_catbox(img_bytes):
    r = requests.post(
        "https://catbox.moe/user/api.php",
        data={"reqtype": "fileupload"},
        files={"fileToUpload": ("photo.jpg", img_bytes, "image/jpeg")},
        timeout=60,
    )
    r.raise_for_status()
    url = r.text.strip()
    return url if url.startswith("http") else None


def _try_tmpfiles(img_bytes):
    r = requests.post(
        "https://tmpfiles.org/api/v1/upload",
        files={"file": ("photo.jpg", img_bytes, "image/jpeg")},
        timeout=60,
    )
    r.raise_for_status()
    data = r.json()
    url = data.get("data", {}).get("url", "")
    # tmpfiles returns page URL; convert to direct download
    url = url.replace("tmpfiles.org/", "tmpfiles.org/dl/")
    return url if url.startswith("http") else None


def _try_0x0(img_bytes):
    r = requests.post(
        "https://0x0.st",
        files={"file": ("photo.jpg", img_bytes, "image/jpeg")},
        timeout=60,
    )
    r.raise_for_status()
    url = r.text.strip()
    return url if url.startswith("http") else None


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
