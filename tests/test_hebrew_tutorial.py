import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

import videos_utils
import youtube_tutorial


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


def test_extract_hebrew_sections_returns_list(tmp_path):
    html = '''<html><body>
      <p data-he="עומק שדה קובע כמה הרקע מטושטש בתמונה שלך. שלושה גורמים שולטים בו." data-en="Depth of field determines blur."></p>
      <p data-he="f/1.4 יתן בוקה בולט — f/11 ישמור הכל חד. הבן את הפשרות." data-en="f/1.4 bokeh."></p>
      <p data-he="←" data-en="←"></p>
    </body></html>'''
    guide_dir = tmp_path / "camera" / "depth-of-field"
    guide_dir.mkdir(parents=True)
    (guide_dir / "index.html").write_text(html, encoding="utf-8")

    original_root = youtube_tutorial.ROOT
    youtube_tutorial.ROOT = tmp_path
    try:
        sections = youtube_tutorial.extract_hebrew_sections("depth-of-field")
    finally:
        youtube_tutorial.ROOT = original_root

    assert len(sections) == 2
    assert all(len(s) >= 40 for s in sections)


def test_extract_hebrew_sections_skips_ui_text(tmp_path):
    html = '''<html><body>
      <p data-he="ראה באדוראמה ←" data-en="View at Adorama"></p>
      <p data-he="קנה לי קפה ותמוך ביצירת תוכן איכותי לצלמים ישראלים" data-en="Buy me coffee"></p>
      <p data-he="מדריך מלא ומפורט על עומק שדה, בוקה וצמצם בצילום." data-en="Full guide."></p>
    </body></html>'''
    guide_dir = tmp_path / "camera" / "focus"
    guide_dir.mkdir(parents=True)
    (guide_dir / "index.html").write_text(html, encoding="utf-8")

    original_root = youtube_tutorial.ROOT
    youtube_tutorial.ROOT = tmp_path
    try:
        sections = youtube_tutorial.extract_hebrew_sections("focus")
    finally:
        youtube_tutorial.ROOT = original_root

    assert len(sections) == 1
    assert "מדריך" in sections[0]


def test_build_hebrew_narration_script_contains_slug_title():
    sections = ["עומק שדה קובע כמה הרקע מטושטש.", "f/1.4 נותן בוקה בולט."]
    script = youtube_tutorial.build_hebrew_narration_script("exposure", sections, "חשיפה")
    assert "חשיפה" in script
    assert "עמית" in script
    assert "amitphotos.com" in script
