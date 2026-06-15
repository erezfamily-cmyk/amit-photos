#!/usr/bin/env python3
"""Shared helper — append a video record to data/videos.json."""

import json
import datetime
from pathlib import Path

VIDEOS_FILE = Path(__file__).parent.parent / "data" / "videos.json"


def append_video(record: dict) -> None:
    """Append record to data/videos.json. Adds today's date if missing."""
    record.setdefault("date", datetime.date.today().isoformat())
    videos = json.loads(VIDEOS_FILE.read_text(encoding="utf-8")) if VIDEOS_FILE.exists() else []
    videos.append(record)
    VIDEOS_FILE.write_text(json.dumps(videos, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[OK] videos.json <- {record.get('type')} [{record.get('id')}]")
