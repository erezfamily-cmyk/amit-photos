#!/usr/bin/env python3
"""Publish up to three curated Pinterest queue entries per day."""

import csv
import json
import os
import random
import sys
import time
from pathlib import Path
from urllib.parse import urlencode, urlparse, parse_qs

import requests

ROOT = Path(__file__).resolve().parent.parent
QUEUE_FILE = ROOT / "data" / "pinterest_queue.csv"
POSTED_FILE = ROOT / "data" / "pinterest_posted.json"
SITE_URL = "https://amitphotos.com"
PINTEREST_API = "https://api.pinterest.com/v5"
PINS_PER_DAY = int(os.getenv("PINTEREST_POST_LIMIT", "3"))
PILOT_PHOTO_ID = os.getenv("PINTEREST_PILOT_PHOTO_ID", "").strip()
DRY_RUN = "--dry-run" in sys.argv


def load_queue():
    with QUEUE_FILE.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        required = {"id", "title", "category", "description", "image_url", "link", "posted"}
        if not required.issubset(reader.fieldnames or []):
            raise ValueError("Pinterest queue is missing required columns")
        rows = list(reader)
    ids = [row["id"] for row in rows]
    if not ids or len(ids) != len(set(ids)):
        raise ValueError("Pinterest queue is empty or contains duplicate IDs")
    for row in rows:
        if not all(row.get(field, "").strip() for field in required - {"posted"}):
            raise ValueError(f"Incomplete Pinterest queue entry: {row.get('id', '')}")
        link = urlparse(row["link"])
        if link.scheme != "https" or link.netloc != "amitphotos.com" or parse_qs(link.query).get("photo") != [row["id"]]:
            raise ValueError(f"Invalid per-photo link: {row['id']}")
    return rows, reader.fieldnames


def load_posted():
    try:
        return set(json.loads(POSTED_FILE.read_text(encoding="utf-8")))
    except FileNotFoundError:
        return set()


def save_state(rows, fields, posted):
    # Write both state files after every successful Pin; the workflow commits both.
    with QUEUE_FILE.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    POSTED_FILE.write_text(
        json.dumps(sorted(posted), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def load_live_photos():
    response = requests.get(f"{SITE_URL}/api/photos", timeout=15)
    response.raise_for_status()
    photos = response.json()
    if not isinstance(photos, list) or not photos:
        raise ValueError("Photo API returned no usable catalog")
    return {str(photo["id"]): photo for photo in photos if photo.get("id")}


def pinterest_request(token, method, endpoint, **kwargs):
    response = requests.request(
        method, f"{PINTEREST_API}/{endpoint}",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        timeout=20, **kwargs,
    )
    response.raise_for_status()
    return response.json()


def board_for_category(token, category, cache):
    if category in cache:
        return cache[category]
    data = pinterest_request(token, "GET", "boards", params={"page_size": 250})
    for board in data.get("items", []):
        if board.get("name") == category:
            cache[category] = board["id"]
            return board["id"]
    board = pinterest_request(token, "POST", "boards", json={
        "name": category,
        "description": f"צילומי {category} מאת עמית ארז | {SITE_URL}",
        "privacy": "PUBLIC",
    })
    cache[category] = board["id"]
    return board["id"]


def select_rows(rows, live, posted, count=PINS_PER_DAY):
    candidates = [
        row for row in rows
        if row["id"] in live and row["id"] not in posted
        and row["posted"].upper() != "TRUE"
    ]
    random.shuffle(candidates)
    selected, categories = [], set()
    for row in candidates:
        if row["category"] not in categories:
            selected.append(row)
            categories.add(row["category"])
            if len(selected) == count:
                break
    return selected


def publish(token, row, photo, board):
    image_url = photo.get("thumbnail") or photo.get("url")
    if not image_url:
        raise ValueError(f"No live image for {row['id']}")
    if image_url.startswith("/"):
        image_url = f"{SITE_URL}{image_url}"
    link = row["link"] + "&" + urlencode({
        "utm_source": "pinterest", "utm_medium": "organic_social",
        "utm_campaign": "gallery_pins", "utm_content": row["id"],
    })
    return pinterest_request(token, "POST", "pins", json={
        "board_id": board,
        "title": row["title"],
        "description": row["description"],
        "link": link,
        "media_source": {"source_type": "image_url", "url": image_url},
    })


def main():
    token = os.getenv("PINTEREST_ACCESS_TOKEN", "").strip()
    if not token and not DRY_RUN:
        raise ValueError("PINTEREST_ACCESS_TOKEN is missing")
    rows, fields = load_queue()
    posted = load_posted()
    live = load_live_photos()
    if PILOT_PHOTO_ID:
        selected = [row for row in rows if row["id"] == PILOT_PHOTO_ID and row["id"] in live
                    and row["id"] not in posted and row["posted"].upper() != "TRUE"]
        if len(selected) != 1:
            raise ValueError(f"Pilot photo unavailable or already posted: {PILOT_PHOTO_ID}")
    else:
        selected = select_rows(rows, live, posted)
    print(f"Queue={len(rows)}, live matches={sum(row['id'] in live for row in rows)}, "
          f"already posted={sum(row['id'] in posted for row in rows)}, selected={len(selected)}")
    if PINS_PER_DAY < 1 or (PILOT_PHOTO_ID and PINS_PER_DAY != 1):
        raise ValueError("Pilot requires exactly one Pin")
    if DRY_RUN:
        for row in selected:
            print(f"DRY RUN: {row['id']} | {row['title']} | {row['link']}")
        return
    board_cache, failures = {}, 0
    for row in selected:
        try:
            board = board_for_category(token, row["category"], board_cache)
            pin = publish(token, row, live[row["id"]], board)
            posted.add(row["id"])
            row["posted"] = "TRUE"
            save_state(rows, fields, posted)
            print(f"Published {row['id']} as Pin {pin.get('id', '')}")
            time.sleep(3)
        except (requests.RequestException, ValueError, KeyError) as exc:
            failures += 1
            print(f"Failed {row['id']}: {exc}", file=sys.stderr)
    if failures:
        raise RuntimeError(f"{failures} Pin(s) failed")


if __name__ == "__main__":
    main()
