from pathlib import Path
import importlib.util
import json
from unittest.mock import Mock

SCRIPT = Path(__file__).parent.parent / "src" / "sync_drive_curation.py"


def load_sync(monkeypatch, tmp_path):
    spec = importlib.util.spec_from_file_location("sync_under_test", SCRIPT)
    sync = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(sync)
    monkeypatch.setattr(sync, "STATE_FILE", tmp_path / "state.json")
    monkeypatch.setattr(sync, "LAST_SCAN_FILE", tmp_path / "last_scan.json")
    sync.LAST_SCAN_FILE.write_text('{}')
    sync.STATE_FILE.write_text(json.dumps({"version": 1, "hidden": {
        "photo": {"source_parent_id": "original"}
    }}))
    monkeypatch.setattr(sync, "fetch_decisions", lambda: {"photo": {"decision": "KEEP"}})
    monkeypatch.setattr(sync, "get_drive_session", lambda: (object(), {sync.DRIVE_SCOPE}))
    return sync


def test_restore_after_lost_push_reconciles_without_moving_again(monkeypatch, tmp_path):
    sync = load_sync(monkeypatch, tmp_path)
    monkeypatch.setattr(sync, "file_metadata", lambda *args: {"parents": ["original"]})
    move = Mock()
    monkeypatch.setattr(sync, "api_patch", move)
    assert sync.main() == 0
    move.assert_not_called()
    state = json.loads(sync.STATE_FILE.read_text())
    assert state["hidden"] == {}
    assert state["last_summary"]["reconciled"] == 1
    assert not sync.LAST_SCAN_FILE.exists()
    assert sync.main() == 0
    move.assert_not_called()


def test_restore_does_not_clear_state_for_unrelated_parent(monkeypatch, tmp_path):
    sync = load_sync(monkeypatch, tmp_path)
    monkeypatch.setattr(sync, "file_metadata", lambda *args: {"parents": ["elsewhere"]})
    move = Mock()
    monkeypatch.setattr(sync, "api_patch", move)
    assert sync.main() == 0
    assert "photo" in json.loads(sync.STATE_FILE.read_text())["hidden"]
    assert sync.LAST_SCAN_FILE.exists()
    move.assert_not_called()


def test_successful_restore_checkpoints_before_next_photo_failure(monkeypatch, tmp_path):
    import pytest
    sync = load_sync(monkeypatch, tmp_path)
    state = json.loads(sync.STATE_FILE.read_text())
    state["hidden"]["later"] = {"source_parent_id": "original"}
    sync.STATE_FILE.write_text(json.dumps(state))
    monkeypatch.setattr(sync, "file_metadata", lambda *args: {"parents": [sync.HIDDEN_FOLDER_ID]})
    move = Mock(side_effect=[{}, RuntimeError("Drive unavailable")])
    monkeypatch.setattr(sync, "api_patch", move)
    with pytest.raises(RuntimeError, match="Drive unavailable"):
        sync.main()
    persisted = json.loads(sync.STATE_FILE.read_text())["hidden"]
    assert "photo" not in persisted
    assert "later" in persisted
    assert not sync.LAST_SCAN_FILE.exists()


def test_empty_portfolio_env_falls_back_to_known_folder_id():
    text = SCRIPT.read_text(encoding="utf-8")
    assert 'DEFAULT_PORTFOLIO_FOLDER_ID = "1LpmT9PNKjCq5kb_GReuavkJPPbeMawMW"' in text
    assert '(os.environ.get("PORTFOLIO_FOLDER_ID") or DEFAULT_PORTFOLIO_FOLDER_ID).strip()' in text


def test_refresh_grant_does_not_resend_scope():
    text = SCRIPT.read_text(encoding="utf-8")
    assert '"grant_type": "refresh_token"' in text
    assert '"scope":' not in text
    assert "token_refreshed.json" in text


def test_drive_clients_do_not_downgrade_scope():
    root = SCRIPT.parent.parent
    for rel in ("src/agent_photos.py", "src/auto_import_new_photos.py"):
        text = (root / rel).read_text(encoding="utf-8")
        assert "drive.readonly" not in text
        assert 'https://www.googleapis.com/auth/drive' in text
        assert "creds.refresh(Request())" not in text
        assert '"grant_type": "refresh_token"' in text


def test_photo_agent_never_overwrites_refreshed_token_metadata():
    root = SCRIPT.parent.parent
    text = (root / "src/agent_photos.py").read_text(encoding="utf-8")
    assert "token_refreshed.json" not in text
