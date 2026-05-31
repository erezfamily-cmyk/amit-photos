#!/usr/bin/env python3
"""
Scan Quiz Photos — one-time script
Fetches photos from eligible categories, uses Claude Vision to identify
recognizable landmarks, sets quiz_eligible + quiz_description.
"""

import os
import sys
import base64
import requests
import anthropic
import json

SITE_URL = "https://amitphotos.com"
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()

ELIGIBLE_CATEGORIES = {
    "ישראל", "איטליה", "אנגליה", "יוון", "וינה", "הולנד", "גרמניה",
    "טנזניה", "מונטנגרו", "סלובקיה", "סן דיאגו", "ספרד ואנדורה", "צכיה", "אבו דאבי",
}

CATEGORY_COUNTRY = {
    "ישראל": "Israel", "איטליה": "Italy", "אנגליה": "England / UK",
    "יוון": "Greece", "וינה": "Austria (Vienna)", "הולנד": "Netherlands",
    "גרמניה": "Germany", "טנזניה": "Tanzania", "מונטנגרו": "Montenegro",
    "סלובקיה": "Slovakia", "סן דיאגו": "USA (San Diego)", "ספרד ואנדורה": "Spain / Andorra",
    "צכיה": "Czech Republic", "אבו דאבי": "UAE (Abu Dhabi / Dubai)",
}

CATEGORY_KEYWORD = {
    "ישראל": "ישראל", "איטליה": "איטליה", "אנגליה": "אנגליה",
    "יוון": "יוון", "וינה": "אוסטריה", "הולנד": "הולנד",
    "גרמניה": "גרמניה", "טנזניה": "טנזניה", "מונטנגרו": "מונטנגרו",
    "סלובקיה": "סלובקיה", "סן דיאגו": "ארה", "ספרד ואנדורה": "ספרד",
    "צכיה": "צ", "אבו דאבי": "אמירויות",
}

def build_prompt(category):
    country = CATEGORY_COUNTRY.get(category, category)
    return f"""This photo was taken in {country}.
Does it show a recognizable landmark, building, or specific location that people would clearly identify?
Examples of YES: Eiffel Tower, Colosseum, Big Ben, Western Wall, Santorini buildings, Florence Cathedral.
Examples of NO: flowers, nature without landmarks, abstract, portrait of people, generic street with no recognizable feature.

If YES, return only valid JSON (description must mention the correct country: {country}):
{{"eligible": true, "description": "Name — brief factual description, City, Country (in Hebrew)"}}
Example: {{"eligible": true, "description": "הקולוסיאום — אמפיתיאטרון רומי מהמאה הראשונה לספירה. רומא, איטליה."}}

If NO, return only:
{{"eligible": false}}

Return ONLY the JSON, nothing else."""


def load_photos():
    resp = requests.get(f"{SITE_URL}/api/photos", timeout=15)
    resp.raise_for_status()
    photos = resp.json()
    eligible = [p for p in photos if p.get("category") in ELIGIBLE_CATEGORIES]
    print(f"📸 {len(eligible)} תמונות בקטגוריות כשירות")
    return eligible


def fetch_image_b64(url, max_bytes=3_750_000):
    if url.startswith("/"):
        url = f"{SITE_URL}{url}"
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    img_bytes = resp.content
    try:
        from PIL import Image
        import io
        img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        if max(img.size) > 1200:
            img.thumbnail((1200, 1200), Image.LANCZOS)
        quality = 80
        while quality >= 40:
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=quality)
            img_bytes = buf.getvalue()
            if len(img_bytes) <= max_bytes:
                break
            quality -= 15
    except ImportError:
        pass
    return base64.standard_b64encode(img_bytes).decode("utf-8")


def analyze_photo(client, photo):
    url = photo.get("thumbnail") or photo.get("url")
    try:
        b64 = fetch_image_b64(url)
    except Exception as e:
        print(f"  ⚠️  הורדה נכשלה ({e})")
        return None

    prompt = build_prompt(photo.get("category", ""))
    try:
        msg = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=200,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": b64}},
                    {"type": "text", "text": prompt},
                ]
            }]
        )
        text = msg.content[0].text.strip()
        start = text.find('{')
        end   = text.rfind('}') + 1
        result = json.loads(text[start:end])
        return result
    except Exception as e:
        print(f"  ⚠️  Claude נכשל ({e})")
        return None


def patch_photo(photo_id, quiz_eligible, quiz_description=""):
    if not ADMIN_TOKEN:
        print("  ⚠️  ADMIN_TOKEN חסר — מדלג על PATCH")
        return
    resp = requests.patch(
        f"{SITE_URL}/api/photos",
        json={"id": photo_id, "quiz_eligible": quiz_eligible, "quiz_description": quiz_description},
        headers={"X-Admin-Password": ADMIN_TOKEN},
        timeout=15,
    )
    if not resp.ok:
        print(f"  ❌ PATCH נכשל: {resp.status_code} {resp.text}")
    else:
        print(f"  ✅ עודכן: eligible={quiz_eligible}")


def is_description_wrong(photo):
    """Returns True if quiz_description mentions the wrong country."""
    desc = photo.get("quiz_description", "")
    category = photo.get("category", "")
    keyword = CATEGORY_KEYWORD.get(category)
    if not keyword or not desc:
        return False
    return keyword not in desc

def load_quiz_photos():
    """Fetch only photos already marked quiz_eligible=1."""
    resp = requests.get(f"{SITE_URL}/api/quiz-photos", timeout=15)
    resp.raise_for_status()
    return resp.json()

def main():
    if not ANTHROPIC_API_KEY:
        print("❌ חסר ANTHROPIC_API_KEY")
        sys.exit(1)

    rescan_only = "--rescan-wrong" in sys.argv

    if rescan_only:
        all_quiz = load_quiz_photos()
        photos = [p for p in all_quiz if is_description_wrong(p)]
        print(f"🔍 נמצאו {len(photos)} תמונות עם תיאור שגוי מתוך {len(all_quiz)}")
    else:
        photos = load_photos()

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    fixed = 0
    for i, photo in enumerate(photos, 1):
        title = photo.get("title", "ללא כותרת")
        cat   = photo.get("category", "")
        print(f"\n[{i}/{len(photos)}] {title} ({cat})")
        if rescan_only:
            print(f"  ישן: {photo.get('quiz_description', '')}")

        result = analyze_photo(client, photo)
        if result is None:
            continue

        if result.get("eligible"):
            desc = result.get("description", "")
            print(f"  🌍 חדש: {desc}")
            patch_photo(photo["id"], True, desc)
            fixed += 1
        else:
            print("  — לא מזוהה, מנקה תיאור")
            patch_photo(photo["id"], False, "")

    print(f"\n✅ סריקה הסתיימה — {fixed} תמונות עודכנו")


if __name__ == "__main__":
    main()
