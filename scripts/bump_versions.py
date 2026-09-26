"""
bump_versions.py — updates asset versions based on file content hash.

- INDEX_ASSETS are referenced only from index.html (the homepage), so only that file is rewritten.
- SITEWIDE_ASSETS (e.g. nav.js) are referenced from every standalone subpage (camera/*, locations/*,
  videos, sale, games, quiz, puzzle, gear, learn — 30+ files), so every .html file in the repo that
  references them gets rewritten too. Without this, editing nav.js has no effect on any page whose
  browser or edge cache already has the old ?v=... URL — confirmed live: a hard-reload showed the
  fix working, a normal load of an already-visited page did not.

Usage: python scripts/bump_versions.py
"""
import hashlib, re, sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).parent.parent

INDEX_ASSETS = [
    ROOT / "assets/css/style.css",
    ROOT / "assets/js/analytics.js",
    ROOT / "assets/js/gallery.js",
    ROOT / "assets/js/i18n.js",
]

SITEWIDE_ASSETS = [
    ROOT / "assets/js/nav.js",
]

def file_hash(path):
    return hashlib.md5(path.read_bytes()).hexdigest()[:8]

def bump_in_text(text, asset):
    h = file_hash(asset)
    rel = asset.relative_to(ROOT).as_posix()
    return re.sub(
        rf'({re.escape(rel)})(\?v=[^"\']+)?',
        rf'\1?v={h}',
        text,
    ), h

def main():
    index = ROOT / "index.html"
    content = index.read_text(encoding="utf-8")
    for asset in INDEX_ASSETS:
        if not asset.exists():
            continue
        content, _ = bump_in_text(content, asset)
    index.write_text(content, encoding="utf-8")
    print("versions updated in index.html")

    for asset in SITEWIDE_ASSETS:
        if not asset.exists():
            continue
        rel = asset.relative_to(ROOT).as_posix()
        h = file_hash(asset)
        updated = 0
        for html_file in ROOT.glob("**/*.html"):
            if "node_modules" in html_file.parts:
                continue
            text = html_file.read_text(encoding="utf-8")
            if rel not in text:
                continue
            new_text, _ = bump_in_text(text, asset)
            if new_text != text:
                html_file.write_text(new_text, encoding="utf-8")
                updated += 1
        print(f"{rel}: updated {updated} file(s) to ?v={h}")

if __name__ == "__main__":
    main()
