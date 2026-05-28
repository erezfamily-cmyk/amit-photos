#!/usr/bin/env python3
"""
YouTube Weekly Slideshow — Full Album Video
Creates a cinematic 16:9 (1920×1080) video from a full album and uploads to YouTube.

One-time setup (run locally):
  pip install google-auth-oauthlib google-api-python-client
  python src/youtube_auth.py          ← browser login, saves token
  Add YOUTUBE_TOKEN_JSON to GitHub secrets (base64-encoded token.json content)

Weekly: one album per video, ~5 min, intro card + location overlay + outro.
"""

import os, sys, json, random, requests, subprocess, tempfile, shutil, base64, datetime
from pathlib import Path
from collections import defaultdict

GRAPH_API  = "https://graph.facebook.com/v21.0"
SITE_URL   = "https://amitphotos.com"
ROOT       = Path(__file__).parent.parent
DATA_DIR   = ROOT / "data"
MUSIC_DIR  = ROOT / "assets" / "music"
POSTED_FILE = DATA_DIR / "youtube_posted.json"

W, H             = 1920, 1080
SLIDE_DURATION   = 5.0   # seconds per photo
TRANSITION_DUR   = 0.8
INTRO_DUR        = 4.0
OUTRO_DUR        = 5.0
MAX_PHOTOS       = 60
MIN_PHOTOS       = 15   # skip album if fewer photos


# ── Data ──────────────────────────────────────────────────────────────────────

def load_photos():
    try:
        r = requests.get(f"{SITE_URL}/api/photos", timeout=15)
        r.raise_for_status()
        valid = [p for p in r.json()
                 if p.get("title") and not p["title"].upper().startswith("DSC_")]
        if valid:
            print(f"✅ {len(valid)} תמונות")
            return valid
    except Exception as e:
        print(f"⚠️  API: {e}")
    jf = DATA_DIR / "photos.json"
    if jf.exists():
        return [p for p in json.loads(jf.read_text(encoding="utf-8"))
                if p.get("title") and not p["title"].upper().startswith("DSC_")]
    return []

def load_state():
    if POSTED_FILE.exists():
        return json.loads(POSTED_FILE.read_text(encoding="utf-8"))
    return {"posted_albums": []}

def save_state(state):
    POSTED_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")

def select_album(photos, state):
    by_cat = defaultdict(list)
    for p in photos:
        c = p.get("category", "").strip()
        if c:
            by_cat[c].append(p)

    used   = set(state.get("posted_albums", []))
    avail  = [c for c, ps in by_cat.items() if len(ps) >= MIN_PHOTOS and c not in used]

    if not avail:
        print("🔄 כל האלבומים כוסו — מתחיל מחדש")
        state["posted_albums"] = []
        avail = [c for c, ps in by_cat.items() if len(ps) >= MIN_PHOTOS]

    if not avail:
        print("❌ אין אלבומים עם מספיק תמונות")
        sys.exit(1)

    category = random.choice(avail)
    pool     = by_cat[category]
    selected = random.sample(pool, min(MAX_PHOTOS, len(pool)))
    return selected, category


# ── Video helpers ─────────────────────────────────────────────────────────────

def get_dims(path):
    r = subprocess.run(
        ["ffprobe", "-v", "quiet", "-select_streams", "v:0",
         "-show_entries", "stream=width,height", "-of", "json", str(path)],
        capture_output=True, text=True,
    )
    s = json.loads(r.stdout)["streams"][0]
    return s["width"], s["height"]

def fit_dims_16_9(w, h, max_w=1860, max_h=1020):
    ratio = min(max_w / w, max_h / h)
    return max(int(w * ratio) & ~1, 2), max(int(h * ratio) & ~1, 2)

def get_duration(path):
    r = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", str(path)],
        capture_output=True, text=True,
    )
    try:
        return float(json.loads(r.stdout)["format"]["duration"])
    except Exception:
        return SLIDE_DURATION * MAX_PHOTOS

def download_photo(photo, tmp_dir, idx):
    url = photo.get("url") or photo.get("thumbnail", "")
    if url.startswith("/"):
        url = f"{SITE_URL}{url}"
    r = requests.get(url, timeout=30, headers={"User-Agent": "Mozilla/5.0"})
    r.raise_for_status()
    path = tmp_dir / f"photo_{idx:03d}.jpg"
    path.write_bytes(r.content)
    return path


# ── Slide creation ────────────────────────────────────────────────────────────

def create_intro(category, tmp_dir):
    """Title card: dark bg + album name + photographer credit."""
    out   = tmp_dir / "intro.mp4"
    name  = category.replace("'", "\\'")
    frames = int(INTRO_DUR * 30)

    vf = (
        f"drawtext=text='{name}':"
        f"fontcolor=white:fontsize=72:x=(w-text_w)/2:y=h/2-60,"
        f"drawtext=text='Amit Erez Photography':"
        f"fontcolor=white@0.65:fontsize=36:x=(w-text_w)/2:y=h/2+20,"
        f"drawtext=text='amitphotos.com':"
        f"fontcolor=0xf0a500:fontsize=28:x=(w-text_w)/2:y=h/2+75"
    )
    r = subprocess.run([
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", f"color=c=0x0a0a1a:s={W}x{H}:r=30",
        "-vf", vf,
        "-t", str(INTRO_DUR), "-r", "30",
        "-c:v", "libx264", "-preset", "fast", "-crf", "22", "-pix_fmt", "yuv420p",
        str(out),
    ], capture_output=True, text=True)
    return out if r.returncode == 0 else None

def create_outro(tmp_dir):
    """End card: subscribe + site link."""
    out = tmp_dir / "outro.mp4"
    vf = (
        "drawtext=text='Subscribe for more photography':"
        "fontcolor=white:fontsize=56:x=(w-text_w)/2:y=h/2-50,"
        "drawtext=text='amitphotos.com':"
        "fontcolor=0xf0a500:fontsize=44:x=(w-text_w)/2:y=h/2+30"
    )
    r = subprocess.run([
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", f"color=c=0x0a0a1a:s={W}x{H}:r=30",
        "-vf", vf,
        "-t", str(OUTRO_DUR), "-r", "30",
        "-c:v", "libx264", "-preset", "fast", "-crf", "22", "-pix_fmt", "yuv420p",
        str(out),
    ], capture_output=True, text=True)
    return out if r.returncode == 0 else None

def create_slide(photo_path, idx, category, tmp_dir):
    """16:9 slide: blurred bg + centered photo + Ken Burns + category overlay."""
    out    = tmp_dir / f"slide_{idx:03d}.mp4"
    frames = int(SLIDE_DURATION * 30)

    try:
        w, h = get_dims(photo_path)
    except Exception:
        w, h = 4000, 3000
    fw, fh = fit_dims_16_9(w, h)

    inc = 0.04 / frames
    zoom_expr = (
        f"'if(lte(on,1),1.0,min(zoom+{inc:.6f},1.04))'"
        if idx % 2 == 0 else
        f"'if(lte(on,1),1.04,max(zoom-{inc:.6f},1.0))'"
    )

    cat_label = category.replace("'", "\\'")

    # Pre-scale 4x before zoompan — eliminates flickering/judder
    fw4, fh4 = fw * 4, fh * 4

    fc = (
        f"[0:v]scale={W}:{H}:force_original_aspect_ratio=increase,"
        f"crop={W}:{H},gblur=sigma=30[bg];"

        # Scale up 4x with lanczos for crisp zoompan source
        f"[0:v]scale={fw4}:{fh4}:flags=lanczos[big];"

        f"[big]zoompan=z={zoom_expr}:"
        f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
        f"d={frames}:s={fw}x{fh}:fps=30[fg];"

        f"[bg][fg]overlay=(W-w)/2:(H-h)/2,"
        f"drawtext=text='{cat_label}':"
        f"fontcolor=white@0.85:fontsize=26:x=40:y=H-60:"
        f"enable='between(t,0.3,{SLIDE_DURATION - 0.5})',"
        # Centered copyright watermark — deters frame theft
        f"drawtext=text='© Amit Erez Photography | amitphotos.com':"
        f"fontcolor=white@0.45:fontsize=22:x=(W-tw)/2:y=H-44,"
        f"format=yuv420p[out]"
    )

    r = subprocess.run([
        "ffmpeg", "-y", "-loop", "1", "-i", str(photo_path),
        "-filter_complex", fc, "-map", "[out]",
        "-t", str(SLIDE_DURATION), "-r", "30",
        # CRF 18 + YouTube recommended 8Mbps → crisp quality
        "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        "-b:v", "8M", "-maxrate", "10M", "-bufsize", "20M",
        str(out),
    ], capture_output=True, text=True)

    if r.returncode != 0:
        print(f"  ⚠️  slide {idx}: {r.stderr[-300:]}")
        return None
    return out


# ── Concat ────────────────────────────────────────────────────────────────────

def concat_all(clips, tmp_dir):
    """Simple concat (no xfade — too many clips for complex filter)."""
    list_file = tmp_dir / "all.txt"
    list_file.write_text("\n".join(f"file '{c}'" for c in clips))
    out = tmp_dir / "concat.mp4"
    r = subprocess.run([
        "ffmpeg", "-y", "-f", "concat", "-safe", "0",
        "-i", str(list_file),
        "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        "-b:v", "8M", "-maxrate", "10M", "-bufsize", "20M",
        str(out),
    ], capture_output=True, text=True)
    if r.returncode != 0:
        print(f"❌ concat: {r.stderr[-400:]}")
        sys.exit(1)
    return out


# ── Audio ─────────────────────────────────────────────────────────────────────

# Public domain classical pieces from Musopen (composer & recording both PD)
CLASSICAL_TRACKS = [
    {
        "name": "Clair de Lune — Debussy",
        "url":  "https://musopen.org/music/download/6765/",  # direct MP3
    },
    {
        "name": "Moonlight Sonata — Beethoven",
        "url":  "https://musopen.org/music/download/2615/",
    },
    {
        "name": "Gymnopédie No.1 — Satie",
        "url":  "https://musopen.org/music/download/1327/",
    },
]

CLASSICAL_DIR = Path(__file__).parent.parent / "assets" / "classical"

def get_classical_music():
    """Return a local classical MP3 if available, else fall back to short tracks."""
    CLASSICAL_DIR.mkdir(parents=True, exist_ok=True)
    existing = list(CLASSICAL_DIR.glob("*.mp3"))
    if existing:
        return random.choice(existing)
    return None

def add_music(video_path, tmp_dir):
    """Loop music to match video duration — classical preferred."""
    duration = get_duration(video_path)
    fade_st  = max(0.0, duration - 4.0)

    # Prefer classical (longer, better for YouTube)
    music = get_classical_music()
    if not music:
        music_files = list(MUSIC_DIR.glob("*.mp3"))
        if not music_files:
            print("⚠️  אין מוזיקה — ממשיך בלי")
            return video_path
        music = random.choice(music_files)
        print(f"🎵 מוזיקה: {music.name}")
    else:
        print(f"🎵 קלאסי: {music.name}")

    out = tmp_dir / "with_music.mp4"

    r = subprocess.run([
        "ffmpeg", "-y",
        "-i", str(video_path),
        "-stream_loop", "-1", "-i", str(music),
        "-filter_complex",
        f"[1:a]atrim=0:{duration:.1f},asetpts=PTS-STARTPTS,"
        f"afade=t=in:st=0:d=2,afade=t=out:st={fade_st:.1f}:d=3,"
        f"volume=0.35[aud]",
        "-map", "0:v", "-map", "[aud]",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
        "-shortest", str(out),
    ], capture_output=True, text=True)

    return out if r.returncode == 0 else video_path


# ── YouTube upload ────────────────────────────────────────────────────────────

def delete_youtube_video(video_id):
    """Delete a YouTube video by ID before re-uploading."""
    token_b64 = os.environ.get("YOUTUBE_TOKEN_JSON", "")
    if not token_b64 or not video_id:
        return
    try:
        from googleapiclient.discovery import build
        from google.oauth2.credentials import Credentials
        from google.auth.transport.requests import Request
        token_data = json.loads(base64.b64decode(token_b64).decode())
        creds = Credentials.from_authorized_user_info(token_data)
        if creds.expired and creds.refresh_token:
            creds.refresh(Request())
        youtube = build("youtube", "v3", credentials=creds, cache_discovery=False)
        youtube.videos().delete(id=video_id).execute()
        print(f"🗑️  וידאו ישן נמחק: {video_id}")
    except Exception as e:
        print(f"⚠️  מחיקה נכשלה: {e}")


def upload_to_youtube(video_path, title, description, tags, category):
    token_b64 = os.environ.get("YOUTUBE_TOKEN_JSON", "")
    if not token_b64:
        print("⚠️  YOUTUBE_TOKEN_JSON לא מוגדר — וידאו נשמר מקומית בלבד")
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
            "title":       title,
            "description": description,
            "tags":        tags,
            "categoryId":  "19",  # Travel & Events
        },
        "status": {"privacyStatus": "public"},
    }

    media   = MediaFileUpload(str(video_path), mimetype="video/mp4",
                              resumable=True, chunksize=10 * 1024 * 1024)
    request = youtube.videos().insert(part=",".join(body.keys()),
                                       body=body, media_body=media)

    response = None
    while response is None:
        status, response = request.next_chunk()
        if status:
            print(f"  ⬆️  {int(status.progress() * 100)}%")

    vid_id = response.get("id")
    print(f"✅ YouTube: https://youtu.be/{vid_id}")
    return vid_id


def extract_exif(photo_path):
    """Extract shooting date, camera model, settings from JPEG EXIF."""
    try:
        from PIL import Image
        from PIL.ExifTags import TAGS
        img  = Image.open(photo_path)
        raw  = img._getexif()
        if not raw:
            return {}
        exif = {TAGS.get(k, k): v for k, v in raw.items()}
        result = {}
        # Date
        for date_tag in ("DateTimeOriginal", "DateTime"):
            if date_tag in exif:
                try:
                    dt = datetime.datetime.strptime(str(exif[date_tag])[:19], "%Y:%m:%d %H:%M:%S")
                    result["date"] = dt.strftime("%B %Y")  # e.g. "March 2023"
                    result["year"] = dt.year
                except Exception:
                    pass
                break
        # Camera
        if "Make" in exif and "Model" in exif:
            make  = str(exif["Make"]).strip()
            model = str(exif["Model"]).strip()
            if make.lower() not in model.lower():
                result["camera"] = f"{make} {model}"
            else:
                result["camera"] = model
        # Lens / settings
        if "FNumber" in exif:
            try:
                result["aperture"] = f"f/{float(exif['FNumber']):.1f}"
            except Exception:
                pass
        if "FocalLengthIn35mmFilm" in exif:
            result["focal"] = f"{exif['FocalLengthIn35mmFilm']}mm"
        elif "FocalLength" in exif:
            try:
                result["focal"] = f"{int(float(exif['FocalLength']))}mm"
            except Exception:
                pass
        if "ISOSpeedRatings" in exif:
            result["iso"] = f"ISO {exif['ISOSpeedRatings']}"
        # GPS
        if "GPSInfo" in exif:
            gps = exif["GPSInfo"]
            try:
                from PIL.ExifTags import GPSTAGS
                gps_data = {GPSTAGS.get(k, k): v for k, v in gps.items()}
                def to_deg(val):
                    d, m, s = [float(x) for x in val]
                    return d + m/60 + s/3600
                lat = to_deg(gps_data["GPSLatitude"])
                lon = to_deg(gps_data["GPSLongitude"])
                if gps_data.get("GPSLatitudeRef") == "S":  lat = -lat
                if gps_data.get("GPSLongitudeRef") == "W": lon = -lon
                result["gps"] = (lat, lon)
            except Exception:
                pass
        return result
    except Exception:
        return {}

def reverse_geocode(lat, lon):
    """Get place name from GPS coords via Nominatim (free, no key)."""
    try:
        r = requests.get(
            "https://nominatim.openstreetmap.org/reverse",
            params={"lat": lat, "lon": lon, "format": "json", "zoom": 10},
            headers={"User-Agent": "amitphotos/1.0"},
            timeout=5,
        )
        if r.ok:
            data = r.json()
            addr = data.get("address", {})
            return (addr.get("city") or addr.get("town") or
                    addr.get("village") or addr.get("state") or
                    addr.get("country", ""))
    except Exception:
        pass
    return ""

def collect_exif_summary(photo_paths):
    """Collect EXIF from a sample of photos and build a summary dict."""
    cameras, dates, locations, settings = set(), set(), set(), []

    for path in photo_paths[:20]:  # sample first 20 to keep it fast
        exif = extract_exif(path)
        if exif.get("camera"):
            cameras.add(exif["camera"])
        if exif.get("date"):
            dates.add(exif["date"])
        if exif.get("gps"):
            place = reverse_geocode(*exif["gps"])
            if place:
                locations.add(place)
        s = " · ".join(filter(None, [
            exif.get("focal"), exif.get("aperture"), exif.get("iso")
        ]))
        if s:
            settings.append(s)

    return {
        "cameras":   sorted(cameras),
        "dates":     sorted(dates),
        "locations": sorted(locations),
        "settings":  settings[:5],
    }

def share_youtube_on_social(video_id, category, exif_summary=None):
    """Post YouTube link to Instagram, Facebook Page, and Threads."""
    yt_url   = f"https://youtu.be/{video_id}"
    ig_user  = os.environ.get("INSTAGRAM_USER_ID", "")
    fb_page  = os.environ.get("FACEBOOK_PAGE_ID", "")
    token    = os.environ.get("INSTAGRAM_PAGE_TOKEN", "")

    date_str = f" ({', '.join(exif_summary['dates'])})" if exif_summary and exif_summary.get("dates") else ""
    loc_str  = f"\n📍 {', '.join(exif_summary['locations'])}" if exif_summary and exif_summary.get("locations") else ""

    caption_he = (
        f"סרטון חדש עלה לערוץ YouTube שלי 🎬\n"
        f"אלבום: {category}{date_str}{loc_str}\n\n"
        f"🔗 {yt_url}\n\n"
        f"#צילום #amitphotos #{category.replace(' ', '')}"
    )
    caption_en = (
        f"New video on my YouTube channel 🎬\n"
        f"Album: {category}{date_str}{loc_str}\n\n"
        f"🔗 {yt_url}\n\n"
        f"#photography #amitphotos #{category.replace(' ', '')}"
    )

    # Instagram — image post with YouTube link in caption
    if ig_user and token:
        _post_ig_text(ig_user, token, caption_he)

    # Facebook Page — link post
    if fb_page and token:
        _post_fb_link(fb_page, token, yt_url, category, caption_he)

    # Threads — via Instagram Threads API
    if ig_user and token:
        _post_threads(ig_user, token, caption_en + f"\n\n{yt_url}")


def _post_ig_text(ig_user, token, caption):
    """Post to Instagram feed (image post with YouTube thumbnail)."""
    try:
        # Use a plain text post — IG requires image, use a site screenshot as placeholder
        r = requests.post(f"{GRAPH_API}/{ig_user}/media", data={
            "image_url":    f"{SITE_URL}/og-image.jpg",
            "caption":      caption,
            "access_token": token,
        }, timeout=30)
        if r.ok:
            creation_id = r.json().get("id")
            pub = requests.post(f"{GRAPH_API}/{ig_user}/media_publish", data={
                "creation_id":  creation_id,
                "access_token": token,
            }, timeout=30)
            if pub.ok:
                print(f"✅ Instagram: פוסט YouTube שותף")
                return
        print(f"⚠️  Instagram share: {r.status_code} {r.text[:100]}")
    except Exception as e:
        print(f"⚠️  Instagram share: {e}")


def _post_fb_link(page_id, token, url, title, message):
    """Post link to Facebook Page feed."""
    try:
        r = requests.post(f"{GRAPH_API}/{page_id}/feed", data={
            "link":         url,
            "message":      message,
            "access_token": token,
        }, timeout=30)
        if r.ok:
            print(f"✅ Facebook: לינק YouTube שותף")
        else:
            print(f"⚠️  Facebook share: {r.status_code} {r.text[:100]}")
    except Exception as e:
        print(f"⚠️  Facebook share: {e}")


def _post_threads(ig_user, token, text):
    """Post text to Threads."""
    try:
        r = requests.post(f"{GRAPH_API}/{ig_user}/threads", data={
            "media_type":   "TEXT",
            "text":         text[:500],
            "access_token": token,
        }, timeout=30)
        if r.ok:
            creation_id = r.json().get("id")
            pub = requests.post(f"{GRAPH_API}/{ig_user}/threads_publish", data={
                "creation_id":  creation_id,
                "access_token": token,
            }, timeout=30)
            if pub.ok:
                print(f"✅ Threads: פוסט YouTube שותף")
                return
        print(f"⚠️  Threads share: {r.status_code} {r.text[:100]}")
    except Exception as e:
        print(f"⚠️  Threads share: {e}")


def build_metadata(category, n_photos, exif_summary=None):
    title = f"{category} | Amit Erez Photography"

    lines = [
        f"A cinematic photo collection from {category}, "
        f"featuring {n_photos} photographs by Amit Erez.",
        "",
    ]

    if exif_summary:
        if exif_summary.get("dates"):
            lines.append(f"📅 Photographed: {', '.join(exif_summary['dates'])}")
        if exif_summary.get("locations"):
            lines.append(f"📍 Locations: {', '.join(exif_summary['locations'])}")
        if exif_summary.get("cameras"):
            lines.append(f"📷 Camera: {', '.join(exif_summary['cameras'])}")
        if exif_summary.get("settings"):
            lines.append(f"🔭 Settings: {exif_summary['settings'][0]}")
        lines.append("")

    lines += [
        "🌐 Full gallery:",
        SITE_URL,
        "",
        "🖼️  Fine art prints available:",
        SITE_URL + "/sale/",
        "",
        f"#{category.replace(' ', '')} #photography #AmitErez #amitphotos #Israel #fineart",
    ]

    description = "\n".join(lines)
    tags = ["photography", "Amit Erez", "amitphotos", category,
            "fine art", "landscape", "travel photography", "Israel"]
    if exif_summary and exif_summary.get("locations"):
        tags += list(exif_summary["locations"])[:3]

    return title, description, tags


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    args = sys.argv[1:]

    # --replace VIDEO_ID: delete old video and re-upload same album
    replace_id = None
    if "--replace" in args:
        idx = args.index("--replace")
        if idx + 1 < len(args):
            replace_id = args[idx + 1]
            args = [a for a in args if a not in ("--replace", replace_id)]

    photos = load_photos()
    if not photos:
        print("❌ לא נמצאו תמונות")
        sys.exit(1)

    state = load_state()

    # If replacing, force the same album and remove from posted list
    force_album = args[0] if args else None
    if replace_id and not force_album:
        # Re-use last posted album
        posted = state.get("posted_albums", [])
        force_album = posted[-1] if posted else None
        if force_album and force_album in state.get("posted_albums", []):
            state["posted_albums"].remove(force_album)

    if force_album:
        by_cat = defaultdict(list)
        for p in photos:
            c = p.get("category", "").strip()
            if c:
                by_cat[c].append(p)
        if force_album not in by_cat:
            print(f"❌ אלבום לא נמצא: {force_album}")
            sys.exit(1)
        pool = by_cat[force_album]
        selected = random.sample(pool, min(MAX_PHOTOS, len(pool)))
        category = force_album
    else:
        selected, category = select_album(photos, state)

    print(f"🎬 אלבום: {category} | {len(selected)} תמונות")

    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        clips   = []

        # Intro
        intro = create_intro(category, tmp_dir)
        if intro:
            clips.append(intro)
            print("✅ Intro")

        # Download + slides
        print("⬇️  מוריד תמונות...")
        photo_paths = []
        for i, photo in enumerate(selected):
            try:
                path  = download_photo(photo, tmp_dir, i)
                photo_paths.append(path)
                slide = create_slide(path, i, category, tmp_dir)
                if slide:
                    clips.append(slide)
                if (i + 1) % 10 == 0:
                    print(f"  {i+1}/{len(selected)} slides")
            except Exception as e:
                print(f"  ✗ {photo.get('title','?')}: {e}")

        if len(clips) < 3:
            print("❌ לא מספיק clips")
            sys.exit(1)

        # Outro
        outro = create_outro(tmp_dir)
        if outro:
            clips.append(outro)
            print("✅ Outro")

        # Concat
        print("🔗 מחבר...")
        combined = concat_all(clips, tmp_dir)

        # Music
        print("🎵 מוסיף מוזיקה...")
        final = add_music(combined, tmp_dir)

        dur = get_duration(Path(final))
        sz  = Path(final).stat().st_size / 1024 / 1024
        print(f"📹 {dur:.0f} שניות | {sz:.0f} MB")

        # Delete old video before uploading improved version
        if replace_id:
            delete_youtube_video(replace_id)

        # Collect EXIF from downloaded photos
        print("📊 קורא EXIF...")
        exif_summary = collect_exif_summary(photo_paths)
        if exif_summary.get("dates"):
            print(f"  📅 {', '.join(exif_summary['dates'])}")
        if exif_summary.get("locations"):
            print(f"  📍 {', '.join(exif_summary['locations'])}")
        if exif_summary.get("cameras"):
            print(f"  📷 {', '.join(exif_summary['cameras'])}")

        # Upload
        title, description, tags = build_metadata(category, len(selected), exif_summary)
        vid_id = upload_to_youtube(Path(final), title, description, tags, category)

        # Save locally if no upload
        if not vid_id:
            out_path = ROOT / f"output_{category.replace(' ', '_')}.mp4"
            shutil.copy(final, out_path)
            print(f"💾 נשמר: {out_path}")

        # Auto-share YouTube link on social media
        if vid_id:
            share_youtube_on_social(vid_id, category, exif_summary)

    # Update state
    state.setdefault("posted_albums", []).append(category)
    save_state(state)


if __name__ == "__main__":
    main()
