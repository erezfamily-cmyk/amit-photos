import hashlib
import importlib.util
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))

spec = importlib.util.spec_from_file_location("bump_versions", Path(__file__).parent.parent / "scripts" / "bump_versions.py")
bump_versions = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bump_versions)


def test_file_hash_is_first_8_hex_chars_of_md5(tmp_path):
    f = tmp_path / "x.js"
    f.write_text("console.log(1);", encoding="utf-8")
    expected = hashlib.md5(b"console.log(1);").hexdigest()[:8]
    assert bump_versions.file_hash(f) == expected


def test_bump_in_text_replaces_existing_version_query():
    text = '<script src="assets/js/nav.js?v=oldhash"></script>'
    asset = bump_versions.ROOT / "assets/js/nav.js"
    new_text, h = bump_versions.bump_in_text(text, asset)
    assert f'assets/js/nav.js?v={h}' in new_text
    assert 'oldhash' not in new_text


def test_bump_in_text_adds_a_version_query_when_none_present():
    text = '<script src="assets/js/nav.js"></script>'
    asset = bump_versions.ROOT / "assets/js/nav.js"
    new_text, h = bump_versions.bump_in_text(text, asset)
    assert f'assets/js/nav.js?v={h}' in new_text


def test_sitewide_assets_includes_nav_js_since_it_is_shared_by_every_standalone_subpage():
    # regression: nav.js is referenced by 30+ standalone pages (camera/*, locations/*, videos,
    # sale, games, quiz, puzzle, gear, learn), not just index.html — it must be a SITEWIDE_ASSET,
    # not an INDEX_ASSET, or edits to it never reach any page whose cached ?v=... URL is stale.
    sitewide_names = {a.name for a in bump_versions.SITEWIDE_ASSETS}
    assert 'nav.js' in sitewide_names


def test_every_html_file_currently_referencing_nav_js_uses_the_same_version_query(tmp_path):
    # locks in the actual fix: after running bump_versions.py, every page must reference the
    # SAME current nav.js hash — not a stale one left over from before nav.js was last edited.
    root = bump_versions.ROOT
    nav = root / "assets/js/nav.js"
    expected_v = f'nav.js?v={bump_versions.file_hash(nav)}'
    stale_files = []
    for html_file in root.glob("**/*.html"):
        if "node_modules" in html_file.parts:
            continue
        text = html_file.read_text(encoding="utf-8")
        if "assets/js/nav.js?v=" in text and expected_v not in text:
            stale_files.append(str(html_file.relative_to(root)))
    assert stale_files == [], f"these files reference an outdated nav.js version: {stale_files}"
