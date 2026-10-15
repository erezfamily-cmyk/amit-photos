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


def normalize_hashtags(hashtags, max_count=None):
    """Deduplicate hashtags case-insensitively and keep a deliberate small set."""
    result = []
    seen = set()
    for tag in str(hashtags or "").split():
        if not tag.startswith("#"):
            continue
        key = tag.casefold()
        if key in seen:
            continue
        seen.add(key)
        result.append(tag)
        if max_count is not None and len(result) >= max_count:
            break
    return " ".join(result)


def analyze_caption_set(captions):
    """Return editorial hygiene metrics for a set of published captions."""
    values = [text if isinstance(text, str) else "" for text in captions]
    readable = [text for text in values if has_caption_body(text)]
    duplicate_hashtags = 0
    for text in values:
        tags = re.findall(r"#[^\s#]+", text)
        if len({tag.casefold() for tag in tags}) < len(tags):
            duplicate_hashtags += 1
    return {
        "posts_checked": len(values),
        "readable_captions": len(readable),
        "missing_or_hashtag_only": len(values) - len(readable),
        "duplicate_hashtag_posts": duplicate_hashtags,
        "question_posts": sum("?" in text or "؟" in text for text in readable),
        "link_posts": sum(bool(re.search(r"https?://|amitphotos\.com", text)) for text in readable),
        "avg_caption_chars": round(sum(len(text) for text in readable) / len(readable)) if readable else 0,
    }


def compose_caption(body, footer, hashtags, fallback, max_chars=MAX_CAPTION_CHARS, max_hashtags=None):
    """Preserve the complete CTA; trim only at a complete sentence boundary."""
    tags = normalize_hashtags(hashtags, max_count=max_hashtags)
    suffix = f"\n\n{footer.strip()}\n\n{tags}".rstrip()
    budget = max_chars - len(suffix)
    if budget <= 0:
        raise ValueError(f"Caption footer must fit within {max_chars} characters")
    body = body.strip() if has_caption_body(body) else fallback
    if len(body) > budget:
        endings = list(re.finditer(r"[.!?](?=\s|$)", body[:budget]))
        body = body[:endings[-1].end()] if endings else fallback
    return require_caption(body + suffix, max_chars=max_chars)

