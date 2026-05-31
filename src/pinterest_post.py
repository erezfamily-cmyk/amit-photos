#!/usr/bin/env python3
"""
Pinterest Auto-Post Agent
מפרסם 3 תמונות ביום ל-Pinterest עם תיאורים שנוצרים ע"י Claude Vision.
"""

import json
import os
import sys
import time
import random
import requests
import anthropic
from pathlib import Path

ROOT        = Path(__file__).parent.parent
POSTED_FILE = ROOT / "data" / "pinterest_posted.json"
SITE_URL    = "https://amitphotos.com"
PINTEREST_API = "https://api.pinterest.com/v5"
PINS_PER_DAY  = 3
DRY_RUN       = "--dry-run" in sys.argv


def load_photos():
    """טוען תמונות מ-D1 API, עם fallback ל-JSON."""
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

    json_file = ROOT / "data" / "photos.json"
    if json_file.exists():
        photos = json.loads(json_file.read_text(encoding="utf-8"))
        valid = [p for p in photos if p.get("title") and not p["title"].upper().startswith("DSC_")]
        print(f"📁 נטענו {len(valid)} תמונות מ-JSON (fallback)")
        return valid

    print("❌ לא נמצא מקור תמונות")
    sys.exit(1)


def load_posted():
    if POSTED_FILE.exists():
        try:
            return set(json.loads(POSTED_FILE.read_text(encoding="utf-8")))
        except Exception:
            pass
    return set()


def save_posted(posted_ids):
    POSTED_FILE.write_text(json.dumps(sorted(posted_ids), ensure_ascii=False, indent=2), encoding="utf-8")


def pinterest_get(token, endpoint, params=None):
    res = requests.get(
        f"{PINTEREST_API}/{endpoint}",
        headers={"Authorization": f"Bearer {token}"},
        params=params, timeout=15,
    )
    res.raise_for_status()
    return res.json()


def pinterest_post_req(token, endpoint, body):
    res = requests.post(
        f"{PINTEREST_API}/{endpoint}",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json=body, timeout=15,
    )
    if not res.ok:
        print(f"   ⚠️  Pinterest {res.status_code}: {res.text}")
    res.raise_for_status()
    return res.json()


def get_or_create_board(token, category_name):
    data   = pinterest_get(token, "boards", {"page_size": 250})
    boards = data.get("items", [])
    for board in boards:
        if board["name"] == category_name:
            print(f"   📋 לוח קיים: {category_name} ({board['id']})")
            return board["id"]

    if DRY_RUN:
        print(f"   [dry-run] היה יוצר לוח: {category_name}")
        return f"dry-run-board-{category_name}"

    board = pinterest_post_req(token, "boards", {
        "name": category_name,
        "description": f"צילומי {category_name} מאת עמית ארז | {SITE_URL}",
        "privacy": "PUBLIC",
    })
    print(f"   ✅ לוח חדש נוצר: {category_name} ({board['id']})")
    time.sleep(1)
    return board["id"]


def generate_pin_description(photo, anthropic_key):
    """יוצר תיאור pin עם Claude Vision."""
    client = anthropic.Anthropic(api_key=anthropic_key)

    title       = photo.get("title", "")
    category    = photo.get("category", "")
    description = photo.get("description", "")

    thumbnail_url = photo.get("thumbnail") or photo.get("url", "")
    if thumbnail_url.startswith("/"):
        thumbnail_url = f"{SITE_URL}{thumbnail_url}"

    meta = f"Photo: {title}" + (f" | Category: {category}" if category else "") + (f" | {description}" if description else "")

    user_content = [{"type": "text", "text": f"""Write a Pinterest pin description for this photo, written in first person as Amit, the photographer who took it.

{meta}

Requirements:
- 2-3 sentences in English, first person ("I photographed", "I chose", "I waited for")
- Mention what technique or decision was used and why
- Mention Israel/Israeli scenery if relevant
- End with: "Available for purchase at amitphotos.com"
- Include 5-8 relevant keywords naturally (not as hashtags)
- No questions at the end

Output only the description text."""}]

    msg = client.messages.create(
        model="claude-opus-4-8",
        max_tokens=300,
        messages=[{"role": "user", "content": user_content}],
    )
    return msg.content[0].text.strip()


def publish_pin(token, board_id, photo, anthropic_key):
    title         = photo.get("title", "")
    category      = photo.get("category", "")
    image_url     = photo.get("thumbnail") or photo.get("url", "")
    if image_url.startswith("/"):
        image_url = f"{SITE_URL}{image_url}"

    # צור תיאור עם Claude
    try:
        description = generate_pin_description(photo, anthropic_key)
        print(f"   ✍️  תיאור: {description[:80]}...")
    except Exception as e:
        print(f"   ⚠️  Claude נכשל ({e}) — תיאור בסיסי")
        description = f"{title} | {category} | צילום: עמית ארז | {SITE_URL}"

    body = {
        "board_id":    board_id,
        "title":       f"{title} — {category}" if title else category,
        "description": description,
        "media_source": {"source_type": "image_url", "url": image_url},
    }

    if DRY_RUN:
        print(f"   [dry-run] היה מפרסם: {title} → לוח {board_id}")
        return {"id": f"dry-run-{photo['id']}"}

    return pinterest_post_req(token, "pins", body)


def main():
    sys.stdout.reconfigure(encoding="utf-8")

    token = os.environ.get("PINTEREST_ACCESS_TOKEN", "").strip()
    if not token:
        print("❌ חסר PINTEREST_ACCESS_TOKEN")
        sys.exit(1)

    anthropic_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not anthropic_key:
        print("⚠️  אין ANTHROPIC_API_KEY — תיאורים יהיו בסיסיים")

    photos = load_photos()
    posted = load_posted()

    print(f"📋 סה\"כ תמונות: {len(photos)}, כבר פורסמו: {len(posted)}")

    by_category = {}
    for p in photos:
        if p["id"] in posted:
            continue
        cat = p.get("category", "כללי")
        by_category.setdefault(cat, []).append(p)

    if not by_category:
        print("✅ כל התמונות כבר פורסמו! מתחיל מחדש...")
        posted = set()
        for p in photos:
            cat = p.get("category", "כללי")
            by_category.setdefault(cat, []).append(p)

    categories = list(by_category.keys())
    random.shuffle(categories)
    selected = categories[:PINS_PER_DAY]

    board_cache = {}
    published   = 0

    for cat in selected:
        photos_in_cat = by_category.get(cat, [])
        if not photos_in_cat:
            continue

        photo = random.choice(photos_in_cat)
        print(f"\n📌 מפרסם: {photo.get('title', photo['id'])} → {cat}")

        try:
            if cat not in board_cache:
                board_cache[cat] = get_or_create_board(token, cat)
            board_id = board_cache[cat]

            result = publish_pin(token, board_id, photo, anthropic_key)
            print(f"   ✅ פורסם! Pin ID: {result.get('id', '')}")
            posted.add(photo["id"])
            published += 1
            time.sleep(3)
        except Exception as e:
            print(f"   ❌ שגיאה: {e}")

    print(f"\n{'=' * 40}")
    print(f"✅ פורסמו {published} תמונות היום")

    if not DRY_RUN:
        save_posted(posted)
        print(f"💾 נשמר ל-{POSTED_FILE}")


if __name__ == "__main__":
    main()
