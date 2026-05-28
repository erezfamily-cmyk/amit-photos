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

PHOTOS_PER_STORY = 8
SLIDE_DURATION   = 3.5   # seconds
TRANSITION_DUR   = 0.7   # cross-fade between slides
WATERMARK        = "amitphotos.com"

# Weekly gear tip — appended as final slide every Sunday
GEAR_TOOLS = [
    {
        "name": "Luminar Neo",
        "line1": "AI photo editing",
        "line2": "sky, portraits, landscapes",
    },
    {
        "name": "FlexClip",
        "line1": "Photos to Reels in minutes",
        "line2": "no editing experience needed",
    },
]

# Map real album/category names → music file by keyword matching
NATURE_KEYWORDS   = ["פרחים", "צמחים", "בעלי חיים", "מאקרו", "טבע", "ציפור", "פרח", "חרק"]
PORTRAIT_KEYWORDS = ["פורטרט"]
CINEMATIC_KEYWORDS = ["מופשט", "יצירתי", "אמנות", "דומם"]
# Everything else (travel, locations) → urban-electronic

def get_music_for_category(category):
    if any(k in category for k in NATURE_KEYWORDS):
        return "nature-ambient.mp3"
    if any(k in category for k in PORTRAIT_KEYWORDS):
        return "soft-portrait.mp3"
    if any(k in category for k in CINEMATIC_KEYWORDS):
        return "cinematic-events.mp3"
    return "urban-electronic.mp3"

# ffmpeg lavfi ambient audio fallback (no music file needed)
AMBIENT_BY_MUSIC = {
    "nature-ambient.mp3": {
        "src": "anoisesrc=c=pink:a=0.5:r=44100",
        "af":  "lowpass=f=350,highpass=f=70,volume=0.18",
    },
    "soft-portrait.mp3": {
        "src": "aevalsrc=0.15*sin(2*PI*220*t)+0.1*sin(2*PI*330*t)+0.07*sin(2*PI*440*t)+0.04*sin(2*PI*110*t):s=44100:c=stereo",
        "af":  "aecho=0.6:0.5:900:0.35,lowpass=f=700,volume=0.30",
    },
    "urban-electronic.mp3": {
        "src": "anoisesrc=c=white:a=0.35:r=44100",
        "af":  "bandpass=f=180:width_type=h:w=80,volume=0.12",
    },
    "cinematic-events.mp3": {
        "src": "aevalsrc=0.18*sin(2*PI*261.63*t)+0.13*sin(2*PI*329.63*t)+0.1*sin(2*PI*392*t)+0.07*sin(2*PI*523.25*t):s=44100:c=stereo",
        "af":  "aecho=0.7:0.6:700:0.4,lowpass=f=1500,volume=0.28",
    },
}


# ── State ─────────────────────────────────────────────────────────────────────

def load_state():
    default = {"current_category_index": 0, "used_ids_by_category": {}}
    if not STORY_FILE.exists():
        return default
    data = json.loads(STORY_FILE.read_text(encoding="utf-8"))
    if "used_ids_by_category" not in data:
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
    from collections import defaultdict
    by_cat = defaultdict(list)
    for p in photos:
        c = p.get("category", "").strip()
        if c:
            by_cat[c].append(p)

    # All albums with at least 3 photos, sorted for stable daily rotation
    valid_cats = sorted(c for c, ps in by_cat.items() if len(ps) >= 3)
    if not valid_cats:
        return random.sample(photos, min(PHOTOS_PER_STORY, len(photos))), "כללי", 0

    cat_idx  = state.get("current_category_index", 0) % len(valid_cats)
    category = valid_cats[cat_idx]
    pool     = by_cat[category]

    used  = set(state.get("used_ids_by_category", {}).get(category, []))
    avail = [p for p in pool if p["id"] not in used]
    if len(avail) < min(PHOTOS_PER_STORY, len(pool)):
        state.setdefault("used_ids_by_category", {})[category] = []
        avail = pool
        print(f"🔄 '{category}' מתחיל מחדש")

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


# ── Gear slide ───────────────────────────────────────────────────────────────

def should_add_gear_slide():
    from datetime import datetime
    return datetime.utcnow().weekday() == 6  # Sunday

def get_current_gear_tool(state):
    idx = state.get("gear_tool_index", 0) % len(GEAR_TOOLS)
    return GEAR_TOOLS[idx], idx

def create_gear_slide(tool, tmp_dir):
    """Dark-background branded tool mention slide (English, ffmpeg drawtext)."""
    out   = tmp_dir / "gear_slide.mp4"
    name  = tool["name"].replace("'", "\\'")
    line1 = tool["line1"].replace("'", "\\'")
    line2 = tool["line2"].replace("'", "\\'")

    vf = (
        "drawbox=x=0:y=0:w=1080:h=8:color=0xf0a500:t=fill,"
        f"drawtext=text='{name}':fontcolor=white:fontsize=72:x=(w-text_w)/2:y=820,"
        f"drawtext=text='{line1}':fontcolor=white@0.80:fontsize=34:x=(w-text_w)/2:y=924,"
        f"drawtext=text='{line2}':fontcolor=white@0.65:fontsize=28:x=(w-text_w)/2:y=972,"
        "drawtext=text='link in bio >>':fontcolor=0xf0a500:fontsize=40:x=(w-text_w)/2:y=1060,"
        f"drawtext=text='{WATERMARK}':fontcolor=white@0.35:fontsize=22:x=(w-text_w)/2:y=h-55"
    )

    r = subprocess.run([
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", "color=c=0x0f0f23:s=1080x1920:r=30",
        "-vf", vf,
        "-t", str(SLIDE_DURATION), "-r", "30",
        "-c:v", "libx264", "-preset", "fast", "-crf", "22",
        "-pix_fmt", "yuv420p",
        str(out),
    ], capture_output=True, text=True)

    if r.returncode != 0:
        print(f"⚠️  gear slide error: {r.stderr[-300:]}")
        return None
    return out


# ── Audio ─────────────────────────────────────────────────────────────────────

def _gen_ambient(music_file, duration, tmp_dir):
    """Generate ambient audio via ffmpeg lavfi (no external file needed)."""
    out   = tmp_dir / "ambient.aac"
    gen   = AMBIENT_BY_MUSIC.get(music_file, AMBIENT_BY_MUSIC["urban-electronic.mp3"])
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
    duration  = get_duration(video_path)
    fade_st   = max(0.0, duration - 2.0)
    music_file = get_music_for_category(category)

    # Prefer real music file if available
    music = MUSIC_DIR / music_file
    if not music.exists():
        print(f"⚠️  {music_file} לא נמצא — מייצר ambient audio")
        music = _gen_ambient(music_file, duration, tmp_dir)

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


def publish_fb_reels(video_path, category):
    """Upload video as Facebook Reel (binary upload, 3-phase). Requires FACEBOOK_PAGE_ID."""
    if not FB_PAGE_ID:
        return
    print("🎬 Facebook Reel...")

    # Phase 1: start
    r = requests.post(f"{GRAPH_API}/{FB_PAGE_ID}/video_reels", data={
        "upload_phase": "start",
        "access_token": ACCESS_TOKEN,
    }, timeout=30)
    if not r.ok:
        print(f"⚠️  FB Reels start: {r.status_code} {r.text[:200]}")
        return
    d = r.json()
    video_id   = d.get("video_id")
    upload_url = d.get("upload_url")
    if not video_id or not upload_url:
        print(f"⚠️  FB Reels: {d}")
        return

    # Phase 2: binary upload
    video_bytes = Path(video_path).read_bytes()
    up = requests.put(
        upload_url,
        headers={
            "Authorization": f"OAuth {ACCESS_TOKEN}",
            "Content-Type":  "video/mp4",
            "offset":        "0",
            "file_size":     str(len(video_bytes)),
        },
        data=video_bytes,
        timeout=180,
    )
    if not up.ok:
        print(f"⚠️  FB Reels upload: {up.status_code} {up.text[:200]}")
        return

    # Phase 3: publish
    fin = requests.post(f"{GRAPH_API}/{FB_PAGE_ID}/video_reels", data={
        "upload_phase": "finish",
        "video_id":     video_id,
        "title":        f"Photography — {category}",
        "description":  f"📸 {category}\n\namitphotos.com",
        "published":    "true",
        "access_token": ACCESS_TOKEN,
    }, timeout=30)
    if fin.ok and fin.json().get("success"):
        print("✅ Facebook Reel פורסם!")
    else:
        print(f"⚠️  FB Reels finish: {fin.status_code} {fin.text[:200]}")


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

        # Weekly gear tip slide (Sundays)
        if should_add_gear_slide():
            gear_tool, gear_idx = get_current_gear_tool(state)
            print(f"📢 gear slide: {gear_tool['name']}")
            gs = create_gear_slide(gear_tool, tmp_dir)
            if gs:
                slides.append(gs)
                state["gear_tool_index"] = (gear_idx + 1) % len(GEAR_TOOLS)

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
        publish_fb_reels(Path(final), cat)

    # Save state
    from collections import defaultdict
    by_cat = defaultdict(list)
    for p in photos:
        c = p.get("category", "").strip()
        if c:
            by_cat[c].append(p)
    valid_cats = sorted(c for c, ps in by_cat.items() if len(ps) >= 3)
    state["current_category_index"] = (idx + 1) % max(len(valid_cats), 1)
    state.setdefault("used_ids_by_category", {}).setdefault(cat, []).extend(
        p["id"] for p in selected
    )
    save_state(state)


if __name__ == "__main__":
    main()
