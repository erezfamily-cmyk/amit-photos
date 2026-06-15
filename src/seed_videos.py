#!/usr/bin/env python3
"""
One-time seed script — populates data/videos.json from existing tracking files.

Tutorial/gallery video IDs are not stored in the repo. Those records get id=null
and must be filled in manually (find the IDs on youtube.com/channel/yours).

Run: python src/seed_videos.py
"""

import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).parent))
from videos_utils import append_video

ROOT     = Path(__file__).parent.parent
DATA_DIR = ROOT / "data"

# Hebrew category → English title for gallery videos
ALBUM_EN = {
    "יוון": "Greece",
    "גרמניה": "Germany",
    "טבע דומם": "Still Life",
    "איטליה": "Italy",
    "טנזניה": "Tanzania",
    "ספרד ואנדורה": "Spain & Andorra",
    "מונטנגרו": "Montenegro",
    "אנגליה": "England",
}

# Guide slug → Hebrew title
GUIDE_TITLE_HE = {
    "depth-of-field":  "עומק שדה",
    "composition":     "קומפוזיציה",
    "exposure":        "חשיפה",
    "light":           "אור",
    "focus":           "פוקוס",
    "landscape":       "נוף",
    "portrait":        "פורטרט",
    "macro":           "מאקרו",
    "histogram":       "היסטוגרם",
    "white-balance":   "איזון לבן",
    "filters":         "פילטרים",
    "editing":         "עריכה",
    "lenses":          "עדשות",
    "controls":        "כפתורי המצלמה",
    "dynamic-range":   "טווח דינמי",
    "visual-language": "שפה ויזואלית",
    "types":           "סוגי מצלמות",
    "sports":          "ספורט",
    "mobile":          "צילום סלולרי",
    "software":        "תוכנות עריכה",
}

# Clear existing file
(DATA_DIR / "videos.json").write_text("[]", encoding="utf-8")

# 1. Tutorial videos
tutorials_file = DATA_DIR / "youtube_tutorials_posted.json"
if tutorials_file.exists():
    state = json.loads(tutorials_file.read_text(encoding="utf-8"))
    for slug in state.get("posted_guides", []):
        title_en = slug.replace("-", " ").title()
        append_video({
            "id":         None,   # fill in manually
            "platform":   "youtube",
            "type":       "tutorial",
            "slug":       slug,
            "title_he":   GUIDE_TITLE_HE.get(slug, title_en),
            "title_en":   f"{title_en} — Photography Tutorial",
            "summary_he": "",
            "summary_en": "",
            "date":       "2026-01-01",
        })

# 2. Album slideshow videos
posted_file = DATA_DIR / "youtube_posted.json"
if posted_file.exists():
    state = json.loads(posted_file.read_text(encoding="utf-8"))
    for album in state.get("posted_albums", []):
        append_video({
            "id":         None,   # fill in manually
            "platform":   "youtube",
            "type":       "gallery",
            "slug":       None,
            "title_he":   album,
            "title_en":   ALBUM_EN.get(album, album),
            "summary_he": "",
            "summary_en": "",
            "date":       "2026-01-01",
        })

# 3. Distributed videos (YouTube IDs known)
dist_file = DATA_DIR / "distributed_videos.json"
if dist_file.exists():
    for entry in json.loads(dist_file.read_text(encoding="utf-8")):
        yt_id = entry.get("platforms", {}).get("youtube")
        filename = entry.get("filename", "")
        name = filename.split("-", 1)[-1].replace("-", " ").replace(".mp4", "").title()
        if yt_id:
            append_video({
                "id":         yt_id,
                "platform":   "youtube",
                "type":       "reel",
                "slug":       None,
                "title_he":   name,
                "title_en":   name,
                "summary_he": "",
                "summary_en": "",
                "date":       entry.get("date", "2026-01-01"),
            })

print("\n[OK] Seeding complete. Open data/videos.json and fill in 'id': null entries.")
