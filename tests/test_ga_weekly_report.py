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
        "funnel_events": {"photo_view": "10", "purchase_intent": "2", "add_size": "1", "purchase": "0",
                           "print_intent": "0", "print_type_selected": "0", "print_checkout": "0"},
        "revenue": revenue,
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
        "hero_gallery_click", "hero_guide_click", "journey_click", "nav_click", "gallery_filter",
        "scroll_25", "scroll_50", "scroll_75", "scroll_90",
        "generate_lead", "contact_intent", "contact_form_success",
        "language_change",
    } <= event_values


def test_save_report_persists_ux_dimensions_for_future_comparisons(tmp_path):
    reports_file = tmp_path / "ga_reports.json"
    gwr.save_report(fake_data(revenue=None), "analysis", reports_file=reports_file)

    report = json.loads(reports_file.read_text(encoding="utf-8"))[-1]
    assert report["devices"] == [{"מכשיר": "mobile", "sessions": "60"}]
    assert report["countries"] == [{"ארץ": "Israel", "sessions": "75"}]
    assert report["landing_pages"] == [{"עמוד נחיתה": "/", "sessions": "70"}]
    assert report["summary"]["newUsers"] == "50"
