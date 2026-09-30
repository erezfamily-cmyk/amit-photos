import json
import sys
from pathlib import Path

import pytest
import requests

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

import agent_photos as ap


# 26.9-30.9.2026: the same script-mixing corruption bug (a Hebrew word truncated and spliced
# with a fragment of an English/Chinese/Arabic/Cyrillic word, e.g. "קactus" instead of "קקטוס",
# "שומGuards" instead of "שומרים") kept recurring in Drive-imported photos, because
# analyze_with_claude() accepted whatever title/description Claude Vision returned with zero
# validation. worker.js's generateHebrewTitle() (used for admin uploads) already rejects any
# non-Hebrew character and returns null — agent_photos.py had no equivalent guard at all.

def test_is_clean_hebrew_text_accepts_real_hebrew_with_common_punctuation():
    assert ap.is_clean_hebrew_text("הרים מושלגים בגאורגיה")
    assert ap.is_clean_hebrew_text("שלום, עולם - זהו טקסט תקין.")


@pytest.mark.parametrize("bad", [
    "קactus",             # Hebrew word truncated + spliced with a Latin fragment
    "שומGuards",           # same pattern, different word
    "פרח על 茎ירוק",        # Chinese character spliced into a Hebrew sentence
    "맑은 שמיים",           # Korean spliced in
    "باروקי סגנון",         # Arabic spliced in
    "взлет של מטוס",       # Cyrillic spliced in
    "",                    # empty string is not usable as a title
    None,                  # missing entirely
])
def test_is_clean_hebrew_text_rejects_script_mixing_and_empty(bad):
    assert not ap.is_clean_hebrew_text(bad)


class _Resp:
    def __init__(self, payload):
        self._payload = payload
        self.status_code = 200

    def raise_for_status(self):
        pass

    def json(self):
        return {"content": [{"text": json.dumps(self._payload, ensure_ascii=False)}]}


def test_analyze_with_claude_retries_past_a_corrupted_response_and_keeps_the_clean_one(monkeypatch):
    responses = [
        {"title": "קactus ירוק", "description": "תקריב של קactus", "copyright_risk": False, "copyright_reason": ""},
        {"title": "קקטוס ירוק", "description": "תקריב יפה של קקטוס במדבר", "copyright_risk": False, "copyright_reason": ""},
    ]
    calls = []

    def fake_post(*args, **kwargs):
        calls.append(1)
        return _Resp(responses[len(calls) - 1])

    monkeypatch.setattr(requests, "post", fake_post)
    monkeypatch.setattr(ap.time, "sleep", lambda *_: None)

    title, description, risk, reason = ap.analyze_with_claude(b"fake-bytes", "DSC_0001.jpg", "צילום מופשט", "fake-key")

    assert len(calls) == 2, "must retry once after the corrupted first response"
    assert title == "קקטוס ירוק"
    assert description == "תקריב יפה של קקטוס במדבר"


def test_analyze_with_claude_falls_back_to_filename_if_every_attempt_stays_corrupted(monkeypatch):
    corrupted = {"title": "שומGuards בגאורגיה", "description": "", "copyright_risk": False, "copyright_reason": ""}

    def fake_post(*args, **kwargs):
        return _Resp(corrupted)

    monkeypatch.setattr(requests, "post", fake_post)
    monkeypatch.setattr(ap.time, "sleep", lambda *_: None)

    title, description, risk, reason = ap.analyze_with_claude(b"fake-bytes", "DSC_0002.jpg", "גאורגיה", "fake-key")

    # must NOT propagate the corrupted title into photos.json — falls back to the filename stem instead
    assert title == "DSC_0002"
    assert description == ""
