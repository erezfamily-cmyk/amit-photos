"""Consistent, privacy-safe campaign URLs for automated social posts."""

from urllib.parse import urlencode

SITE_URL = "https://amitphotos.com"


def build_campaign_url(path, *, source, campaign, content, params=None):
    """Build a first-party URL with a stable GA acquisition taxonomy."""
    clean_path = "/" + str(path or "").lstrip("/")
    query = {str(key): str(value) for key, value in (params or {}).items()}
    query.update({
        "utm_source": source,
        "utm_medium": "organic_social",
        "utm_campaign": campaign,
        "utm_content": str(content),
    })
    return f"{SITE_URL}{clean_path}?{urlencode(query)}"
