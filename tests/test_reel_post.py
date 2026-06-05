import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

import reel_post


def test_pick_photo_excludes_posted():
    photos = [
        {"id": "a", "title": "Photo A", "thumbnail": "http://x.com/a.jpg"},
        {"id": "b", "title": "Photo B", "thumbnail": "http://x.com/b.jpg"},
        {"id": "c", "title": "Photo C", "thumbnail": "http://x.com/c.jpg"},
    ]
    posted = ["a", "b"]
    result = reel_post.pick_photo(photos, posted)
    assert result["id"] == "c"


def test_pick_photo_resets_when_all_posted():
    photos = [
        {"id": "a", "title": "Photo A", "thumbnail": "http://x.com/a.jpg"},
    ]
    posted = ["a"]
    result = reel_post.pick_photo(photos, posted)
    assert result["id"] == "a"


def test_load_posted_missing_file(tmp_path):
    posted_file = tmp_path / "reels_posted.json"
    result = reel_post.load_posted(posted_file)
    assert result == []


def test_save_and_load_posted(tmp_path):
    posted_file = tmp_path / "reels_posted.json"
    reel_post.save_posted(["id1", "id2"], posted_file)
    result = reel_post.load_posted(posted_file)
    assert result == ["id1", "id2"]
