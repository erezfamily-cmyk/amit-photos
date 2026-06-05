#!/usr/bin/env python3
"""
Reel + YouTube Short Auto-Post
Weekly: picks one photo → 25-second 9:16 video → Instagram Reel + YouTube Short.
"""

import base64
import json
import os
import random
import subprocess
import sys
import tempfile
import time
from pathlib import Path

GRAPH_API  = "https://graph.facebook.com/v21.0"
SITE_URL   = "https://amitphotos.com"
ROOT       = Path(__file__).parent.parent
DATA_DIR   = ROOT / "data"
MUSIC_DIR  = ROOT / "assets" / "music"

POSTED_FILE = DATA_DIR / "reels_posted.json"

W, H           = 1080, 1920
REEL_DURATION  = 25       # seconds — well under Reels 90s limit, ideal for attention
WATERMARK      = "amitphotos.com"

IG_USER_ID        = os.environ.get("INSTAGRAM_USER_ID", "")
ACCESS_TOKEN      = os.environ.get("INSTAGRAM_PAGE_TOKEN", "")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()


# ── State ─────────────────────────────────────────────────────────────────────

def load_posted(path=POSTED_FILE):
    if Path(path).exists():
        return json.loads(Path(path).read_text(encoding="utf-8"))
    return []


def save_posted(posted_ids, path=POSTED_FILE):
    Path(path).write_text(
        json.dumps(posted_ids, ensure_ascii=False, indent=2), encoding="utf-8"
    )


# ── Photo selection ───────────────────────────────────────────────────────────

def load_photos():
    try:
        import requests
        resp = requests.get(f"{SITE_URL}/api/photos", timeout=15)
        resp.raise_for_status()
        valid = [p for p in resp.json()
                 if p.get("title") and not p["title"].upper().startswith("DSC_")]
        if valid:
            print(f"✅ {len(valid)} תמונות")
            return valid
    except Exception as e:
        print(f"⚠️  API נכשל ({e})")
    jf = DATA_DIR / "photos.json"
    if jf.exists():
        return [p for p in json.loads(jf.read_text(encoding="utf-8"))
                if p.get("title") and not p["title"].upper().startswith("DSC_")]
    print("❌ אין מקור תמונות")
    sys.exit(1)


def pick_photo(photos, posted_ids):
    unposted = [p for p in photos if p["id"] not in posted_ids]
    if not unposted:
        print("🔄 כל התמונות כוסו — מתחיל rotation")
        return random.choice(photos)
    return random.choice(unposted)


# ── Video helpers ─────────────────────────────────────────────────────────────

def get_dims(path):
    r = subprocess.run(
        ["ffprobe", "-v", "quiet", "-select_streams", "v:0",
         "-show_entries", "stream=width,height", "-of", "json", str(path)],
        capture_output=True, text=True,
    )
    s = json.loads(r.stdout)["streams"][0]
    return s["width"], s["height"]


def fit_dims(w, h, max_w=1020, max_h=1820):
    ratio = min(max_w / w, max_h / h)
    return max(int(w * ratio) & ~1, 2), max(int(h * ratio) & ~1, 2)


def download_photo(photo, tmp_dir):
    import requests
    url = photo.get("url") or photo.get("thumbnail", "")
    if url.startswith("/"):
        url = f"{SITE_URL}{url}"
    r = requests.get(url, timeout=30, headers={"User-Agent": "Mozilla/5.0"})
    r.raise_for_status()
    path = tmp_dir / "photo.jpg"
    path.write_bytes(r.content)
    return path


def create_reel_slide(photo_path, tmp_dir):
    """9:16 slide: blurred bg + Ken Burns zoom + watermark."""
    out    = tmp_dir / "slide.mp4"
    frames = int(REEL_DURATION * 30)

    try:
        w, h = get_dims(photo_path)
    except Exception:
        w, h = 4000, 3000
    fw, fh = fit_dims(w, h)

    inc = 0.04 / frames
    zoom_expr = f"'if(lte(on,1),1.0,min(zoom+{inc:.6f},1.04))'"

    fc = (
        f"[0:v]scale={W}:{H}:force_original_aspect_ratio=increase,"
        f"crop={W}:{H},gblur=sigma=28[bg];"

        f"[0:v]scale={fw}:{fh}[fg_raw];"

        f"[fg_raw]zoompan=z={zoom_expr}:"
        f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
        f"d={frames}:s={fw}x{fh}:fps=30[fg];"

        f"[bg][fg]overlay=(W-w)/2:(H-h)/2,"
        f"drawtext=text='{WATERMARK}':"
        f"fontcolor=white@0.35:fontsize=24:x=(w-text_w)/2:y=h-55,"
        f"format=yuv420p[out]"
    )

    r = subprocess.run([
        "ffmpeg", "-y", "-loop", "1", "-i", str(photo_path),
        "-filter_complex", fc, "-map", "[out]",
        "-t", str(REEL_DURATION), "-r", "30",
        "-c:v", "libx264", "-preset", "fast", "-crf", "22",
        str(out),
    ], capture_output=True, text=True)

    if r.returncode != 0:
        print(f"❌ FFmpeg error: {r.stderr[-400:]}")
        sys.exit(1)
    return out


def add_audio(video_path, tmp_dir):
    """Add background music (mp3 from assets, or generated ambient fallback)."""
    fade_st = max(0.0, REEL_DURATION - 2.0)

    music_files = list(MUSIC_DIR.glob("*.mp3"))
    if music_files:
        music = random.choice(music_files)
        print(f"🎵 {music.name}")
    else:
        print("⚠️  אין mp3 — מייצר ambient")
        ambient = tmp_dir / "ambient.aac"
        subprocess.run([
            "ffmpeg", "-y", "-f", "lavfi",
            "-i", "anoisesrc=c=pink:a=0.5:r=44100",
            "-af",
            f"lowpass=f=350,highpass=f=70,volume=0.18,"
            f"afade=t=in:st=0:d=1.5,afade=t=out:st={fade_st:.2f}:d=2",
            "-t", str(REEL_DURATION),
            "-ar", "44100", "-ac", "2", "-c:a", "aac", "-b:a", "128k",
            str(ambient),
        ], capture_output=True)
        music = ambient if ambient.exists() else None

    if not music or not Path(music).exists():
        return video_path

    out = tmp_dir / "with_audio.mp4"
    r = subprocess.run([
        "ffmpeg", "-y",
        "-i", str(video_path), "-stream_loop", "-1", "-i", str(music),
        "-filter_complex",
        f"[1:a]atrim=0:{REEL_DURATION:.2f},asetpts=PTS-STARTPTS,"
        f"afade=t=in:st=0:d=1.5,afade=t=out:st={fade_st:.2f}:d=2,"
        f"volume=0.38[aud]",
        "-map", "0:v", "-map", "[aud]",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-shortest",
        str(out),
    ], capture_output=True, text=True)

    return out if (r.returncode == 0 and out.exists()) else video_path


# ── Caption ───────────────────────────────────────────────────────────────────

HASHTAG_POOLS = {
    "default": [
        "#photography #reels #naturephotography #landscapephotography",
        "#photographer #fineartphotography #visualart #photooftheday",
        "#israeliphotographer #israelphoto #ig_israel #wildlife_photography",
    ],
    "טבע": [
        "#nature #naturephotography #wildlife #macro #reels #naturereels",
        "#naturelover #earthpix #outdoorphotography #wildlifephotography",
        "#israel_nature #הטבע_הישראלי #macro_photography",
    ],
    "פורטרט": [
        "#portrait #portraitphotography #reels #portraiture #naturallight",
        "#portraitreels #humanportrait #emotionalportrait",
    ],
    "עירוני": [
        "#urban #streetphotography #city #architecture #reels",
        "#streetphoto #cityscape #architecturephotography #urbanreels",
        "#israel_architecture #tel_aviv #jerusalem",
    ],
    "אירועים": [
        "#events #weddingphotography #celebration #moments #reels",
        "#wedding #barMitzvah #familyphotography #eventreels",
    ],
}


def get_hashtags(category):
    pool = HASHTAG_POOLS.get(category, HASHTAG_POOLS["default"])
    base = random.choice(pool)
    return f"{base} #amitphotos #ישראל #צילום #shorts"


def generate_caption(photo):
    import anthropic
    import io

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    title       = photo.get("title", "")
    category    = photo.get("category", "")
    description = photo.get("description", "")

    thumbnail_url = photo.get("thumbnail") or photo.get("url", "")
    if thumbnail_url.startswith("/"):
        thumbnail_url = f"{SITE_URL}{thumbnail_url}"

    image_content = []
    try:
        import requests
        resp = requests.get(thumbnail_url, timeout=30)
        resp.raise_for_status()
        img_bytes = resp.content
        try:
            from PIL import Image
            img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
            if max(img.size) > 2000:
                img.thumbnail((2000, 2000), Image.LANCZOS)
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=85)
            img_bytes = buf.getvalue()
        except ImportError:
            pass
        b64 = base64.standard_b64encode(img_bytes).decode()
        image_content = [{"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": b64}}]
    except Exception as e:
        print(f"⚠️  לא הורדה תמונה לcaption ({e})")

    meta = f"שם: {title}" + (f"\nקטגוריה: {category}" if category else "") + (f"\nתיאור: {description}" if description else "")
    hashtags = get_hashtags(category)

    system_prompt = """אתה עמית ארז, צלם ישראלי שמצלם מאהבה אמיתית.
כותב בגוף ראשון, עברית ברורה. מתחיל ממה שמעניין בתמונה הספציפית — מיקום, אור, זווית.
מסביר את טכניקת הצילום. לא שיווקי, לא ביטויים ריקים."""

    prompt = f"""כתוב כיתוב Reel קצר (3-4 משפטים) עבור התמונה הזו.
{meta}
סיים עם: 🎯 amitphotos.com
עברית בלבד. רק הכיתוב."""

    msg = client.messages.create(
        model="claude-opus-4-8",
        max_tokens=350,
        system=system_prompt,
        messages=[{"role": "user", "content": image_content + [{"type": "text", "text": prompt}]}],
    )
    text = msg.content[0].text.strip()
    return f"{text}\n\n{hashtags}"


# ── Upload ────────────────────────────────────────────────────────────────────

def upload_video(video_path):
    """Upload to catbox.moe (1-hour link) with 0x0.st fallback."""
    import requests
    data = video_path.read_bytes()
    mb   = len(data) / 1024 / 1024
    print(f"📤 {mb:.1f} MB")

    for name, url, extra in [
        ("litterbox", "https://litterbox.catbox.moe/resources/internals/api.php",
         {"data": {"reqtype": "fileupload", "time": "1h"}, "file_field": "fileToUpload"}),
        ("0x0.st", "https://0x0.st",
         {"file_field": "file"}),
    ]:
        try:
            files     = {extra["file_field"]: ("reel.mp4", data, "video/mp4")}
            post_data = extra.get("data", {})
            r = requests.post(url, data=post_data, files=files, timeout=180)
            r.raise_for_status()
            public_url = r.text.strip()
            if public_url.startswith("http"):
                print(f"⬆️  {name}: {public_url}")
                return public_url
        except Exception as e:
            print(f"⚠️  {name} נכשל: {e}")

    raise RuntimeError("כל שירותי ה-upload נכשלו")


# ── Instagram Reel ─────────────────────────────────────────────────────────────

def publish_ig_reel(video_url, caption):
    import requests
    print("📸 מפרסם IG Reel...")

    r = requests.post(f"{GRAPH_API}/{IG_USER_ID}/media", data={
        "video_url":     video_url,
        "media_type":    "REELS",
        "share_to_feed": "true",
        "caption":       caption,
        "access_token":  ACCESS_TOKEN,
    }, timeout=30)
    if not r.ok:
        print(f"❌ IG container: {r.status_code} {r.text[:300]}")
        return None
    creation_id = r.json().get("id")
    if not creation_id:
        print(f"❌ {r.json()}")
        return None
    print(f"📦 container: {creation_id}")

    for attempt in range(24):
        time.sleep(5)
        status = requests.get(
            f"{GRAPH_API}/{creation_id}",
            params={"fields": "status_code", "access_token": ACCESS_TOKEN},
            timeout=30,
        ).json().get("status_code", "")
        print(f"  ⏳ [{attempt + 1}] {status}")
        if status == "FINISHED":
            break
        if status == "ERROR":
            print("❌ שגיאת עיבוד Instagram")
            return None

    pub = requests.post(f"{GRAPH_API}/{IG_USER_ID}/media_publish", data={
        "creation_id":  creation_id,
        "access_token": ACCESS_TOKEN,
    }, timeout=30)
    if pub.ok:
        reel_id = pub.json().get("id")
        print(f"✅ IG Reel פורסם! ID: {reel_id}")
        return reel_id
    print(f"❌ Publish נכשל: {pub.status_code} {pub.text[:200]}")
    return None


# ── YouTube Short ─────────────────────────────────────────────────────────────

def upload_youtube_short(video_path, title, description):
    token_b64 = os.environ.get("YOUTUBE_TOKEN_JSON", "")
    if not token_b64:
        print("⚠️  YOUTUBE_TOKEN_JSON לא מוגדר — מדלג על YouTube")
        return None

    try:
        from googleapiclient.discovery import build
        from googleapiclient.http import MediaFileUpload
        from google.oauth2.credentials import Credentials
        from google.auth.transport.requests import Request
    except ImportError:
        print("⚠️  חסר: pip install google-api-python-client google-auth")
        return None

    token_data = json.loads(base64.b64decode(token_b64).decode())
    creds = Credentials.from_authorized_user_info(token_data)
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())

    youtube = build("youtube", "v3", credentials=creds, cache_discovery=False)

    body = {
        "snippet": {
            "title":       f"{title[:90]} #Shorts",
            "description": f"{description}\n\namitphotos.com",
            "tags":        ["photography", "shorts", "צילום", "ישראל", "amitphotos"],
            "categoryId":  "19",
        },
        "status": {"privacyStatus": "public"},
    }

    print("📺 מעלה YouTube Short...")
    media   = MediaFileUpload(str(video_path), mimetype="video/mp4",
                              resumable=True, chunksize=10 * 1024 * 1024)
    request = youtube.videos().insert(
        part=",".join(body.keys()), body=body, media_body=media
    )

    response = None
    while response is None:
        status, response = request.next_chunk()
        if status:
            print(f"  ⬆️  {int(status.progress() * 100)}%")

    vid_id = response.get("id")
    print(f"✅ YouTube Short: https://youtu.be/{vid_id}")
    return vid_id


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    if not IG_USER_ID or not ACCESS_TOKEN:
        print("❌ חסרים INSTAGRAM_USER_ID / INSTAGRAM_PAGE_TOKEN")
        sys.exit(1)

    photos     = load_photos()
    posted_ids = load_posted()
    photo      = pick_photo(photos, posted_ids)
    print(f"📷 נבחרה: {photo['title']} ({photo.get('category', '')})")

    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)

        img_path = download_photo(photo, tmp)
        print("⬇️  תמונה הורדה")

        slide = create_reel_slide(img_path, tmp)
        final = add_audio(slide, tmp)
        print("🎬 וידאו נוצר")

        caption = generate_caption(photo)
        print(f"✍️  caption: {caption[:60]}…")

        video_url = upload_video(final)

        ig_id = publish_ig_reel(video_url, caption)
        yt_id = upload_youtube_short(final, photo["title"], caption)

    if ig_id or yt_id:
        posted_ids.append(photo["id"])
        save_posted(posted_ids)
        print(f"💾 נשמר ב-reels_posted.json ({len(posted_ids)} סה\"כ)")
    else:
        print("⚠️  שני הפרסומים נכשלו — לא עדכון")
        sys.exit(1)


if __name__ == "__main__":
    main()
