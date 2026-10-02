#!/usr/bin/env python3
"""Incremental visual curation for the full photo portfolio.

Advisory only: this script never changes D1, R2, published state, category,
public ordering, or owner decisions. It preserves completed visual scores and
fills missing visual components in batches with Claude Vision.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

ROOT = Path(__file__).resolve().parents[1]
PHOTOS_FILE = ROOT / "data" / "photos.json"
FLOWER_SCORES_FILE = ROOT / "data" / "flower-curation-scores.json"
OUT_FILE = ROOT / "data" / "portfolio-curation-scores.json"

ANTHROPIC_API = "https://api.anthropic.com/v1/messages"
ANTHROPIC_MODEL = "claude-haiku-4-5-20251001"
SITE_BASE = "https://amitphotos.com"

LOW_LONG_EDGE = 2000
LOW_SHORT_EDGE = 1200
CRITICAL_LONG_EDGE = 1200
CRITICAL_SHORT_EDGE = 800
OWNER_REVIEW_MAX_SCORE = 85

VISUAL_WEIGHTS = {
    "sharpness": 0.25,
    "composition": 0.20,
    "light_color": 0.15,
    "resolution": 0.15,
    "uniqueness": 0.10,
    "category_fit": 0.10,
    "metadata": 0.05,
}


def load_json(path: Path, default: Any):
    try:
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default
    except Exception:
        return default


def clamp_score(value: Any) -> int:
    try:
        return max(0, min(100, int(round(float(value)))))
    except (TypeError, ValueError):
        raise ValueError(f"invalid score: {value!r}")


def resolution_score(width: Any, height: Any) -> int:
    try:
        width, height = int(width or 0), int(height or 0)
    except (TypeError, ValueError):
        return 0
    if width <= 0 or height <= 0:
        return 0
    long_edge, short_edge = max(width, height), min(width, height)
    if long_edge < 800 or short_edge < 500:
        return 13
    if long_edge < 1200 or short_edge < 800:
        return 27
    if long_edge < 2000 or short_edge < 1200:
        return 47
    if long_edge < 3200 or short_edge < 1800:
        return 72
    if long_edge < 4200 or short_edge < 2400:
        return 85
    if long_edge < 6000 or short_edge < 3500:
        return 92
    return 100


def metadata_score(photo: dict) -> int:
    score = 0
    if str(photo.get("title") or "").strip():
        score += 20
    if str(photo.get("description") or "").strip():
        score += 40
    if photo.get("exif"):
        score += 40
    return score


def normalized(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().casefold())


def uniqueness_score(photo: dict, title_counts: Counter, filename_counts: Counter) -> int:
    score = 100
    title = normalized(photo.get("title"))
    filename = normalized(photo.get("filename"))
    if title and title_counts[title] > 1:
        score = min(score, 75 if title_counts[title] == 2 else 60)
    if filename and filename_counts[filename] > 1:
        score = min(score, 50)
    return score


def technical_flags(photo: dict, title_counts: Counter, filename_counts: Counter) -> list[str]:
    flags: list[str] = []
    try:
        width, height = int(photo.get("width") or 0), int(photo.get("height") or 0)
    except (TypeError, ValueError):
        width = height = 0
    if width and height:
        long_edge, short_edge = max(width, height), min(width, height)
        if long_edge < CRITICAL_LONG_EDGE or short_edge < CRITICAL_SHORT_EDGE:
            flags.append("critical_low_resolution")
        elif long_edge < LOW_LONG_EDGE or short_edge < LOW_SHORT_EDGE:
            flags.append("low_resolution")
    else:
        flags.append("missing_dimensions")

    title = normalized(photo.get("title"))
    filename = normalized(photo.get("filename"))
    if title and title_counts[title] > 1:
        flags.append("duplicate_title")
    if filename and filename_counts[filename] > 1:
        flags.append("duplicate_filename")
    if not str(photo.get("description") or "").strip():
        flags.append("missing_description")
    if not photo.get("exif"):
        flags.append("missing_exif")
    return flags


def image_url(photo: dict) -> str:
    src = str(photo.get("thumbnail") or photo.get("url") or "").strip()
    if not src:
        return ""
    if src.startswith("http://") or src.startswith("https://"):
        return src
    return SITE_BASE + (src if src.startswith("/") else "/" + src)


def fetch_image(photo: dict) -> tuple[bytes, str]:
    url = image_url(photo)
    if not url:
        raise RuntimeError("photo has no image URL")
    res = requests.get(url, timeout=30)
    res.raise_for_status()
    content_type = (res.headers.get("Content-Type") or "image/webp").split(";")[0].strip()
    if not content_type.startswith("image/"):
        raise RuntimeError(f"unexpected content type: {content_type}")
    if len(res.content) > 5 * 1024 * 1024:
        raise RuntimeError("image exceeds 5MB vision input limit")
    return res.content, content_type


def parse_json_text(text: str) -> dict:
    text = text.strip()
    fence = chr(96) * 3
    if fence in text:
        chunks = text.split(fence)
        text = next((c for c in chunks if "{" in c and "}" in c), text)
        text = re.sub(r"^json\s*", "", text.strip(), flags=re.I)
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < start:
        raise ValueError("model response did not contain JSON object")
    return json.loads(text[start:end + 1])


def analyze_visual(photo: dict, api_key: str) -> dict:
    image_bytes, media_type = fetch_image(photo)
    b64 = base64.standard_b64encode(image_bytes).decode("ascii")
    prompt = f"""You are performing a conservative professional photo-portfolio review.
Evaluate only what is visually observable in this single image.

Photo title: {photo.get('title') or ''}
Current category: {photo.get('category') or ''}

Return JSON only with:
{{
  "sharpness": 0-100,
  "composition": 0-100,
  "light_color": 0-100,
  "category_fit": 0-100,
  "visual_flags": ["optional_short_flag"],
  "note": "one concise sentence"
}}

Calibration:
- 90-100: exceptional / portfolio-ready with no meaningful visual issue.
- 86-89: strong, small imperfections only.
- 75-85: good but warrants owner review.
- below 75: clear visual weakness or technical problem.
Be conservative. Do not infer resolution from the displayed thumbnail; resolution is scored separately from metadata.
Sharpness should judge intentional focus versus unwanted blur. Composition should judge framing, balance, subject separation and distractions. Light/color should judge exposure, tonal control, white balance/color harmony and clipped highlights/shadows where visible.
"""

    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    body = {
        "model": ANTHROPIC_MODEL,
        "max_tokens": 280,
        "temperature": 0,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": b64}},
                {"type": "text", "text": prompt},
            ],
        }],
    }

    last_error = None
    for attempt in range(3):
        try:
            res = requests.post(ANTHROPIC_API, headers=headers, json=body, timeout=45)
            if res.status_code in (429, 500, 502, 503, 529) and attempt < 2:
                time.sleep(4 * (attempt + 1))
                continue
            res.raise_for_status()
            payload = parse_json_text(res.json()["content"][0]["text"])
            return {
                "sharpness": clamp_score(payload.get("sharpness")),
                "composition": clamp_score(payload.get("composition")),
                "light_color": clamp_score(payload.get("light_color")),
                "category_fit": clamp_score(payload.get("category_fit")),
                "visual_flags": [str(x)[:80] for x in (payload.get("visual_flags") or [])[:6]],
                "note": str(payload.get("note") or "").strip()[:300],
            }
        except Exception as exc:
            last_error = exc
            if attempt < 2:
                time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"vision analysis failed: {last_error}")


def final_visual_score(components: dict) -> int:
    return int(round(sum(float(components[key]) * weight for key, weight in VISUAL_WEIGHTS.items())))


def item_from_photo(photo: dict, title_counts: Counter, filename_counts: Counter) -> dict:
    flags = technical_flags(photo, title_counts, filename_counts)
    components = {
        "sharpness": None,
        "composition": None,
        "light_color": None,
        "resolution": resolution_score(photo.get("width"), photo.get("height")),
        "uniqueness": uniqueness_score(photo, title_counts, filename_counts),
        "category_fit": None,
        "metadata": metadata_score(photo),
    }
    technical_score = round(
        0.55 * components["resolution"]
        + 0.30 * components["uniqueness"]
        + 0.15 * components["metadata"]
    )
    return {
        "photo_id": str(photo.get("id") or ""),
        "title": photo.get("title") or "",
        "category": photo.get("category") or "",
        "filename": photo.get("filename") or "",
        "thumbnail": photo.get("thumbnail") or photo.get("url") or "",
        "width": photo.get("width"),
        "height": photo.get("height"),
        "score": None,
        "score_kind": "pending_visual",
        "confidence": "pending",
        "technical_score": technical_score,
        "components": components,
        "flags": flags,
        "visual_flags": [],
        "visual_note": "",
        "material_problem": "critical_low_resolution" in flags,
        "owner_review_required": False,
        "recommended_action": "PENDING_VISUAL_REVIEW",
        "visual_reviewed_at": None,
    }


def seed_flower_scores(items_by_id: dict[str, dict], flower_scores: dict) -> None:
    for old in flower_scores.get("items", []) if isinstance(flower_scores, dict) else []:
        photo_id = str(old.get("photo_id") or "")
        current = items_by_id.get(photo_id)
        if not current:
            continue
        old_components = old.get("components") or {}
        for key in ("resolution", "uniqueness", "metadata"):
            if old_components.get(key) is not None:
                current["components"][key] = old_components[key]
        current["technical_score"] = old.get("technical_score", current["technical_score"])
        if old.get("score_kind") != "visual_complete":
            continue
        for key in ("sharpness", "composition", "light_color", "category_fit"):
            current["components"][key] = old_components.get(key)
        current["score"] = old.get("pilot_score")
        current["score_kind"] = "visual_complete"
        current["confidence"] = old.get("confidence") or "high"
        current["visual_reviewed_at"] = "2026-10-02T00:00:00Z"
        current["visual_note"] = old.get("note") or "Preserved from completed flower-pilot visual review."
        current["owner_review_required"] = (
            int(current["score"] or 0) <= OWNER_REVIEW_MAX_SCORE or current["material_problem"]
        )
        current["recommended_action"] = (
            "OWNER_REVIEW" if current["owner_review_required"] else "KEEP_CANDIDATE"
        )


def build_state(photos: list[dict], existing: dict | None = None, flower_scores: dict | None = None) -> dict:
    title_counts = Counter(normalized(p.get("title")) for p in photos if normalized(p.get("title")))
    filename_counts = Counter(normalized(p.get("filename")) for p in photos if normalized(p.get("filename")))

    items_by_id = {
        str(photo.get("id")): item_from_photo(photo, title_counts, filename_counts)
        for photo in photos
        if photo.get("id")
    }
    seed_flower_scores(items_by_id, flower_scores or {})

    for prior in (existing or {}).get("items", []):
        photo_id = str(prior.get("photo_id") or "")
        if photo_id not in items_by_id:
            continue
        if prior.get("score_kind") == "visual_complete":
            merged = items_by_id[photo_id]
            preserved = dict(prior)
            preserved.update({
                "title": merged["title"],
                "category": merged["category"],
                "filename": merged["filename"],
                "thumbnail": merged["thumbnail"],
                "width": merged["width"],
                "height": merged["height"],
            })
            items_by_id[photo_id] = preserved

    state = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "version": "portfolio-v1",
        "scope": "all_galleries",
        "policy": {
            "owner_review_max_score": OWNER_REVIEW_MAX_SCORE,
            "score_above_threshold_requires_owner_review": False,
            "automatic_delete": False,
            "automatic_hide_by_this_pipeline": False,
            "google_drive_master_archive_untouched": True,
            "visual_components_require_actual_vision_review": True,
        },
        "method": {
            "model": ANTHROPIC_MODEL,
            "visual_formula": "25% sharpness + 20% composition + 15% light/color + 15% resolution + 10% uniqueness + 10% category fit + 5% metadata",
            "technical_formula": "55% resolution + 30% uniqueness + 15% metadata",
            "low_resolution_review_threshold": {"long_edge": LOW_LONG_EDGE, "short_edge": LOW_SHORT_EDGE},
            "critical_resolution_flag_threshold": {"long_edge": CRITICAL_LONG_EDGE, "short_edge": CRITICAL_SHORT_EDGE},
        },
        "items": list(items_by_id.values()),
    }
    refresh_summary(state)
    return state


def refresh_summary(state: dict) -> None:
    items = state.get("items", [])
    visual = [x for x in items if x.get("score_kind") == "visual_complete"]
    pending = [x for x in items if x.get("score_kind") != "visual_complete"]
    owner_review = [x for x in visual if x.get("owner_review_required")]
    clear = [x for x in visual if not x.get("owner_review_required")]
    state["summary"] = {
        "total": len(items),
        "visual_complete": len(visual),
        "pending_visual": len(pending),
        "owner_review_required": len(owner_review),
        "auto_clear_above_85": len(clear),
        "critical_low_resolution": sum("critical_low_resolution" in (x.get("flags") or []) for x in items),
    }
    state["generated_at"] = datetime.now(timezone.utc).isoformat()


def save_state(state: dict) -> None:
    refresh_summary(state)
    OUT_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def apply_visual_result(item: dict, result: dict) -> None:
    item["components"]["sharpness"] = result["sharpness"]
    item["components"]["composition"] = result["composition"]
    item["components"]["light_color"] = result["light_color"]
    item["components"]["category_fit"] = result["category_fit"]
    item["visual_flags"] = result["visual_flags"]
    item["visual_note"] = result["note"]
    item["score"] = final_visual_score(item["components"])
    item["score_kind"] = "visual_complete"
    item["confidence"] = "high"
    item["visual_reviewed_at"] = datetime.now(timezone.utc).isoformat()
    item["owner_review_required"] = (
        item["score"] <= OWNER_REVIEW_MAX_SCORE or bool(item.get("material_problem"))
    )
    item["recommended_action"] = "OWNER_REVIEW" if item["owner_review_required"] else "KEEP_CANDIDATE"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch-size", type=int, default=200)
    parser.add_argument("--category", default="")
    parser.add_argument("--init-only", action="store_true")
    args = parser.parse_args()

    photos = load_json(PHOTOS_FILE, [])
    if not isinstance(photos, list) or not photos:
        raise SystemExit("data/photos.json is missing or empty")

    existing = load_json(OUT_FILE, {})
    flower_scores = load_json(FLOWER_SCORES_FILE, {})
    state = build_state(photos, existing, flower_scores)
    save_state(state)

    if args.init_only:
        print("initialized portfolio curation:", state["summary"])
        return 0

    api_key = re.sub(r"\s+", "", os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("AMIT_PHOTO_AGENT") or "")
    if not api_key:
        raise SystemExit("missing ANTHROPIC_API_KEY / AMIT_PHOTO_AGENT")

    photo_by_id = {str(p.get("id")): p for p in photos if p.get("id")}
    pending = [
        item for item in state["items"]
        if item.get("score_kind") != "visual_complete"
        and (not args.category or item.get("category") == args.category)
    ]
    pending.sort(key=lambda x: (
        0 if x.get("material_problem") else 1,
        str(x.get("category") or ""),
        str(x.get("photo_id") or ""),
    ))
    if args.batch_size > 0:
        pending = pending[:args.batch_size]

    completed = 0
    failures = 0
    for index, item in enumerate(pending, 1):
        photo = photo_by_id.get(str(item.get("photo_id")))
        if not photo:
            continue
        print(f"[{index}/{len(pending)}] {item.get('category')} — {item.get('title')}", flush=True)
        try:
            result = analyze_visual(photo, api_key)
            apply_visual_result(item, result)
            completed += 1
        except Exception as exc:
            failures += 1
            item["last_visual_error"] = str(exc)[:300]
            print(f"  ERROR: {exc}", flush=True)
        save_state(state)
        time.sleep(0.15)

    print("portfolio visual curation:", {
        "completed_this_run": completed,
        "failures": failures,
        **state["summary"],
    })
    return 0 if completed or not pending else 1


if __name__ == "__main__":
    raise SystemExit(main())
