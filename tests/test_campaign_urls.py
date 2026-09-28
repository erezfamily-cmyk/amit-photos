import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from campaign_urls import build_campaign_url


def test_campaign_url_uses_consistent_organic_social_taxonomy():
    url = build_campaign_url(
        "/photo/photo-123",
        source="facebook",
        campaign="photo_posts",
        content="photo-123",
    )
    parsed = urlparse(url)
    query = parse_qs(parsed.query)

    assert parsed.scheme == "https"
    assert parsed.netloc == "amitphotos.com"
    assert parsed.path == "/photo/photo-123"
    assert query == {
        "utm_source": ["facebook"],
        "utm_medium": ["organic_social"],
        "utm_campaign": ["photo_posts"],
        "utm_content": ["photo-123"],
    }


def test_campaign_url_preserves_first_party_photo_parameters():
    url = build_campaign_url(
        "/",
        source="pinterest",
        campaign="gallery_pins",
        content="a b",
        params={"photo": "a b", "buy": "1"},
    )
    query = parse_qs(urlparse(url).query)

    assert query["photo"] == ["a b"]
    assert query["buy"] == ["1"]
    assert query["utm_source"] == ["pinterest"]
    assert query["utm_content"] == ["a b"]
