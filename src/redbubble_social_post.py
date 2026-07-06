#!/usr/bin/env python3
"""
redbubble_social_post.py — Weekly promotion of Redbubble print-on-demand products.

Picks one photo (rotating through photos that have redbubble_products configured),
posts one English feed post to Instagram/Facebook/Threads (one random product),
and one Pinterest pin per product on that photo, to a dedicated "Redbubble Prints" board.

Sibling script to zazzle_social_post.py — same architecture, PRODUCT_FIELD swapped
per the extensibility seam that script was built with.

Usage:
  python src/redbubble_social_post.py            # real run
  python src/redbubble_social_post.py --dry-run   # print what would happen, post nothing
"""

import json
import os
import random
import sys
import time
from pathlib import Path

import requests

ROOT        = Path(__file__).parent.parent
SITE_URL    = "https://amitphotos.com"
GRAPH_API   = "https://graph.facebook.com/v21.0"
THREADS_API = "https://graph.threads.net/v1.0"
PINTEREST_API = "https://api.pinterest.com/v5"

POSTED_FILE  = ROOT / "data" / "redbubble_social_posted.json"
PRODUCT_FIELD = "redbubble_products"

DRY_RUN = "--dry-run" in sys.argv

IG_USER_ID          = os.environ.get("INSTAGRAM_USER_ID", "")
IG_TOKEN            = os.environ.get("INSTAGRAM_PAGE_TOKEN", "")
FB_PAGE_ID          = os.environ.get("FACEBOOK_PAGE_ID", "")
FB_TOKEN            = os.environ.get("FACEBOOK_PAGE_TOKEN", "")
THREADS_USER_ID     = os.environ.get("THREADS_USER_ID", "")
THREADS_TOKEN       = os.environ.get("THREADS_ACCESS_TOKEN", "")
PINTEREST_TOKEN     = os.environ.get("PINTEREST_ACCESS_TOKEN", "")
ANTHROPIC_API_KEY   = os.environ.get("ANTHROPIC_API_KEY", "").strip()


# ── Data & rotation ───────────────────────────────────────────────────────────

def load_redbubble_photos():
    """Fetch photos from the live API, keep only those with non-empty redbubble_products."""
    resp = requests.get(f"{SITE_URL}/api/photos", timeout=15)
    resp.raise_for_status()
    photos = resp.json()
    return [p for p in photos if get_products(p)]


def get_products(photo):
    """Parse the redbubble_products JSON-string field into a list of dicts. Empty/invalid -> []."""
    raw = photo.get(PRODUCT_FIELD)
    if not raw:
        return []
    try:
        products = json.loads(raw)
        return products if isinstance(products, list) else []
    except Exception:
        return []


def load_posted():
    if POSTED_FILE.exists():
        try:
            return json.loads(POSTED_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"posted_ids": []}


def save_posted(data):
    POSTED_FILE.parent.mkdir(parents=True, exist_ok=True)
    POSTED_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def pick_photo(photos, posted_ids):
    unposted = [p for p in photos if p["id"] not in posted_ids]
    if not unposted:
        print("🔄 All Redbubble photos already featured — starting rotation over")
        return random.choice(photos)
    return random.choice(unposted)


def pick_product(products):
    return random.choice(products)


# ── Caption generation ────────────────────────────────────────────────────────

def generate_feed_caption(photo, product):
    """English, first-person caption for IG/FB/Threads mentioning one specific product."""
    import anthropic
    title       = photo.get("title", "")
    category    = photo.get("category", "")
    description = photo.get("description", "")
    product_name = product.get("name", "print")

    meta = f"Photo: {title}" + (f" | Category: {category}" if category else "") + (f" | {description}" if description else "")

    if not ANTHROPIC_API_KEY:
        return f"Now available as a {product_name}: \"{title}\". Get yours at the link below."

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    prompt = f"""Write a short social media caption in English, first person, as Amit — an Israeli photographer —
promoting this photo of mine as a {product_name} available for purchase.

{meta}

Requirements:
- 2-3 sentences, first person ("I photographed", "I chose", "I waited for")
- Mention what makes the photo/moment special
- Naturally mention it's now available as a {product_name}
- No hashtags, no link (added separately after this text)
- No question at the end

Output only the caption text."""

    try:
        msg = client.messages.create(
            model="claude-opus-4-8",
            max_tokens=250,
            messages=[{"role": "user", "content": prompt}],
        )
        return msg.content[0].text.strip()
    except Exception as e:
        print(f"⚠️  Claude caption failed ({e}) — using fallback")
        return f"Now available as a {product_name}: \"{title}\". Get yours at the link below."


# ── Feed platform publishing ──────────────────────────────────────────────────

def _image_url(photo):
    url = photo.get("thumbnail") or photo.get("url", "")
    return f"{SITE_URL}{url}" if url.startswith("/") else url


def post_to_instagram(photo, caption, product):
    if not IG_USER_ID or not IG_TOKEN:
        print("⚠️  Missing INSTAGRAM_USER_ID / INSTAGRAM_PAGE_TOKEN — skipping Instagram")
        return None

    full_caption = f"{caption}\n\n🛍️ {product.get('name', 'Print')}: {product.get('url', SITE_URL)}"
    if DRY_RUN:
        print(f"[dry-run] would post to Instagram:\n{full_caption}\nimage: {_image_url(photo)}")
        return "dry-run-ig"

    container = requests.post(f"{GRAPH_API}/{IG_USER_ID}/media", data={
        "image_url": _image_url(photo), "caption": full_caption, "access_token": IG_TOKEN,
    }, timeout=30)
    if not container.ok:
        print(f"❌ IG container failed: {container.status_code} — {container.text}")
        return None
    try:
        container_id = container.json().get("id")
    except json.JSONDecodeError:
        print("⚠️  IG container response JSON unparseable — skipping")
        return None

    publish = requests.post(f"{GRAPH_API}/{IG_USER_ID}/media_publish", data={
        "creation_id": container_id, "access_token": IG_TOKEN,
    }, timeout=30)
    if not publish.ok:
        print(f"❌ IG publish failed: {publish.status_code} — {publish.text}")
        return None
    try:
        post_id = publish.json().get("id")
    except json.JSONDecodeError:
        print("⚠️  IG publish response JSON unparseable — skipping")
        return None
    print(f"✅ Posted to Instagram! ID: {post_id}")
    return post_id


def post_to_facebook(photo, caption, product):
    if not FB_PAGE_ID or not FB_TOKEN:
        print("⚠️  Missing FACEBOOK_PAGE_ID / FACEBOOK_PAGE_TOKEN — skipping Facebook")
        return None

    full_caption = f"{caption}\n\n🛍️ {product.get('name', 'Print')}: {product.get('url', SITE_URL)}"
    if DRY_RUN:
        print(f"[dry-run] would post to Facebook:\n{full_caption}\nimage: {_image_url(photo)}")
        return "dry-run-fb"

    resp = requests.post(f"{GRAPH_API}/{FB_PAGE_ID}/photos", data={
        "url": _image_url(photo), "message": full_caption, "access_token": FB_TOKEN,
    }, timeout=30)
    if not resp.ok:
        print(f"❌ FB post failed: {resp.status_code} — {resp.text}")
        return None
    try:
        post_id = resp.json().get("id")
    except json.JSONDecodeError:
        print("⚠️  FB response JSON unparseable — skipping")
        return None
    print(f"✅ Posted to Facebook! ID: {post_id}")
    return post_id


def post_to_threads(photo, caption, product):
    if not THREADS_USER_ID or not THREADS_TOKEN:
        print("⚠️  Missing THREADS_USER_ID / THREADS_ACCESS_TOKEN — skipping Threads")
        return None

    full_caption = f"{caption}\n\n🛍️ {product.get('name', 'Print')}: {product.get('url', SITE_URL)}"
    if DRY_RUN:
        print(f"[dry-run] would post to Threads:\n{full_caption}\nimage: {_image_url(photo)}")
        return "dry-run-threads"

    container_resp = requests.post(
        f"{THREADS_API}/{THREADS_USER_ID}/threads",
        params={"access_token": THREADS_TOKEN},
        json={"media_type": "IMAGE", "image_url": _image_url(photo), "text": full_caption},
        timeout=30,
    )
    if not container_resp.ok:
        print(f"❌ Threads container failed: {container_resp.status_code} — {container_resp.text}")
        return None
    try:
        container_data = container_resp.json()
    except json.JSONDecodeError:
        print("⚠️  Threads container response JSON unparseable — skipping")
        return None
    container_id = container_data.get("id")
    if not container_id:
        print(f"❌ Missing Threads container id: {container_data}")
        return None

    for _ in range(10):
        time.sleep(5)
        status_resp = requests.get(
            f"{THREADS_API}/{container_id}",
            params={"fields": "status,error_message", "access_token": THREADS_TOKEN},
            timeout=30,
        )
        if not status_resp.ok:
            print(f"⚠️  Threads status poll failed: {status_resp.status_code} — skipping")
            return None
        try:
            status_data = status_resp.json()
        except json.JSONDecodeError:
            print("⚠️  Threads status response JSON unparseable — skipping")
            return None
        status = status_data.get("status", "")
        print(f"⏳ Threads status: {status}")
        if status == "FINISHED":
            break
        if status == "ERROR":
            print(f"❌ Threads processing error: {status_data.get('error_message', '')}")
            return None
    else:
        print("❌ Threads container did not finish in time")
        return None

    publish_resp = requests.post(
        f"{THREADS_API}/{THREADS_USER_ID}/threads_publish",
        params={"access_token": THREADS_TOKEN},
        json={"creation_id": container_id},
        timeout=30,
    )
    if not publish_resp.ok:
        print(f"❌ Threads publish failed: {publish_resp.status_code} — {publish_resp.text}")
        return None
    try:
        post_id = publish_resp.json().get("id")
    except json.JSONDecodeError:
        print("⚠️  Threads publish response JSON unparseable — skipping")
        return None
    print(f"✅ Posted to Threads! ID: {post_id}")
    return post_id


# ── Pinterest — one pin per product ──────────────────────────────────────────

REDBUBBLE_BOARD_NAME = "Redbubble Prints"


def _pinterest_get(token, endpoint, params=None):
    res = requests.get(f"{PINTEREST_API}/{endpoint}",
                        headers={"Authorization": f"Bearer {token}"}, params=params, timeout=15)
    res.raise_for_status()
    return res.json()


def _pinterest_post(token, endpoint, body):
    res = requests.post(f"{PINTEREST_API}/{endpoint}",
                         headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                         json=body, timeout=15)
    if not res.ok:
        print(f"⚠️  Pinterest {res.status_code}: {res.text}")
    res.raise_for_status()
    return res.json()


def get_or_create_redbubble_board(token):
    if DRY_RUN:
        print(f"[dry-run] would look up/create board: {REDBUBBLE_BOARD_NAME}")
        return "dry-run-board"

    data = _pinterest_get(token, "boards", {"page_size": 250})
    for board in data.get("items", []):
        if board["name"] == REDBUBBLE_BOARD_NAME:
            print(f"📋 Existing board: {REDBUBBLE_BOARD_NAME} ({board['id']})")
            return board["id"]

    board = _pinterest_post(token, "boards", {
        "name": REDBUBBLE_BOARD_NAME,
        "description": f"Photography prints and products by Amit Erez | {SITE_URL}",
        "privacy": "PUBLIC",
    })
    print(f"✅ New board created: {REDBUBBLE_BOARD_NAME} ({board['id']})")
    time.sleep(1)
    return board["id"]


def generate_pin_description(photo, product):
    import anthropic
    title        = photo.get("title", "")
    category     = photo.get("category", "")
    product_name = product.get("name", "print")

    if not ANTHROPIC_API_KEY:
        return f"\"{title}\" now available as a {product_name}. Available for purchase at {product.get('url', SITE_URL)}"

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    prompt = f"""Write a Pinterest pin description in English, first person, as Amit — the Israeli photographer who took this photo —
promoting it as a {product_name}.

Photo: {title}{f' | Category: {category}' if category else ''}

Requirements:
- 2-3 sentences, first person ("I photographed", "I chose", "I waited for")
- Mention the {product_name} specifically
- End with: "Available for purchase at the link"
- Include 5-8 relevant keywords naturally (not as hashtags)
- No questions at the end

Output only the description text."""

    try:
        msg = client.messages.create(model="claude-opus-4-8", max_tokens=300,
                                      messages=[{"role": "user", "content": prompt}])
        return msg.content[0].text.strip()
    except Exception as e:
        print(f"⚠️  Claude pin description failed ({e}) — using fallback")
        return f"\"{title}\" now available as a {product_name}. Available for purchase at {product.get('url', SITE_URL)}"


def publish_redbubble_pin(token, board_id, photo, product):
    title       = photo.get("title", "")
    image_url   = product.get("image") or _image_url(photo)
    description = generate_pin_description(photo, product)

    body = {
        "board_id": board_id,
        "title": f"{title} — {product.get('name', 'Print')}",
        "description": description,
        "link": product.get("url", SITE_URL),
        "media_source": {"source_type": "image_url", "url": image_url},
    }

    if DRY_RUN:
        print(f"[dry-run] would pin: {body['title']} → board {board_id}\n  {description[:80]}...")
        return "dry-run-pin"

    try:
        result = _pinterest_post(token, "pins", body)
        pin_id = result.get("id")
        print(f"✅ Pinned! {title} — {product.get('name')} → {pin_id}")
        return pin_id
    except Exception as e:
        print(f"❌ Pin failed for {product.get('name')}: {e}")
        return None


# ── Orchestration ─────────────────────────────────────────────────────────────

def main():
    print("📦 Loading photos with Redbubble products...")
    photos = load_redbubble_photos()
    if not photos:
        print("❌ No photos with redbubble_products found — nothing to post")
        return

    posted_data = load_posted()
    posted_ids  = set(posted_data.get("posted_ids", []))
    print(f"📋 {len(photos)} Redbubble-enabled photos, {len(posted_ids)} already featured")

    photo    = pick_photo(photos, posted_ids)
    products = get_products(photo)
    print(f"\n🖼️  Featured this week: {photo.get('title', photo['id'])} ({len(products)} products)")

    # Feed platforms — one random product each
    feed_product = pick_product(products)
    print(f"🎯 Feed platforms will feature: {feed_product.get('name')}")
    caption = generate_feed_caption(photo, feed_product)
    print(f"✍️  Caption: {caption[:100]}...")

    results = {"instagram": None, "facebook": None, "threads": None, "pinterest_pins": []}

    try:
        results["instagram"] = post_to_instagram(photo, caption, feed_product)
    except Exception as e:
        print(f"❌ Instagram step crashed: {e}")

    try:
        results["facebook"] = post_to_facebook(photo, caption, feed_product)
    except Exception as e:
        print(f"❌ Facebook step crashed: {e}")

    try:
        results["threads"] = post_to_threads(photo, caption, feed_product)
    except Exception as e:
        print(f"❌ Threads step crashed: {e}")

    # Pinterest — one pin per product
    if not PINTEREST_TOKEN:
        print("⚠️  Missing PINTEREST_ACCESS_TOKEN — skipping Pinterest")
    else:
        try:
            board_id = get_or_create_redbubble_board(PINTEREST_TOKEN)
            for product in products:
                pin_id = publish_redbubble_pin(PINTEREST_TOKEN, board_id, photo, product)
                results["pinterest_pins"].append(pin_id)
                if not DRY_RUN:
                    time.sleep(2)
        except Exception as e:
            print(f"❌ Pinterest step crashed: {e}")

    if not DRY_RUN:
        posted_ids.add(photo["id"])
        save_posted({"posted_ids": sorted(posted_ids)})
        print(f"\n💾 Saved rotation state ({len(posted_ids)} photos featured so far)")

    print(f"\n{'=' * 40}")
    print(f"✅ Instagram: {'ok' if results['instagram'] else 'skipped/failed'}")
    print(f"✅ Facebook: {'ok' if results['facebook'] else 'skipped/failed'}")
    print(f"✅ Threads: {'ok' if results['threads'] else 'skipped/failed'}")
    print(f"✅ Pinterest pins: {sum(1 for p in results['pinterest_pins'] if p)}/{len(products)}")


if __name__ == "__main__":
    main()
