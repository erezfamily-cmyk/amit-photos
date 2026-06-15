#!/usr/bin/env python3
"""
Fill null video IDs in data/videos.json by searching the channel on YouTube.
Uses local token.json for auth.
"""

import json, sys, os, base64
from pathlib import Path

try:
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
    from googleapiclient.discovery import build
except ImportError:
    print("חסר: pip install google-auth google-auth-oauthlib google-api-python-client")
    sys.exit(1)

ROOT = Path(__file__).parent.parent
VIDEOS_FILE = ROOT / "data" / "videos.json"


def get_youtube():
    token_b64 = os.environ.get("YOUTUBE_TOKEN_JSON", "")
    if token_b64:
        creds = Credentials.from_authorized_user_info(
            json.loads(base64.b64decode(token_b64).decode())
        )
    else:
        TOKEN_FILE = ROOT / "token.json"
        creds = Credentials.from_authorized_user_file(str(TOKEN_FILE))
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
    return build("youtube", "v3", credentials=creds, cache_discovery=False)


def fetch_all_channel_videos(yt):
    """Return list of {id, title, description} for all channel uploads."""
    # Get uploads playlist ID
    ch = yt.channels().list(part="contentDetails", mine=True).execute()
    uploads_id = ch["items"][0]["contentDetails"]["relatedPlaylists"]["uploads"]

    videos = []
    page_token = None
    while True:
        resp = yt.playlistItems().list(
            part="snippet",
            playlistId=uploads_id,
            maxResults=50,
            pageToken=page_token,
        ).execute()
        for item in resp.get("items", []):
            sn = item["snippet"]
            videos.append({
                "id":    sn["resourceId"]["videoId"],
                "title": sn["title"],
            })
        page_token = resp.get("nextPageToken")
        if not page_token:
            break
    return videos


def normalize(s):
    return s.lower().replace("—", "-").replace("–", "-").replace("  ", " ").strip()


def find_best_match(record, channel_videos):
    """Try to match a null-id record to a channel video by title."""
    candidates = []

    t_he = normalize(record.get("title_he", ""))
    t_en = normalize(record.get("title_en", ""))
    slug = record.get("slug") or ""
    vtype = record.get("type", "")

    for v in channel_videos:
        vt = normalize(v["title"])
        score = 0
        if t_he and t_he in vt:
            score += 3
        if t_en and t_en in vt:
            score += 2
        if slug and slug.replace("-", " ") in vt:
            score += 2
        if vtype == "tutorial" and ("tutorial" in vt or "מדריך" in vt):
            score += 1
        if vtype == "gallery" and ("גלריה" in vt or "slideshow" in vt or "gallery" in vt):
            score += 1
        if score > 0:
            candidates.append((score, v))

    if not candidates:
        return None
    candidates.sort(key=lambda x: -x[0])
    return candidates[0][1]


def main():
    yt = get_youtube()
    print("מושך רשימת סרטונים מהערוץ...")
    channel_videos = fetch_all_channel_videos(yt)
    print(f"נמצאו {len(channel_videos)} סרטונים בערוץ")

    videos = json.loads(VIDEOS_FILE.read_text(encoding="utf-8"))
    null_records = [v for v in videos if not v.get("id")]
    print(f"\nרשומות ללא ID: {len(null_records)}")

    updated = 0
    for record in videos:
        if record.get("id"):
            continue
        match = find_best_match(record, channel_videos)
        if match:
            print(f"  ✅ '{record['title_he']}' → {match['id']} ({match['title']})")
            record["id"] = match["id"]
            updated += 1
        else:
            print(f"  ❌ '{record['title_he']}' — לא נמצא מתאים")

    # Remove duplicate depth-of-field entries (keep only one)
    seen_ids = {}
    seen_slugs_null = {}
    deduped = []
    for v in videos:
        key = (v.get("slug"), v.get("type"), v.get("title_he"))
        if key in seen_ids:
            print(f"  🗑 הסרת כפיל: {v['title_he']} ({v.get('slug')})")
            continue
        seen_ids[key] = True
        deduped.append(v)

    if len(deduped) < len(videos):
        videos = deduped
        print(f"\nהוסרו {len(deduped) - len(deduped)} כפילויות")

    VIDEOS_FILE.write_text(json.dumps(videos, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n✅ עודכן data/videos.json — {updated} IDs חדשים")

    print("\nכל הסרטונים בערוץ:")
    for v in channel_videos:
        print(f"  {v['id']}  {v['title']}")


if __name__ == "__main__":
    main()
