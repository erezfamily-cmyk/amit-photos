"""
bump_versions.py — updates asset versions in index.html based on file content hash.
Usage: python scripts/bump_versions.py
"""
import hashlib, re, sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).parent.parent

ASSETS = [
    ROOT / "assets/css/style.css",
    ROOT / "assets/js/gallery.js",
    ROOT / "assets/js/i18n.js",
]

def file_hash(path):
    return hashlib.md5(path.read_bytes()).hexdigest()[:8]

def main():
    index = ROOT / "index.html"
    content = index.read_text(encoding="utf-8")

    for asset in ASSETS:
        if not asset.exists():
            continue
        h = file_hash(asset)
        rel = asset.relative_to(ROOT).as_posix()
        content = re.sub(
            rf'({re.escape(rel)})(\?v=[^"\']+)?',
            rf'\1?v={h}',
            content,
        )

    index.write_text(content, encoding="utf-8")
    print("versions updated in index.html")

if __name__ == "__main__":
    main()
