#!/usr/bin/env python3
"""
facebook_fix_captions.py
סורק את כל הפוסטים בעמוד הפייסבוק, מזהה כיתובים עם אותיות ערביות,
ומחדש אותם עם Claude Sonnet.

שימוש:
  python src/facebook_fix_captions.py              # preview בלבד (לא מעדכן)
  python src/facebook_fix_captions.py --fix        # מעדכן בפועל
  python src/facebook_fix_captions.py --fix --post-id 123456_789  # פוסט ספציפי
"""

import os
import sys
import re
import time
import argparse
import base64
import requests
import anthropic

GRAPH_API    = "https://graph.facebook.com/v21.0"
PAGE_ID      = os.environ.get("FACEBOOK_PAGE_ID", "")
ACCESS_TOKEN = os.environ.get("FACEBOOK_PAGE_TOKEN", "")
ANTHROPIC_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()
SITE_URL     = "https://amitphotos.com"

# טווח Unicode של ערבית
ARABIC_RE = re.compile(r'[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]')


def has_arabic(text):
    return bool(ARABIC_RE.search(text or ""))


def fetch_all_posts():
    """שולף את כל פוסטי הדף — עד 100 האחרונים."""
    posts = []
    url = f"{GRAPH_API}/{PAGE_ID}/feed"
    params = {
        "fields": "id,message,full_picture,created_time",
        "limit": 100,
        "access_token": ACCESS_TOKEN,
    }
    while url:
        resp = requests.get(url, params=params, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        posts.extend(data.get("data", []))
        url = data.get("paging", {}).get("next")
        params = {}
    return posts


def generate_caption_from_image(image_url):
    """יוצר כיתוב חדש מהתמונה ישירות."""
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
Write Facebook posts in Hebrew — short, emotional, engaging.
Style: intimate, artistic, inspiring. Not too promotional.
CRITICAL: Use ONLY Hebrew characters for the Hebrew text. Never mix Arabic script with Hebrew.
The post should feel like a short story about the moment in the photo.
You may use 1-3 relevant emojis. No hashtags unless they feel natural."""

    user_content = image_content + [{
        "type": "text",
        "text": f"""Write a Facebook post for this photo.

Instructions:
- 3-6 lines in Hebrew (Hebrew letters only, no Arabic)
- Describe the emotion / atmosphere / moment captured in the photo
- At the end put this link on a separate line: {SITE_URL}
- 1-3 emojis max
- Output only the post text, no extra explanations"""
    }]

    msg = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=500,
        system=system_prompt,
        messages=[{"role": "user", "content": user_content}],
    )
    return msg.content[0].text.strip()


def update_post(post_id, new_message):
    """מעדכן טקסט של פוסט קיים בפייסבוק."""
    url = f"{GRAPH_API}/{post_id}"
    resp = requests.post(url, data={
        "message": new_message,
        "access_token": ACCESS_TOKEN,
    }, timeout=30)
    resp.raise_for_status()
    return resp.json()


def main():
    parser = argparse.ArgumentParser(description="Fix Facebook posts with Arabic chars")
    parser.add_argument("--fix",     action="store_true", help="עדכן בפועל (ברירת מחדל: preview בלבד)")
    parser.add_argument("--post-id", help="תקן פוסט ספציפי לפי ID")
    args = parser.parse_args()

    if not PAGE_ID or not ACCESS_TOKEN:
        print("❌ חסרים: FACEBOOK_PAGE_ID או FACEBOOK_PAGE_TOKEN")
        sys.exit(1)
    if not ANTHROPIC_KEY:
        print("❌ חסר: ANTHROPIC_API_KEY")
        sys.exit(1)

    print("📥 שולף פוסטים מפייסבוק...")
    posts = fetch_all_posts()
    print(f"   נמצאו {len(posts)} פוסטים\n")

    if args.post_id:
        posts = [p for p in posts if p["id"] == args.post_id]
        if not posts:
            print(f"❌ לא נמצא פוסט עם ID: {args.post_id}")
            sys.exit(1)

    bad_posts = [p for p in posts if has_arabic(p.get("message", ""))]

    if not bad_posts:
        print("✅ לא נמצאו פוסטים עם אותיות ערביות.")
        return

    print(f"⚠️  נמצאו {len(bad_posts)} פוסטים עם אותיות ערביות:\n")
    for p in bad_posts:
        snippet = (p.get("message") or "")[:80].replace("\n", " ")
        print(f"  • {p['id']} ({p.get('created_time','')[:10]}): {snippet}...")

    if not args.fix:
        print(f"\n💡 הרץ עם --fix כדי לתקן את {len(bad_posts)} הפוסטים.")
        return

    print(f"\n🔧 מתקן {len(bad_posts)} פוסטים...\n")
    for i, post in enumerate(bad_posts, 1):
        print(f"[{i}/{len(bad_posts)}] פוסט {post['id']}")
        image_url = post.get("full_picture")
        if not image_url:
            print("   ⚠️  אין תמונה לפוסט — מדלג")
            continue

        try:
            new_message = generate_caption_from_image(image_url)
            print(f"   כיתוב חדש:\n{new_message[:120]}...\n")
            update_post(post["id"], new_message)
            print("   ✅ עודכן")
        except Exception as e:
            print(f"   ❌ שגיאה: {e}")

        if i < len(bad_posts):
            time.sleep(3)

    print("\n✅ סיום.")


if __name__ == "__main__":
    main()
