import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))
import social_caption_quality as quality
import instagram_post as ig
import facebook_post as fb


def message(text, stop_reason="end_turn"):
    return SimpleNamespace(stop_reason=stop_reason, content=[SimpleNamespace(type="text", text=text)])


@pytest.mark.parametrize("text", ["", "#amitphotos #amitphotos", "https://amitphotos.com/ #צילום"])
def test_publish_rejects_empty_or_hashtag_only_caption_before_network(text):
    with patch.object(ig.requests, "post") as post, patch.object(ig.requests, "get") as get:
        with pytest.raises(ValueError):
            ig.post_to_instagram({"id": "photo-1"}, text)
        with pytest.raises(ValueError):
            fb.post_to_facebook({"id": "photo-1"}, text)
    post.assert_not_called()
    get.assert_not_called()


def test_truncated_model_response_uses_complete_fallback():
    assert quality.generated_body(message("בחרתי זווית נמוכה כדי שה", "max_tokens"), "צילום שלי מתוך הגלריה.") == "צילום שלי מתוך הגלריה."


def test_empty_text_blocks_are_not_mistaken_for_a_caption():
    msg = SimpleNamespace(stop_reason="end_turn", content=[SimpleNamespace(type="thinking", thinking="private")])
    assert quality.generated_body(msg, "צילום שלי מתוך הגלריה.") == "צילום שלי מתוך הגלריה."


def test_long_caption_keeps_complete_sentence_and_link():
    body = "האור מדגיש את הפרטים בתמונה. " * 120
    caption = quality.compose_caption(body, "התמונה בגלריה: https://amitphotos.com/photo/one", "#צילום #צילום #amitphotos", "צילום שלי מתוך הגלריה.")
    assert len(caption) <= 2200
    assert caption.split("\n\n")[0].endswith(".")
    assert "https://amitphotos.com/photo/one" in caption
    assert caption.count("#צילום") == 1


@pytest.mark.parametrize("module", [ig, fb])
def test_generation_does_not_publish_truncated_prose_or_purchase_claim(module):
    photo = {"id": "photo-1", "title": "פרח בשמש", "category": "טבע"}
    client = MagicMock()
    client.messages.create.return_value = message("המשפט נחתך באמצ", "max_tokens")
    with patch.object(module.anthropic, "Anthropic", return_value=client), \
         patch.object(module, "fetch_image_as_base64", return_value=("image", "image/jpeg")), \
         patch.object(module.random, "random", return_value=1):
        caption = module.generate_caption(photo)
    assert "המשפט נחתך" not in caption
    assert "פרח בשמש" in caption
    assert "/photo/photo-1?" in caption
    assert f"utm_source={'instagram' if module is ig else 'facebook'}" in caption
    assert "זמין לרכישה" not in caption
    assert "🛍️" not in caption


@pytest.mark.parametrize("module", [ig, fb])
def test_pdf_promo_always_has_complete_tagged_guide_link(module):
    photo = {"id": "photo-1", "title": "פרח בשמש", "category": "טבע"}
    client = MagicMock()
    client.messages.create.return_value = message("#amitphotos #amitphotos")
    args = (photo, client, [], "פרח") if module is ig else (photo, client, [])
    caption = module.generate_pdf_promo_caption(*args)
    assert "פרח בשמש" in caption
    assert "/free-guide/?" in caption
    assert "utm_campaign=202610_freeguide_photo_tips" in caption


def test_reel_validation_blocks_hashtag_only_caption_before_network():
    # reel_post configures console encoding on import; wrap pytest's streams.
    with patch("sys.stdout", MagicMock(wraps=sys.stdout)), patch("sys.stderr", MagicMock(wraps=sys.stderr)):
        import reel_post
    with patch("requests.post") as post:
        with pytest.raises(ValueError):
            reel_post._publish_ig("https://example.com/approved.mp4", "#amitphotos #amitphotos")
    post.assert_not_called()
    with patch.object(reel_post, "ANTHROPIC_API_KEY", ""):
        caption = reel_post.generate_reel_caption("טבע", "he")
    assert "טבע" in caption
    assert quality.has_caption_body(caption)
