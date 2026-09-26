import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

import agent_photos as ap


class FakeSession:
    def __init__(self, files_response=None, by_id_response=None):
        self.files_response = files_response or []
        self.by_id_response = by_id_response
        self.calls = []


def fake_drive_get(session, endpoint, params=None):
    session.calls.append((endpoint, params))
    if endpoint == "files":
        return {"files": session.files_response}
    if endpoint.startswith("files/"):
        return session.by_id_response
    raise AssertionError(f"unexpected endpoint {endpoint}")


def test_find_folder_raises_on_multiple_matches(monkeypatch):
    monkeypatch.setattr(ap, "drive_get", fake_drive_get)
    session = FakeSession(files_response=[
        {"id": "abc", "name": "Portfolio"},
        {"id": "xyz", "name": "Portfolio"},
    ])
    with pytest.raises(RuntimeError, match="2 "):
        ap.find_folder(session, "Portfolio")


def test_resolve_portfolio_folder_uses_id_when_configured(monkeypatch):
    monkeypatch.setattr(ap, "drive_get", fake_drive_get)
    monkeypatch.setattr(ap, "PORTFOLIO_FOLDER_ID", "explicit-id-123")
    session = FakeSession(by_id_response={"id": "explicit-id-123", "name": "Portfolio"})
    result = ap.resolve_portfolio_folder(session)
    assert result == {"id": "explicit-id-123", "name": "Portfolio"}
    assert all(call[0] != "files" for call in session.calls)


def test_resolve_portfolio_folder_falls_back_to_name_search(monkeypatch):
    monkeypatch.setattr(ap, "drive_get", fake_drive_get)
    monkeypatch.setattr(ap, "PORTFOLIO_FOLDER_ID", "")
    session = FakeSession(files_response=[{"id": "abc", "name": "Portfolio"}])
    result = ap.resolve_portfolio_folder(session)
    assert result == {"id": "abc", "name": "Portfolio"}
