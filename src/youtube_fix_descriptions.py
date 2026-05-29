#!/usr/bin/env python3
"""
Fix YouTube video descriptions — move URLs to their own line so they become clickable.

Usage:
  python src/youtube_fix_descriptions.py          # dry run (preview only)
  python src/youtube_fix_descriptions.py --apply  # actually update
"""

import os, sys, json, re, base64

def get_youtube_client():
    token_b64 = os.environ.get("YOUTUBE_TOKEN_JSON", "")
    if not token_b64:
        print("❌ YOUTUBE_TOKEN_JSON לא מוגדר")
        sys.exit(1)

    try:
        from googleapiclient.discovery import build
        from google.oauth2.credentials import Credentials
        from google.auth.transport.requests import Request
    except ImportError:
        print("❌ חסר: pip install google-api-python-client google-auth")
        sys.exit(1)

    creds = Credentials.from_authorized_user_info(
        json.loads(base64.b64decode(token_b64).decode())
    )
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())

    return build("youtube", "v3", credentials=creds, cache_discovery=False)


def fix_description(text):
    """Move URLs to their own line when they appear after text on the same line."""
    # Match: any text ending with non-whitespace, then space, then https://...
    fixed = re.sub(r"([^\n])( )(https?://\S+)", r"\1\n\3", text)
    return fixed


def get_all_channel_videos(yt):
    """Fetch all uploaded videos from the channel."""
    # First get the uploads playlist ID
    ch = yt.channels().list(part="contentDetails", mine=True).execute()
    uploads_id = ch["items"][0]["contentDetails"]["relatedPlaylists"]["uploads"]

    videos = []
    page_token = None
    while True:
        kwargs = dict(part="snippet", playlistId=uploads_id, maxResults=50)
        if page_token:
            kwargs["pageToken"] = page_token
        resp = yt.playlistItems().list(**kwargs).execute()
        for item in resp.get("items", []):
            vid_id = item["snippet"]["resourceId"]["videoId"]
            title  = item["snippet"]["title"]
            videos.append((vid_id, title))
        page_token = resp.get("nextPageToken")
        if not page_token:
            break

    return videos


def main():
    apply = "--apply" in sys.argv

    print("🔑 מתחבר ל-YouTube...")
    yt = get_youtube_client()

    print("📋 שולף רשימת סרטונים...")
    videos = get_all_channel_videos(yt)
    print(f"   נמצאו {len(videos)} סרטונים\n")

    updated = 0
    for vid_id, title in videos:
        # Fetch full snippet
        resp = yt.videos().list(part="snippet", id=vid_id).execute()
        if not resp.get("items"):
            continue

        snippet = resp["items"][0]["snippet"]
        original = snippet.get("description", "")
        fixed = fix_description(original)

        if fixed == original:
            print(f"✓ ללא שינוי: {title}")
            continue

        print(f"\n📝 {title} ({vid_id})")
        # Show diff
        for i, (orig_line, new_line) in enumerate(
            zip(original.splitlines(), fixed.splitlines()), 1
        ):
            if orig_line != new_line:
                print(f"  לפני: {orig_line!r}")
                print(f"  אחרי: {new_line!r}")

        if apply:
            snippet["description"] = fixed
            # categoryId must be a string
            if "categoryId" not in snippet:
                snippet["categoryId"] = "22"
            yt.videos().update(
                part="snippet",
                body={"id": vid_id, "snippet": snippet}
            ).execute()
            print(f"  ✅ עודכן")
            updated += 1
        else:
            print(f"  (dry run — הוסף --apply לעדכון בפועל)")

    print(f"\n{'✅ עודכנו' if apply else '🔍 ימתינו לעדכון'}: {updated} סרטונים")
    if not apply:
        print("הרץ עם --apply לביצוע בפועל:")
        print("  python src/youtube_fix_descriptions.py --apply")


if __name__ == "__main__":
    main()
