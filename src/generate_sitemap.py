"""
generate_sitemap.py
-------------------
מייצר sitemap.xml עם כל התמונות לגוגל.
מריץ אוטומטית בכל עדכון תמונות.

הרצה:
  python src/generate_sitemap.py
"""

import json
from pathlib import Path
from datetime import date

ROOT = Path(__file__).parent.parent
DATA_FILE = ROOT / "data" / "photos.json"
SITEMAP_FILE = ROOT / "sitemap.xml"
SITE_URL = "https://amitphotos.com"


def escape(text):
    return (text
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;"))


def main():
    photos = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    today = date.today().isoformat()

    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
        '        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
        f'  <url>',
        f'    <loc>{SITE_URL}/</loc>',
        f'    <lastmod>{today}</lastmod>',
        f'    <changefreq>daily</changefreq>',
        f'    <priority>1.0</priority>',
    ]

    count = 0
    for photo in photos:
        image_url = photo.get("thumbnail") or photo.get("url", "")
        if not image_url:
            continue
        title = escape(photo.get("title", ""))
        description = escape(photo.get("description", ""))
        lines.append(f'    <image:image>')
        lines.append(f'      <image:loc>{image_url}</image:loc>')
        if title:
            lines.append(f'      <image:title>{title}</image:title>')
        if description:
            lines.append(f'      <image:caption>{description}</image:caption>')
        lines.append(f'    </image:image>')
        count += 1

    lines.append('  </url>')
    lines.append('</urlset>')

    SITEMAP_FILE.write_text("\n".join(lines), encoding="utf-8")
    print(f"sitemap.xml created with {count} images")


if __name__ == "__main__":
    main()
