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
