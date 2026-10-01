#!/usr/bin/env python3
"""Build a conservative, data-driven shortlist of strong photos.

This report is advisory only. It never reorders the public gallery.
"""

import json
import math
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).parent.parent
GA_FILE = ROOT / "data" / "ga_reports.json"
SOCIAL_FILE = ROOT / "data" / "social_report.json"
PHOTOS_FILE = ROOT / "data" / "photos.json"
OUT_FILE = ROOT / "data" / "photo_strength_report.json"


def load_json(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default
    except Exception:
        return default


def num(value):
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def log_normalize(values):
    if not values:
        return {}
    logged = {k: math.log1p(max(0.0, v)) for k, v in values.items()}
    peak = max(logged.values(), default=0.0)
    if peak <= 0:
        return {k: 0.0 for k in logged}
    return {k: v / peak for k, v in logged.items()}


def build_report():
    reports = load_json(GA_FILE, [])
    social = load_json(SOCIAL_FILE, {})
    photos = load_json(PHOTOS_FILE, [])
    photo_meta = {str(p.get("id")): p for p in photos if p.get("id")}

    latest = reports[-1] if isinstance(reports, list) and reports else {}
    analytics = latest.get("photo_analytics") or {}

    views = {str(r.get("photo_id")): num(r.get("count")) for r in analytics.get("views", []) if r.get("photo_id")}
    intents = {str(r.get("photo_id")): num(r.get("count")) for r in analytics.get("intents", []) if r.get("photo_id")}
    purchases = {str(r.get("photo_id")): num(r.get("count")) for r in analytics.get("purchases", []) if r.get("photo_id")}

    social_signal = {}
    social_posts = {}

    def add_social(row, platform, extra=0.0):
        photo_id = str(row.get("photo_id") or "")
        if not photo_id:
            return
        likes = num(row.get("likes"))
        comments = num(row.get("comments"))
        signal = likes + 2 * comments + extra
        social_signal[photo_id] = social_signal.get(photo_id, 0.0) + signal
        social_posts[photo_id] = social_posts.get(photo_id, 0) + 1

    for row in (social.get("ig", {}).get("photo_performance") or []):
        add_social(row, "instagram")
    for page in social.get("fb_pages") or []:
        for row in page.get("photo_performance") or []:
            add_social(row, "facebook")
    for row in (social.get("reels", {}).get("top_reels") or []):
        extra = (
            num(row.get("plays")) * 0.02
            + num(row.get("reach")) * 0.02
            + num(row.get("shares")) * 2
            + num(row.get("saved")) * 2
        )
        add_social(row, "instagram_reel", extra=extra)

    ids = set(views) | set(intents) | set(purchases) | set(social_signal)
    if not ids:
        return {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "source_period": latest.get("period"),
            "status": "waiting_for_mapped_data",
            "note": "No per-photo mapped analytics are available yet. Do not rank photos from aggregate data.",
            "ranked": [],
        }

    view_norm = log_normalize(views)
    intent_signal = {
        photo_id: intents.get(photo_id, 0) * 3 + purchases.get(photo_id, 0) * 10
        for photo_id in ids
    }
    intent_norm = log_normalize(intent_signal)
    social_norm = log_normalize(social_signal)

    ranked = []
    for photo_id in ids:
        v = views.get(photo_id, 0)
        i = intents.get(photo_id, 0)
        p = purchases.get(photo_id, 0)
        social = social_signal.get(photo_id, 0)
        samples = v + i * 2 + social_posts.get(photo_id, 0) * 2

        if samples >= 20:
            confidence = "high"
            confidence_factor = 1.0
        elif samples >= 7:
            confidence = "medium"
            confidence_factor = 0.88
        else:
            confidence = "low"
            confidence_factor = 0.70

        raw_score = (
            0.45 * view_norm.get(photo_id, 0)
            + 0.35 * intent_norm.get(photo_id, 0)
            + 0.20 * social_norm.get(photo_id, 0)
        ) * 100
        score = round(raw_score * confidence_factor, 1)

        reasons = []
        if v:
            reasons.append(f"{int(v)} views / 30d")
        if i:
            reasons.append(f"{int(i)} purchase intents")
        if p:
            reasons.append(f"{int(p)} verified print purchases")
        if social:
            reasons.append(f"social signal {social:.1f}")
        if confidence == "low":
            reasons.append("sample still small")

        meta = photo_meta.get(photo_id, {})
        ranked.append({
            "photo_id": photo_id,
            "title": meta.get("title") or "",
            "category": meta.get("category") or "",
            "score": score,
            "confidence": confidence,
            "views_30d": int(v),
            "purchase_intents_30d": int(i),
            "verified_print_purchases_30d": int(p),
            "social_signal_7d": round(social, 1),
            "mapped_social_posts_7d": social_posts.get(photo_id, 0),
            "eligible_for_featured_review": confidence in ("medium", "high") and (v >= 3 or social_posts.get(photo_id, 0) >= 2),
            "reasons": reasons,
        })

    ranked.sort(key=lambda row: (row["score"], row["views_30d"]), reverse=True)
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_period": latest.get("period"),
        "window_days": analytics.get("window_days", 30),
        "method": {
            "website_views_weight": 0.45,
            "high_intent_weight": 0.35,
            "social_weight": 0.20,
            "confidence_penalty": True,
            "auto_reorder_public_gallery": False,
        },
        "status": "ready",
        "ranked": ranked[:30],
        "featured_review_shortlist": [r for r in ranked if r["eligible_for_featured_review"]][:12],
    }


def main():
    report = build_report()
    OUT_FILE.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"photo strength report: {report.get('status')} — {len(report.get('ranked', []))} ranked")


if __name__ == "__main__":
    main()
