import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

import ga_weekly_report as ga


def test_seconds_under_a_minute():
    assert ga.format_duration(45) == "45 שניות"


def test_exactly_one_minute():
    assert ga.format_duration(60) == "1:00 דקות"


def test_minutes_and_seconds():
    assert ga.format_duration(190) == "3:10 דקות"


def test_the_reported_bug_value_3071_seconds():
    # was rendered as "3071ש'" (looked like 3071 HOURS) — should be 51 min 11 sec
    assert ga.format_duration(3071) == "51:11 דקות"


def test_exactly_one_hour():
    assert ga.format_duration(3600) == "1:00 שעות"


def test_over_an_hour():
    assert ga.format_duration(3661) == "1:01 שעות"


def test_accepts_string_input_like_ga4_api_returns():
    assert ga.format_duration("45.0") == "45 שניות"


def test_zero():
    assert ga.format_duration(0) == "0 שניות"


def test_funnel_rate_normal_case():
    assert ga.funnel_rate(25, 100) == 25.0


def test_funnel_rate_rounds_to_one_decimal():
    assert ga.funnel_rate(1, 3) == 33.3


def test_funnel_rate_zero_denominator_returns_none():
    assert ga.funnel_rate(5, 0) is None


def test_funnel_rate_missing_values_return_none():
    assert ga.funnel_rate(None, 10) is None
    assert ga.funnel_rate("5", None) is None


def test_funnel_rate_non_numeric_string_returns_none():
    assert ga.funnel_rate("abc", "10") is None


def test_sample_size_note_below_threshold():
    assert ga.sample_size_note(5) == "⚠️ מדגם קטן מדי (5) להסקת מסקנות אמינות"


def test_sample_size_note_above_threshold_is_none():
    assert ga.sample_size_note(50) is None


def test_sample_size_note_handles_non_numeric():
    assert ga.sample_size_note("0") == "⚠️ מדגם קטן מדי (0) להסקת מסקנות אמינות"
