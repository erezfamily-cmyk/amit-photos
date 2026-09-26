import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

import fetch_photos as fp


class FakeSession:
    """Records drive_get-style calls without hitting the network."""
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


def test_find_folder_returns_single_match(monkeypatch):
    monkeypatch.setattr(fp, "drive_get", fake_drive_get)
    session = FakeSession(files_response=[{"id": "abc", "name": "Portfolio"}])
    result = fp.find_folder(session, "Portfolio")
    assert result == {"id": "abc", "name": "Portfolio"}


def test_find_folder_raises_on_multiple_matches(monkeypatch):
    monkeypatch.setattr(fp, "drive_get", fake_drive_get)
    session = FakeSession(files_response=[
        {"id": "abc", "name": "Portfolio"},
        {"id": "xyz", "name": "Portfolio"},
    ])
    with pytest.raises(RuntimeError, match="2 תיקיות"):
        fp.find_folder(session, "Portfolio")


def test_find_folder_returns_none_when_no_match(monkeypatch):
    monkeypatch.setattr(fp, "drive_get", fake_drive_get)
    session = FakeSession(files_response=[])
    assert fp.find_folder(session, "Portfolio") is None


def test_resolve_portfolio_folder_uses_id_when_configured(monkeypatch):
    monkeypatch.setattr(fp, "drive_get", fake_drive_get)
    monkeypatch.setattr(fp, "PORTFOLIO_FOLDER_ID", "explicit-id-123")
    session = FakeSession(by_id_response={"id": "explicit-id-123", "name": "Portfolio"})
    result = fp.resolve_portfolio_folder(session)
    assert result == {"id": "explicit-id-123", "name": "Portfolio"}
    # must NOT have done a name-based search at all
    assert all(call[0] != "files" for call in session.calls)


def test_resolve_portfolio_folder_falls_back_to_name_search(monkeypatch):
    monkeypatch.setattr(fp, "drive_get", fake_drive_get)
    monkeypatch.setattr(fp, "PORTFOLIO_FOLDER_ID", "")
    session = FakeSession(files_response=[{"id": "abc", "name": "Portfolio"}])
    result = fp.resolve_portfolio_folder(session)
    assert result == {"id": "abc", "name": "Portfolio"}
