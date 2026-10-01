#!/usr/bin/env python3
"""Metadata-first photo catalog audit.

This script deliberately does NOT decide artistic quality and does NOT delete/hide
photos. It produces review candidates that must be visually inspected.
"""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PHOTOS_FILE = ROOT / "data" / "photos.json"
STRENGTH_FILE = ROOT / "data" / "photo_strength_report.json"
OUT_FILE = ROOT / "data" / "photo_catalog_audit.json"

LOW_LONG_EDGE = 2000
LOW_SHORT_EDGE = 1200
OVERSIZED_CATEGORY = 60

LOCATION_CATEGORIES = {
    "ישראל", "גאורגיה", "איטליה", "סלובקיה", "ספרד ואנדורה",
    "בולגריה", "הולנד", "אבו דאבי", "גרמניה", "אנגליה", "יוון",
    "צכיה", "טנזניה", "מונטנגרו", 'סן דיאגו - ארה"ב', "הונגריה",
    "וינה", "רומניה",
}

STYLE_OR_ATTRIBUTE_CATEGORIES = {
    "שחור-לבן", "צילומי לילה",
}


def load_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def build_audit(photos: list[dict], strength: dict | None = None) -> dict:
    category_counts = Counter()
    title_groups: dict[str, list[str]] = defaultdict(list)

    missing_description = []
    missing_parent_category = []
    low_resolution = []
    no_exif = []

    for photo in photos:
        photo_id = str(photo.get("id") or "")
        category = str(photo.get("category") or "").strip() or "(ללא קטגוריה)"
        title = str(photo.get("title") or "").strip()

        category_counts[category] += 1

        if title:
            title_groups[title.casefold()].append(photo_id)

        if not str(photo.get("description") or "").strip():
            missing_description.append(photo_id)

        if not photo.get("parent_category"):
            missing_parent_category.append(photo_id)

        width = int(photo.get("width") or 0)
        height = int(photo.get("height") or 0)
        if width and height:
            long_edge = max(width, height)
            short_edge = min(width, height)
            if long_edge < LOW_LONG_EDGE or short_edge < LOW_SHORT_EDGE:
                low_resolution.append({
                    "photo_id": photo_id,
                    "width": width,
                    "height": height,
                    "reason": "review_for_licensing_resolution",
                })

        if not photo.get("exif"):
            no_exif.append(photo_id)

    duplicate_title_groups = []
    for normalized, ids in title_groups.items():
        if len(ids) > 1:
            duplicate_title_groups.append({
                "normalized_title": normalized,
                "count": len(ids),
                "photo_ids": ids,
            })
    duplicate_title_groups.sort(key=lambda row: (-row["count"], row["normalized_title"]))

    categories = []
    for name, count in sorted(category_counts.items(), key=lambda row: (-row[1], row[0])):
        if name in LOCATION_CATEGORIES:
            taxonomy_type = "location_collection"
        elif name in STYLE_OR_ATTRIBUTE_CATEGORIES:
            taxonomy_type = "style_or_attribute"
        else:
            taxonomy_type = "subject_or_genre"

        categories.append({
            "category": name,
            "count": count,
            "share_pct": round((count / len(photos) * 100), 2) if photos else 0,
            "taxonomy_type": taxonomy_type,
            "oversized_for_manual_review": count > OVERSIZED_CATEGORY,
        })

    strength = strength or {}
    strength_status = strength.get("status", "unknown")

    return {
        "status": "review_required",
        "policy": {
            "automatic_delete": False,
            "automatic_hide": False,
            "visual_review_required_before_archive": True,
        },
        "catalog": {
            "total_photos": len(photos),
            "category_count": len(category_counts),
            "strength_status": strength_status,
        },
        "issues": {
            "missing_description_count": len(missing_description),
            "missing_description_photo_ids": missing_description,
            "missing_parent_category_count": len(missing_parent_category),
            "low_resolution_count": len(low_resolution),
            "low_resolution_candidates": low_resolution,
            "no_exif_count": len(no_exif),
            "duplicate_title_group_count": len(duplicate_title_groups),
            "duplicate_title_groups": duplicate_title_groups,
        },
        "categories": categories,
        "next_review": {
            "priority_categories": [
                "פרחים וצמחים",
                "בעלי חיים",
                "ישראל",
                "צילום מופשט",
                "מאקרו-צילומי תקריב",
            ],
            "visual_rubric": [
                "technical_quality",
                "composition",
                "distinctiveness",
                "editorial_impact",
                "commercial_portfolio_fit",
            ],
            "allowed_statuses": [
                "KEEP",
                "KEEP_SECONDARY",
                "REVIEW_DUPLICATE",
                "REVIEW_CATEGORY",
                "REVIEW_TECHNICAL",
                "ARCHIVE_CANDIDATE",
                "HIDE_CANDIDATE",
                "LEGAL_REVIEW",
            ],
        },
    }


def main() -> None:
    photos = load_json(PHOTOS_FILE, [])
    strength = load_json(STRENGTH_FILE, {})
    report = build_audit(photos, strength)
    OUT_FILE.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        "photo catalog audit:",
        report["catalog"]["total_photos"],
        "photos,",
        report["catalog"]["category_count"],
        "categories,",
        report["issues"]["duplicate_title_group_count"],
        "duplicate-title groups",
    )


if __name__ == "__main__":
    main()
