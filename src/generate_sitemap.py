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


def main():
    photos = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    today = date.today().isoformat()

    lines = ['<?xml version="1.0" encoding="UTF-8"?>']
    lines.append('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"')
    lines.append('        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">')

    # עמוד ראשי
    lines.append(f"""  <url>
    <loc>{SITE_URL}/</loc>
    <lastmod>{today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>""")

    # תמונות
    lines.append(f"""  <url>
    <loc>{SITE_URL}/</loc>
    <lastmod>{today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>""")

    for photo in photos:
        title = photo.get("title", "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        description = photo.get("description", "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        image_url = photo.get("thumbnail") or photo.get("url", "")
        if not image_url:
            continue
        lines.append(f"""    <image:image>
      <image:loc>{image_url}</image:loc>
      <image:title>{title}</image:title>
      <image:caption>{description}</image:caption>
    </image:image>""")

    lines.append(f"""  </url>""")
    lines.append("</urlset>")

    SITEMAP_FILE.write_text("\n".join(lines), encoding="utf-8")
    print(f"sitemap.xml created with {len(photos)} photos")


if __name__ == "__main__":
    main()
