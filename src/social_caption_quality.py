"""Keep generated social captions complete and validate before publishing."""

import re

MAX_CAPTION_CHARS = 2200


def has_caption_body(text):
    if not isinstance(text, str):
        return False
    body = re.sub(r"https?://\S+|\b(?:www\.)?amitphotos\.com\S*|#[^\s#]+", "", text)
    return sum(ch.isalpha() for ch in body) >= 12


def require_caption(text, max_chars=MAX_CAPTION_CHARS):
    if not has_caption_body(text) or len(text) > max_chars:
        raise ValueError(f"Caption must contain readable text and fit within {max_chars} characters")
    return text


def photo_fallback(photo, lang="he"):
    title = str(photo.get("title") or photo.get("category") or "").strip()
    if lang == "he":
        return f"צילום שלי מהגלריה: {title}." if title else "צילום שלי מתוך הגלריה באתר."
    return f"From my photography gallery: {title}." if title else "A photograph from my gallery."


def generated_body(message, fallback):
    # max_tokens can leave a plausible-looking sentence cut in the middle.
    if getattr(message, "stop_reason", None) != "end_turn":
        return fallback
    text = "\n".join(
        block.text for block in getattr(message, "content", [])
        if getattr(block, "type", None) == "text"
    ).strip()
    return text if has_caption_body(text) else fallback


def compose_caption(body, footer, hashtags, fallback, max_chars=MAX_CAPTION_CHARS):
    """Preserve the complete CTA; trim only at a complete sentence boundary."""
    # Deduplicate hashtags without changing their order.
    tags = " ".join(dict.fromkeys(hashtags.split()))
    suffix = f"\n\n{footer.strip()}\n\n{tags}".rstrip()
    budget = max_chars - len(suffix)
    if budget <= 0:
        raise ValueError(f"Caption footer must fit within {max_chars} characters")
    body = body.strip() if has_caption_body(body) else fallback
    if len(body) > budget:
        endings = list(re.finditer(r"[.!?](?=\s|$)", body[:budget]))
        body = body[:endings[-1].end()] if endings else fallback
    return require_caption(body + suffix, max_chars=max_chars)

