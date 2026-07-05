#!/usr/bin/env python3
"""
zazzle_social_post.py — Weekly promotion of Zazzle print-on-demand products.

Picks one photo (rotating through photos that have zazzle_products configured),
posts one English feed post to Instagram/Facebook/Threads (one random product),
and one Pinterest pin per product on that photo, to a dedicated "Zazzle Prints" board.

Usage:
  python src/zazzle_social_post.py            # real run
  python src/zazzle_social_post.py --dry-run   # print what would happen, post nothing
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

POSTED_FILE  = ROOT / "data" / "zazzle_social_posted.json"
PRODUCT_FIELD = "zazzle_products"  # swap to "redbubble_products" later for that marketplace

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

def load_zazzle_photos():
    """Fetch photos from the live API, keep only those with non-empty zazzle_products."""
    resp = requests.get(f"{SITE_URL}/api/photos", timeout=15)
    resp.raise_for_status()
    photos = resp.json()
    return [p for p in photos if get_products(p)]


def get_products(photo):
    """Parse the zazzle_products JSON-string field into a list of dicts. Empty/invalid -> []."""
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
        print("🔄 All Zazzle photos already featured — starting rotation over")
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
