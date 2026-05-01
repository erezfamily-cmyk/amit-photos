#!/usr/bin/env python3
"""
Learn Photo Analysis — Social Post
מייצר ניתוח צילום חדש ומפרסם לפייסבוק + אינסטגרם
"""

import os
import sys
import re
import json
import time
import requests

SITE_URL  = "https://amitphotos.com"
GRAPH_API = "https://graph.facebook.com/v21.0"

IG_USER_ID = os.environ.get("INSTAGRAM_USER_ID", "")
IG_TOKEN   = os.environ.get("INSTAGRAM_PAGE_TOKEN", "")
FB_PAGE_ID = os.environ.get("FACEBOOK_PAGE_ID", "")
FB_TOKEN   = os.environ.get("FACEBOOK_PAGE_TOKEN", "")
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "")

RULE_LABELS = {
    'rule_of_thirds': 'חוק השליש',
    'symmetry': 'סימטריה',
    'leading_lines': 'קווי הובלה',
    'golden_ratio': 'יחס הזהב',
    'framing': 'ממסגר',
    'negative_space': 'מרחב שלילי',
}

def strip_html(html):
    """Strip HTML tags, return plain text"""
    return re.sub(r'<[^>]+>', '', html or '').strip()

def first_sentence(text):
    """Return first sentence (up to first period or 150 chars)"""
    text = text.strip()
    match = re.search(r'[.!?]', text)
    if match and match.start() < 150:
        return text[:match.start() + 1]
    return text[:150]

def generate_analysis():
    if not ADMIN_TOKEN:
        print("❌ חסר ADMIN_TOKEN")
        sys.exit(1)
    resp = requests.post(
        f"{SITE_URL}/api/analyses/generate",
        headers={"X-Admin-Password": ADMIN_TOKEN},
        timeout=120
    )
    if not resp.ok:
        print(f"❌ Generate נכשל: {resp.status_code} {resp.text}")
        sys.exit(1)
    data = resp.json()
    if data.get("error"):
        print(f"❌ שגיאה מהשרת: {data['error']}")
        sys.exit(1)
    return data

def post_to_facebook(image_url, message):
    if not FB_PAGE_ID or not FB_TOKEN:
        print("⚠️  חסרים פרטי פייסבוק — מדלג")
        return
    resp = requests.post(f"{GRAPH_API}/{FB_PAGE_ID}/photos", data={
        "url": image_url, "message": message, "access_token": FB_TOKEN,
    }, timeout=30)
    if resp.ok:
        print(f"✅ פורסם לפייסבוק! ID: {resp.json().get('id')}")
    else:
        print(f"❌ FB post נכשל: {resp.text}")

def post_to_instagram(image_url, caption):
    if not IG_USER_ID or not IG_TOKEN:
        print("⚠️  חסרים פרטי אינסטגרם — מדלג")
        return
    container = requests.post(f"{GRAPH_API}/{IG_USER_ID}/media", data={
        "image_url": image_url, "caption": caption, "access_token": IG_TOKEN,
    }, timeout=30)
    if not container.ok:
        print(f"❌ IG container נכשל: {container.text}")
        return
    cid = container.json().get("id")
    for _ in range(10):
        time.sleep(5)
        s = requests.get(f"{GRAPH_API}/{cid}", params={"fields": "status_code", "access_token": IG_TOKEN}, timeout=30).json().get("status_code", "")
        if s == "FINISHED":
            break
        if s == "ERROR":
            print("❌ Container שגיאה")
            return
    publish = requests.post(f"{GRAPH_API}/{IG_USER_ID}/media_publish", data={"creation_id": cid, "access_token": IG_TOKEN}, timeout=30)
    if publish.ok:
        print(f"✅ פורסם לאינסטגרם! ID: {publish.json().get('id')}")
    else:
        print(f"❌ IG publish נכשל: {publish.text}")

def main():
    print("🔬 מייצר ניתוח צילום חדש...")
    data = generate_analysis()

    photo_id = data.get("photo_id", "")
    title = data.get("title", "")
    composition_rule = data.get("composition_rule", "")
    composition_html = data.get("composition_html", "")
    tags_raw = data.get("tags_json", "[]")
    image_url = data.get("thumbnail") or data.get("url", "")
    if image_url and image_url.startswith("/"):
        image_url = f"https://www.amitphotos.com{image_url}"

    print(f"📸 ניתוח חדש: {title} ({photo_id})")

    # Parse tags
    try:
        tags = json.loads(tags_raw) if isinstance(tags_raw, str) else tags_raw
    except Exception:
        tags = []
    tag_hashtags = " ".join(f"#{t.replace(' ', '')}" for t in tags[:4])

    rule_label = RULE_LABELS.get(composition_rule, composition_rule)
    comp_text = first_sentence(strip_html(composition_html))
    learn_url = f"{SITE_URL}/learn/{photo_id}"

    fb_message = f"📸 {title}\n\n{comp_text}\n\n👉 ניתוח מלא: {learn_url}\n\n#צילום {tag_hashtags}"
    ig_caption = f"📸 {title}\n\n{comp_text} — {rule_label}\n\n#צילום {tag_hashtags} #amitphotos #photography"

    print(f"\n--- פוסט פייסבוק ---\n{fb_message}\n")
    print(f"--- פוסט אינסטגרם ---\n{ig_caption}\n")

    if not image_url:
        print("❌ אין URL לתמונה — לא ניתן לפרסם")
        sys.exit(1)

    print("📤 מפרסם לסושיאל...")
    post_to_facebook(image_url, fb_message)
    post_to_instagram(image_url, ig_caption)

if __name__ == "__main__":
    main()
