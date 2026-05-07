#!/usr/bin/env python3
"""
Camera Education Promo Post
מפרסם פוסט קידומי לפייסבוק ולאינסטגרם שמוביל לדפי הלימוד של אמית.
משתמש בתמונה אמיתית מהגלריה + כיתוב שמסביר טכניקה ומזמין ללמוד.
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
POSTED_FILE = Path(__file__).parent.parent / "data" / "camera_edu_posted.json"
SITE_URL    = "https://amitphotos.com"
GRAPH_API   = "https://graph.facebook.com/v21.0"

PAGE_ID           = os.environ.get("FACEBOOK_PAGE_ID", "")
FB_TOKEN          = os.environ.get("FACEBOOK_PAGE_TOKEN", "")
IG_USER_ID        = os.environ.get("INSTAGRAM_USER_ID", "")
IG_TOKEN          = os.environ.get("INSTAGRAM_PAGE_TOKEN", "")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()
ADMIN_TOKEN       = os.environ.get("ADMIN_TOKEN", "")

# ===== דפי הלימוד =====
EDUCATION_PAGES = [
    {
        "key": "lenses",
        "url": f"{SITE_URL}/camera/lenses/",
        "title": "עדשות",
        "emoji": "🔭",
        "best_categories": ["טבע", "פורטרט"],
        "angle": "עדשות — מרחק מוקד, בוקה ו-Wide vs Telephoto",
        "hook": "הבוקה ברקע לא קורה במקרה — הוא תוצאה של בחירת עדשה מכוונת.",
    },
    {
        "key": "light",
        "url": f"{SITE_URL}/camera/light/",
        "title": "אור וצבע",
        "emoji": "🌅",
        "best_categories": ["טבע", "עירוני"],
        "angle": "אור וצבע — שעת הקסם, טמפרטורת צבע ואור רך מול קשה",
        "hook": "הצבעים בתמונה הזו לא נוצרו בעריכה — הם הגיעו מבחירת השעה הנכונה.",
    },
    {
        "key": "exposure",
        "url": f"{SITE_URL}/camera/exposure/",
        "title": "חשיפה",
        "emoji": "☀️",
        "best_categories": ["טבע", "עירוני", "אירועים"],
        "angle": "חשיפה — המשולש ISO, צמצם ותריס",
        "hook": "לכל תמונה יש שלושה כפתורים שקובעים כמה אור יגיע לחיישן. לכל אחד יש מחיר.",
    },
    {
        "key": "composition",
        "url": f"{SITE_URL}/camera/composition/",
        "title": "קומפוזיציה",
        "emoji": "🔲",
        "best_categories": ["טבע", "עירוני", "פורטרט"],
        "angle": "קומפוזיציה — חוק השליש, קווים מובילים ומסגור",
        "hook": "לא מה שצולם — אלא איך. הקומפוזיציה היא מה שהצופה מרגיש לפני שהוא מבין למה.",
    },
    {
        "key": "filters",
        "url": f"{SITE_URL}/camera/filters/",
        "title": "פילטרים",
        "emoji": "🎨",
        "best_categories": ["טבע"],
        "angle": "פילטרים — UV, ND, CPL, GND",
        "hook": "השמיים הכחולים בתמונה הזו לא גובהו בעריכה — זה פילטר CPL על העדשה.",
    },
    {
        "key": "visual-language",
        "url": f"{SITE_URL}/camera/visual-language/",
        "title": "שפה צילומית",
        "emoji": "🖼️",
        "best_categories": ["פורטרט", "טבע", "עירוני"],
        "angle": "שפה צילומית — לפתח קול אישי ייחודי",
        "hook": "אחרי שלומדים לצלם — מתחילים לשאול למה לצלם את זה, ולא משהו אחר.",
    },
    {
        "key": "editing",
        "url": f"{SITE_URL}/camera/editing/",
        "title": "עריכה",
        "emoji": "✏️",
        "best_categories": ["פורטרט", "טבע", "עירוני"],
        "angle": "עריכה כביטוי — RAW, חמישה אלמנטי עריכה, Lightroom vs Capture One",
        "hook": "RAW הוא לא ״איכות גבוהה יותר״ — הוא ניגטיב דיגיטלי. ההבדל הוא בשליטה, לא בפיקסלים.",
    },
    {
        "key": "types",
        "url": f"{SITE_URL}/camera/types/",
        "title": "סוגי מצלמות",
        "emoji": "📷",
        "best_categories": ["טבע", "פורטרט", "עירוני"],
        "angle": "Full Frame vs APS-C vs סמארטפון — מה ההבדל האמיתי",
        "hook": "ה-Crop Factor הוא לא רק מספר — הוא משנה את זווית הראייה ועומק השדה של כל עדשה.",
    },
    {
        "key": "software",
        "url": f"{SITE_URL}/camera/software/",
        "title": "תוכנות וארגון",
        "emoji": "⚙️",
        "best_categories": ["טבע", "פורטרט", "עירוני"],
        "angle": "Lightroom, Capture One ו-Photoshop — מה מתאים למה",
        "hook": "הסוד לארגון 10,000 תמונות: לא אלבומים — keywords + גיבוי 3-2-1.",
    },
    {
        "key": "controls",
        "url": f"{SITE_URL}/camera/controls/",
        "title": "כפתורי מצלמה",
        "emoji": "🎛",
        "best_categories": ["טבע", "פורטרט", "עירוני", "אירועים"],
        "angle": "כפתורי מצלמה — מ-Auto ל-Manual",
        "hook": "כפתור ה-EV± הוא הכלי הכי חשוב על המצלמה שרוב הצלמים לא משתמשים בו מספיק.",
    },
]

# ===== Hashtag pools =====
EDU_HASHTAGS_FB = [
    "#צילום #photography #ישראל #למודצילום",
    "#photography #learnphotography #ישראל #צילום",
    "#צלם #צילום_ישראלי #photography_tips #cameratips",
]

EDU_HASHTAGS_IG = [
    "#photography #learnphotography #photographytips #cameraschool #ישראל #צילום #למד_לצלם #photooftheday",
    "#photographylessons #cameratips #learnphotography #photographylovers #צלם #טיפצילום #israel_photography",
    "#photographyeducation #photographylife #camerawork #צילום #ישראל #photographytechniques #photoart",
]


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
    return {"posted_keys": []}


def save_posted(data):
    POSTED_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def pick_page(posted_keys):
    unposted = [p for p in EDUCATION_PAGES if p["key"] not in posted_keys]
    if not unposted:
        print("🔄 כל הדפים קודמו — מתחיל rotation מחדש")
        return random.choice(EDUCATION_PAGES)
    return random.choice(unposted)


def pick_photo_for_page(photos, page):
    preferred = [p for p in photos if p.get("category") in page["best_categories"]]
    pool = preferred if preferred else photos
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


def generate_posts(photo, page):
    """מייצר פוסט לפייסבוק ופוסט לאינסטגרם בקריאת API אחת."""
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

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

    exif = photo.get("exif") or {}
    exif_parts = []
    if exif.get("aperture"): exif_parts.append(f"f/{exif['aperture']}")
    if exif.get("shutter"):  exif_parts.append(f"{exif['shutter']}s")
    if exif.get("focal"):    exif_parts.append(f"{exif['focal']}mm")
    if exif.get("iso"):      exif_parts.append(f"ISO {exif['iso']}")
    exif_line = " · ".join(exif_parts) if exif_parts else ""

    system_prompt = """אתה כותב פוסטים לרשתות חברתיות בשביל צלם ישראלי בשם אמית.
סגנון: מקצועי, חינוכי, תכליתי — כמו צלם שמסביר את הרמה שלו לצלמים אחרים.
כתוב בעברית בלבד."""

    prompt = f"""כתוב שני גרסאות של פוסט קידומי שמשלב את התמונה עם קידום הדף הלימודי.

נושא הדף: {page['angle']}
Hook: {page['hook']}
קישור לדף: {page['url']}
EXIF התמונה: {exif_line or '(לא זמין)'}
כותרת התמונה: {photo.get('title', '')}

**גרסה 1 — פייסבוק:**
מבנה:
1. משפט פתיחה (hook) שמקשר בין התמונה לנושא הלימודי — מה רואים בפריים ואיזה עיקרון צילומי הוא מדגים
2. אם יש EXIF — שורת הגדרות טכניות קצרה (אחרת — דלג)
3. 2-3 שורות שמסבירות בקצרה מה ילמד מי שיכנס לדף (תיזר — לא כל הסיפור)
4. שורה ריקה
5. 👉 ללמוד עוד: {page['url']}

**גרסה 2 — אינסטגרם:**
מבנה:
1. שורת hook קצרה ומושכת שמקשרת בין התמונה לנושא
2. אם יש EXIF — שורת הגדרות טכניות (אחרת — דלג)
3. 1-2 שורות קצרות עם teaser של מה לומדים בדף
4. שורה ריקה
5. 👉 קישור בביו ← {page['title']} {page['emoji']}

פרד בין הגרסאות עם: ---SEPARATOR---
כתוב רק את הטקסט של הפוסטים, ללא כותרות כמו "גרסה 1" וכו'."""

    user_content = image_content + [{"type": "text", "text": prompt}]
    msg = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=800,
        system=system_prompt,
        messages=[{"role": "user", "content": user_content}],
    )

    text = msg.content[0].text.strip()
    parts = text.split("---SEPARATOR---")
    fb_text  = parts[0].strip() if len(parts) >= 1 else text
    ig_text  = parts[1].strip() if len(parts) >= 2 else fb_text

    fb_hashtags = random.choice(EDU_HASHTAGS_FB)
    ig_hashtags = random.choice(EDU_HASHTAGS_IG)

    return f"{fb_text}\n\n{fb_hashtags}", f"{ig_text}\n\n{ig_hashtags}"


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

    # Try upload hosts
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
    r = requests.post(
        f"{SITE_URL}/api/admin/upload-story",
        data=img_bytes,
        headers={"Authorization": f"Bearer {ADMIN_TOKEN}", "Content-Type": "image/jpeg"},
        timeout=60,
    )
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


def post_to_facebook(photo, message):
    source_url = photo.get("thumbnail") or photo.get("url")
    if source_url and source_url.startswith("/"):
        source_url = f"{SITE_URL}{source_url}"

    resp = requests.get(source_url, timeout=30)
    resp.raise_for_status()
    img_bytes = resp.content

    image_url = None
    for name, fn in [("r2", _try_r2), ("litterbox", _try_litterbox), ("catbox", _try_catbox), ("0x0", _try_0x0)]:
        try:
            image_url = fn(img_bytes)
            if image_url:
                print(f"⬆️  FB — הועלה ל-{name}")
                break
        except Exception as e:
            print(f"⚠️  FB upload {name} נכשל ({e})")

    if not image_url:
        image_url = source_url  # last resort: original URL

    resp = requests.post(f"{GRAPH_API}/{PAGE_ID}/photos", data={
        "url": image_url, "message": message, "access_token": FB_TOKEN,
    }, timeout=30)
    if not resp.ok:
        print(f"❌ Facebook API: {resp.status_code} — {resp.text}")
        return None
    result = resp.json()
    return result.get("id")


def post_to_instagram(photo, caption):
    import time
    image_url = get_public_image_url(photo)

    container_resp = requests.post(f"{GRAPH_API}/{IG_USER_ID}/media", data={
        "image_url": image_url, "caption": caption, "access_token": IG_TOKEN,
    }, timeout=30)
    if not container_resp.ok:
        print(f"❌ Instagram API: {container_resp.status_code} — {container_resp.text}")
        return None
    container_data = container_resp.json()
    if "id" not in container_data:
        print(f"❌ שגיאה ביצירת container: {container_data}")
        return None

    creation_id = container_data["id"]
    print(f"📦 Container נוצר: {creation_id}")

    for _ in range(10):
        time.sleep(5)
        status_resp = requests.get(f"{GRAPH_API}/{creation_id}",
            params={"fields": "status_code", "access_token": IG_TOKEN}, timeout=30)
        status = status_resp.json().get("status_code", "")
        print(f"⏳ סטטוס: {status}")
        if status == "FINISHED":
            break
        if status == "ERROR":
            print(f"❌ שגיאת container: {status_resp.json()}")
            return None

    publish_resp = requests.post(f"{GRAPH_API}/{IG_USER_ID}/media_publish", data={
        "creation_id": creation_id, "access_token": IG_TOKEN,
    }, timeout=30)
    publish_resp.raise_for_status()
    result = publish_resp.json()
    return result.get("id")


def main():
    missing = []
    if not PAGE_ID or not FB_TOKEN:
        missing.append("FACEBOOK_PAGE_ID / FACEBOOK_PAGE_TOKEN")
    if not IG_USER_ID or not IG_TOKEN:
        missing.append("INSTAGRAM_USER_ID / INSTAGRAM_PAGE_TOKEN")
    if not ANTHROPIC_API_KEY:
        missing.append("ANTHROPIC_API_KEY")
    if missing:
        print(f"❌ חסרים: {', '.join(missing)}")
        sys.exit(1)

    photos      = load_photos()
    posted_data = load_posted()
    posted_keys = set(posted_data.get("posted_keys", []))

    page  = pick_page(posted_keys)
    photo = pick_photo_for_page(photos, page)

    print(f"📚 דף לימוד נבחר: {page['title']} ({page['url']})")
    print(f"📸 תמונה נבחרה: {photo.get('title', photo['id'])}")

    print("✍️  מייצר פוסטים עם Claude Vision...")
    fb_caption, ig_caption = generate_posts(photo, page)

    print(f"\n--- פייסבוק ---\n{fb_caption}\n")
    print(f"--- אינסטגרם ---\n{ig_caption}\n---------------\n")

    fb_id = None
    ig_id = None

    if PAGE_ID and FB_TOKEN:
        print("📤 מפרסם לפייסבוק...")
        fb_id = post_to_facebook(photo, fb_caption)
        if fb_id:
            print(f"✅ פייסבוק: {fb_id}")
        else:
            print("❌ פרסום לפייסבוק נכשל")

    if IG_USER_ID and IG_TOKEN:
        print("📤 מפרסם לאינסטגרם...")
        ig_id = post_to_instagram(photo, ig_caption)
        if ig_id:
            print(f"✅ אינסטגרם: {ig_id}")
        else:
            print("❌ פרסום לאינסטגרם נכשל")

    if fb_id or ig_id:
        posted_data["posted_keys"] = list(posted_keys | {page["key"]})
        save_posted(posted_data)
        print(f"💾 עודכן data/camera_edu_posted.json")
    else:
        print("❌ שני הפרסומים נכשלו — לא מעדכן מעקב")
        sys.exit(1)


if __name__ == "__main__":
    main()
