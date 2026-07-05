import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

import zazzle_social_post as zsp


def test_get_products_parses_json_string():
    photo = {"id": "a", "zazzle_products": '[{"name": "Poster", "url": "http://x/1"}]'}
    result = zsp.get_products(photo)
    assert result == [{"name": "Poster", "url": "http://x/1"}]


def test_get_products_missing_field_returns_empty():
    assert zsp.get_products({"id": "a"}) == []


def test_get_products_empty_string_returns_empty():
    assert zsp.get_products({"id": "a", "zazzle_products": ""}) == []


def test_get_products_invalid_json_returns_empty():
    assert zsp.get_products({"id": "a", "zazzle_products": "not json"}) == []


def test_pick_photo_excludes_posted():
    photos = [
        {"id": "a", "title": "Photo A"},
        {"id": "b", "title": "Photo B"},
        {"id": "c", "title": "Photo C"},
    ]
    result = zsp.pick_photo(photos, posted_ids={"a", "b"})
    assert result["id"] == "c"


def test_pick_photo_resets_when_all_posted():
    photos = [{"id": "a", "title": "Photo A"}]
    result = zsp.pick_photo(photos, posted_ids={"a"})
    assert result["id"] == "a"


def test_pick_product_returns_one_of_the_list():
    products = [{"name": "Poster"}, {"name": "Mug"}, {"name": "Canvas"}]
    result = zsp.pick_product(products)
    assert result in products


def test_load_posted_missing_file(tmp_path, monkeypatch):
    posted_file = tmp_path / "zazzle_social_posted.json"
    monkeypatch.setattr(zsp, "POSTED_FILE", posted_file)
    result = zsp.load_posted()
    assert result == {"posted_ids": []}


def test_save_and_load_posted(tmp_path, monkeypatch):
    posted_file = tmp_path / "zazzle_social_posted.json"
    monkeypatch.setattr(zsp, "POSTED_FILE", posted_file)
    zsp.save_posted({"posted_ids": ["id1", "id2"]})
    result = zsp.load_posted()
    assert result == {"posted_ids": ["id1", "id2"]}
