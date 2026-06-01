#!/usr/bin/env python3
"""
Newsletter Social Post
מפרסם פוסט על הניוזלטר החדש לאינסטגרם, פייסבוק ו-Threads
"""

import os, sys, time, json, base64, requests, anthropic

SITE_URL      = "https://amitphotos.com"
GRAPH_API     = "https://graph.facebook.com/v21.0"
THREADS_API   = "https://graph.threads.net/v1.0"

NEWSLETTER_SLUG = os.environ.get("NEWSLETTER_SLUG", "2026-06-full")
HERO_IMAGE_URL  = os.environ.get("HERO_IMAGE_URL", f"{SITE_URL}/photos/0978111c-bea2-4fd9-b1b0-398ac75d0c36.jpg")
NEWSLETTER_URL  = f"{SITE_URL}/newsletter/{NEWSLETTER_SLUG}/"

IG_USER_ID        = os.environ.get("INSTAGRAM_USER_ID", "")
IG_TOKEN          = os.environ.get("INSTAGRAM_PAGE_TOKEN", "")
FB_PAGE_ID        = os.environ.get("FACEBOOK_PAGE_ID", "")
FB_TOKEN          = os.environ.get("FACEBOOK_PAGE_TOKEN", "")
THREADS_USER_ID   = os.environ.get("THREADS_USER_ID", "")
THREADS_TOKEN     = os.environ.get("THREADS_ACCESS_TOKEN", "")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()

NEWSLETTER_SUMMARY = """
גיליון #2 — יוני 2026

תמונה מומלצת: "דייזיז בגן אנגליה"
שדה שלם של דייזיז קטנות בבוקר טחוב — רכנתי קרוב לאדמה לתפוס את הטל שנצמד לעלי הכותרת הלבנים.

מדריך החודש: טווח דינמי
שלושה שלבים: מדידת נקודות הקצה בסצנה, bracketing, מיזוג ב-Lightroom —
כדי שהתמונה תיראה כמו שהעין ראתה.

מקום לצילום: המצפה התת-ימי אילת
ממש מתחת לפני הים, מוקף בדגים ואלמוגים בלי להירטב.
טיפ: הצמד עדשה לזכוכית ועטוף בבד כהה — כאילו צילמת בתוך המים.
"""


def fetch_image_b64(url, max_bytes=3_750_000):
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
    except ImportError:
        pass
    b64 = base64.standard_b64encode(img_bytes).decode("utf-8")
    print(f"🖼️  תמונה: {len(img_bytes)//1024}KB")
    return b64


def generate_captions(client, image_b64):
    image_block = [{"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": image_b64}}]

    # ===== עברית — אינסטגרם + פייסבוק =====
    he_msg = client.messages.create(
        model="claude-opus-4-8",
        max_tokens=600,
        system="""אתה עמית ארז, צלם ישראלי שמצלם מאהבה. כותב בגוף ראשון, בעברית טבעית ואנושית.
לא שיווקי. כאילו אתה מספר לחבר על מה שצילמת ומה יש לך לתת.""",
        messages=[{"role": "user", "content": image_block + [{"type": "text", "text": f"""כתוב פוסט אינסטגרם בגוף ראשון שמקדם את הגיליון החדש של הניוזלטר.

תוכן הגיליון:
{NEWSLETTER_SUMMARY}

קישור: {NEWSLETTER_URL}

הנחיות:
- התחל מהתמונה הזו ספציפית (דייזיז בבוקר טחוב, אנגליה)
- הזכר בטבעיות שיש גיליון חדש — מדריך טווח דינמי ומקום לצילום באילת
- אל תפתח עם שאלה
- 3-5 משפטים
- סיים עם: הניוזלטר מגיע פעם בחודש ← {NEWSLETTER_URL}
- רק עברית, רק הפוסט, בלי כותרת

#צילום #photography #ניוזלטר #newsletter #ישראל #naturephotography #amitphotos #photographytips"""}]}],
    )
    caption_he = he_msg.content[0].text.strip()
    print("✅ כיתוב עברית נוצר")

    # ===== אנגלית =====
    en_msg = client.messages.create(
        model="claude-opus-4-8",
        max_tokens=600,
        system="You are Amit Erez, an Israeli photographer. Write in first person, natural English, not salesy.",
        messages=[{"role": "user", "content": image_block + [{"type": "text", "text": f"""Write an Instagram post in first person promoting the new newsletter issue.

Newsletter content:
{NEWSLETTER_SUMMARY}

Link: {NEWSLETTER_URL}

Guidelines:
- Start from this specific photo (daisies in a dewy morning, England)
- Naturally mention the new issue — dynamic range tutorial and Eilat location tip
- Don't start with a question
- 3-5 sentences
- End with: Monthly newsletter ← {NEWSLETTER_URL}
- English only, just the post, no title

#photography #newsletter #naturephotography #israel #amitphotos #photographytutorial #dynamicrange"""}]}],
    )
    caption_en = en_msg.content[0].text.strip()
    print("✅ כיתוב אנגלית נוצר")

    # ===== Threads — עברית קצר =====
    th_msg = client.messages.create(
        model="claude-opus-4-8",
        max_tokens=250,
        system="אתה עמית ארז. Threads — שיחה קצרה וישירה, לא פרסומת. משפט-שניים.",
        messages=[{"role": "user", "content": image_block + [{"type": "text", "text": f"""פוסט Threads קצר על גיליון 2 של הניוזלטר: דייזיז + מדריך טווח דינמי + המצפה התת-ימי אילת.
סיים עם: ← {NEWSLETTER_URL}
רק הפוסט."""}]}],
    )
    caption_threads = th_msg.content[0].text.strip()
    print("✅ כיתוב Threads נוצר")

    return caption_he, caption_en, caption_threads


def post_instagram(image_url, caption):
    print("\n📸 מפרסם לאינסטגרם...")
    container = requests.post(f"{GRAPH_API}/{IG_USER_ID}/media", data={
        "image_url": image_url, "caption": caption, "access_token": IG_TOKEN,
    }, timeout=30)
    if not container.ok:
        print(f"❌ IG container: {container.status_code} — {container.text}")
        return False
    creation_id = container.json().get("id")
    for _ in range(10):
        time.sleep(5)
        st = requests.get(f"{GRAPH_API}/{creation_id}",
            params={"fields": "status_code", "access_token": IG_TOKEN}, timeout=30).json()
        status = st.get("status_code", "")
        print(f"  ⏳ {status}")
        if status == "FINISHED":
            break
        if status == "ERROR":
            print(f"❌ IG error: {st}")
            return False
    pub = requests.post(f"{GRAPH_API}/{IG_USER_ID}/media_publish", data={
        "creation_id": creation_id, "access_token": IG_TOKEN,
    }, timeout=30)
    pub.raise_for_status()
    print(f"✅ אינסטגרם פורסם: {pub.json().get('id')}")
    return True


def post_facebook(image_url, caption):
    print("\n📘 מפרסם לפייסבוק...")
    resp = requests.post(f"{GRAPH_API}/{FB_PAGE_ID}/photos", data={
        "url": image_url, "message": caption, "access_token": FB_TOKEN,
    }, timeout=30)
    if not resp.ok:
        print(f"❌ FB: {resp.status_code} — {resp.text}")
        return False
    print(f"✅ פייסבוק פורסם: {resp.json().get('id')}")
    return True


def post_threads(image_url, caption):
    print("\n🧵 מפרסם ל-Threads...")
    container = requests.post(f"{THREADS_API}/{THREADS_USER_ID}/threads",
        params={"access_token": THREADS_TOKEN},
        json={"media_type": "IMAGE", "image_url": image_url, "text": caption},
        timeout=30)
    if not container.ok:
        print(f"❌ Threads container: {container.status_code} — {container.text}")
        return False
    container_id = container.json().get("id")
    for _ in range(10):
        time.sleep(5)
        st = requests.get(f"{THREADS_API}/{container_id}",
            params={"fields": "status,error_message", "access_token": THREADS_TOKEN},
            timeout=30).json()
        status = st.get("status", "")
        print(f"  ⏳ {status}")
        if status == "FINISHED":
            break
        if status == "ERROR":
            print(f"❌ Threads error: {st.get('error_message')}")
            return False
    pub = requests.post(f"{THREADS_API}/{THREADS_USER_ID}/threads_publish",
        params={"access_token": THREADS_TOKEN},
        json={"creation_id": container_id},
        timeout=30)
    pub.raise_for_status()
    print(f"✅ Threads פורסם: {pub.json().get('id')}")
    return True


def main():
    if not ANTHROPIC_API_KEY:
        print("❌ חסר ANTHROPIC_API_KEY")
        sys.exit(1)

    print(f"📰 ניוזלטר: {NEWSLETTER_URL}")
    print(f"🖼️  תמונה: {HERO_IMAGE_URL}")

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    print("\n⬇️  מוריד תמונה לניתוח...")
    image_b64 = fetch_image_b64(HERO_IMAGE_URL)

    print("\n✍️  כותב כיתובים עם Claude Opus...")
    caption_he, caption_en, caption_threads = generate_captions(client, image_b64)

    print("\n" + "="*50)
    print("HEBREW CAPTION:\n", caption_he)
    print("="*50)
    print("ENGLISH CAPTION:\n", caption_en)
    print("="*50)
    print("THREADS CAPTION:\n", caption_threads)
    print("="*50 + "\n")

    results = {}

    if IG_USER_ID and IG_TOKEN:
        results["instagram"] = post_instagram(HERO_IMAGE_URL, caption_he)
    else:
        print("⏭️  אינסטגרם — secrets חסרים, מדלג")

    if FB_PAGE_ID and FB_TOKEN:
        results["facebook"] = post_facebook(HERO_IMAGE_URL, caption_he)
    else:
        print("⏭️  פייסבוק — secrets חסרים, מדלג")

    if THREADS_USER_ID and THREADS_TOKEN:
        results["threads"] = post_threads(HERO_IMAGE_URL, caption_threads)
    else:
        print("⏭️  Threads — secrets חסרים, מדלג")

    print("\n📊 סיכום:")
    for platform, ok in results.items():
        print(f"  {'✅' if ok else '❌'} {platform}")

    if any(not ok for ok in results.values()):
        sys.exit(1)


if __name__ == "__main__":
    main()
