#!/usr/bin/env python3
"""
Location Social Post Agent
מפרסם דף מקום לצילום לכל 4 רשתות חברתיות, round-robin, כל 3 ימים.
"""

import json
import os
import sys
import time
import requests
import anthropic
from pathlib import Path

ROOT          = Path(__file__).parent.parent
POSTED_FILE   = ROOT / "data" / "location_social_posted.json"
SITE_URL      = "https://amitphotos.com"
GRAPH_API     = "https://graph.facebook.com/v21.0"
THREADS_API   = "https://graph.threads.net/v1.0"
PINTEREST_API = "https://api.pinterest.com/v5"

IG_USER_ID        = os.environ.get("INSTAGRAM_USER_ID", "")
IG_TOKEN          = os.environ.get("INSTAGRAM_PAGE_TOKEN", "")
FB_PAGE_ID        = os.environ.get("FACEBOOK_PAGE_ID", "")
FB_TOKEN          = os.environ.get("FACEBOOK_PAGE_TOKEN", "")
PINTEREST_TOKEN   = os.environ.get("PINTEREST_ACCESS_TOKEN", "")
THREADS_USER_ID   = os.environ.get("THREADS_USER_ID", "")
THREADS_TOKEN     = os.environ.get("THREADS_ACCESS_TOKEN", "")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()
ADMIN_TOKEN       = os.environ.get("ADMIN_TOKEN", "")

PINTEREST_BOARD = "Photography Locations — Israel"


# ===== Tracking =====

def load_posted():
    if POSTED_FILE.exists():
        return json.loads(POSTED_FILE.read_text(encoding="utf-8"))
    return {"last_index": -1, "posted_slugs": []}


def save_posted(data):
    POSTED_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


# ===== Locations API =====

def fetch_locations():
    resp = requests.get(f"{SITE_URL}/api/locations", timeout=15)
    resp.raise_for_status()
    locs = resp.json()
    locs.sort(key=lambda l: l["id"])  # stable round-robin order
    return locs


def fetch_location_detail(slug):
    resp = requests.get(f"{SITE_URL}/api/locations/{slug}", timeout=15)
    resp.raise_for_status()
    return resp.json()


def pick_location(locations, last_index):
    next_index = (last_index + 1) % len(locations)
    return locations[next_index], next_index


# ===== Caption generation =====

def _best_seasons_text(when_raw):
    if not when_raw:
        return ""
    try:
        wt = json.loads(when_raw) if isinstance(when_raw, str) else when_raw
        season_map = {"spring": "אביב", "summer": "קיץ", "autumn": "סתיו", "winter": "חורף"}
        good = [season_map.get(s, s) for s, v in wt.items() if v == "good"]
        return " / ".join(good) if good else ""
    except Exception:
        return ""


def generate_caption(loc_detail, platform):
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    title      = loc_detail.get("title", "")
    region     = loc_detail.get("region", "")
    desc       = (loc_detail.get("description") or "")[:300]
    best_time  = loc_detail.get("best_time", "")
    tip        = loc_detail.get("my_tip", "")
    slug       = loc_detail.get("id", "")
    page_url   = f"{SITE_URL}/locations/spot/?slug={slug}"
    seasons    = _best_seasons_text(loc_detail.get("when_to_visit"))

    context = f"""Location: {title}
Region: {region}
Description: {desc}
Best time: {best_time}
Best seasons: {seasons or 'year-round'}
Photographer's tip: {tip}
Page URL: {page_url}"""

    if platform == "instagram":
        system = (
            "You write Instagram captions for an Israeli nature photographer named Amit. "
            "Style: inspiring, grounded, mentions what makes it special for photography. "
            "Write only in Hebrew."
        )
        prompt = f"""{context}

Write an Instagram caption (3-4 sentences). Mention the region and what time of year is best.
End with 📍 {page_url} and one engaging question to the audience.
Then on a new line add these hashtags exactly:
#צילום_נוף #landscape #israel #travelphotography #photospot #amitphotos #ישראל #טבע #ig_israel

Output only the caption."""

    elif platform == "facebook":
        system = (
            "You write Facebook posts for an Israeli photographer named Amit. "
            "Style: warm, informative, personal — as if recommending the spot to friends. "
            "Write only in Hebrew."
        )
        prompt = f"""{context}

Write a Facebook post (3-4 sentences). Explain what makes this location special for photography.
Include the URL: {page_url}
End with: #צילום #ישראל #photography #nature

Output only the post."""

    elif platform == "threads":
        system = (
            "You write short Threads posts for an Israeli photographer named Amit. "
            "Style: concise, direct, confident — one sharp observation. "
            "Write only in Hebrew."
        )
        prompt = f"""{context}

Write a Threads post (2 short sentences max). One punchy observation about what makes this spot worth visiting.
End with {page_url} and a short question.
Hashtags (1 line): #צילום #ישראל

Output only the post."""

    else:  # pinterest
        system = (
            "You write Pinterest pin descriptions for travel and photography content. "
            "Style: practical, inspiring, SEO-friendly. Write in English."
        )
        prompt = f"""{context}

Write a Pinterest description (2-3 sentences). Mention Israel, mention the photographic opportunity.
End with: 'Full guide at amitphotos.com'
Do not add hashtags.

Output only the description."""

    msg = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=500,
        system=system,
        messages=[{"role": "user", "content": prompt}],
    )
    return msg.content[0].text.strip()


# ===== Image URL helpers =====

def get_cover_url(loc_summary, loc_detail):
    cover = loc_summary.get("cover_url") or loc_summary.get("cover_thumb")
    if not cover:
        photos = loc_detail.get("photos", [])
        if photos:
            cover = photos[0].get("url") or photos[0].get("thumbnail")
    if not cover:
        return None
    if cover.startswith("/"):
        cover = f"{SITE_URL}{cover}"
    return cover


def ensure_public_url(image_url):
    if image_url.startswith(f"{SITE_URL}/"):
        print(f"✅ תמונה ב-R2 — URL ישיר")
        return image_url
    resp = requests.get(image_url, timeout=30)
    resp.raise_for_status()
    img_bytes = resp.content
    for name, fn in [("r2", _try_r2), ("litterbox", _try_litterbox), ("catbox", _try_catbox)]:
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


# ===== Platform posting =====

def post_to_instagram(image_url, caption):
    if not IG_USER_ID or not IG_TOKEN:
        print("⚠️  Instagram credentials חסרים — דלג")
        return None

    container = requests.post(f"{GRAPH_API}/{IG_USER_ID}/media", data={
        "image_url": image_url, "caption": caption, "access_token": IG_TOKEN,
    }, timeout=30)
    if not container.ok:
        print(f"❌ Instagram container: {container.status_code} — {container.text}")
        return None
    creation_id = container.json().get("id")
    if not creation_id:
        print(f"❌ חסר creation_id: {container.json()}")
        return None

    for _ in range(12):
        time.sleep(5)
        status = requests.get(f"{GRAPH_API}/{creation_id}",
            params={"fields": "status_code", "access_token": IG_TOKEN},
            timeout=30).json().get("status_code", "")
        print(f"⏳ Instagram: {status}")
        if status == "FINISHED":
            break
        if status == "ERROR":
            print("❌ Instagram processing error")
            return None

    publish = requests.post(f"{GRAPH_API}/{IG_USER_ID}/media_publish", data={
        "creation_id": creation_id, "access_token": IG_TOKEN,
    }, timeout=30)
    if not publish.ok:
        print(f"❌ Instagram publish: {publish.status_code} — {publish.text}")
        return None
    return publish.json().get("id")


def post_to_facebook(image_url, caption):
    if not FB_PAGE_ID or not FB_TOKEN:
        print("⚠️  Facebook credentials חסרים — דלג")
        return None

    resp = requests.post(f"{GRAPH_API}/{FB_PAGE_ID}/photos", data={
        "url": image_url, "caption": caption, "access_token": FB_TOKEN,
    }, timeout=30)
    if not resp.ok:
        print(f"❌ Facebook: {resp.status_code} — {resp.text}")
        return None
    return resp.json().get("id")


def _get_or_create_pinterest_board(token, board_name):
    data = requests.get(f"{PINTEREST_API}/boards",
        headers={"Authorization": f"Bearer {token}"},
        params={"page_size": 250}, timeout=15).json()
    for b in data.get("items", []):
        if b["name"] == board_name:
            print(f"📋 לוח קיים: {board_name} ({b['id']})")
            return b["id"]
    b = requests.post(f"{PINTEREST_API}/boards",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"name": board_name, "description": f"Best photography spots in Israel | {SITE_URL}", "privacy": "PUBLIC"},
        timeout=15)
    b.raise_for_status()
    board_id = b.json().get("id")
    print(f"✅ לוח חדש נוצר: {board_name} ({board_id})")
    time.sleep(1)
    return board_id


def post_to_pinterest(image_url, caption, loc_detail):
    if not PINTEREST_TOKEN:
        print("⚠️  Pinterest token חסר — דלג")
        return None

    title    = loc_detail.get("title", "")
    region   = loc_detail.get("region", "")
    slug     = loc_detail.get("id", "")
    page_url = f"{SITE_URL}/locations/spot/?slug={slug}"

    try:
        board_id = _get_or_create_pinterest_board(PINTEREST_TOKEN, PINTEREST_BOARD)
    except Exception as e:
        print(f"❌ Pinterest board error: {e}")
        return None

    pin = requests.post(f"{PINTEREST_API}/pins",
        headers={"Authorization": f"Bearer {PINTEREST_TOKEN}", "Content-Type": "application/json"},
        json={
            "board_id": board_id,
            "title": f"{title} — {region}",
            "description": caption,
            "link": page_url,
            "media_source": {"source_type": "image_url", "url": image_url},
        }, timeout=20)
    if not pin.ok:
        print(f"❌ Pinterest pin: {pin.status_code} — {pin.text}")
        return None
    pin_id = pin.json().get("id")
    time.sleep(3)
    return pin_id


def post_to_threads(image_url, caption):
    if not THREADS_USER_ID or not THREADS_TOKEN:
        print("⚠️  Threads credentials חסרים — דלג")
        return None

    container = requests.post(f"{THREADS_API}/{THREADS_USER_ID}/threads",
        params={"access_token": THREADS_TOKEN},
        json={"media_type": "IMAGE", "image_url": image_url, "text": caption},
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


# ===== Main =====

def main():
    sys.stdout.reconfigure(encoding="utf-8")

    if not ANTHROPIC_API_KEY:
        print("❌ חסר ANTHROPIC_API_KEY")
        sys.exit(1)

    locations = fetch_locations()
    if not locations:
        print("❌ אין מקומות פורסמים")
        sys.exit(1)
    print(f"📍 נטענו {len(locations)} מקומות")

    posted_data = load_posted()
    last_index  = posted_data.get("last_index", -1)

    loc_summary, next_index = pick_location(locations, last_index)
    slug = loc_summary["id"]
    print(f"\n🗺️  מקום: {loc_summary.get('title', slug)} (אינדקס {next_index})")

    loc_detail = fetch_location_detail(slug)

    cover_url = get_cover_url(loc_summary, loc_detail)
    if not cover_url:
        print("❌ אין תמונה למקום הזה — מדלג")
        sys.exit(1)
    print(f"🖼️  כריכה: {cover_url}")

    image_url = ensure_public_url(cover_url)

    print("\n✍️  מייצר כיתובים...")
    ig_caption        = generate_caption(loc_detail, "instagram")
    fb_caption        = generate_caption(loc_detail, "facebook")
    threads_caption   = generate_caption(loc_detail, "threads")
    pinterest_caption = generate_caption(loc_detail, "pinterest")
    print(f"Instagram preview: {ig_caption[:120]}...")

    results = {}

    print("\n📤 מפרסם לאינסטגרם...")
    results["instagram"] = post_to_instagram(image_url, ig_caption)
    print(f"{'✅' if results['instagram'] else '❌'} Instagram: {results['instagram']}")

    print("\n📤 מפרסם לפייסבוק...")
    results["facebook"] = post_to_facebook(image_url, fb_caption)
    print(f"{'✅' if results['facebook'] else '❌'} Facebook: {results['facebook']}")

    print("\n📤 מפרסם ל-Pinterest...")
    results["pinterest"] = post_to_pinterest(image_url, pinterest_caption, loc_detail)
    print(f"{'✅' if results['pinterest'] else '❌'} Pinterest: {results['pinterest']}")

    print("\n📤 מפרסם ל-Threads...")
    results["threads"] = post_to_threads(image_url, threads_caption)
    print(f"{'✅' if results['threads'] else '❌'} Threads: {results['threads']}")

    posted_data["last_index"] = next_index
    slugs = posted_data.get("posted_slugs", [])
    if slug not in slugs:
        slugs.append(slug)
    posted_data["posted_slugs"] = slugs
    save_posted(posted_data)
    print(f"\n💾 עודכן {POSTED_FILE.name} — אינדקס הבא: {next_index}")

    success_count = sum(1 for v in results.values() if v)
    print(f"\n✅ הסתיים — {success_count}/4 רשתות פורסמו בהצלחה")
    if success_count == 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
