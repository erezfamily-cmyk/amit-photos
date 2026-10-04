#!/usr/bin/env python3
"""Audit Pinterest queue against published API and local/Drive HIDE records."""

import json
from collections import Counter
from pathlib import Path

from pinterest_post import ROOT, load_queue, load_live_photos

def main():
    rows, _ = load_queue()
    live = load_live_photos()
    static = json.loads((ROOT / "data" / "photos.json").read_text(encoding="utf-8"))
    static_ids = {photo["id"] for photo in static}
    state = json.loads((ROOT / "data" / "drive-curation-state.json").read_text(encoding="utf-8"))
    hidden_ids = set(state.get("hidden", {}))
    missing = []
    for row in rows:
        if row["id"] in live:
            continue
        missing.append({
            "id": row["id"], "title": row["title"], "category": row["category"],
            "in_static": row["id"] in static_ids,
            "drive_hidden": row["id"] in hidden_ids,
            "posted": row["posted"],
        })
    groups = Counter(
        "drive_hidden" if row["drive_hidden"] else
        "in_static_not_live" if row["in_static"] else "absent_from_static_and_live"
        for row in missing
    )
    print(json.dumps({
        "queue": len(rows), "live_catalog": len(live),
        "live_matches": len(rows) - len(missing),
        "missing": len(missing), "groups": dict(groups),
    }, ensure_ascii=False))
    for row in missing:
        print(json.dumps(row, ensure_ascii=False))

if __name__ == "__main__":
    main()
