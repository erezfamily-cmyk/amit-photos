"""Read-only checks for social duplication and business signal quality.

Never changes publishing targets, checkout flags, or schedules. Events that are
missing from GA are observations, NOT proof of a broken CTA or lost purchase.
"""

from __future__ import annotations

import re
from collections import defaultdict

QUALIFIED_EVENTS = (
    "guide_request_success", "generate_lead", "contact_form_success",
    "photo_contact_click", "licensing_personal_interest",
    "licensing_commercial_contact", "b2b_contact_start",
)
CHECKOUT_EVENTS = (
    "purchase_intent", "add_size", "purchase", "print_intent",
    "print_type_selected", "print_checkout",
)


def _count(value):
    try:
        return max(0, int(float(value)))
    except (ValueError, TypeError):
        return 0


def facebook_duplicates(posts):
    """Same-day EXACT full normalized captions on distinct FB post IDs.

    Never compare only the 100-character excerpts in social_report.json.
    """
    groups = defaultdict(set)
    captions = {}
    for post in posts or []:
        text = re.sub(r"\s+", " ", (post.get("message") or "").strip()).casefold()
        post_id = str(post.get("id") or "")
        day = str(post.get("created_time") or "")[:10]
        if len(text) < 35 or not post_id or not day:
            continue
        key = (day, text)
        groups[key].add(post_id)
        captions[key] = text
    return [
        {"date": day, "post_ids": sorted(ids), "caption_excerpt": captions[(day, text)][:100],
         "status": "review_needed"}
        for (day, text), ids in sorted(groups.items()) if len(ids) > 1
    ]


def ga_business_signals(reports):
    """Interpret GA alongside *verified* checkout state, not only zero events."""
    entries = reports.get("reports", []) if isinstance(reports, dict) else reports
    entries = [r for r in (entries or []) if isinstance(r, dict) and isinstance(r.get("funnel_events"), dict)]
    last = entries[-3:]
    if not last:
        return {"status": "unavailable", "weeks": 0,
                "next_action": "Verify GA4 event query and report freshness before evaluating performance."}
    newest = last[-1]
    revenue = newest.get("revenue")
    enabled = revenue.get("payments_enabled") if isinstance(revenue, dict) else None
    checkout_state = "disabled" if enabled is False else "enabled" if enabled is True else "unknown"
    event_totals = {
        key: sum(_count(row["funnel_events"].get(key)) for row in last)
        for key in (*QUALIFIED_EVENTS, *CHECKOUT_EVENTS, "photo_view")
    }
    qualified = sum(event_totals[key] for key in QUALIFIED_EVENTS)
    checkout = sum(event_totals[key] for key in CHECKOUT_EVENTS)
    sessions = sum(_count(row.get("summary", {}).get("sessions")) for row in last)
    previous_checkout_observed = any(
        _count(row.get("funnel_events", {}).get(key)) > 0
        for row in entries[:-3] for key in CHECKOUT_EVENTS
    )
    if len(last) < 3:
        status = "insufficient_history"
        action = "Gather three comparable weekly GA reports; do not infer conversion changes yet."
    elif sessions == 0:
        status = "no_traffic_or_missing_collection"
        action = "Verify GA4 traffic measurement; no channel conclusion is possible."
    elif qualified == 0:
        status = "qualified_actions_unobserved"
        action = "Check non-checkout lead/licensing/contact events and user journeys in GA4 DebugView."
    else:
        status = "measuring"
        action = "Compare campaign-tagged visits with qualified actions before adjusting publishing volume."
    return {
        "status": status,
        "weeks": len(last),
        "sessions": sessions,
        "checkout_state": checkout_state,
        "checkout_events": checkout,
        "checkout_disappeared_after_prior_activity": bool(previous_checkout_observed and checkout == 0),
        "checkout_zero_interpretation": (
            "expected_while_disabled" if checkout_state == "disabled" and checkout == 0
            else "unknown_checkout_state" if checkout_state == "unknown" and checkout == 0
            else "observed"
        ),
        "qualified_action_events": qualified,
        "photo_views": event_totals["photo_view"],
        "qualified_event_counts": {key: event_totals[key] for key in QUALIFIED_EVENTS},
        "next_action": action,
        "data_limitations": (
            "No per-post conversions or verified platform attribution can be inferred "
            "from GA aggregate reports; absent events can mean no interactions or missing measurement."
        ),
    }


def build_social_business_audit(social_report, ga_reports):
    pages = social_report.get("fb_pages", []) or []
    duplicates = [
        {"page": p.get("name") or p.get("label") or "Facebook", **candidate}
        for p in pages for candidate in p.get("suspected_duplicates", [])
    ]
    fb_posts = sum(_count(p.get("posts_this_week")) for p in pages)
    return {
        "version": 1,
        "read_only": True,
        "facebook_posts_observed": fb_posts,
        "facebook_post_source_attribution": "unavailable",
        "source_note": (
            "Observed API feed totals cannot be reliably assigned to a workflow, "
            "manual upload or approval from existing data. Story/Reel deliveries are separate."
        ),
        "facebook_duplicate_candidates": duplicates,
        "ga": ga_business_signals(ga_reports),
        "publishing_recommendation": "Keep volume/targets unchanged until provenance and business signals are verified.",
    }
