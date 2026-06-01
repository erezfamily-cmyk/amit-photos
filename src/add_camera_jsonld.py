#!/usr/bin/env python3
"""Add JSON-LD structured data (Article + BreadcrumbList) to all camera tutorial pages."""

import re
import json
from pathlib import Path

BASE_URL = "https://amitphotos.com"
CAMERA_DIR = Path(__file__).parent.parent / "camera"

AUTHOR = {"@type": "Person", "name": "עמית ארז", "url": BASE_URL}
PUBLISHER = {"@type": "Organization", "name": "Amit Photos", "url": BASE_URL}


def extract_meta(html: str, tag: str) -> str:
    if tag == "title":
        m = re.search(r"<title>([^<]+)</title>", html)
        return m.group(1).strip() if m else ""
    m = re.search(rf'<meta name="{tag}" content="([^"]+)"', html)
    return m.group(1).strip() if m else ""


def short_title(full_title: str) -> str:
    t = full_title.split("|")[0].strip()
    for suffix in [" — בית ספר לצילום", " — Amit Photos"]:
        if t.endswith(suffix):
            t = t[: -len(suffix)].strip()
    return t


def build_jsonld(slug: str, title: str, description: str) -> str:
    short = short_title(title)
    url = f"{BASE_URL}/camera/{slug}/" if slug else f"{BASE_URL}/camera/"

    if not slug:
        data = [
            {
                "@context": "https://schema.org",
                "@type": "CollectionPage",
                "name": short,
                "description": description,
                "url": url,
                "author": AUTHOR,
                "inLanguage": "he",
            },
            {
                "@context": "https://schema.org",
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": "בית", "item": f"{BASE_URL}/"},
                    {"@type": "ListItem", "position": 2, "name": short, "item": url},
                ],
            },
        ]
    else:
        data = [
            {
                "@context": "https://schema.org",
                "@type": "Article",
                "headline": short,
                "description": description,
                "url": url,
                "author": AUTHOR,
                "publisher": PUBLISHER,
                "isPartOf": {
                    "@type": "Course",
                    "name": "בית ספר לצילום",
                    "url": f"{BASE_URL}/camera/",
                },
                "inLanguage": "he",
            },
            {
                "@context": "https://schema.org",
                "@type": "BreadcrumbList",
                "itemListElement": [
                    {"@type": "ListItem", "position": 1, "name": "בית", "item": f"{BASE_URL}/"},
                    {"@type": "ListItem", "position": 2, "name": "למד לצלם", "item": f"{BASE_URL}/camera/"},
                    {"@type": "ListItem", "position": 3, "name": short, "item": url},
                ],
            },
        ]

    serialized = json.dumps(data, ensure_ascii=False, indent=2)
    return f'\n  <!-- JSON-LD Structured Data -->\n  <script type="application/ld+json">\n  {serialized}\n  </script>'


def process_file(html_file: Path):
    html = html_file.read_text(encoding="utf-8")

    if "application/ld+json" in html:
        print(f"  SKIP (already has JSON-LD): {html_file}")
        return False

    title = extract_meta(html, "title")
    description = extract_meta(html, "description")

    slug = "" if html_file.parent.name == "camera" else html_file.parent.name

    jsonld = build_jsonld(slug, title, description)
    new_html = html.replace("</head>", jsonld + "\n</head>", 1)
    html_file.write_text(new_html, encoding="utf-8")
    print(f"  OK [{slug or 'index'}]: {short_title(title)}")
    return True


def main():
    added = 0
    for html_file in sorted(CAMERA_DIR.glob("**/index.html")):
        if process_file(html_file):
            added += 1
    print(f"\nDone: added JSON-LD to {added} files.")


if __name__ == "__main__":
    main()
