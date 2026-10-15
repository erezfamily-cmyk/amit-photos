"""Consistent, privacy-safe campaign URLs for automated social posts."""

from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

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


def add_campaign_params(url, *, source, campaign, content):
    """Add the same acquisition taxonomy to an existing first- or third-party URL."""
    parts = urlsplit(str(url or SITE_URL))
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    query.update({
        "utm_source": str(source),
        "utm_medium": "organic_social",
        "utm_campaign": str(campaign),
        "utm_content": str(content),
    })
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))
