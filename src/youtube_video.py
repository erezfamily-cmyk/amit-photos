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

import os, sys, json, random, requests, subprocess, tempfile, shutil, base64
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
        f"drawtext=text='amitphotos.com':"
        f"fontcolor=white@0.30:fontsize=20:x=W-tw-30:y=H-50,"
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


def build_metadata(category, n_photos):
    title = f"{category} | Amit Erez Photography"
    description = (
        f"A cinematic photo collection from {category}, "
        f"featuring {n_photos} photographs by Amit Erez.\n\n"
        f"🌐 Full gallery: {SITE_URL}\n"
        f"📷 Fine art prints available\n\n"
        f"#photography #amitphotos #{category.replace(' ', '')} #Israel"
    )
    tags = ["photography", "Amit Erez", "amitphotos", category,
            "fine art", "landscape", "travel photography"]
    return title, description, tags


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    photos = load_photos()
    if not photos:
        print("❌ לא נמצאו תמונות")
        sys.exit(1)

    state            = load_state()
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
        for i, photo in enumerate(selected):
            try:
                path  = download_photo(photo, tmp_dir, i)
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

        # Upload
        title, description, tags = build_metadata(category, len(selected))
        vid_id = upload_to_youtube(Path(final), title, description, tags, category)

        # Save locally if no upload
        if not vid_id:
            out_path = ROOT / f"output_{category.replace(' ', '_')}.mp4"
            shutil.copy(final, out_path)
            print(f"💾 נשמר: {out_path}")

    # Update state
    state.setdefault("posted_albums", []).append(category)
    save_state(state)


if __name__ == "__main__":
    main()
