#!/usr/bin/env python3
"""
instagram_fix_captions.py
סורק את כל הפוסטים באינסטגרם, מזהה כיתובים עם אותיות ערביות,
ומחדש אותם עם Claude Sonnet.

שימוש:
  python src/instagram_fix_captions.py           # preview בלבד (לא מעדכן)
  python src/instagram_fix_captions.py --fix     # מעדכן בפועל
  python src/instagram_fix_captions.py --fix --post-id 123456  # פוסט ספציפי
"""

import os
import sys
import re
import time
import argparse
import base64
import requests
import anthropic

GRAPH_API     = "https://graph.facebook.com/v21.0"
IG_USER_ID    = os.environ.get("INSTAGRAM_USER_ID", "")
ACCESS_TOKEN  = os.environ.get("INSTAGRAM_PAGE_TOKEN", "")
ANTHROPIC_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()

# טווח Unicode של ערבית
ARABIC_RE = re.compile(r'[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]')


def has_arabic(text):
    return bool(ARABIC_RE.search(text or ""))


def fetch_all_posts():
    """שולף את כל הפוסטים — עד 100 האחרונים."""
    posts = []
    url = f"{GRAPH_API}/{IG_USER_ID}/media"
    params = {
        "fields": "id,caption,media_url,timestamp",
        "limit": 100,
        "access_token": ACCESS_TOKEN,
    }
    while url:
        resp = requests.get(url, params=params, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        posts.extend(data.get("data", []))
        # pagination
        url = data.get("paging", {}).get("next")
        params = {}  # next URL כולל הכל
    return posts


def generate_caption_from_image(image_url):
    """יוצר כיתוב חדש מהתמונה ישירות (ללא מטה-דאטה מקומי)."""
    client = anthropic.Anthropic(api_key=ANTHROPIC_KEY)

    image_content = []
    try:
        resp = requests.get(image_url, timeout=30)
        resp.raise_for_status()
        mime = resp.headers.get("Content-Type", "image/jpeg").split(";")[0].strip()
        b64 = base64.standard_b64encode(resp.content).decode()
        image_content = [{
            "type": "image",
            "source": {"type": "base64", "media_type": mime, "data": b64},
        }]
        print("   🖼️  תמונה הורדה לניתוח")
    except Exception as e:
        print(f"   ⚠️  לא הצלחתי להוריד תמונה: {e}")

    system_prompt = """You are a social media manager for an Israeli photographer named Amit.
Write Instagram captions in Hebrew — visual, emotional, inspiring.
Style: short, intimate, artistic. Feels like a real moment.
CRITICAL: Use ONLY Hebrew characters for the Hebrew text. Never mix Arabic script with Hebrew.
Hashtags at the end should be in English (and optionally some Hebrew hashtags).
Do not include URLs in the text body — only "🔗 amitphotos.com (link in bio)" at the end of the main text."""

    user_content = image_content + [{
        "type": "text",
        "text": """Write an Instagram caption for this photo.

Caption structure (exactly in this order):
1. 2-4 lines in Hebrew — emotional/artistic description of the moment (Hebrew letters only, no Arabic)
2. Empty line
3. 🔗 amitphotos.com (link in bio)
4. Empty line
5. Hashtags: mix of English and Hebrew — photography, nature, Israel etc. — 10-15 total

Output only the caption, no extra explanations."""
    }]

    msg = client.messages.create(
        model="claude-opus-4-8",
        max_tokens=600,
        system=system_prompt,
        messages=[{"role": "user", "content": user_content}],
    )
    return msg.content[0].text.strip()


def update_caption(post_id, new_caption):
    """מעדכן כיתוב פוסט קיים."""
    url = f"{GRAPH_API}/{post_id}"
    resp = requests.post(url, data={
        "caption": new_caption,
        "access_token": ACCESS_TOKEN,
    }, timeout=30)
    resp.raise_for_status()
    return resp.json()


def main():
    parser = argparse.ArgumentParser(description="Fix Instagram captions with Arabic chars")
    parser.add_argument("--fix",     action="store_true", help="עדכן בפועל (ברירת מחדל: preview בלבד)")
    parser.add_argument("--post-id", help="תקן פוסט ספציפי לפי ID")
    args = parser.parse_args()

    if not IG_USER_ID or not ACCESS_TOKEN:
        print("❌ חסרים: INSTAGRAM_USER_ID או INSTAGRAM_PAGE_TOKEN")
        sys.exit(1)
    if not ANTHROPIC_KEY:
        print("❌ חסר: ANTHROPIC_API_KEY")
        sys.exit(1)

    print("📥 שולף פוסטים מאינסטגרם...")
    posts = fetch_all_posts()
    print(f"   נמצאו {len(posts)} פוסטים\n")

    # סינון לפי post-id אם צוין
    if args.post_id:
        posts = [p for p in posts if p["id"] == args.post_id]
        if not posts:
            print(f"❌ לא נמצא פוסט עם ID: {args.post_id}")
            sys.exit(1)

    # זיהוי פוסטים עם ערבית
    bad_posts = [p for p in posts if has_arabic(p.get("caption", ""))]

    if not bad_posts:
        print("✅ לא נמצאו פוסטים עם אותיות ערביות.")
        return

    print(f"⚠️  נמצאו {len(bad_posts)} פוסטים עם אותיות ערביות:\n")
    for p in bad_posts:
        snippet = (p.get("caption") or "")[:80].replace("\n", " ")
        print(f"  • {p['id']} ({p.get('timestamp','')[:10]}): {snippet}...")

    if not args.fix:
        print(f"\n💡 הרץ עם --fix כדי לתקן את {len(bad_posts)} הפוסטים.")
        return

    print(f"\n🔧 מתקן {len(bad_posts)} פוסטים...\n")
    for i, post in enumerate(bad_posts, 1):
        print(f"[{i}/{len(bad_posts)}] פוסט {post['id']}")
        media_url = post.get("media_url")
        if not media_url:
            print("   ⚠️  אין media_url — מדלג")
            continue

        try:
            new_caption = generate_caption_from_image(media_url)
            print(f"   כיתוב חדש:\n{new_caption[:120]}...\n")
            update_caption(post["id"], new_caption)
            print("   ✅ עודכן")
        except Exception as e:
            print(f"   ❌ שגיאה: {e}")

        if i < len(bad_posts):
            time.sleep(3)  # הגבלת קצב Instagram API

    print("\n✅ סיום.")


if __name__ == "__main__":
    main()
