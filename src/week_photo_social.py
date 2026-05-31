#!/usr/bin/env python3
"""
Week Photo Social Agent
כשתמונת השבוע מוגדרת — מייצר כיתוב בגוף ראשון עם Claude Vision ומפרסם לאינסטגרם ופייסבוק.
"""

import base64
import os
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
    "default":           "#photography #photooftheday #israeliphotographer #amitphotos #צילום #ישראל",
    "טבע":               "#nature #naturephotography #wildlife #israel_nature #הטבע_הישראלי #amitphotos",
    "פורטרט":            "#portrait #portraitphotography #צילום_פורטרט #amitphotos #israeliphotographer",
    "פורטרטים":          "#portrait #portraitphotography #צילום_פורטרט #amitphotos #israeliphotographer",
    "עירוני":            "#urban #streetphotography #architecture #israel_urban #amitphotos",
    "אירועים":           "#events #weddingphotography #momentscaptured #amitphotos #צילום",
    "פרחים וצמחים":      "#flowers #naturephotography #macro #botanicalphotography #amitphotos",
    "בעלי חיים":         "#wildlife #animalphotography #nature #wildlifephotography #amitphotos",
    "מאקרו-צילומי תקריב": "#macro #macrophotography #closeup #details #amitphotos",
    "טבע דומם":          "#stilllife #stilllifephotography #art #amitphotos",
    "צילום מופשט":       "#abstract #abstractphotography #art #fineart #amitphotos",
    "ישראל":             "#israel #israeliphotographer #visitisrael #amitphotos #ישראל",
    "אבו דאבי":          "#abudhabi #uae #travel #travelphotography #amitphotos",
    "איטליה":            "#italy #italia #travel #travelphotography #amitphotos",
    "אנגליה":            "#england #uk #london #travel #travelphotography #amitphotos",
    "גרמניה":            "#germany #deutschland #travel #travelphotography #amitphotos",
    "הולנד":             "#netherlands #holland #amsterdam #travel #amitphotos",
    "וינה":              "#vienna #wien #austria #travel #travelphotography #amitphotos",
    "טנזניה":            "#tanzania #africa #safari #wildlife #travelphotography #amitphotos",
    "יוון":              "#greece #hellas #travel #travelphotography #amitphotos",
    "מונטנגרו":          "#montenegro #balkans #travel #travelphotography #amitphotos",
    "סלובקיה":           "#slovakia #europe #travel #travelphotography #amitphotos",
    'סן דיאגו - ארה"ב':  "#sandiego #california #usa #travel #travelphotography #amitphotos",
    "ספרד ואנדורה":      "#spain #espana #andorra #travel #travelphotography #amitphotos",
    "צכיה":              "#czechrepublic #prague #europe #travel #amitphotos",
}

CATEGORY_TO_LOCATION_SEARCH = {
    "ישראל":             "Israel",
    "אבו דאבי":          "Abu Dhabi",
    "איטליה":            "Italy",
    "אנגליה":            "England",
    "גרמניה":            "Germany",
    "הולנד":             "Netherlands",
    "וינה":              "Vienna",
    "טנזניה":            "Tanzania",
    "יוון":              "Greece",
    "מונטנגרו":          "Montenegro",
    "סלובקיה":           "Slovakia",
    'סן דיאגו - ארה"ב':  "San Diego",
    "ספרד ואנדורה":      "Spain",
    "צכיה":              "Czech Republic",
}

SHARE_CTA = "אהבתם? שתפו עם מי שאוהב צילום 🙏"


def get_location_id(category, token):
    """מחפש Facebook Place ID לפי קטגוריה — מחזיר None אם לא נמצא."""
    search_term = CATEGORY_TO_LOCATION_SEARCH.get(category)
    if not search_term:
        return None
    try:
        r = requests.get(
            f"{GRAPH_API}/search",
            params={"type": "place", "q": search_term, "fields": "id,name", "access_token": token},
            timeout=10,
        )
        if r.ok:
            data = r.json().get("data", [])
            if data:
                print(f"📍 נמצא location: {data[0]['name']} (id: {data[0]['id']})")
                return data[0]["id"]
    except Exception as e:
        print(f"⚠️  חיפוש location נכשל: {e}")
    return None


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


def fetch_image_as_base64(url, max_bytes=3_750_000):
    # max_bytes is raw limit: base64 inflates ~33%, so 3.75MB raw → ~5MB base64 (Anthropic limit)
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

    exif_parts = []
    if exif.get("aperture"): exif_parts.append(f"f/{exif['aperture']}")
    if exif.get("shutter"):  exif_parts.append(f"{exif['shutter']}s")
    if exif.get("focal"):    exif_parts.append(f"{exif['focal']}mm")
    if exif.get("iso"):      exif_parts.append(f"ISO {exif['iso']}")
    if exif.get("camera"):   exif_parts.append(exif['camera'])
    exif_line = " · ".join(exif_parts) if exif_parts else ""

    prompt = f"""Write a social media post for this photo by Israeli photographer Amit.

Metadata:
{meta_text or '(not available)'}
EXIF summary: {exif_line or '(not available)'}

Post structure (exactly in this order):
1. One sentence: what is in the frame — subject, genre (macro/landscape/portrait/long exposure/etc.), location if identifiable.
2. One sentence: the key technical or compositional decision — lighting conditions, time of day, framing choice.
3. If EXIF data is available — one line listing the shooting settings (aperture, shutter speed, focal length, ISO, camera). If not available, skip this line entirely.

Rules:
- Write in Hebrew only. Never mix Arabic script with Hebrew characters.
- Be specific and factual — no metaphors, no emotional language.
- Output only the post text, no titles or extra explanations."""

    msg = client.messages.create(
        model="claude-opus-4-8",
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
        model="claude-opus-4-8",
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


def upload_bytes_to_public_host(img_bytes, filename="image.jpg"):
    """מעלה bytes ל-R2 דרך ה-API שלנו, מחזיר URL."""
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
                    print(f"⬆️  הועלה (R2): {url}")
                    return url
        except Exception as e:
            print(f"⚠️  R2 upload נכשל ({e}) — עובר ל-fallback")

    # fallback: 0x0.st
    r = requests.post("https://0x0.st", files={"file": (filename, img_bytes, "image/jpeg")}, timeout=60)
    r.raise_for_status()
    url = r.text.strip()
    print(f"⬆️  הועלה (0x0.st): {url}")
    return url


def upload_to_public_host(source_url):
    """מעלה תמונה לשרת ציבורי (R2 ישיר / litterbox / 0x0.st)."""
    if source_url.startswith(f"{SITE_URL}/photos/"):
        print(f"⬆️  תמונה ב-R2, URL ישיר: {source_url}")
        return source_url
    resp = requests.get(source_url, timeout=30)
    resp.raise_for_status()
    return upload_bytes_to_public_host(resp.content)


def create_story_image_bytes(source_url):
    """יוצר תמונת 9:16 לסטורי אינסטגרם: התמונה המקורית במרכז + רקע מטושטש."""
    from PIL import Image, ImageFilter
    import io

    if source_url.startswith("/"):
        source_url = f"{SITE_URL}{source_url}"

    resp = requests.get(source_url, timeout=30)
    resp.raise_for_status()

    STORY_W, STORY_H = 1080, 1920
    img = Image.open(io.BytesIO(resp.content)).convert("RGB")
    orig_w, orig_h = img.size

    # רקע: scale לכסות קנבס במלואו → חיתוך → טשטוש → כהה
    bg_scale = max(STORY_W / orig_w, STORY_H / orig_h)
    bg = img.resize((int(orig_w * bg_scale) + 2, int(orig_h * bg_scale) + 2), Image.LANCZOS)
    bw, bh = bg.size
    bg = bg.crop(((bw - STORY_W) // 2, (bh - STORY_H) // 2,
                   (bw - STORY_W) // 2 + STORY_W, (bh - STORY_H) // 2 + STORY_H))
    bg = bg.filter(ImageFilter.GaussianBlur(radius=25))
    dark = Image.new("RGB", (STORY_W, STORY_H), (0, 0, 0))
    bg = Image.blend(bg, dark, 0.35)

    # תמונה מרכזית: fit בתוך 78% מגובה הקנבס (מרווח לטקסט + link sticker)
    fit_scale = min(STORY_W / orig_w, (STORY_H * 0.78) / orig_h)
    fg = img.resize((int(orig_w * fit_scale), int(orig_h * fit_scale)), Image.LANCZOS)
    paste_x = (STORY_W - fg.width) // 2
    paste_y = (STORY_H - fg.height) // 2 - 60  # מוזז מעט למעלה לפינות ל-sticker
    bg.paste(fg, (paste_x, paste_y))

    # Link sticker — pill לבן חצי-שקוף עם amitphotos.com
    from PIL import ImageDraw, ImageFont
    draw = ImageDraw.Draw(bg, "RGBA")

    text = "amitphotos.com"
    font_size = 38
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", font_size)
    except Exception:
        font = ImageFont.load_default()

    bbox = draw.textbbox((0, 0), text, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]

    pad_x, pad_y = 36, 20
    pill_w = text_w + pad_x * 2
    pill_h = text_h + pad_y * 2
    pill_x = (STORY_W - pill_w) // 2
    pill_y = STORY_H - 220

    # צייר pill (מלבן מעוגל) עם שקיפות
    r = pill_h // 2
    draw.rounded_rectangle(
        [pill_x, pill_y, pill_x + pill_w, pill_y + pill_h],
        radius=r,
        fill=(255, 255, 255, 220),
    )

    # טקסט כהה במרכז ה-pill
    text_x = pill_x + pad_x - bbox[0]
    text_y = pill_y + pad_y - bbox[1]
    draw.text((text_x, text_y), text, font=font, fill=(30, 30, 30, 255))

    buf = io.BytesIO()
    bg.convert("RGB").save(buf, format="JPEG", quality=92)
    print(f"📐 סטורי נוצר: {STORY_W}x{STORY_H}, {len(buf.getvalue())//1024}KB")
    return buf.getvalue()


def prepare_post_assets(photo):
    """מחזיר image_url ו-hashtags מוכנים לפרסום."""
    source_url = photo.get("url") or photo.get("thumbnail")
    if source_url and source_url.startswith("/"):
        source_url = f"{SITE_URL}{source_url}"
    image_url = upload_to_public_host(source_url)
    hashtags  = HASHTAGS_BY_CATEGORY.get(photo.get("category", ""), HASHTAGS_BY_CATEGORY["default"])
    return image_url, hashtags


def post_to_instagram(photo, caption, image_url, hashtags):
    """מפרסם לאינסטגרם עם הכיתוב + hashtags + location + alt_text."""
    if not IG_USER_ID or not IG_TOKEN:
        print("⚠️  חסרים INSTAGRAM_USER_ID / INSTAGRAM_PAGE_TOKEN — מדלג")
        return

    full_caption = f"{caption}\n\n{SHARE_CTA}\n\n🛍️ זמין לרכישה — amitphotos.com (link in bio)\n\n{hashtags}"
    alt_text = photo.get("description") or photo.get("title") or ""
    location_id = get_location_id(photo.get("category", ""), IG_TOKEN)

    container_data = {
        "image_url": image_url,
        "caption": full_caption,
        "alt_text": alt_text,
        "access_token": IG_TOKEN,
    }
    if location_id:
        container_data["location_id"] = location_id

    container = requests.post(f"{GRAPH_API}/{IG_USER_ID}/media", data=container_data, timeout=30)
    if not container.ok and location_id:
        print(f"⚠️  IG container עם location נכשל — מנסה בלי location")
        del container_data["location_id"]
        container = requests.post(f"{GRAPH_API}/{IG_USER_ID}/media", data=container_data, timeout=30)
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


def post_to_instagram_story(story_url):
    """מפרסם סטורי לאינסטגרם."""
    if not IG_USER_ID or not IG_TOKEN:
        print("⚠️  חסרים פרטי אינסטגרם — מדלג על סטורי")
        return

    container = requests.post(f"{GRAPH_API}/{IG_USER_ID}/media", data={
        "image_url": story_url,
        "media_type": "STORIES",
        "access_token": IG_TOKEN,
    }, timeout=30)
    if not container.ok:
        print(f"❌ Story container נכשל: {container.status_code} — {container.text}")
        return

    container_id = container.json().get("id")
    publish = requests.post(f"{GRAPH_API}/{IG_USER_ID}/media_publish", data={
        "creation_id": container_id, "access_token": IG_TOKEN,
    }, timeout=30)
    if publish.ok:
        print(f"✅ סטורי פורסם! ID: {publish.json().get('id')}")
    else:
        print(f"❌ Story publish נכשל: {publish.status_code} — {publish.text}")


def post_to_facebook(photo, caption, image_url, hashtags):
    """מפרסם לפייסבוק עם הכיתוב + hashtags."""
    if not FB_PAGE_ID or not FB_TOKEN:
        print("⚠️  חסרים FACEBOOK_PAGE_ID / FACEBOOK_PAGE_TOKEN — מדלג")
        return

    buy_link     = f"{SITE_URL}/photo/{photo['id']}"
    full_caption = f"{caption}\n\n{SHARE_CTA}\n\n🛍️ לרכישת התמונה: {buy_link}\n\n{hashtags}"

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

    # סטורי אינסטגרם — תמונה בפורמט 9:16 עם רקע מטושטש
    source_url = photo.get("url") or photo.get("thumbnail") or ""
    if source_url:
        try:
            story_bytes = create_story_image_bytes(source_url)
            story_url   = upload_bytes_to_public_host(story_bytes, "story.jpg")
            post_to_instagram_story(story_url)
        except Exception as e:
            print(f"⚠️  סטורי נכשל: {e}")


if __name__ == "__main__":
    main()
