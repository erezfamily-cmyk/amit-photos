import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from social_business_audit import (
    facebook_duplicates, ga_business_signals, build_social_business_audit,
)


def ga_week(*, sessions=50, events=None, enabled=None):
    return {"summary": {"sessions": str(sessions)}, "funnel_events": events or {},
            "revenue": None if enabled is None else {"payments_enabled": enabled}}


def test_duplicates_require_full_matching_caption_same_day_and_different_ids():
    txt = "A photo of an alpine lake and a long evening exposure."
    posts = [
        {"id": "1", "created_time": "2026-10-16T10:00:00Z", "message": txt},
        {"id": "2", "created_time": "2026-10-16T11:00:00Z",
         "message": "A photo of an alpine lake and a long evening exposure.  "},
        {"id": "3", "created_time": "2026-10-17T11:00:00Z", "message": txt},
        {"id": "4", "created_time": "2026-10-16T11:00:00Z", "message": txt[:25]},
    ]
    assert facebook_duplicates(posts) == [
        {"date": "2026-10-16", "post_ids": ["1", "2"],
         "caption_excerpt": txt.casefold(), "status": "review_needed"}
    ]


def test_zero_checkout_while_off_not_automatically_a_tracking_failure():
    history = [ga_week(events={"purchase_intent": 4}, enabled=False)] + [
        ga_week(events={"photo_view": 3, "photo_contact_click": 1}, enabled=False)
        for _ in range(3)
    ]
    result = ga_business_signals(history)
    assert result["checkout_disappeared_after_prior_activity"]
    assert result["checkout_zero_interpretation"] == "expected_while_disabled"
    assert result["status"] == "measuring"


def test_qualified_actions_absent_is_not_proof_event_instrumentation_broken():
    result = ga_business_signals([ga_week(events={"photo_view": 2}) for _ in range(3)])
    assert result["status"] == "qualified_actions_unobserved"
    assert result["checkout_state"] == "unknown"
    assert "absent events" in result["data_limitations"]


def test_no_traffic_unavailable_history_and_read_only_audit():
    assert ga_business_signals([])["status"] == "unavailable"
    assert ga_business_signals(
        [ga_week(sessions=0) for _ in range(3)]
    )["status"] == "no_traffic_or_missing_collection"
    report = {"fb_pages": [{"name": "Main", "posts_this_week": 12,
               "suspected_duplicates": [{"date": "2026-10-16",
                                         "post_ids": ["a", "b"]}]}]}
    audit = build_social_business_audit(report, [ga_week() for _ in range(3)])
    assert audit["read_only"] is True
    assert audit["facebook_posts_observed"] == 12
    assert len(audit["facebook_duplicate_candidates"]) == 1
    assert audit["facebook_post_source_attribution"] == "unavailable"
