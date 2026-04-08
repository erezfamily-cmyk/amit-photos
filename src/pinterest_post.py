"""
pinterest_post.py
-----------------
Agent אוטומטי שמפרסם 3 תמונות ביום ל-Pinterest.
- יוצר לוח נפרד לכל קטגוריה (אם לא קיים)
- בוחר תמונות שלא פורסמו עדיין
- שומר מעקב ב-data/pinterest_posted.json

הרצה:
  python src/pinterest_post.py           # פרסום רגיל
  python src/pinterest_post.py --dry-run # רק מציג, לא מפרסם
"""

import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).parent.parent
DATA_FILE = ROOT / "data" / "photos.json"
POSTED_FILE = ROOT / "data" / "pinterest_posted.json"

PINTEREST_API = "https://api.pinterest.com/v5"
SITE_URL = "https://amitphotos.com"
PINS_PER_DAY = 3

DRY_RUN = "--dry-run" in sys.argv


def pinterest_get(token, endpoint, params=None):
    import requests
    res = requests.get(
        f"{PINTEREST_API}/{endpoint}",
        headers={"Authorization": f"Bearer {token}"},
        params=params,
        timeout=15,
    )
    res.raise_for_status()
    return res.json()


def pinterest_post(token, endpoint, body):
    import requests
    res = requests.post(
        f"{PINTEREST_API}/{endpoint}",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json=body,
        timeout=15,
    )
    res.raise_for_status()
    return res.json()


def get_or_create_board(token, category_name):
    """מחזיר board_id לפי שם קטגוריה — יוצר אם לא קיים."""
    # חפש לוח קיים
    data = pinterest_get(token, "boards", {"page_size": 250})
    boards = data.get("items", [])
    for board in boards:
        if board["name"] == category_name:
            print(f"   📋 לוח קיים: {category_name} ({board['id']})")
            return board["id"]

    # צור לוח חדש
    if DRY_RUN:
        print(f"   [dry-run] היה יוצר לוח: {category_name}")
        return f"dry-run-board-{category_name}"

    board = pinterest_post(token, "boards", {
        "name": category_name,
        "description": f"צילומי {category_name} מאת עמית ארז | {SITE_URL}",
        "privacy": "PUBLIC",
    })
    print(f"   ✅ לוח חדש נוצר: {category_name} ({board['id']})")
    time.sleep(1)
    return board["id"]


def publish_pin(token, board_id, photo):
    """מפרסם pin אחד ל-Pinterest."""
    title = photo.get("title", "")
    description = photo.get("description", "")
    category = photo.get("category", "")
    image_url = photo.get("thumbnail") or photo.get("url", "")

    desc_parts = []
    if description:
        desc_parts.append(description)
    desc_parts.append(f"צילום: עמית ארז | {SITE_URL}")

    body = {
        "board_id": board_id,
        "title": f"{title} — {category}" if title else category,
        "description": " | ".join(desc_parts),
        "link": SITE_URL,
        "media_source": {
            "source_type": "image_url",
            "url": image_url,
        },
    }

    if DRY_RUN:
        print(f"   [dry-run] היה מפרסם: {title} → לוח {board_id}")
        return {"id": f"dry-run-{photo['id']}"}

    return pinterest_post(token, "pins", body)


def load_posted():
    if POSTED_FILE.exists():
        try:
            return set(json.loads(POSTED_FILE.read_text(encoding="utf-8")))
        except Exception:
            pass
    return set()


def save_posted(posted_ids):
    POSTED_FILE.write_text(
        json.dumps(sorted(posted_ids), ensure_ascii=False, indent=2),
        encoding="utf-8"
    )


def main():
    sys.stdout.reconfigure(encoding="utf-8")

    token = os.environ.get("PINTEREST_ACCESS_TOKEN", "").strip()
    if not token:
        print("❌ חסר PINTEREST_ACCESS_TOKEN")
        sys.exit(1)

    # טען תמונות
    if not DATA_FILE.exists():
        print("❌ לא נמצא data/photos.json")
        sys.exit(1)
    photos = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    posted = load_posted()

    print(f"📋 סה\"כ תמונות: {len(photos)}, כבר פורסמו: {len(posted)}")

    # בנה מילון קטגוריה → רשימת תמונות שלא פורסמו
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

    # בחר קטגוריות רנדומליות (ללא repetition)
    import random
    categories = list(by_category.keys())
    random.shuffle(categories)
    selected_categories = categories[:PINS_PER_DAY]

    # מטמון לוחות
    board_cache = {}

    published = 0
    for cat in selected_categories:
        photos_in_cat = by_category[cat]
        if not photos_in_cat:
            continue

        photo = random.choice(photos_in_cat)
        print(f"\n📌 מפרסם: {photo.get('title', photo['id'])} → {cat}")

        try:
            # קבל/צור לוח
            if cat not in board_cache:
                board_cache[cat] = get_or_create_board(token, cat)
            board_id = board_cache[cat]

            # פרסם pin
            result = publish_pin(token, board_id, photo)
            pin_id = result.get("id", "")
            print(f"   ✅ פורסם! Pin ID: {pin_id}")

            posted.add(photo["id"])
            published += 1
            time.sleep(2)  # הגבלת קצב

        except Exception as e:
            print(f"   ❌ שגיאה: {e}")
            continue

    print(f"\n{'=' * 40}")
    print(f"✅ פורסמו {published} תמונות היום")

    if not DRY_RUN:
        save_posted(posted)
        print(f"💾 נשמר ל-{POSTED_FILE}")


if __name__ == "__main__":
    main()
