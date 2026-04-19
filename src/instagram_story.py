#!/usr/bin/env python3
"""
Instagram Story Auto-Post Agent
מפרסם Story לאינסטגרם — תמונה אחרונה שפורסמה, או תמונה רנדומלית.

שימוש:
  python src/instagram_story.py            # תמונה רנדומלית מהגלריה
  python src/instagram_story.py --latest   # ה-post האחרון שפורסם
"""

import os
import sys
import json
import random
import requests
from pathlib import Path

GRAPH_API    = "https://graph.facebook.com/v21.0"
SITE_URL     = "https://amitphotos.com"
POSTED_FILE  = Path(__file__).parent.parent / "data" / "instagram_posted.json"

IG_USER_ID   = os.environ.get("INSTAGRAM_USER_ID", "")
ACCESS_TOKEN = os.environ.get("INSTAGRAM_PAGE_TOKEN", "")

USE_LATEST = "--latest" in sys.argv


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
        print(f"⚠️  D1 API נכשל ({e})")

    json_file = Path(__file__).parent.parent / "data" / "photos.json"
    if json_file.exists():
        photos = json.loads(json_file.read_text(encoding="utf-8"))
        return [p for p in photos if p.get("title")]

    return []


def get_latest_posted_photo(photos):
    """מחזיר את התמונה שפורסמה אחרונה."""
    if not POSTED_FILE.exists():
        return None
    posted_data = json.loads(POSTED_FILE.read_text(encoding="utf-8"))
    posted_ids  = posted_data.get("posted_ids", [])
    if not posted_ids:
        return None
    last_id = posted_ids[-1]
    for p in photos:
        if p["id"] == last_id:
            return p
    return None


def upload_to_public_host(source_url):
    resp = requests.get(source_url, timeout=30)
    resp.raise_for_status()
    img_bytes = resp.content

    try:
        upload = requests.post(
            "https://litterbox.catbox.moe/resources/internals/api.php",
            data={"reqtype": "fileupload", "time": "1h"},
            files={"fileToUpload": ("photo.jpg", img_bytes, "image/jpeg")},
            timeout=60,
        )
        upload.raise_for_status()
        public_url = upload.text.strip()
        if public_url.startswith("http"):
            print(f"⬆️  הועלה (litterbox): {public_url}")
            return public_url
    except Exception as e:
        print(f"⚠️  litterbox נכשל ({e}), מנסה 0x0.st...")

    upload = requests.post("https://0x0.st", files={"file": ("photo.jpg", img_bytes, "image/jpeg")}, timeout=60)
    upload.raise_for_status()
    return upload.text.strip()


def post_story(image_url):
    """מפרסם Story לאינסטגרם."""
    # שלב 1: צור container
    container_resp = requests.post(f"{GRAPH_API}/{IG_USER_ID}/media", data={
        "image_url":    image_url,
        "media_type":   "STORIES",
        "access_token": ACCESS_TOKEN,
    }, timeout=30)

    if not container_resp.ok:
        print(f"❌ שגיאת container: {container_resp.status_code} — {container_resp.text}")
        sys.exit(1)

    container_data = container_resp.json()
    if "id" not in container_data:
        print(f"❌ שגיאה: {container_data}")
        sys.exit(1)

    creation_id = container_data["id"]
    print(f"📦 Container נוצר: {creation_id}")

    # המתן
    import time
    for attempt in range(10):
        time.sleep(4)
        status = requests.get(
            f"{GRAPH_API}/{creation_id}",
            params={"fields": "status_code", "access_token": ACCESS_TOKEN}, timeout=30,
        ).json().get("status_code", "")
        print(f"⏳ סטטוס: {status}")
        if status == "FINISHED":
            break
        if status == "ERROR":
            print("❌ שגיאת עיבוד")
            sys.exit(1)

    # שלב 2: פרסם
    publish_resp = requests.post(f"{GRAPH_API}/{IG_USER_ID}/media_publish", data={
        "creation_id":  creation_id,
        "access_token": ACCESS_TOKEN,
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

    photos = load_photos()
    if not photos:
        print("❌ לא נמצאו תמונות")
        sys.exit(1)

    if USE_LATEST:
        photo = get_latest_posted_photo(photos)
        if not photo:
            print("⚠️  לא נמצא post אחרון — בוחר רנדומלית")
            photo = random.choice(photos)
        else:
            print(f"📸 Story מה-post האחרון: {photo['title']}")
    else:
        photo = random.choice(photos)
        print(f"📸 תמונה רנדומלית: {photo['title']}")

    source_url = photo.get("thumbnail") or photo.get("url", "")
    if source_url.startswith("/"):
        source_url = f"{SITE_URL}{source_url}"

    print(f"⬆️  מעלה תמונה לשרת ציבורי...")
    image_url = upload_to_public_host(source_url)
    print(f"📤 מפרסם Story מ-URL: {image_url}")
    story_id = post_story(image_url)
    print(f"✅ Story פורסם! ID: {story_id}")


if __name__ == "__main__":
    main()
