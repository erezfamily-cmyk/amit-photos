#!/usr/bin/env python3
"""
Instagram Story — Multi-photo Slideshow with Ambient Audio
Creates a ~23-second 9:16 video: blurred background + Ken Burns + category-matched audio.
Posts to Instagram Stories, optionally to Facebook Stories (set FACEBOOK_PAGE_ID secret).
"""

import os, sys, json, random, requests, subprocess, tempfile, shutil
from pathlib import Path

GRAPH_API = "https://graph.facebook.com/v21.0"
SITE_URL  = "https://amitphotos.com"
ROOT      = Path(__file__).parent.parent

DATA_DIR   = ROOT / "data"
MUSIC_DIR  = ROOT / "assets" / "music"
STORY_FILE = DATA_DIR / "instagram_story_posted.json"

IG_USER_ID   = os.environ.get("INSTAGRAM_USER_ID", "")
ACCESS_TOKEN = os.environ.get("INSTAGRAM_PAGE_TOKEN", "")
FB_PAGE_ID   = os.environ.get("FACEBOOK_PAGE_ID", "")

CATEGORIES       = ["טבע", "פורטרט", "עירוני", "אירועים"]
MUSIC_FILES      = {
    "טבע":     "nature-ambient.mp3",
    "פורטרט":  "soft-portrait.mp3",
    "עירוני":  "urban-electronic.mp3",
    "אירועים": "cinematic-events.mp3",
}
PHOTOS_PER_STORY = 8
SLIDE_DURATION   = 3.5   # seconds
TRANSITION_DUR   = 0.7   # cross-fade between slides
WATERMARK        = "amitphotos.com"

# ffmpeg lavfi sources for procedural ambient audio (fallback when no music file)
AMBIENT = {
    "טבע": {
        "src": "anoisesrc=c=pink:a=0.5:r=44100",
        "af":  "lowpass=f=350,highpass=f=70,volume=0.18",
    },
    "פורטרט": {
        "src": "aevalsrc=0.15*sin(2*PI*220*t)+0.1*sin(2*PI*330*t)+0.07*sin(2*PI*440*t)+0.04*sin(2*PI*110*t):s=44100:c=stereo",
        "af":  "aecho=0.6:0.5:900:0.35,lowpass=f=700,volume=0.30",
    },
    "עירוני": {
        "src": "anoisesrc=c=white:a=0.35:r=44100",
        "af":  "bandpass=f=180:width_type=h:w=80,volume=0.12",
    },
    "אירועים": {
        "src": "aevalsrc=0.18*sin(2*PI*261.63*t)+0.13*sin(2*PI*329.63*t)+0.1*sin(2*PI*392*t)+0.07*sin(2*PI*523.25*t):s=44100:c=stereo",
        "af":  "aecho=0.7:0.6:700:0.4,lowpass=f=1500,volume=0.28",
    },
}


# ── State ─────────────────────────────────────────────────────────────────────

def load_state():
    default = {
        "current_category_index": 0,
        "used_ids_by_category": {c: [] for c in CATEGORIES},
    }
    if not STORY_FILE.exists():
        return default
    data = json.loads(STORY_FILE.read_text(encoding="utf-8"))
    if "used_ids_by_category" not in data:          # migrate old format
        return default
    return data

def save_state(state):
    STORY_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


# ── Photos ────────────────────────────────────────────────────────────────────

def load_photos():
    try:
        resp = requests.get(f"{SITE_URL}/api/photos", timeout=15)
        resp.raise_for_status()
        valid = [p for p in resp.json()
                 if p.get("title") and not p["title"].upper().startswith("DSC_")]
        if valid:
            print(f"✅ {len(valid)} תמונות נטענו מ-API")
            return valid
    except Exception as e:
        print(f"⚠️  API נכשל ({e})")

    jf = DATA_DIR / "photos.json"
    if jf.exists():
        return [p for p in json.loads(jf.read_text(encoding="utf-8"))
                if p.get("title") and not p["title"].upper().startswith("DSC_")]
    return []

def select_photos(photos, state):
    cat_idx  = state.get("current_category_index", 0) % len(CATEGORIES)
    category = CATEGORIES[cat_idx]
    pool     = [p for p in photos if p.get("category") == category]

    if len(pool) < 3:
        for alt in CATEGORIES:
            a = [p for p in photos if p.get("category") == alt]
            if len(a) >= 3:
                category, pool = alt, a
                break

    used  = set(state.get("used_ids_by_category", {}).get(category, []))
    avail = [p for p in pool if p["id"] not in used]
    if len(avail) < PHOTOS_PER_STORY:
        state.setdefault("used_ids_by_category", {})[category] = []
        avail = pool
        print(f"🔄 קטגוריה '{category}' מתחילה מחדש")

    selected = random.sample(avail, min(PHOTOS_PER_STORY, len(avail)))
    return selected, category, cat_idx

def download_photo(photo, tmp_dir, idx):
    url = photo.get("url") or photo.get("thumbnail", "")
    if url.startswith("/"):
        url = f"{SITE_URL}{url}"
    r = requests.get(url, timeout=30, headers={"User-Agent": "Mozilla/5.0"})
    r.raise_for_status()
    path = tmp_dir / f"photo_{idx:02d}.jpg"
    path.write_bytes(r.content)
    return path


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

def get_duration(path):
    r = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", str(path)],
        capture_output=True, text=True,
    )
    try:
        return float(json.loads(r.stdout)["format"]["duration"])
    except Exception:
        return SLIDE_DURATION * PHOTOS_PER_STORY


# ── Slide creation ────────────────────────────────────────────────────────────

def create_slide(photo_path, idx, tmp_dir):
    """9:16 slide: blurred bg + centered photo + Ken Burns zoom."""
    out    = tmp_dir / f"slide_{idx:02d}.mp4"
    frames = int(SLIDE_DURATION * 30)

    try:
        w, h = get_dims(photo_path)
    except Exception:
        w, h = 4000, 3000
    fw, fh = fit_dims(w, h)

    # Alternate zoom direction for visual variety
    inc = 0.04 / frames
    zoom_expr = (
        f"'if(lte(on,1),1.0,min(zoom+{inc:.6f},1.04))'"
        if idx % 2 == 0 else
        f"'if(lte(on,1),1.04,max(zoom-{inc:.6f},1.0))'"
    )

    fc = (
        f"[0:v]scale=1080:1920:force_original_aspect_ratio=increase,"
        f"crop=1080:1920,gblur=sigma=28[bg];"

        f"[0:v]scale={fw}:{fh}[fg_raw];"

        f"[fg_raw]zoompan=z={zoom_expr}:"
        f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
        f"d={frames}:s={fw}x{fh}:fps=30[fg];"

        f"[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p[out]"
    )

    r = subprocess.run([
        "ffmpeg", "-y", "-loop", "1", "-i", str(photo_path),
        "-filter_complex", fc, "-map", "[out]",
        "-t", str(SLIDE_DURATION), "-r", "30",
        "-c:v", "libx264", "-preset", "fast", "-crf", "22",
        str(out),
    ], capture_output=True, text=True)

    if r.returncode != 0:
        print(f"  ⚠️  slide {idx} error: {r.stderr[-400:]}")
        return None
    return out


# ── Concatenate ───────────────────────────────────────────────────────────────

def concat_xfade(slides, tmp_dir):
    if len(slides) == 1:
        out = tmp_dir / "combined.mp4"
        shutil.copy(slides[0], out)
        return out

    inputs = []
    for f in slides:
        inputs += ["-i", str(f)]

    step  = SLIDE_DURATION - TRANSITION_DUR
    parts = [
        f"[0:v][1:v]xfade=transition=fade:duration={TRANSITION_DUR}:offset={step:.2f}[v1]"
    ]
    for i in range(2, len(slides)):
        offset = i * step
        parts.append(
            f"[v{i-1}][{i}:v]xfade=transition=fade:duration={TRANSITION_DUR}:offset={offset:.2f}[v{i}]"
        )
    last = f"v{len(slides)-1}"
    fc   = ";".join(parts) + f";[{last}]format=yuv420p[out]"

    out = tmp_dir / "combined.mp4"
    r   = subprocess.run(
        ["ffmpeg", "-y"] + inputs +
        ["-filter_complex", fc, "-map", "[out]",
         "-c:v", "libx264", "-preset", "fast", "-crf", "21", str(out)],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        print(f"⚠️  xfade נכשל, fallback...")
        return _concat_simple(slides, tmp_dir)
    return out

def _concat_simple(slides, tmp_dir):
    lf = tmp_dir / "list.txt"
    lf.write_text("\n".join(f"file '{f}'" for f in slides))
    out = tmp_dir / "combined.mp4"
    subprocess.run([
        "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(lf),
        "-c:v", "libx264", "-preset", "fast", "-crf", "21", str(out),
    ], capture_output=True)
    return out


# ── Watermark ─────────────────────────────────────────────────────────────────

def add_watermark(video_path, tmp_dir):
    out = tmp_dir / "watermarked.mp4"
    r = subprocess.run([
        "ffmpeg", "-y", "-i", str(video_path),
        "-vf", f"drawtext=text='{WATERMARK}':fontcolor=white@0.35:fontsize=24:x=(w-text_w)/2:y=h-55",
        "-c:v", "libx264", "-preset", "fast", "-crf", "22", str(out),
    ], capture_output=True, text=True)
    return out if r.returncode == 0 else video_path


# ── Audio ─────────────────────────────────────────────────────────────────────

def _gen_ambient(category, duration, tmp_dir):
    """Generate ambient audio via ffmpeg lavfi (no external file needed)."""
    out   = tmp_dir / "ambient.aac"
    gen   = AMBIENT.get(category, AMBIENT["טבע"])
    fade_st = max(0.0, duration - 2.0)
    af    = f"{gen['af']},afade=t=in:st=0:d=1.5,afade=t=out:st={fade_st:.2f}:d=2"

    r = subprocess.run([
        "ffmpeg", "-y", "-f", "lavfi", "-i", gen["src"],
        "-af", af, "-t", str(duration),
        "-ar", "44100", "-ac", "2", "-c:a", "aac", "-b:a", "128k",
        str(out),
    ], capture_output=True, text=True)
    return out if r.returncode == 0 else None

def add_audio(video_path, category, tmp_dir):
    duration = get_duration(video_path)
    fade_st  = max(0.0, duration - 2.0)

    # Prefer real music file if available
    music = MUSIC_DIR / MUSIC_FILES.get(category, "")
    if not music.exists():
        print("⚠️  קובץ מוזיקה לא נמצא — מייצר ambient audio")
        music = _gen_ambient(category, duration, tmp_dir)

    if not music or not Path(music).exists():
        print("⚠️  ללא אודיו")
        return video_path

    out = tmp_dir / "final_audio.mp4"
    r = subprocess.run([
        "ffmpeg", "-y",
        "-i", str(video_path), "-i", str(music),
        "-filter_complex",
        f"[1:a]atrim=0:{duration:.2f},asetpts=PTS-STARTPTS,"
        f"afade=t=in:st=0:d=1.5,afade=t=out:st={fade_st:.2f}:d=2,"
        f"volume=0.38[aud]",
        "-map", "0:v", "-map", "[aud]",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-shortest",
        str(out),
    ], capture_output=True, text=True)

    if r.returncode != 0:
        print(f"⚠️  שגיאת אודיו: {r.stderr[-200:]}")
        return video_path
    return out


# ── Upload ────────────────────────────────────────────────────────────────────

def upload_video(video_path):
    data  = video_path.read_bytes()
    mb    = len(data) / 1024 / 1024
    print(f"📤 גודל וידאו: {mb:.1f} MB")

    for name, url, extra in [
        ("litterbox", "https://litterbox.catbox.moe/resources/internals/api.php",
         {"data": {"reqtype": "fileupload", "time": "1h"}, "file_field": "fileToUpload"}),
        ("0x0.st", "https://0x0.st",
         {"file_field": "file"}),
    ]:
        try:
            files = {extra["file_field"]: ("story.mp4", data, "video/mp4")}
            post_data = extra.get("data", {})
            r = requests.post(url, data=post_data, files=files, timeout=180)
            r.raise_for_status()
            public_url = r.text.strip()
            if public_url.startswith("http"):
                print(f"⬆️  הועלה ({name}): {public_url}")
                return public_url
        except Exception as e:
            print(f"⚠️  {name} נכשל: {e}")

    raise RuntimeError("כל שירותי ה-upload נכשלו")


# ── Publish ───────────────────────────────────────────────────────────────────

def publish_ig(video_url):
    import time
    r = requests.post(f"{GRAPH_API}/{IG_USER_ID}/media", data={
        "video_url":    video_url,
        "media_type":   "STORIES",
        "access_token": ACCESS_TOKEN,
    }, timeout=30)
    if not r.ok:
        print(f"❌ IG container: {r.status_code} {r.text}")
        sys.exit(1)
    creation_id = r.json().get("id")
    if not creation_id:
        print(f"❌ {r.json()}")
        sys.exit(1)
    print(f"📦 IG container: {creation_id}")

    for attempt in range(18):
        time.sleep(5)
        status = requests.get(
            f"{GRAPH_API}/{creation_id}",
            params={"fields": "status_code", "access_token": ACCESS_TOKEN},
            timeout=30,
        ).json().get("status_code", "")
        print(f"  ⏳ [{attempt+1}] {status}")
        if status == "FINISHED":
            break
        if status == "ERROR":
            print("❌ שגיאת עיבוד Instagram")
            sys.exit(1)

    pub = requests.post(f"{GRAPH_API}/{IG_USER_ID}/media_publish", data={
        "creation_id":  creation_id,
        "access_token": ACCESS_TOKEN,
    }, timeout=30)
    pub.raise_for_status()
    return pub.json().get("id")

def publish_fb(video_url):
    """Post video story to Facebook Page. Requires FACEBOOK_PAGE_ID secret."""
    if not FB_PAGE_ID:
        return
    print("📘 מנסה Facebook Story...")
    r = requests.post(f"{GRAPH_API}/{FB_PAGE_ID}/video_stories", data={
        "file_url":     video_url,
        "upload_phase": "single",
        "access_token": ACCESS_TOKEN,
    }, timeout=60)
    if r.ok and r.json().get("success"):
        print("✅ Facebook Story פורסם!")
    else:
        print(f"⚠️  Facebook Story נכשל ({r.status_code}): {r.text[:200]}")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    if not IG_USER_ID or not ACCESS_TOKEN:
        print("❌ חסרים: INSTAGRAM_USER_ID / INSTAGRAM_PAGE_TOKEN")
        sys.exit(1)

    photos = load_photos()
    if not photos:
        print("❌ לא נמצאו תמונות")
        sys.exit(1)

    state              = load_state()
    selected, cat, idx = select_photos(photos, state)
    print(f"📸 קטגוריה: {cat} | {len(selected)} תמונות")

    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)

        # Download
        print("⬇️  מוריד תמונות...")
        photo_paths = []
        for i, photo in enumerate(selected):
            try:
                p = download_photo(photo, tmp_dir, i)
                photo_paths.append(p)
                print(f"  ✓ {photo.get('title', '?')}")
            except Exception as e:
                print(f"  ✗ {photo.get('title', '?')}: {e}")

        if len(photo_paths) < 3:
            print("❌ לא מספיק תמונות הורדו")
            sys.exit(1)

        # Slides
        print("🎬 יוצר slides...")
        slides = []
        for i, path in enumerate(photo_paths):
            s = create_slide(path, i, tmp_dir)
            if s:
                slides.append(s)
                print(f"  ✓ slide {i+1}/{len(photo_paths)}")

        if len(slides) < 2:
            print("❌ לא מספיק slides")
            sys.exit(1)

        # Concat
        print(f"🔗 מחבר {len(slides)} slides עם xfade...")
        combined = concat_xfade(slides, tmp_dir)

        # Watermark
        print("💧 watermark...")
        wm = add_watermark(combined, tmp_dir)

        # Audio
        print(f"🎵 אודיו ({cat})...")
        final = add_audio(wm, cat, tmp_dir)

        sz = Path(final).stat().st_size / 1024 / 1024
        dur = get_duration(Path(final))
        print(f"📹 וידאו מוכן: {sz:.1f} MB, {dur:.1f} שניות")

        # Upload & publish
        video_url = upload_video(Path(final))

        story_id = publish_ig(video_url)
        print(f"✅ Instagram Story: {story_id}")

        publish_fb(video_url)

    # Save state
    state["current_category_index"] = (idx + 1) % len(CATEGORIES)
    state.setdefault("used_ids_by_category", {}).setdefault(cat, []).extend(
        p["id"] for p in selected
    )
    save_state(state)


if __name__ == "__main__":
    main()
