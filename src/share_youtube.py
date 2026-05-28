#!/usr/bin/env python3
"""Share a YouTube video link on Instagram, Facebook and Threads."""
import os, sys, requests

GRAPH_API  = "https://graph.facebook.com/v21.0"
SITE_URL   = "https://amitphotos.com"
IG_USER    = os.environ.get("INSTAGRAM_USER_ID", "")
FB_PAGE    = os.environ.get("FACEBOOK_PAGE_ID", "")
TOKEN      = os.environ.get("INSTAGRAM_PAGE_TOKEN", "")

def main():
    if len(sys.argv) < 3:
        print("Usage: share_youtube.py <video_id> <title>")
        sys.exit(1)

    video_id = sys.argv[1]
    title    = sys.argv[2]
    yt_url   = f"https://youtu.be/{video_id}"

    caption_he = (
        f"סרטון חדש בערוץ YouTube שלי 🎬\n\n"
        f"מדריך: {title}\n"
        f"הסבר מלא עם תמונות אמיתיות + narration באנגלית\n\n"
        f"🔗 {yt_url}\n\n"
        f"#צילום #amitphotos #{title.replace(' ','')} #photographytutorial"
    )
    caption_en = (
        f"New tutorial on my YouTube channel 🎬\n\n"
        f"{title} — practical guide with real photography examples\n\n"
        f"🔗 {yt_url}\n\n"
        f"#photography #amitphotos #{title.replace(' ','')} #photographytutorial"
    )

    # Instagram
    if IG_USER and TOKEN:
        r = requests.post(f"{GRAPH_API}/{IG_USER}/media", data={
            "image_url":    f"{SITE_URL}/og-image.jpg",
            "caption":      caption_he,
            "access_token": TOKEN,
        }, timeout=30)
        if r.ok:
            cid = r.json().get("id")
            pub = requests.post(f"{GRAPH_API}/{IG_USER}/media_publish",
                data={"creation_id": cid, "access_token": TOKEN}, timeout=30)
            print("✅ Instagram" if pub.ok else f"⚠️  IG: {pub.text[:100]}")
        else:
            print(f"⚠️  IG media: {r.text[:100]}")

    # Facebook
    if FB_PAGE and TOKEN:
        r = requests.post(f"{GRAPH_API}/{FB_PAGE}/feed", data={
            "link": yt_url, "message": caption_he, "access_token": TOKEN,
        }, timeout=30)
        print("✅ Facebook" if r.ok else f"⚠️  FB: {r.text[:100]}")

    # Threads
    if IG_USER and TOKEN:
        r = requests.post(f"{GRAPH_API}/{IG_USER}/threads", data={
            "media_type": "TEXT", "text": caption_en[:500], "access_token": TOKEN,
        }, timeout=30)
        if r.ok:
            cid = r.json().get("id")
            pub = requests.post(f"{GRAPH_API}/{IG_USER}/threads_publish",
                data={"creation_id": cid, "access_token": TOKEN}, timeout=30)
            print("✅ Threads" if pub.ok else f"⚠️  Threads: {pub.text[:100]}")
        else:
            print(f"⚠️  Threads media: {r.text[:100]}")

if __name__ == "__main__":
    main()
