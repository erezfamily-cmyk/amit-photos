import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

import videos_utils


@pytest.fixture(autouse=False)
def restore_videos_file():
    original = videos_utils.VIDEOS_FILE
    yield
    videos_utils.VIDEOS_FILE = original


def test_update_video_id_he_existing_entry(tmp_path, restore_videos_file):
    f = tmp_path / "videos.json"
    f.write_text(json.dumps([
        {"id": "abc", "id_he": None, "type": "tutorial", "slug": "exposure", "platform": "youtube",
         "title_he": "חשיפה", "title_en": "Exposure", "summary_he": "", "summary_en": "", "date": "2026-01-01"}
    ], ensure_ascii=False), encoding="utf-8")
    videos_utils.VIDEOS_FILE = f

    videos_utils.update_video_id_he("exposure", "xyz789")

    result = json.loads(f.read_text(encoding="utf-8"))
    assert result[0]["id_he"] == "xyz789"


def test_update_video_id_he_creates_entry_if_missing(tmp_path, restore_videos_file):
    f = tmp_path / "videos.json"
    f.write_text("[]", encoding="utf-8")
    videos_utils.VIDEOS_FILE = f

    videos_utils.update_video_id_he("landscape", "he999")

    result = json.loads(f.read_text(encoding="utf-8"))
    assert len(result) == 1
    assert result[0]["slug"] == "landscape"
    assert result[0]["id_he"] == "he999"
    assert result[0]["id"] is None


def test_update_video_id_he_only_updates_tutorial_type(tmp_path, restore_videos_file):
    f = tmp_path / "videos.json"
    f.write_text(json.dumps([
        {"id": "gal1", "type": "gallery", "slug": "exposure", "platform": "youtube",
         "title_he": "", "title_en": "", "summary_he": "", "summary_en": "", "date": "2026-01-01"}
    ], ensure_ascii=False), encoding="utf-8")
    videos_utils.VIDEOS_FILE = f

    videos_utils.update_video_id_he("exposure", "xyz789")

    result = json.loads(f.read_text(encoding="utf-8"))
    # gallery entry untouched, new tutorial entry created
    assert len(result) == 2
    assert result[1]["type"] == "tutorial"
    assert result[1]["id_he"] == "xyz789"
