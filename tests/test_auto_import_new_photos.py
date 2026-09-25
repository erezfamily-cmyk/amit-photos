import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

import auto_import_new_photos as aip


def test_new_photo_included_even_if_title_matches_existing_d1_title():
    # Two different Drive photos that happen to share an AI-generated title must
    # both import — title must never be used to decide "already exists".
    photos_json = [{"id": "drive_2", "title": "נוף הרים", "url": "https://drive.google.com/x"}]
    result = aip.filter_new_photos(photos_json, d1_ids={"drive_1"}, d1_filenames=set())
    assert [p["id"] for p in result] == ["drive_2"]


def test_existing_drive_id_excluded():
    photos_json = [{"id": "drive_1", "title": "נוף הרים", "url": "https://drive.google.com/x"}]
    result = aip.filter_new_photos(photos_json, d1_ids={"drive_1"}, d1_filenames=set())
    assert result == []


def test_filename_match_does_not_block_import(capsys):
    # filename can only warn, never exclude a photo with a genuinely new Drive ID
    photos_json = [{"id": "drive_2", "filename": "IMG_001.jpg", "url": "https://drive.google.com/x"}]
    result = aip.filter_new_photos(photos_json, d1_ids=set(), d1_filenames={"IMG_001.jpg"})
    assert [p["id"] for p in result] == ["drive_2"]
    assert "IMG_001.jpg" in capsys.readouterr().out


def test_non_drive_urls_excluded():
    photos_json = [{"id": "x", "url": "https://amitphotos.com/photos/x.webp"}]
    assert aip.filter_new_photos(photos_json, d1_ids=set(), d1_filenames=set()) == []


def test_missing_id_excluded():
    photos_json = [{"url": "https://drive.google.com/x"}]
    assert aip.filter_new_photos(photos_json, d1_ids=set(), d1_filenames=set()) == []


def test_main_exits_nonzero_when_a_photo_fails_to_import(tmp_path, monkeypatch):
    # Regression test: previously the script printed "✗ N שגיאות" and still exited 0,
    # so a fully-failed CI run looked green.
    photos_json_path = tmp_path / "photos.json"
    photos_json_path.write_text(json.dumps([
        {"id": "new_drive_id", "title": "x", "url": "https://drive.google.com/x", "filename": "a.jpg"}
    ]), encoding="utf-8")

    monkeypatch.setattr(aip, "PHOTOS_JSON", photos_json_path)
    monkeypatch.setattr(aip, "get_drive_session", lambda: object())

    def failing_download(session, drive_id):
        raise RuntimeError("boom")
    monkeypatch.setattr(aip, "download", failing_download)

    class FakeResp:
        def json(self):
            return []  # D1 empty — the one photo counts as new
    monkeypatch.setattr(aip.requests, "get", lambda *a, **k: FakeResp())
    monkeypatch.setattr(sys, "argv", ["auto_import_new_photos.py", "--dry-run"])

    with pytest.raises(SystemExit) as exc_info:
        aip.main()
    assert exc_info.value.code == 1


def test_main_exits_zero_when_no_errors(tmp_path, monkeypatch):
    photos_json_path = tmp_path / "photos.json"
    photos_json_path.write_text(json.dumps([]), encoding="utf-8")  # no new photos at all

    monkeypatch.setattr(aip, "PHOTOS_JSON", photos_json_path)

    class FakeResp:
        def json(self):
            return []
    monkeypatch.setattr(aip.requests, "get", lambda *a, **k: FakeResp())
    monkeypatch.setattr(sys, "argv", ["auto_import_new_photos.py", "--dry-run"])

    aip.main()  # should return normally, no SystemExit
