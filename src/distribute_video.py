#!/usr/bin/env python3
"""
distribute_video.py — מפיץ סרטון מוכן לכל הפלטפורמות
שימוש: python src/distribute_video.py --file video/myvideo.mp4
"""

import argparse
import base64
import json
import os
import sys
import time
from pathlib import Path

import requests
from videos_utils import append_video

GRAPH_API   = "https://graph.facebook.com/v21.0"
ROOT        = Path(__file__).parent.parent
DATA_DIR    = ROOT / "data"
POSTED_FILE = DATA_DIR / "distributed_videos.json"

IG_USER_ID   = os.environ.get("INSTAGRAM_USER_ID", "")
IG_TOKEN     = os.environ.get("INSTAGRAM_PAGE_TOKEN", "")
FB_PAGE_ID   = os.environ.get("FACEBOOK_PAGE_ID", "")
FB_TOKEN     = os.environ.get("FACEBOOK_PAGE_TOKEN", "")
YT_TOKEN_B64 = os.environ.get("YOUTUBE_TOKEN_JSON", "")

TAGS = "#photography #bts #behindthescenes #photographer #photographylife #naturephotography #photooftheday #amitphotos #israeliphotographer"

# כיתובים מתחלפים — נבחר לפי מספר השבוע כדי לגוון
CAPTIONS = [
    f"מאחורי הקלעים 📷\n\nרגע שנולד דרך העינית — הכל קורה בשבריר שנייה.\n\namitphotos.com\n\n{TAGS}",
    f"Behind the lens 📷\n\nSome moments find you before you find them.\n\namitphotos.com\n\n{TAGS}",
    f"איך נולדת התמונה הזאת? 🤔\n\nכל צילום מתחיל בהמתנה — לאור הנכון, לרגע הנכון.\n\namitphotos.com\n\n{TAGS}",
    f"The camera sees what the eye misses 📷\n\nBehind every frame — a moment of decision.\n\namitphotos.com\n\n{TAGS}",
    f"מה שלא נכנס לפריים נשאר בראש 🎞️\n\nהנה מה שהיה לפני שלחצתי על ההדק.\n\namitphotos.com\n\n{TAGS}",
    f"Stillness before the shot 📷\n\nPatience is the photographer's best tool.\n\namitphotos.com\n\n{TAGS}",
    f"בין המחשבה לתמונה — חלקיק שנייה ⚡\n\nזה הרגע שאני הכי אוהב לתפוס.\n\namitphotos.com\n\n{TAGS}",
    f"Light chasing 🌅\n\nBehind the scenes of a golden hour hunt.\n\namitphotos.com\n\n{TAGS}",
]


def get_default_caption():
    from datetime import date
    week = date.today().isocalendar()[1]
    return CAPTIONS[week % len(CAPTIONS)]


YT_TITLE = "Behind the Lens | amitphotos.com #Shorts"
YT_DESCRIPTION = """\
Behind the scenes of photography by Amit Erez.

🌐 amitphotos.com

#photography #Shorts #bts #photographer #behindthescenes"""


def load_posted():
    if POSTED_FILE.exists():
        return json.loads(POSTED_FILE.read_text(encoding="utf-8"))
    return []


def save_posted(records):
    POSTED_FILE.write_text(
        json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def upload_video(video_path):
    data = Path(video_path).read_bytes()
    print(f"📤 {len(data)/1024/1024:.1f} MB")

    for name, url, extra in [
        (
            "litterbox",
            "https://litterbox.catbox.moe/resources/internals/api.php",
            {"data": {"reqtype": "fileupload", "time": "72h"}, "field": "fileToUpload"},
        ),
        ("0x0.st", "https://0x0.st", {"data": {}, "field": "file"}),
    ]:
        try:
            r = requests.post(
                url,
                data=extra["data"],
                files={extra["field"]: ("video.mp4", data, "video/mp4")},
                timeout=180,
            )
            r.raise_for_status()
            pub = r.text.strip()
            if pub.startswith("http"):
                print(f"⬆️  {name}: {pub}")
                return pub
        except Exception as e:
            print(f"⚠️  {name} נכשל: {e}")

    raise RuntimeError("upload נכשל לחלוטין")


def publish_ig(video_url, caption):
    if not IG_USER_ID or not IG_TOKEN:
        print("⚠️  IG credentials חסרים — מדלג")
        return None

    print("📸 מפרסם IG Reel...")
    r = requests.post(
        f"{GRAPH_API}/{IG_USER_ID}/media",
        data={
            "video_url":    video_url,
            "media_type":   "REELS",
            "share_to_feed": "true",
            "caption":      caption,
            "access_token": IG_TOKEN,
        },
        timeout=30,
    )
    if not r.ok:
        print(f"❌ IG container: {r.status_code} {r.text[:300]}")
        return None

    cid = r.json().get("id")
    if not cid:
        return None

    for attempt in range(30):
        time.sleep(5)
        status = requests.get(
            f"{GRAPH_API}/{cid}",
            params={"fields": "status_code", "access_token": IG_TOKEN},
            timeout=30,
        ).json().get("status_code", "")
        print(f"  ⏳ [{attempt+1}] {status}")
        if status == "FINISHED":
            break
        if status == "ERROR":
            print("❌ שגיאת עיבוד IG")
            return None

    pub = requests.post(
        f"{GRAPH_API}/{IG_USER_ID}/media_publish",
        data={"creation_id": cid, "access_token": IG_TOKEN},
        timeout=30,
    )
    if pub.ok:
        ig_id = pub.json().get("id")
        print(f"✅ IG Reel: {ig_id}")
        return ig_id
    print(f"❌ IG publish נכשל: {pub.status_code}")
    return None


def publish_fb(video_url, caption):
    if not FB_PAGE_ID or not FB_TOKEN:
        print("⚠️  FB credentials חסרים — מדלג")
        return None

    print("📘 מפרסם Facebook Video...")
    r = requests.post(
        f"{GRAPH_API}/{FB_PAGE_ID}/videos",
        data={
            "file_url":    video_url,
            "description": caption,
            "access_token": FB_TOKEN,
        },
        timeout=60,
    )
    if r.ok:
        fb_id = r.json().get("id")
        print(f"✅ FB Video: {fb_id}")
        return fb_id
    print(f"❌ FB נכשל: {r.status_code} {r.text[:300]}")
    return None


def publish_youtube(video_path):
    if not YT_TOKEN_B64:
        print("⚠️  YOUTUBE_TOKEN_JSON חסר — מדלג")
        return None

    try:
        from googleapiclient.discovery import build
        from googleapiclient.http import MediaFileUpload
        from google.oauth2.credentials import Credentials
        from google.auth.transport.requests import Request
    except ImportError:
        print("⚠️  חסר: pip install google-api-python-client google-auth")
        return None

    print("▶️  מעלה ל-YouTube Shorts...")
    token_data = json.loads(base64.b64decode(YT_TOKEN_B64).decode())
    creds = Credentials.from_authorized_user_info(token_data)
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())

    youtube = build("youtube", "v3", credentials=creds, cache_discovery=False)
    body = {
        "snippet": {
            "title":       YT_TITLE,
            "description": YT_DESCRIPTION,
            "tags":        ["photography", "shorts", "bts", "photographer", "amitphotos", "behindthescenes"],
            "categoryId":  "19",
        },
        "status": {"privacyStatus": "public"},
    }
    media = MediaFileUpload(
        str(video_path), mimetype="video/mp4", resumable=True, chunksize=10 * 1024 * 1024
    )
    request = youtube.videos().insert(part=",".join(body.keys()), body=body, media_body=media)

    response = None
    while response is None:
        status, response = request.next_chunk()
        if status:
            print(f"  ⬆️  {int(status.progress() * 100)}%")

    vid_id = response.get("id")
    print(f"✅ YouTube Short: https://youtu.be/{vid_id}")
    return vid_id


def download_to_temp(url: str) -> Path:
    import tempfile
    print(f"⬇️  מוריד מ-URL...")
    r = requests.get(url, timeout=300, stream=True)
    r.raise_for_status()
    suffix = Path(url.split("?")[0]).suffix or ".mp4"
    tmp = Path(tempfile.mktemp(suffix=suffix))
    with open(tmp, "wb") as f:
        for chunk in r.iter_content(chunk_size=1024 * 1024):
            f.write(chunk)
    print(f"✅ הורד: {tmp} ({tmp.stat().st_size/1024/1024:.1f} MB)")
    return tmp


def main():
    ap = argparse.ArgumentParser(description="מפיץ סרטון לכל הפלטפורמות")
    ap.add_argument("--file",    default=None, help="נתיב הסרטון (למשל video/myvideo.mp4)")
    ap.add_argument("--url",     default=None, help="URL ציבורי לסרטון (מ-amitphotos.com)")
    ap.add_argument("--caption", default=None, help="כיתוב מותאם אישית (ברירת מחדל: כיתוב אוטומטי שבועי)")
    args = ap.parse_args()

    caption = args.caption or get_default_caption()
    print(f"📝 כיתוב: {caption[:60]}...")

    if not args.file and not args.url:
        print("❌ יש לספק --file או --url")
        sys.exit(1)

    tmp_path = None

    if args.url:
        filename = Path(args.url.split("?")[0]).name
        print(f"\n🎬 מפיץ מ-URL: {filename}\n{'─'*40}")
        video_url = args.url
        tmp_path  = download_to_temp(args.url)
        video_path = tmp_path
    else:
        video_path = ROOT / args.file
        if not video_path.exists():
            print(f"❌ קובץ לא נמצא: {video_path}")
            sys.exit(1)
        filename  = Path(args.file).name
        print(f"\n🎬 מפיץ: {filename}\n{'─'*40}")
        video_url = upload_video(video_path)

    results = {
        "filename": filename,
        "date":     time.strftime("%Y-%m-%d"),
        "platforms": {},
    }

    ig_id = publish_ig(video_url, caption)
    results["platforms"]["instagram"] = ig_id

    fb_id = publish_fb(video_url, caption)
    results["platforms"]["facebook"] = fb_id

    yt_id = publish_youtube(video_path)
    results["platforms"]["youtube"] = yt_id

    if tmp_path and tmp_path.exists():
        tmp_path.unlink(missing_ok=True)

    posted = load_posted()
    posted.append(results)
    save_posted(posted)

    # Append to central videos.json — prefer YouTube ID (better embed)
    yt_id = results["platforms"].get("youtube")
    ig_id = results["platforms"].get("instagram")
    video_name = Path(filename).stem.split("-", 1)[-1].replace("-", " ").title()
    if yt_id or ig_id:
        append_video({
            "id":         yt_id or ig_id,
            "platform":   "youtube" if yt_id else "instagram",
            "type":       "reel",
            "slug":       None,
            "title_he":   video_name,
            "title_en":   video_name,
            "summary_he": "",
            "summary_en": "",
        })

    print(f"\n{'─'*40}\n📊 סיכום:")
    print(f"  Instagram: {'✅ ' + str(ig_id) if ig_id else '❌ נכשל'}")
    print(f"  Facebook:  {'✅ ' + str(fb_id) if fb_id else '❌ נכשל'}")
    print(f"  YouTube:   {'✅ ' + str(yt_id) if yt_id else '❌ נכשל'}")


if __name__ == "__main__":
    main()
