import sys
import json
from pathlib import Path
from unittest.mock import patch, MagicMock

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

import ga_weekly_report as gwr


def test_format_duration_uses_minutes_and_seconds():
    assert gwr.format_duration("3071") == "51:11 דקות"
    assert gwr.format_duration("45") == "45 שניות"


def fake_data(revenue=None):
    return {
        "period": "2026-09-19 → 2026-09-26",
        "summary": {"sessions": "100", "activeUsers": "80", "pageViews": "300",
                    "bounceRate": "40.0%", "avgSessionSec": "90", "newUsers": "50"},
        "prev_week": {"sessions": "90", "activeUsers": "70", "pageViews": "280"},
        "top_pages": [], "landing_pages": [{"עמוד נחיתה": "/", "sessions": "70"}],
        "sources": [], "devices": [{"מכשיר": "mobile", "sessions": "60"}],
        "countries": [{"ארץ": "Israel", "sessions": "75"}],
        "ux_by_page": [{"event": "contact_intent", "עמוד": "/learn/", "count": "3"}],
        "funnel_events": {"photo_view": "10", "purchase_intent": "2", "add_size": "1", "purchase": "0",
                           "print_intent": "0", "print_type_selected": "0", "print_checkout": "0"},
        "revenue": revenue,
        "campaigns": [],
        "experiment_events": [],
    }


def test_fetch_revenue_summary_returns_none_without_admin_password(monkeypatch):
    monkeypatch.setattr(gwr, "ADMIN_PASSWORD", "")
    assert gwr.fetch_revenue_summary() is None


def test_fetch_revenue_summary_returns_parsed_json_on_success(monkeypatch):
    monkeypatch.setattr(gwr, "ADMIN_PASSWORD", "secret")
    fake_resp = MagicMock(ok=True)
    fake_resp.json.return_value = {"payments_enabled": False, "digital": {"count": 0, "revenue_ils": 0},
                                    "print": {"by_status": [], "total_count": 0, "total_revenue_ils": 0}}
    with patch.object(gwr.requests, "get", return_value=fake_resp) as mock_get:
        result = gwr.fetch_revenue_summary(days=7)
    assert result["payments_enabled"] is False
    assert mock_get.call_args.kwargs["headers"] == {"X-Admin-Password": "secret"}
    assert mock_get.call_args.kwargs["params"] == {"days": 7}


def test_fetch_revenue_summary_returns_none_on_non_ok_response(monkeypatch):
    monkeypatch.setattr(gwr, "ADMIN_PASSWORD", "secret")
    fake_resp = MagicMock(ok=False, status_code=401, text="Unauthorized")
    with patch.object(gwr.requests, "get", return_value=fake_resp):
        assert gwr.fetch_revenue_summary() is None


def test_fetch_revenue_summary_returns_none_on_network_exception(monkeypatch):
    monkeypatch.setattr(gwr, "ADMIN_PASSWORD", "secret")
    with patch.object(gwr.requests, "get", side_effect=ConnectionError("boom")):
        assert gwr.fetch_revenue_summary() is None


def test_build_data_summary_shows_unavailable_when_revenue_is_none():
    summary = gwr.build_data_summary(fake_data(revenue=None))
    assert "לא זמין" in summary


def test_build_data_summary_shows_payments_disabled_state_and_verified_numbers():
    rev = {
        "payments_enabled": False,
        "digital": {"count": 3, "revenue_ils": 285},
        "print": {"by_status": [{"status": "shipped", "count": 1, "revenue": 250}],
                   "total_count": 1, "total_revenue_ils": 250},
    }
    summary = gwr.build_data_summary(fake_data(revenue=rev))
    assert "כבוי (PAYMENTS_ENABLED=false)" in summary
    assert "3" in summary and "₪285" in summary
    assert "shipped" in summary


def test_build_revenue_html_handles_none_gracefully():
    html = gwr.build_revenue_html(None, card=lambda label, value, prev="": f"[{label}:{value}]")
    assert "לא זמין" in html


def test_build_revenue_html_shows_enabled_status_and_figures():
    rev = {
        "payments_enabled": True,
        "digital": {"count": 5, "revenue_ils": 500},
        "print": {"by_status": [], "total_count": 2, "total_revenue_ils": 700},
    }
    html = gwr.build_revenue_html(rev, card=lambda label, value, prev="": f"[{label}:{value}]")
    assert "🟢 פעיל" in html
    assert "[רכישות דיגיטליות מאומתות:5]" in html
    assert "[הכנסת הדפסה:₪700]" in html


def test_generate_analysis_prompt_no_longer_hardcodes_the_stale_never_closed_a_print_order_claim():
    # regression: this used to assert as fact that the site "never closed a single print order",
    # baked permanently into the system prompt regardless of what's actually in D1 by now.
    import inspect
    source = inspect.getsource(gwr.generate_analysis)
    assert "מעולם" not in source
    assert "PAYMENTS_ENABLED" in source


def test_fetch_ga4_data_requests_landing_pages_engagement_and_ux_events():
    calls = []

    def fake_run_report(_token, body):
        calls.append(body)
        return {"rows": []}

    with patch.object(gwr, "run_report", side_effect=fake_run_report):
        result = gwr.fetch_ga4_data("token")

    assert "landing_pages" in result
    assert any(
        body.get("dimensions") == [{"name": "landingPagePlusQueryString"}]
        for body in calls
    )
    summary_metrics = {
        metric["name"]
        for body in calls if not body.get("dimensions")
        for metric in body.get("metrics", [])
    }
    assert {"engagementRate", "engagedSessions"} <= summary_metrics

    event_values = {
        value
        for body in calls
        for value in body.get("dimensionFilter", {}).get("filter", {}).get("inListFilter", {}).get("values", [])
    }
    assert {
        "hero_gallery_click", "hero_guide_click", "nav_click", "gallery_filter",
        "scroll_25", "scroll_50", "scroll_75", "scroll_90",
        "generate_lead", "contact_intent", "photo_contact_click", "contact_form_success",
        "language_change", "content_link_click", "nav_gallery_click", "nav_contact_click",
    } <= event_values
    assert any(
        body.get("dimensions") == [{"name": "eventName"}, {"name": "pagePath"}]
        for body in calls
    )


def test_save_report_persists_ux_dimensions_for_future_comparisons(tmp_path):
    reports_file = tmp_path / "ga_reports.json"
    gwr.save_report(fake_data(revenue=None), "analysis", reports_file=reports_file)

    report = json.loads(reports_file.read_text(encoding="utf-8"))[-1]
    assert report["devices"] == [{"מכשיר": "mobile", "sessions": "60"}]
    assert report["countries"] == [{"ארץ": "Israel", "sessions": "75"}]
    assert report["landing_pages"] == [{"עמוד נחיתה": "/", "sessions": "70"}]
    assert report["summary"]["newUsers"] == "50"
    assert report["ux_by_page"] == [{"event": "contact_intent", "עמוד": "/learn/", "count": "3"}]


def test_build_data_summary_exposes_ux_events_by_page():
    summary = gwr.build_data_summary(fake_data(revenue=None))
    assert "התנהגות לפי עמוד" in summary
    assert "/learn/" in summary
    assert "contact_intent" in summary


def test_fetch_ga4_data_requests_acquisition_campaign_event_attribution():
    calls = []

    def fake_run_report(_token, body):
        calls.append(body)
        return {"rows": []}

    with patch.object(gwr, "run_report", side_effect=fake_run_report):
        result = gwr.fetch_ga4_data("token")

    assert "experiment_events" in result
    matching = [
        body for body in calls
        if body.get("dimensions") == [{"name": "eventName"}, {"name": "sessionCampaignName"}]
    ]
    assert len(matching) == 1
    campaign_values = matching[0]["dimensionFilter"]["andGroup"]["expressions"][1]["filter"]["inListFilter"]["values"]
    assert set(campaign_values) == set(gwr.ACQUISITION_EXPERIMENT_CAMPAIGNS)


def test_acquisition_experiment_scorecard_attributes_primary_and_secondary_events():
    data = fake_data(revenue=None)
    data["campaigns"] = [
        {"source": "instagram", "medium": "social", "campaign": "202610_freeguide_photo_tips", "sessions": "10", "activeUsers": "8"},
        {"source": "threads", "medium": "social", "campaign": "202610_licensing_personal", "sessions": "5", "activeUsers": "4"},
    ]
    data["experiment_events"] = [
        {"campaign": "202610_freeguide_photo_tips", "event": "guide_request_success", "count": "4"},
        {"campaign": "202610_freeguide_photo_tips", "event": "generate_lead", "count": "2"},
        {"campaign": "202610_licensing_personal", "event": "licensing_personal_interest", "count": "1"},
    ]

    scorecard = gwr.build_acquisition_experiment_scorecard(data)
    by_campaign = {p["campaign"]: p for p in scorecard["paths"]}
    assert scorecard["window_status"] == "measuring"
    assert by_campaign["202610_freeguide_photo_tips"]["primary_count"] == 4
    assert by_campaign["202610_freeguide_photo_tips"]["primary_rate_pct"] == 40.0
    assert by_campaign["202610_freeguide_photo_tips"]["secondary_count"] == 2
    assert by_campaign["202610_b2b_outreach"]["status"] == "not_started"


def test_save_report_persists_acquisition_experiment_scorecard(tmp_path):
    reports_file = tmp_path / "ga_reports.json"
    data = fake_data(revenue=None)
    data["acquisition_experiment"] = gwr.build_acquisition_experiment_scorecard(data)
    gwr.save_report(data, "analysis", reports_file=reports_file)
    report = json.loads(reports_file.read_text(encoding="utf-8"))[-1]
    assert report["acquisition_experiment"]["experiment"] == "Acquisition Experiment 01"
    assert len(report["acquisition_experiment"]["paths"]) == 3


def test_scorecard_aggregates_campaign_sources_without_double_counting_users():
    data = fake_data()
    campaign = "202610_freeguide_photo_tips"
    data["campaigns"] = [
        {"source": "instagram", "campaign": campaign, "sessions": "4", "activeUsers": "4"},
        {"source": "free_guide", "campaign": campaign, "sessions": "1", "activeUsers": "1"},
    ]
    data["experiment_events"] = [{"campaign": campaign, "event": "guide_request_success", "count": "1"}]
    scorecard = gwr.build_acquisition_experiment_scorecard(data)
    guide = scorecard["paths"][0]
    assert guide["sessions"] == 5
    assert guide["primary_rate_pct"] == 20
    assert guide["active_users"] is None


def test_scorecard_uses_complete_campaign_totals_beyond_top_source_rows():
    data = fake_data()
    data["experiment_campaigns"] = [
        {"campaign": "202610_freeguide_photo_tips", "sessions": "5", "activeUsers": "4"},
        {"campaign": "202610_licensing_personal", "sessions": "2", "activeUsers": "1"},
    ]
    scorecard = gwr.build_acquisition_experiment_scorecard(data)
    assert scorecard["paths"][0]["sessions"] == 5
    assert scorecard["paths"][0]["active_users"] == 4
    assert scorecard["paths"][1]["sessions"] == 2
    assert scorecard["campaign_metrics_source"] == "campaign_totals"


def test_campaign_totals_query_and_persistence(tmp_path):
    campaign = "202610_freeguide_photo_tips"
    def fake_report(_token, body):
        if body.get("dimensions") == [{"name": "sessionCampaignName"}]:
            assert body["dimensionFilter"]["filter"]["inListFilter"]["values"] == list(gwr.ACQUISITION_EXPERIMENT_CAMPAIGNS)
            return {"rows": [{"dimensionValues": [{"value": campaign}], "metricValues": [{"value": "5"}, {"value": "4"}]}]}
        return {"rows": []}
    with patch.object(gwr, "run_report", side_effect=fake_report):
        data = gwr.fetch_ga4_data("token")
    target = tmp_path / "reports.json"
    gwr.save_report(data, "analysis", reports_file=target)
    report = json.loads(target.read_text())[-1]
    assert report["experiment_campaigns"][0]["activeUsers"] == "4"


def test_campaign_query_failure_falls_back_to_all_available_sources():
    def fake_report(_token, body):
        if body.get("dimensions") == [{"name": "sessionCampaignName"}]:
            return None
        return {"rows": []}
    with patch.object(gwr, "run_report", side_effect=fake_report):
        data = gwr.fetch_ga4_data("token")
    assert data["experiment_campaigns"] is None
    assert gwr.build_acquisition_experiment_scorecard(data)["campaign_metrics_source"] == "source_rows_fallback"


def test_qualified_event_attribution_by_source_is_queried_and_preserved():
    calls = []

    def fake_report(_token, body):
        calls.append(body)
        if body.get("dimensions") == [
            {"name": "eventName"}, {"name": "sessionSource"}, {"name": "sessionMedium"}
        ]:
            return {"rows": [{
                "dimensionValues": [{"value": "photo_contact_click"},
                                    {"value": "instagram"}, {"value": "social"}],
                "metricValues": [{"value": "2"}]
            }]}
        return {"rows": []}

    with patch.object(gwr, "run_report", side_effect=fake_report):
        result = gwr.fetch_ga4_data("token")

    assert result["qualified_source_status"] == "available"
    assert result["qualified_by_source"] == [
        {"event": "photo_contact_click", "source": "instagram",
         "medium": "social", "count": "2"}
    ]
    matching = [call for call in calls if call.get("dimensions") == [
        {"name": "eventName"}, {"name": "sessionSource"}, {"name": "sessionMedium"}
    ]]
    assert len(matching) == 1
    assert set(matching[0]["dimensionFilter"]["filter"]["inListFilter"]["values"]) == set(gwr.QUALIFIED_EVENTS)


def test_qualified_event_query_failure_is_not_reported_as_zero():
    def fake_report(_token, body):
        if body.get("dimensions") == [
            {"name": "eventName"}, {"name": "sessionSource"}, {"name": "sessionMedium"}
        ]:
            return None
        return {"rows": []}

    with patch.object(gwr, "run_report", side_effect=fake_report):
        result = gwr.fetch_ga4_data("token")
    assert result["qualified_source_status"] == "unavailable"
    assert "לא זמין" in gwr.build_qualified_channel_html(result)


def test_qualified_channel_html_escapes_values_and_report_persists(tmp_path):
    data = fake_data()
    data["qualified_by_source"] = [{
        "event": "guide_request_success",
        "source": "<img src=x onerror=alert(1)>",
        "medium": "social", "count": "3",
    }]
    data["qualified_source_status"] = "available"
    html = gwr.build_qualified_channel_html(data)
    assert "&lt;img" in html
    assert "<img" not in html
    assert "לא במספר לידים ייחודיים" in html
    target = tmp_path / "ga_reports.json"
    gwr.save_report(data, "analysis", reports_file=target)
    saved = json.loads(target.read_text(encoding="utf-8"))[-1]
    assert saved["qualified_by_source"] == data["qualified_by_source"]
    assert saved["qualified_source_status"] == "available"
