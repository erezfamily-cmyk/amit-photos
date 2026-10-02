#!/usr/bin/env python3
"""Build a reversible HIDE plan for critically low-resolution portfolio photos.

This module never deletes files. It excludes every photo that already has an
owner curation decision, so automation cannot overwrite KEEP, KEEP_SECONDARY,
HIDE, DELETE, or CHANGE_CATEGORY.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

CRITICAL_LONG_EDGE = 1200
CRITICAL_SHORT_EDGE = 800
DECISIONS_KEY = "flower_curation_decisions_v1"


def is_critical_low_resolution(photo: dict[str, Any]) -> bool:
    try:
        width = int(photo.get("width") or 0)
        height = int(photo.get("height") or 0)
    except (TypeError, ValueError):
        return False
    if width <= 0 or height <= 0:
        return False
    return max(width, height) < CRITICAL_LONG_EDGE or min(width, height) < CRITICAL_SHORT_EDGE


def has_owner_decision(photo_id: str, decisions: dict[str, Any]) -> bool:
    payload = decisions.get(photo_id)
    return isinstance(payload, dict) and bool(str(payload.get("decision") or "").strip())


def build_plan(photos: list[dict[str, Any]], decisions: dict[str, Any]) -> dict[str, Any]:
    critical = [p for p in photos if p.get("id") and is_critical_low_resolution(p)]
    eligible = [p for p in critical if not has_owner_decision(str(p["id"]), decisions)]
    protected = [p for p in critical if has_owner_decision(str(p["id"]), decisions)]
    return {
        "policy": {
            "action": "HIDE",
            "reversible": True,
            "automatic_delete": False,
            "protect_any_existing_owner_decision": True,
            "long_edge_threshold": CRITICAL_LONG_EDGE,
            "short_edge_threshold": CRITICAL_SHORT_EDGE,
        },
        "critical_count": len(critical),
        "eligible_count": len(eligible),
        "protected_count": len(protected),
        "eligible": [
            {
                "photo_id": str(p["id"]),
                "title": p.get("title") or "",
                "category": p.get("category") or "",
                "width": p.get("width"),
                "height": p.get("height"),
            }
            for p in eligible
        ],
        "protected": [
            {
                "photo_id": str(p["id"]),
                "decision": decisions.get(str(p["id"]), {}).get("decision"),
                "title": p.get("title") or "",
            }
            for p in protected
        ],
    }


def sql_quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def json_path_for_photo(photo_id: str) -> str:
    return '$."' + photo_id.replace('"', '\\"') + '"'


def build_sql(plan: dict[str, Any]) -> str:
    eligible = plan.get("eligible") or []
    statements = [
        "INSERT INTO settings(key,value) VALUES(" + sql_quote(DECISIONS_KEY) + ",'{}') ON CONFLICT(key) DO NOTHING;"
    ]
    for row in eligible:
        photo_id = str(row["photo_id"])
        qid = sql_quote(photo_id)
        path = sql_quote(json_path_for_photo(photo_id))
        safe_value = "CASE WHEN json_valid(value) THEN value ELSE '{}' END"
        # Re-check the live decision immediately before each HIDE. If any owner
        # decision exists now, the photo is left untouched.
        statements.append(
            "UPDATE photos SET published=0 WHERE id="
            + qid
            + " AND NOT EXISTS (SELECT 1 FROM settings WHERE key="
            + sql_quote(DECISIONS_KEY)
            + " AND json_extract("
            + safe_value
            + ", "
            + path
            + " || '.decision') IS NOT NULL);"
        )
        # Record HIDE only when the decision path is still empty. This never
        # overwrites an owner decision.
        statements.append(
            "UPDATE settings SET value=CASE WHEN json_extract("
            + safe_value
            + ", "
            + path
            + " || '.decision') IS NULL THEN json_set("
            + safe_value
            + ", "
            + path
            + ", json_object('decision','HIDE','note','Automatic critical low-resolution HIDE; reversible; Google Drive untouched.','updated_at',strftime('%Y-%m-%dT%H:%M:%fZ','now'))) ELSE value END WHERE key="
            + sql_quote(DECISIONS_KEY)
            + ";"
        )
    return "\n".join(statements) + "\n"


def parse_wrangler_decisions(payload: Any) -> dict[str, Any]:
    rows = []
    if isinstance(payload, list):
        for block in payload:
            if isinstance(block, dict):
                rows.extend(block.get("results") or [])
    elif isinstance(payload, dict):
        rows.extend(payload.get("results") or [])
    for row in rows:
        if row.get("value"):
            try:
                parsed = json.loads(row["value"])
                return parsed if isinstance(parsed, dict) else {}
            except Exception:
                return {}
    return {}


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--photos", default="data/photos.json")
    parser.add_argument("--decisions-json", required=True)
    parser.add_argument("--plan-out", default="/tmp/critical-low-resolution-plan.json")
    parser.add_argument("--sql-out", default="/tmp/critical-low-resolution-hide.sql")
    args = parser.parse_args()

    photos = json.loads(Path(args.photos).read_text(encoding="utf-8"))
    decisions_payload = json.loads(Path(args.decisions_json).read_text(encoding="utf-8"))
    decisions = parse_wrangler_decisions(decisions_payload)
    plan = build_plan(photos, decisions)
    Path(args.plan_out).write_text(json.dumps(plan, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    Path(args.sql_out).write_text(build_sql(plan), encoding="utf-8")
    print(json.dumps({
        "critical_count": plan["critical_count"],
        "eligible_count": plan["eligible_count"],
        "protected_count": plan["protected_count"],
    }))


if __name__ == "__main__":
    main()
