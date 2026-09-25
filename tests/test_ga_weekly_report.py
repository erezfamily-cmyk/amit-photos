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
