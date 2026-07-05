# Zazzle Product Social Posts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a weekly automated script that promotes one photo (rotating through photos that have Zazzle products configured) across Instagram, Facebook, Threads (one post each, English, one random product) and Pinterest (one pin per product on that photo).

**Architecture:** A single new script `src/zazzle_social_post.py`, following the exact conventions of the existing `src/week_photo_social.py` (feed platforms) and `src/pinterest_post.py` (Pinterest board/pin creation), driven by one new weekly GitHub Actions workflow. Pure rotation/data-parsing logic gets real pytest unit tests (`tests/test_zazzle_social_post.py`); network-calling functions (Claude, Graph API, Pinterest API) are verified via `--dry-run`, matching how every other posting script in this repo is tested today (there is no mocking layer for these APIs anywhere in the codebase — introducing one now would be inconsistent with established practice).

**Tech Stack:** Python 3.11, `requests`, `anthropic` (client, `claude-opus-4-8`), pytest. No new dependencies — both are already in `requirements.txt` and used by sibling scripts.

## Global Constraints

- Cadence: once per week, once per platform (not more) — per today's finding that over-posting contributed to the mid-June engagement crash.
- Language: English only for this feature (Zazzle posts target US buyers). All other automation stays Hebrew — do not touch any other script.
- Feed platforms (Instagram, Facebook, Threads): one post per week, mentioning the featured photo + **one** randomly chosen product from its `zazzle_products` list.
- Pinterest: **one pin per product** in that week's featured photo's `zazzle_products` list (e.g. 5 products → 5 pins), all pushed in the same run, to a single dedicated "Zazzle Prints" board (not mixed into the existing per-category boards).
- Rotation: photos with non-empty `zazzle_products` only; track posted photo IDs in `data/zazzle_social_posted.json`; when every photo has been used, reset and pick from the full set again (matches `src/instagram_post.py`'s `pick_photo` behavior exactly).
- Redbubble is explicitly out of scope for this plan — do not add any Redbubble code, but keep the "product field name" as a variable/constant rather than a hardcoded string inline, so it is easy to point at `redbubble_products` later.
- Each platform must fail independently (try/except per platform in `main()`) — one platform's failure must never stop the others or crash the run.
- No new GitHub secrets needed — reuse existing ones: `INSTAGRAM_USER_ID`, `INSTAGRAM_PAGE_TOKEN`, `FACEBOOK_PAGE_ID`, `FACEBOOK_PAGE_TOKEN`, `THREADS_USER_ID`, `THREADS_ACCESS_TOKEN`, `PINTEREST_ACCESS_TOKEN`, `AMIT_PHOTO_AGENT` (Anthropic key, same secret name pattern used by `week-photo-social.yml`).

---

## File Structure

- Create: `src/zazzle_social_post.py` — the whole script (data helpers, caption generation, per-platform publishing, `main()`)
- Create: `tests/test_zazzle_social_post.py` — unit tests for the pure/data-layer functions
- Create: `.github/workflows/zazzle-social-post.yml` — weekly cron
- Runtime-created (not committed ahead of time): `data/zazzle_social_posted.json` — same convention as `data/instagram_story_posted.json` etc., which don't exist until the workflow runs once

---

### Task 1: Data & rotation helpers

**Files:**
- Create: `src/zazzle_social_post.py` (this task only adds the top of the file + these functions)
- Test: `tests/test_zazzle_social_post.py`

**Interfaces:**
- Produces: `SITE_URL` (str constant), `POSTED_FILE` (Path constant), `PRODUCT_FIELD` (str constant, `"zazzle_products"`), `load_zazzle_photos() -> list[dict]`, `get_products(photo: dict) -> list[dict]`, `load_posted() -> dict` (shape `{"posted_ids": [...]}`), `save_posted(data: dict) -> None`, `pick_photo(photos: list[dict], posted_ids: set) -> dict`, `pick_product(products: list[dict]) -> dict`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_zazzle_social_post.py`:

```python
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

import zazzle_social_post as zsp


def test_get_products_parses_json_string():
    photo = {"id": "a", "zazzle_products": '[{"name": "Poster", "url": "http://x/1"}]'}
    result = zsp.get_products(photo)
    assert result == [{"name": "Poster", "url": "http://x/1"}]


def test_get_products_missing_field_returns_empty():
    assert zsp.get_products({"id": "a"}) == []


def test_get_products_empty_string_returns_empty():
    assert zsp.get_products({"id": "a", "zazzle_products": ""}) == []


def test_get_products_invalid_json_returns_empty():
    assert zsp.get_products({"id": "a", "zazzle_products": "not json"}) == []


def test_pick_photo_excludes_posted():
    photos = [
        {"id": "a", "title": "Photo A"},
        {"id": "b", "title": "Photo B"},
        {"id": "c", "title": "Photo C"},
    ]
    result = zsp.pick_photo(photos, posted_ids={"a", "b"})
    assert result["id"] == "c"


def test_pick_photo_resets_when_all_posted():
    photos = [{"id": "a", "title": "Photo A"}]
    result = zsp.pick_photo(photos, posted_ids={"a"})
    assert result["id"] == "a"


def test_pick_product_returns_one_of_the_list():
    products = [{"name": "Poster"}, {"name": "Mug"}, {"name": "Canvas"}]
    result = zsp.pick_product(products)
    assert result in products


def test_load_posted_missing_file(tmp_path, monkeypatch):
    posted_file = tmp_path / "zazzle_social_posted.json"
    monkeypatch.setattr(zsp, "POSTED_FILE", posted_file)
    result = zsp.load_posted()
    assert result == {"posted_ids": []}


def test_save_and_load_posted(tmp_path, monkeypatch):
    posted_file = tmp_path / "zazzle_social_posted.json"
    monkeypatch.setattr(zsp, "POSTED_FILE", posted_file)
    zsp.save_posted({"posted_ids": ["id1", "id2"]})
    result = zsp.load_posted()
    assert result == {"posted_ids": ["id1", "id2"]}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_zazzle_social_post.py -v`
Expected: `ModuleNotFoundError: No module named 'zazzle_social_post'` (file doesn't exist yet)

- [ ] **Step 3: Write the minimal implementation**

Create `src/zazzle_social_post.py`:

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_zazzle_social_post.py -v`
Expected: 9 passed

- [ ] **Step 5: Commit**

```bash
git add src/zazzle_social_post.py tests/test_zazzle_social_post.py
git commit -m "feat: zazzle_social_post — data/rotation helpers + tests"
```

---

### Task 2: Feed caption generation (English, Claude)

**Files:**
- Modify: `src/zazzle_social_post.py` (append)

**Interfaces:**
- Consumes: nothing from Task 1 directly (takes `photo: dict`, `product: dict` as plain args)
- Produces: `generate_feed_caption(photo: dict, product: dict) -> str` (English text, no hashtags, no link — caller appends the link)

- [ ] **Step 1: Write the implementation** (no unit test — this calls the live Anthropic API; verified via `--dry-run` in Task 5's manual check, matching how `generate_pin_description` in `src/pinterest_post.py` and `generate_caption` in `src/week_photo_social.py` are verified today — neither has a pytest test either)

Append to `src/zazzle_social_post.py`:

```python
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
```

- [ ] **Step 2: Commit**

```bash
git add src/zazzle_social_post.py
git commit -m "feat: zazzle_social_post — English feed caption generation"
```

---

### Task 3: Feed platform publishing (Instagram, Facebook, Threads)

**Files:**
- Modify: `src/zazzle_social_post.py` (append)

**Interfaces:**
- Consumes: `generate_feed_caption` (Task 2)
- Produces: `post_to_instagram(photo: dict, caption: str, product: dict) -> str | None` (returns post ID or None), `post_to_facebook(photo: dict, caption: str, product: dict) -> str | None`, `post_to_threads(photo: dict, caption: str, product: dict) -> str | None` — **all three return `None` on failure instead of raising/exiting**, so `main()` (Task 5) can call each independently without one crashing the run.

- [ ] **Step 1: Write the implementation**

Append to `src/zazzle_social_post.py`:

```python
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
    container_id = container.json().get("id")

    publish = requests.post(f"{GRAPH_API}/{IG_USER_ID}/media_publish", data={
        "creation_id": container_id, "access_token": IG_TOKEN,
    }, timeout=30)
    if not publish.ok:
        print(f"❌ IG publish failed: {publish.status_code} — {publish.text}")
        return None
    post_id = publish.json().get("id")
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
    post_id = resp.json().get("id")
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
    container_id = container_resp.json().get("id")
    if not container_id:
        print(f"❌ Missing Threads container id: {container_resp.json()}")
        return None

    for _ in range(10):
        time.sleep(5)
        status_resp = requests.get(
            f"{THREADS_API}/{container_id}",
            params={"fields": "status,error_message", "access_token": THREADS_TOKEN},
            timeout=30,
        )
        status = status_resp.json().get("status", "")
        print(f"⏳ Threads status: {status}")
        if status == "FINISHED":
            break
        if status == "ERROR":
            print(f"❌ Threads processing error: {status_resp.json().get('error_message', '')}")
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
    post_id = publish_resp.json().get("id")
    print(f"✅ Posted to Threads! ID: {post_id}")
    return post_id
```

- [ ] **Step 2: Commit**

```bash
git add src/zazzle_social_post.py
git commit -m "feat: zazzle_social_post — Instagram/Facebook/Threads publishing"
```

---

### Task 4: Pinterest — one pin per product

**Files:**
- Modify: `src/zazzle_social_post.py` (append)

**Interfaces:**
- Produces: `get_or_create_zazzle_board(token: str) -> str` (board ID), `generate_pin_description(photo: dict, product: dict) -> str`, `publish_zazzle_pin(token: str, board_id: str, photo: dict, product: dict) -> str | None` (pin ID or None)

- [ ] **Step 1: Write the implementation**

Append to `src/zazzle_social_post.py`:

```python
# ── Pinterest — one pin per product ──────────────────────────────────────────

ZAZZLE_BOARD_NAME = "Zazzle Prints"


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


def get_or_create_zazzle_board(token):
    if DRY_RUN:
        print(f"[dry-run] would look up/create board: {ZAZZLE_BOARD_NAME}")
        return "dry-run-board"

    data = _pinterest_get(token, "boards", {"page_size": 250})
    for board in data.get("items", []):
        if board["name"] == ZAZZLE_BOARD_NAME:
            print(f"📋 Existing board: {ZAZZLE_BOARD_NAME} ({board['id']})")
            return board["id"]

    board = _pinterest_post(token, "boards", {
        "name": ZAZZLE_BOARD_NAME,
        "description": f"Photography prints and products by Amit Erez | {SITE_URL}",
        "privacy": "PUBLIC",
    })
    print(f"✅ New board created: {ZAZZLE_BOARD_NAME} ({board['id']})")
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


def publish_zazzle_pin(token, board_id, photo, product):
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
```

- [ ] **Step 2: Commit**

```bash
git add src/zazzle_social_post.py
git commit -m "feat: zazzle_social_post — Pinterest, one pin per product"
```

---

### Task 5: Orchestration (`main()`) + CLI entrypoint

**Files:**
- Modify: `src/zazzle_social_post.py` (append)

**Interfaces:**
- Consumes: everything from Tasks 1–4
- Produces: `main()`, module `if __name__ == "__main__":` entrypoint

- [ ] **Step 1: Write the implementation**

Append to `src/zazzle_social_post.py`:

```python
# ── Orchestration ─────────────────────────────────────────────────────────────

def main():
    print("📦 Loading photos with Zazzle products...")
    photos = load_zazzle_photos()
    if not photos:
        print("❌ No photos with zazzle_products found — nothing to post")
        return

    posted_data = load_posted()
    posted_ids  = set(posted_data.get("posted_ids", []))
    print(f"📋 {len(photos)} Zazzle-enabled photos, {len(posted_ids)} already featured")

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
            board_id = get_or_create_zazzle_board(PINTEREST_TOKEN)
            for product in products:
                pin_id = publish_zazzle_pin(PINTEREST_TOKEN, board_id, photo, product)
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
```

- [ ] **Step 2: Dry-run verification**

Run: `python src/zazzle_social_post.py --dry-run`
Expected: prints the featured photo, the chosen feed product, the generated caption (or fallback text if `ANTHROPIC_API_KEY` isn't set locally), `[dry-run]` lines for each of the 4 platforms, and a summary showing counts — no real network posts, no `data/zazzle_social_posted.json` write (since `DRY_RUN` skips the save step).

- [ ] **Step 3: Commit**

```bash
git add src/zazzle_social_post.py
git commit -m "feat: zazzle_social_post — main() orchestration + dry-run entrypoint"
```

---

### Task 6: GitHub Actions workflow

**Files:**
- Create: `.github/workflows/zazzle-social-post.yml`

**Interfaces:**
- Consumes: `src/zazzle_social_post.py` (Task 5), existing repo secrets (see Global Constraints)
- Produces: a scheduled workflow run

- [ ] **Step 1: Write the workflow file**

Create `.github/workflows/zazzle-social-post.yml`:

```yaml
name: פרסום מוצרי Zazzle לרשתות

on:
  # כל יום רביעי ב-12:00 UTC = 15:00 ישראל
  schedule:
    - cron: '0 12 * * 3'
  workflow_dispatch:

env:
  FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true

jobs:
  zazzle-social-post:
    runs-on: ubuntu-latest
    permissions:
      contents: write

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Python setup
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: התקנת חבילות
        run: pip install requests anthropic

      - name: פרסום מוצרי Zazzle
        env:
          INSTAGRAM_USER_ID: ${{ secrets.INSTAGRAM_USER_ID }}
          INSTAGRAM_PAGE_TOKEN: ${{ secrets.INSTAGRAM_PAGE_TOKEN }}
          FACEBOOK_PAGE_ID: ${{ secrets.FACEBOOK_PAGE_ID }}
          FACEBOOK_PAGE_TOKEN: ${{ secrets.FACEBOOK_PAGE_TOKEN }}
          THREADS_USER_ID: ${{ secrets.THREADS_USER_ID }}
          THREADS_ACCESS_TOKEN: ${{ secrets.THREADS_ACCESS_TOKEN }}
          PINTEREST_ACCESS_TOKEN: ${{ secrets.PINTEREST_ACCESS_TOKEN }}
          ANTHROPIC_API_KEY: ${{ secrets.AMIT_PHOTO_AGENT }}
        run: python src/zazzle_social_post.py

      - name: עדכון מעקב פרסומים
        run: |
          git config user.name "Zazzle Social Agent"
          git config user.email "agent@amitphotos.com"
          git add data/zazzle_social_posted.json
          git diff --staged --quiet || git commit -m "🤖 עדכון zazzle_social_posted.json"
          git pull --rebase --autostash origin main
          git push
```

Note the `--autostash` on the rebase (Global Constraint learned from today's `weekly-report.yml` failure: a script writing more than one file and the workflow only committing one caused `git pull --rebase` to fail with "You have unstaged changes"). This script only ever writes `data/zazzle_social_posted.json`, and that's the only file staged, so this shouldn't trigger — `--autostash` is defense-in-depth, not a fix for a known second file here.

- [ ] **Step 2: Verify the workflow syntax**

Run: `python -c "import yaml; yaml.safe_load(open('.github/workflows/zazzle-social-post.yml', encoding='utf-8'))" ` (or equivalent YAML lint) to confirm it parses.
Expected: no error.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/zazzle-social-post.yml
git commit -m "feat: zazzle-social-post.yml — weekly cron, Wednesdays"
```

- [ ] **Step 4: Manual trigger for first real verification**

After pushing, trigger the workflow once manually via `gh workflow run zazzle-social-post.yml` (or the Actions tab) to confirm it runs end-to-end against the 3 currently-configured Zazzle photos, then check each platform to confirm the post/pins look right before letting the weekly schedule take over unattended.

---

## Self-Review Notes

- **Spec coverage:** weekly cadence ✓ (Task 6 cron), English-only ✓ (Task 2/4 prompts), one product per feed post ✓ (Task 5 `pick_product`), one pin per product on Pinterest ✓ (Task 5 loop over `products` in Task 4's `publish_zazzle_pin`), rotation without repeats ✓ (Task 1), independent per-platform failure ✓ (Task 5 try/except per platform), Redbubble seam ✓ (`PRODUCT_FIELD` constant, not hardcoded inline), no new secrets ✓ (Global Constraints list matches existing secret names used elsewhere in the repo).
- **Type consistency:** `get_products`/`pick_product` return `dict`/`list[dict]` consistently across Tasks 1, 2, 3, 4, 5. `load_posted`/`save_posted` use the `{"posted_ids": [...]}` shape consistently (matches `src/instagram_post.py`, not the mismatched flat-list shape in the stale `tests/test_reel_post.py`, which tests functions that no longer exist in `src/reel_post.py` and should not be used as a reference).
- **Testing approach:** pure logic (Task 1) is TDD'd with real pytest. Network-calling code (Tasks 2–4) is verified via `--dry-run`, matching the untested convention already used by every sibling script (`pinterest_post.py`, `week_photo_social.py`, `threads_post.py`, etc.) — no mocking framework exists in this codebase for these APIs, and introducing one only for this feature would be inconsistent.
