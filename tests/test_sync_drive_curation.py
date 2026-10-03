from pathlib import Path

SCRIPT = Path(__file__).parent.parent / "src" / "sync_drive_curation.py"


def test_empty_portfolio_env_falls_back_to_known_folder_id():
    text = SCRIPT.read_text(encoding="utf-8")
    assert 'DEFAULT_PORTFOLIO_FOLDER_ID = "1LpmT9PNKjCq5kb_GReuavkJPPbeMawMW"' in text
    assert '(os.environ.get("PORTFOLIO_FOLDER_ID") or DEFAULT_PORTFOLIO_FOLDER_ID).strip()' in text


def test_refresh_grant_does_not_resend_scope():
    text = SCRIPT.read_text(encoding="utf-8")
    assert '"grant_type": "refresh_token"' in text
    assert '"scope":' not in text
    assert "token_refreshed.json" in text
