#!/usr/bin/env python3
"""Persistent mapping between social post IDs and Amit Photos photo IDs."""

import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).parent.parent
MAP_FILE = ROOT / "data" / "social_photo_map.json"


def load_social_photo_map():
    if not MAP_FILE.exists():
        return []
    try:
        data = json.loads(MAP_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except Exception:
        return []


def save_social_photo_mapping(platform, post_id, photo_id):
    if not platform or not post_id or not photo_id:
        return
    rows = load_social_photo_map()
    key = (str(platform), str(post_id))
    if any((str(r.get("platform")), str(r.get("post_id"))) == key for r in rows):
        return
    rows.append({
        "platform": str(platform),
        "post_id": str(post_id),
        "photo_id": str(photo_id),
        "posted_at": datetime.now(timezone.utc).isoformat(),
    })
    MAP_FILE.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")


def build_post_lookup():
    return {
        (str(row.get("platform")), str(row.get("post_id"))): str(row.get("photo_id"))
        for row in load_social_photo_map()
        if row.get("platform") and row.get("post_id") and row.get("photo_id")
    }
