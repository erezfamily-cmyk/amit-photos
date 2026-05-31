#!/usr/bin/env python3
"""
Camera Education Promo Post
מפרסם פוסט קידומי לכל 4 רשתות חברתיות שמוביל לדפי הלימוד של אמית.
משתמש בתמונה אמיתית מהגלריה + כיתוב שמסביר טכניקה ומזמין ללמוד.
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
POSTED_FILE = Path(__file__).parent.parent / "data" / "camera_edu_posted.json"
SITE_URL    = "https://amitphotos.com"
GRAPH_API   = "https://graph.facebook.com/v21.0"
THREADS_API = "https://graph.threads.net/v1.0"
PINTEREST_API = "https://api.pinterest.com/v5"

PAGE_ID           = os.environ.get("FACEBOOK_PAGE_ID", "")
FB_TOKEN          = os.environ.get("FACEBOOK_PAGE_TOKEN", "")
IG_USER_ID        = os.environ.get("INSTAGRAM_USER_ID", "")
IG_TOKEN          = os.environ.get("INSTAGRAM_PAGE_TOKEN", "")
THREADS_USER_ID   = os.environ.get("THREADS_USER_ID", "")
THREADS_TOKEN     = os.environ.get("THREADS_ACCESS_TOKEN", "")
PINTEREST_TOKEN   = os.environ.get("PINTEREST_ACCESS_TOKEN", "")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()
ADMIN_TOKEN       = os.environ.get("ADMIN_TOKEN", "")

PINTEREST_BOARD = "Photography Education & Techniques"

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
    {
        "key": "macro",
        "url": f"{SITE_URL}/camera/macro/",
        "title": "צילום מאקרו",
        "emoji": "🔬",
        "best_categories": ["טבע"],
        "angle": "צילום מאקרו — יחס הגדלה, עומק שדה דק וציוד",
        "hook": "בצילום מאקרו עומק השדה יכול להיות פחות ממילימטר — ולזה צריך תכנון מדויק.",
    },
    {
        "key": "sports",
        "url": f"{SITE_URL}/camera/sports/",
        "title": "צילום ספורט ותנועה",
        "emoji": "⚡",
        "best_categories": ["אירועים"],
        "angle": "צילום ספורט ותנועה — תריס מהיר, AI tracking ו-burst",
        "hook": "אחיזת הרגע הנכון לא עניין של מזל — זה תכנון של זמן תריס ו-tracking מראש.",
    },
    {
        "key": "dynamic-range",
        "url": f"{SITE_URL}/camera/dynamic-range/",
        "title": "טווח דינמי",
        "emoji": "🌗",
        "best_categories": ["טבע", "עירוני"],
        "angle": "טווח דינמי — מה רואה החיישן מול מה רואה העין",
        "hook": "למה שמיים בהירים עם נוף חשוך? כי לחיישן טווח דינמי מוגבל — והפתרון לא תמיד HDR.",
    },
    {
        "key": "histogram",
        "url": f"{SITE_URL}/camera/histogram/",
        "title": "היסטוגרמה",
        "emoji": "📊",
        "best_categories": ["טבע", "עירוני", "פורטרט"],
        "angle": "היסטוגרמה — לקרוא חשיפה בלי להסתמך על מסך",
        "hook": "המסך של המצלמה משקר — ההיסטוגרמה לא. צלם שיודע לקרוא אותה חשוף נכון בכל תאורה.",
    },
    {
        "key": "depth-of-field",
        "url": f"{SITE_URL}/camera/depth-of-field/",
        "title": "עומק שדה",
        "emoji": "🎯",
        "best_categories": ["פורטרט", "טבע"],
        "angle": "עומק שדה ובוקה — חישוב DOF וסימולציה ויזואלית",
        "hook": "עומק השדה הוא לא אפקט עריכה — הוא נוצר בשניה שבה לוחצים על שחרור.",
    },
    {
        "key": "white-balance",
        "url": f"{SITE_URL}/camera/white-balance/",
        "title": "איזון לבן",
        "emoji": "⬜",
        "best_categories": ["פורטרט", "עירוני"],
        "angle": "איזון לבן — טמפרטורת צבע, Kelvin וצבעי עור",
        "hook": "האם העור בפורטרט שלך נראה צהוב? זה לא שאלה של עריכה — זה איזון לבן שגוי בשידור חי.",
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

EDU_HASHTAGS_THREADS = [
    "#צילום #photography #cameratips",
    "#learnphotography #צלם #ישראל",
    "#photographytips #צילום_ישראלי",
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
    """מייצר פוסטים לכל 4 הפלטפורמות."""
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

    system_prompt = """אתה עמית, צלם ישראלי, כותב בגוף ראשון (לימדתי, גיליתי, השתמשתי) על נושאי צילום שאתה מלמד.
הקהל: אנשים חדשים בתחום הצילום — לא מניחים ידע מוקדם.
סגנון: אישי, חינוכי, נגיש — כאילו אתה מסביר לחבר משהו שאתה מתלהב ממנו.
כשמשתמשים במונח טכני (כמו "צמצם" או "ISO") — מסבירים אותו בביטוי פשוט אחד בסוגריים.
כתוב בעברית תקנית וברורה (חוץ מגרסת Pinterest שבאנגלית)."""

    prompt = f"""כתוב שלוש גרסאות של פוסט קידומי בגוף ראשון שמשלב את התמונה עם הדף הלימודי.
כתוב כאילו אתה (עמית) מסביר בעצמך על הנושא — לא מדברים על עמית, מדברים בתור עמית.

נושא הדף: {page['angle']}
Hook: {page['hook']}
קישור לדף: {page['url']}
EXIF התמונה: {exif_line or '(לא זמין)'}
כותרת התמונה: {photo.get('title', '')}

**גרסה 1 — פייסבוק:**
1. פתיחה בגוף ראשון שמקשרת בין התמונה לנושא הלימודי — שאלה מסקרנת או פרט מפתיע
2. אם יש EXIF — שורה עם ההגדרות + הסבר קצר למה בחרתי בהן (אחרת דלג)
3. 1-2 שורות שמסבירות מה אני מלמד בדף ומה תוכל לעשות אחרי שתקרא
4. שאלה לעוקבים שמזמינה תגובה אמיתית
5. שורה ריקה
6. 👉 ללמוד עוד: {page['url']}

**גרסה 2 — Threads:**
1-2 משפטים קצרים בגוף ראשון — עובדה ספציפית ומעניינת מהניסיון שלי, ברורה גם למתחיל.
שורה ריקה
{page['url']}
(מקסימום 150 תווים לפני הקישור)

**גרסה 3 — Pinterest (באנגלית):**
2-3 משפטים בגוף ראשון — מה I teach in this guide ולמה זה שימושי למתחיל. ברור, ללא ז'רגון.
מסיים ב: "Full guide at amitphotos.com"
(ללא hashtags, ללא שאלות)

הפרד בין הגרסאות עם: ---SEP---
כתוב רק את הטקסט, ללא כותרות כמו "גרסה 1" וכו'."""

    user_content = image_content + [{"type": "text", "text": prompt}]
    msg = client.messages.create(
        model="claude-opus-4-8",
        max_tokens=1000,
        system=system_prompt,
        messages=[{"role": "user", "content": user_content}],
    )

    text = msg.content[0].text.strip()
    parts = [p.strip() for p in text.split("---SEP---")]

    fb_text        = parts[0] if len(parts) > 0 else text
    threads_text   = parts[1] if len(parts) > 1 else fb_text[:200]
    pinterest_text = parts[2] if len(parts) > 2 else ""

    fb_hashtags      = random.choice(EDU_HASHTAGS_FB)
    threads_hashtags = random.choice(EDU_HASHTAGS_THREADS)

    return (
        f"{fb_text}\n\n{fb_hashtags}",
        f"{threads_text}\n\n{threads_hashtags}",
        pinterest_text,
    )


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


def post_to_facebook(image_url, message):
    if not PAGE_ID or not FB_TOKEN:
        print("⚠️  Facebook credentials חסרים — דלג")
        return None
    resp = requests.post(f"{GRAPH_API}/{PAGE_ID}/photos", data={
        "url": image_url, "caption": message, "access_token": FB_TOKEN,
    }, timeout=30)
    if not resp.ok:
        print(f"❌ Facebook API: {resp.status_code} — {resp.text}")
        return None
    return resp.json().get("id")


def post_to_instagram(image_url, caption):
    if not IG_USER_ID or not IG_TOKEN:
        print("⚠️  Instagram credentials חסרים — דלג")
        return None

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
    if not publish_resp.ok:
        print(f"❌ Instagram publish: {publish_resp.status_code} — {publish_resp.text}")
        return None
    return publish_resp.json().get("id")


def post_to_threads(image_url, text):
    if not THREADS_USER_ID or not THREADS_TOKEN:
        print("⚠️  Threads credentials חסרים — דלג")
        return None

    container = requests.post(f"{THREADS_API}/{THREADS_USER_ID}/threads",
        params={"access_token": THREADS_TOKEN},
        json={"media_type": "IMAGE", "image_url": image_url, "text": text},
        timeout=30)
    if not container.ok:
        print(f"❌ Threads container: {container.status_code} — {container.text}")
        return None
    container_id = container.json().get("id")
    if not container_id:
        return None
    print(f"📦 Threads container: {container_id}")

    for _ in range(12):
        time.sleep(5)
        r = requests.get(f"{THREADS_API}/{container_id}",
            params={"fields": "status,error_message", "access_token": THREADS_TOKEN},
            timeout=30).json()
        status = r.get("status", "")
        print(f"⏳ Threads: {status}")
        if status == "FINISHED":
            break
        if status == "ERROR":
            print(f"❌ Threads error: {r.get('error_message', '')}")
            return None

    publish = requests.post(f"{THREADS_API}/{THREADS_USER_ID}/threads_publish",
        params={"access_token": THREADS_TOKEN},
        json={"creation_id": container_id}, timeout=30)
    if not publish.ok:
        print(f"❌ Threads publish: {publish.status_code} — {publish.text}")
        return None
    return publish.json().get("id")


def _get_or_create_pinterest_board(token, board_name):
    data = requests.get(f"{PINTEREST_API}/boards",
        headers={"Authorization": f"Bearer {token}"},
        params={"page_size": 250}, timeout=15).json()
    for b in data.get("items", []):
        if b["name"] == board_name:
            print(f"📋 לוח Pinterest קיים: {board_name}")
            return b["id"]
    b = requests.post(f"{PINTEREST_API}/boards",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"name": board_name, "description": f"Photography tutorials and techniques by Amit | {SITE_URL}/camera/", "privacy": "PUBLIC"},
        timeout=15)
    b.raise_for_status()
    board_id = b.json().get("id")
    print(f"✅ לוח Pinterest חדש: {board_name} ({board_id})")
    time.sleep(1)
    return board_id


def post_to_pinterest(image_url, description, page):
    if not PINTEREST_TOKEN:
        print("⚠️  Pinterest token חסר — דלג")
        return None
    try:
        board_id = _get_or_create_pinterest_board(PINTEREST_TOKEN, PINTEREST_BOARD)
    except Exception as e:
        print(f"❌ Pinterest board error: {e}")
        return None

    pin = requests.post(f"{PINTEREST_API}/pins",
        headers={"Authorization": f"Bearer {PINTEREST_TOKEN}", "Content-Type": "application/json"},
        json={
            "board_id": board_id,
            "title": f"{page['title']} — Photography Guide",
            "description": description or f"Learn about {page['angle']} at amitphotos.com",
            "link": page["url"],
            "media_source": {"source_type": "image_url", "url": image_url},
        }, timeout=20)
    if not pin.ok:
        print(f"❌ Pinterest pin: {pin.status_code} — {pin.text}")
        return None
    pin_id = pin.json().get("id")
    time.sleep(3)
    return pin_id


def main():
    sys.stdout.reconfigure(encoding="utf-8")

    if not ANTHROPIC_API_KEY:
        print("❌ חסר ANTHROPIC_API_KEY")
        sys.exit(1)

    photos      = load_photos()
    posted_data = load_posted()
    posted_keys = set(posted_data.get("posted_keys", []))

    page  = pick_page(posted_keys)
    photo = pick_photo_for_page(photos, page)

    print(f"📚 דף לימוד: {page['title']} ({page['url']})")
    print(f"📸 תמונה: {photo.get('title', photo['id'])}")

    print("✍️  מייצר פוסטים עם Claude Vision...")
    fb_caption, threads_caption, pinterest_desc = generate_posts(photo, page)
    print(f"\nFacebook preview: {fb_caption[:120]}...\n")

    image_url = get_public_image_url(photo)

    results = {}

    print("📤 מפרסם לפייסבוק...")
    results["facebook"] = post_to_facebook(image_url, fb_caption)
    print(f"{'✅' if results['facebook'] else '❌'} Facebook: {results['facebook']}")

    print("📤 מפרסם ל-Threads...")
    results["threads"] = post_to_threads(image_url, threads_caption)
    print(f"{'✅' if results['threads'] else '❌'} Threads: {results['threads']}")

    print("📤 מפרסם ל-Pinterest...")
    results["pinterest"] = post_to_pinterest(image_url, pinterest_desc, page)
    print(f"{'✅' if results['pinterest'] else '❌'} Pinterest: {results['pinterest']}")

    if any(results.values()):
        posted_data["posted_keys"] = list(posted_keys | {page["key"]})
        save_posted(posted_data)
        print(f"💾 עודכן data/camera_edu_posted.json")
    else:
        print("❌ כל הפרסומים נכשלו — לא מעדכן מעקב")
        sys.exit(1)

    success = sum(1 for v in results.values() if v)
    print(f"\n✅ הסתיים — {success}/4 רשתות פורסמו בהצלחה")


if __name__ == "__main__":
    main()
