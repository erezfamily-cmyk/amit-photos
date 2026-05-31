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
ADMIN_TOKEN       = os.environ.get("ADMIN_TOKEN", "")

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


def fetch_image_as_base64(url, max_bytes=3_750_000):
    # max_bytes is raw limit: base64 inflates ~33%, so 3.75MB raw → ~5MB base64 (Anthropic limit)
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    content_type = resp.headers.get("Content-Type", "image/jpeg").split(";")[0].strip()
    img_bytes = resp.content

    try:
        from PIL import Image
        import io
        img = Image.open(io.BytesIO(img_bytes))
        img = img.convert("RGB")
        max_dim = 2000
        if max(img.size) > max_dim:
            img.thumbnail((max_dim, max_dim), Image.LANCZOS)
            print(f"📐 שינוי גודל: {img.size}")
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
        model="claude-opus-4-8",
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


def generate_pdf_promo_caption(photo, client, image_content, vision_description):
    """כיתוב פרומו אישי ל-PDF החינמי, מעוגן בתמונה הספציפית."""
    title    = photo.get("title", "")
    category = photo.get("category", "")

    system_prompt = """אתה עמית ארז, צלם ישראלי שמצלם מאהבה.
אתה כותב בגוף ראשון, בעברית טבעית ואנושית. לא שיווקי, לא מתנשא.
כאילו אתה מספר לחבר משהו שלמדת בדרך הקשה."""

    prompt = f"""כתוב פוסט אינסטגרם שמתחיל מהתמונה הזו ומגיע לרעיון של מדריך חינמי שכתבת.

התמונה: {vision_description or title or 'תמונה שלי'}

הפוסט צריך להרגיש אמיתי — לא פרסומת.
תתחיל ממשהו ספציפי בתמונה הזו, ואז תגיד דבר אחד שלמדת שצלמים מתחילים בדרך כלל לא יודעים.
תסיים בטבעיות עם: "ריכזתי את הדברים האלה ועוד — PDF חינמי ב-link in bio."

אל תשתמש ב"שיתוף" / "הנה" / "חשוב לי לספר". פשוט תכתוב.
עברית בלבד. רק הפוסט."""

    msg = client.messages.create(
        model="claude-opus-4-8",
        max_tokens=450,
        system=system_prompt,
        messages=[{"role": "user", "content": image_content + [{"type": "text", "text": prompt}]}],
    )
    text = msg.content[0].text.strip()
    hashtags = get_hashtags(category)
    return f"{text}\n\n{hashtags}"


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

    system_prompt = """אתה עמית ארז, צלם ישראלי שמצלם מאהבה אמיתית.
אתה כותב בגוף ראשון, בעברית תקנית וברורה, כאילו אתה מסביר לחבר את ההחלטות שעשית בשטח.

הקול שלך:
- ישיר ואנושי, לא שיווקי
- מתחיל במה שמעניין בתמונה הזו ספציפית — המיקום, האור, הזווית, מה ראית שם
- מסביר את טכניקת הצילום: למה בחרת את הזווית הזו, איך התמודדת עם האור, מה ניסית להעביר
- כשיש EXIF — מסביר למה בחרת בהגדרות האלה, לא רק מה הן
- אם המיקום מעניין — מתייחס לחלל, לעומק, לגודל, למה הוא מרגיש כמו שהוא מרגיש בתמונה

תימנע מ:
- פתיחה עם שאלה — כל פוסט לא צריך להתחיל בשאלה
- תבנית קבועה שחוזרת על עצמה
- ביטויים ריקים כמו "שיתוף", "הנה", "חשוב לי לספר"
- שפה עמומה — כל משפט צריך להגיד משהו ספציפי על הצילום הזה"""

    caption_prompt = f"""כתוב כיתוב אינסטגרם בגוף ראשון עבור התמונה הזו.

מה שרואים בתמונה: {vision_description or '(לא זמין)'}
{meta_text}
{f'הגדרות: {exif_line}' if exif_line else ''}

התמקד בשניים-שלושה מהבאים, לפי מה שרלוונטי לתמונה:
- המיקום: מה מיוחד בחלל הזה, מה הגודל, העומק, האווירה שם
- ההחלטה הצילומית: למה בחרת זווית זו, מה ניסית להשיג בקומפוזיציה
- האור: מאיפה הגיע, מה עשית איתו, למה הוא עובד כאן
- ההגדרות: למה f/X עם ISO Y — מה זה נתן לך בפועל
- הרגע: כמה המתנת, מה גרם לך ללחוץ דווקא אז

סיים עם שורה ריקה ואז: 🛍️ זמין לרכישה — amitphotos.com (link in bio)

עברית תקנית וברורה. רק הכיתוב."""

    user_content = image_content + [{"type": "text", "text": caption_prompt}]

    msg = client.messages.create(
        model="claude-opus-4-8",
        max_tokens=500,
        system=system_prompt,
        messages=[{"role": "user", "content": user_content}],
    )

    caption_text = msg.content[0].text.strip()

    # 1 מתוך 4 פוסטים — פרומו אישי ל-PDF במקום footer רגיל
    if random.random() < 0.25:
        print("🎁 פוסט פרומו PDF (1/4)")
        return generate_pdf_promo_caption(photo, client, image_content, vision_description)

    PDF_FOOTER = "\n\n🎁 PDF חינם — 50 טיפים לצילום:\namitphotos.com/free-guide"
    return f"{caption_text}{PDF_FOOTER}\n\n{hashtags}"


def _try_r2(img_bytes):
    if not ADMIN_TOKEN:
        return None
    r = requests.post(
        f"{SITE_URL}/api/admin/upload-story",
        data=img_bytes,
        headers={"Authorization": f"Bearer {ADMIN_TOKEN}", "Content-Type": "image/jpeg"},
        timeout=60,
    )
    r.raise_for_status()
    url = r.json().get("url", "")
    return url if url.startswith("http") else None


def upload_to_public_host(source_url):
    resp = requests.get(source_url, timeout=30)
    resp.raise_for_status()
    img_bytes = resp.content

    hosts = [
        ("r2", _try_r2),
        ("litterbox", _try_litterbox),
        ("catbox", _try_catbox),
        ("tmpfiles", _try_tmpfiles),
        ("uguu", _try_uguu),
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
    url = url.replace("tmpfiles.org/", "tmpfiles.org/dl/")
    url = url.replace("http://", "https://")
    return url if url.startswith("https://") else None


def _try_uguu(img_bytes):
    r = requests.post(
        "https://uguu.se/upload",
        files={"files[]": ("photo.jpg", img_bytes, "image/jpeg")},
        timeout=60,
    )
    r.raise_for_status()
    data = r.json()
    files = data.get("files", [])
    url = files[0].get("url", "") if files else ""
    return url if url.startswith("https://") else None


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
    # Prefer full-res R2 URL; Instagram requires a publicly accessible CDN URL
    source_url = photo.get("url") or photo.get("thumbnail")
    if source_url and source_url.startswith("/"):
        source_url = f"{SITE_URL}{source_url}"

    # If already on our CDN (Cloudflare R2), use directly — avoids unreliable third-party hosts
    if source_url and source_url.startswith(f"{SITE_URL}/"):
        print(f"⬆️  תמונה ב-R2, URL ישיר: {source_url}")
        image_url = source_url
    else:
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

    # שמור את ה-ID לפני הפרסום — מונע כפילות אם ה-script נכשל אחרי upload
    posted_data["posted_ids"] = list(posted_ids | {photo["id"]})
    save_posted(posted_data)
    print(f"💾 {photo['id']} סומן כ-posted (לפני פרסום)")

    print("📤 מפרסם לאינסטגרם...")
    post_id = post_to_instagram(photo, caption)
    print(f"✅ פורסם בהצלחה! Instagram post ID: {post_id}")


if __name__ == "__main__":
    main()
