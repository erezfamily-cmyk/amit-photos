"""
generate_sitemap.py
-------------------
מייצר sitemap.xml עבור Google Search Console.
מריץ אוטומטית בכל עדכון תמונות.

הרצה:
  python src/generate_sitemap.py
"""

from pathlib import Path
from datetime import date

ROOT = Path(__file__).parent.parent
SITEMAP_FILE = ROOT / "sitemap.xml"
SITE_URL = "https://amitphotos.com"


def main():
    today = date.today().isoformat()

    content = f"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>{SITE_URL}/</loc>
    <lastmod>{today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>"""

    SITEMAP_FILE.write_text(content, encoding="utf-8")
    print("sitemap.xml created")


if __name__ == "__main__":
    main()
