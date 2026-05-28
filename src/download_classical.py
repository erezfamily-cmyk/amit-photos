#!/usr/bin/env python3
"""
Download public domain classical music from Musopen API.
Saves to assets/classical/ — used by youtube_video.py as background music.

Pieces: Clair de Lune (Debussy), Moonlight Sonata (Beethoven), Gymnopédie (Satie)
All recordings are public domain via Musopen.org.
"""

import requests, sys
from pathlib import Path

CLASSICAL_DIR = Path(__file__).parent.parent / "assets" / "classical"
MUSOPEN_API   = "https://api.musopen.org"

# Specific recording IDs on Musopen (public domain confirmed)
RECORDINGS = [
    {"id": 5993,  "filename": "clair-de-lune-debussy.mp3",      "title": "Clair de Lune — Debussy"},
    {"id": 6709,  "filename": "moonlight-sonata-beethoven.mp3",  "title": "Moonlight Sonata — Beethoven"},
    {"id": 2476,  "filename": "gymnopedie-no1-satie.mp3",        "title": "Gymnopédie No.1 — Satie"},
]

def download_recording(rec):
    dest = CLASSICAL_DIR / rec["filename"]
    if dest.exists() and dest.stat().st_size > 100_000:
        print(f"✅ קיים: {rec['title']}")
        return True

    print(f"⬇️  {rec['title']}...")
    try:
        # Get recording info from Musopen API
        r = requests.get(f"{MUSOPEN_API}/recordings/{rec['id']}", timeout=15)
        r.raise_for_status()
        data = r.json()
        mp3_url = data.get("files", {}).get("mp3") or data.get("url", "")

        if not mp3_url:
            print(f"  ⚠️  לא נמצא URL ל-{rec['title']}")
            return False

        # Download MP3
        mp3 = requests.get(mp3_url, timeout=60, stream=True,
                           headers={"User-Agent": "amitphotos/1.0"})
        mp3.raise_for_status()
        dest.write_bytes(mp3.content)
        mb = dest.stat().st_size / 1024 / 1024
        print(f"  ✅ {mb:.1f} MB")
        return True

    except Exception as e:
        print(f"  ⚠️  שגיאה: {e}")
        return False

def main():
    CLASSICAL_DIR.mkdir(parents=True, exist_ok=True)
    ok = 0
    for rec in RECORDINGS:
        if download_recording(rec):
            ok += 1
    print(f"\n✅ {ok}/{len(RECORDINGS)} קבצים זמינים ב-assets/classical/")

if __name__ == "__main__":
    main()
