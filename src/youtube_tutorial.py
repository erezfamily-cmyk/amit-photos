#!/usr/bin/env python3
"""
YouTube Tutorial Generator — Camera Education → Video
Converts existing /camera/ HTML guides to narrated YouTube tutorial videos.

Flow:
  1. Parse English text from guide HTML (data-en attributes)
  2. ElevenLabs API → MP3 narration
  3. Relevant photos → Ken Burns slides (16:9)
  4. ffmpeg: slides + narration + background music → video
  5. YouTube Data API → upload

Usage:
  python src/youtube_tutorial.py                    # picks next unposted guide
  python src/youtube_tutorial.py depth-of-field     # specific guide
  python src/youtube_tutorial.py --all              # queue all
"""

import os, sys, json, re, random, requests, subprocess, tempfile, shutil, base64, html
from pathlib import Path
from collections import defaultdict
from videos_utils import append_video, update_video_id_he

SITE_URL  = "https://amitphotos.com"
ROOT      = Path(__file__).parent.parent
DATA_DIR  = ROOT / "data"
MUSIC_DIR = ROOT / "assets" / "music"
POSTED_FILE = DATA_DIR / "youtube_tutorials_posted.json"

W, H           = 1920, 1080
SLIDE_DURATION = 6.0   # seconds per photo slide
TRANSITION     = 0.8
TITLE_DUR      = 4.0
OUTRO_DUR      = 5.0

ELEVENLABS_KEY  = os.environ.get("ELEVENLABS_API_KEY", "")
ELEVENLABS_VOICE = "pNInz6obpgDQGcFmaJgB"   # Adam — calm, authoritative male
ELEVENLABS_VOICE_HE = "pNInz6obpgDQGcFmaJgB"  # Adam — eleven_multilingual_v2 reads Hebrew text natively
ELEVENLABS_MODEL_HE  = "eleven_multilingual_v2"
ELEVENLABS_URL  = "https://api.elevenlabs.io/v1/text-to-speech"

# Map guide slug → photo categories that best illustrate the topic
GUIDE_PHOTO_CATS = {
    "depth-of-field":  ["פורטרטים", "מאקרו-צילומי תקריב", "פרחים וצמחים"],
    "composition":     ["ישראל", "איטליה", "ספרד ואנדורה"],
    "exposure":        ["ישראל", "גרמניה", "אנגליה"],
    "light":           ["פרחים וצמחים", "ישראל", "איטליה"],
    "focus":           ["בעלי חיים", "מאקרו-צילומי תקריב", "פורטרטים"],
    "landscape":       ["ישראל", "איטליה", "טנזניה", "מונטנגרו"],
    "portrait":        ["פורטרטים"],
    "macro":           ["מאקרו-צילומי תקריב", "פרחים וצמחים", "בעלי חיים"],
    "histogram":       ["ישראל", "טבע דומם"],
    "white-balance":   ["ישראל", "איטליה"],
    "filters":         ["ישראל", "טבע דומם"],
    "editing":         ["ישראל", "פורטרטים"],
    "lenses":          ["בעלי חיים", "ספרד ואנדורה", "ישראל"],
    "controls":        ["ישראל", "איטליה"],
    "dynamic-range":   ["ישראל", "טנזניה"],
    "visual-language": ["צילום מופשט", "ישראל"],
    "types":           ["ישראל", "בעלי חיים"],
    "sports":          ["בעלי חיים", "ישראל"],
    "mobile":          ["ישראל", "פרחים וצמחים"],
    "software":        ["ישראל", "פורטרטים"],
}

ALL_GUIDES = list(GUIDE_PHOTO_CATS.keys())

# Text to skip in narration (UI elements)
SKIP_PATTERNS = [
    r"buy me a coffee", r"affiliate link", r"small commission",
    r"back to photography school", r"photography school",
    r"←", r"→", r"view at adorama", r"buy at skylum",
    r"try flexclip", r"link in bio",
]

SKIP_PATTERNS_HE = [
    r"ראה באדוראמה", r"ב-adorama", r"ב-skylum", r"ב-flexclip",
    r"קנה לי קפה", r"קישור שותף", r"עמלה קטנה",
    r"חזרה לבית ספר לצילום",
    r"kofi", r"gumroad", r"awin", r"affiliate",
    r"←", r"→",
]


# ── State ─────────────────────────────────────────────────────────────────────

def load_state():
    if POSTED_FILE.exists():
        return json.loads(POSTED_FILE.read_text(encoding="utf-8"))
    return {"posted_guides": []}

def save_state(state):
    POSTED_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")

def pick_guide(state, requested=None):
    if requested:
        return requested
    posted = set(state.get("posted_guides", []))
    avail  = [g for g in ALL_GUIDES if g not in posted]
    if not avail:
        print("🔄 כל המדריכים כוסו — מתחיל מחדש")
        state["posted_guides"] = []
        avail = ALL_GUIDES
    return avail[0]


# ── HTML parsing ──────────────────────────────────────────────────────────────

def _load_guide_html(slug):
    """Load guide HTML from disk or fallback to HTTP fetch."""
    guide_path = ROOT / "camera" / slug / "index.html"
    if guide_path.exists():
        return guide_path.read_text(encoding="utf-8")
    try:
        r = requests.get(f"{SITE_URL}/camera/{slug}/", timeout=15)
        r.raise_for_status()
        return r.text
    except Exception as e:
        print(f"❌ לא נמצא מדריך: {slug} ({e})")
        sys.exit(1)


def extract_english_sections(slug):
    """Parse English content from guide HTML into narration sections."""
    content = _load_guide_html(slug)

    # Extract data-en values (longer than 30 chars = real content)
    raw = re.findall(r'data-en="([^"]{30,})"', content)

    sections = []
    for text in raw:
        # Decode HTML entities
        text = html.unescape(text)
        # Remove HTML tags
        text = re.sub(r"<[^>]+>", " ", text)
        # Clean whitespace
        text = re.sub(r"\s+", " ", text).strip()
        # Skip UI / affiliate text
        lower = text.lower()
        if any(re.search(p, lower) for p in SKIP_PATTERNS):
            continue
        if len(text) < 40:
            continue
        sections.append(text)

    return sections

def extract_hebrew_sections(slug):
    """Parse Hebrew content from guide HTML into narration sections."""
    content = _load_guide_html(slug)

    raw = re.findall(r'data-he="([^"]{30,})"', content)

    sections = []
    for text in raw:
        text = html.unescape(text)
        text = re.sub(r"<[^>]+>", " ", text)
        text = re.sub(r"\s+", " ", text).strip()
        lower = text.lower()
        if any(re.search(p, lower) for p in SKIP_PATTERNS_HE):
            continue
        if len(text) < 40:
            continue
        sections.append(text)

    return sections


def extract_guide_title_he(slug):
    """Extract Hebrew <h1> text from guide HTML."""
    guide_path = ROOT / "camera" / slug / "index.html"
    if guide_path.exists():
        content = guide_path.read_text(encoding="utf-8")
        m = re.search(r'<h1[^>]+data-he="([^"]+)"', content)
        if m:
            return html.unescape(m.group(1))
    return slug.replace("-", " ").title()


def extract_summary_en(script, n_sentences=3):
    """Return first N sentences of narration script as English summary."""
    sentences = re.split(r'(?<=[.!?])\s+', script.strip())
    return " ".join(sentences[:n_sentences])


def build_narration_script(slug, sections):
    """Build a clean narration script from sections."""
    guide_title = slug.replace("-", " ").title()

    lines = [
        f"Welcome to Amit Erez Photography.",
        f"In this guide, we'll explore {guide_title}.",
        "",
    ]
    lines += sections
    lines += [
        "",
        "Thanks for watching.",
        "For more photography guides, visit amitphotos.com.",
        "Don't forget to subscribe for weekly photography content.",
    ]

    # Join with natural pauses (ElevenLabs respects punctuation)
    script = " ".join(l if l else "..." for l in lines)
    script = re.sub(r"\.{3,}", "...", script)
    return script


def build_hebrew_narration_script(slug, sections, guide_title_he):
    """Build a Hebrew narration script."""
    lines = [
        f"ברוכים הבאים לבית ספר לצילום של עמית ארז.",
        f"במדריך הזה נלמד על {guide_title_he}.",
        "",
    ]
    lines += sections
    lines += [
        "",
        "תודה על הצפייה.",
        "למדריכים נוספים, היכנסו ל-amitphotos.com.",
        "אל תשכחו להירשם לתוכן צילום שבועי.",
    ]

    script = " ".join(l if l else "..." for l in lines)
    script = re.sub(r"\.{3,}", "...", script)
    return script


# ── ElevenLabs TTS ────────────────────────────────────────────────────────────

def generate_narration(script, tmp_dir, lang="en"):
    """Send script to ElevenLabs → MP3 file."""
    if not ELEVENLABS_KEY:
        print("⚠️  ELEVENLABS_API_KEY חסר — ממשיך בלי narration")
        return None

    print(f"🎙️  ElevenLabs TTS ({len(script)} תווים)...")

    # ElevenLabs limits: 5000 chars per request — split if needed
    chunks    = [script[i:i+4500] for i in range(0, len(script), 4500)]
    audio_parts = []

    for i, chunk in enumerate(chunks):
        voice = ELEVENLABS_VOICE_HE if lang == "he" else ELEVENLABS_VOICE
        model = ELEVENLABS_MODEL_HE  if lang == "he" else "eleven_turbo_v2_5"
        r = requests.post(
            f"{ELEVENLABS_URL}/{voice}",
            headers={
                "xi-api-key":   ELEVENLABS_KEY,
                "Content-Type": "application/json",
                "Accept":       "audio/mpeg",
            },
            json={
                "text": chunk,
                "model_id": model,
                "voice_settings": {
                    "stability":        0.55,
                    "similarity_boost": 0.80,
                    "style":            0.20,
                    "use_speaker_boost": True,
                },
            },
            timeout=60,
        )
        if not r.ok:
            print(f"⚠️  ElevenLabs שגיאה: {r.status_code} {r.text[:200]}")
            return None

        part = tmp_dir / f"narration_{i:02d}.mp3"
        part.write_bytes(r.content)
        audio_parts.append(part)
        print(f"  ✓ חלק {i+1}/{len(chunks)}")

    if len(audio_parts) == 1:
        return audio_parts[0]

    # Concat audio parts
    out = tmp_dir / "narration.mp3"
    list_file = tmp_dir / "audio_list.txt"
    list_file.write_text("\n".join(f"file '{p}'" for p in audio_parts))
    subprocess.run([
        "ffmpeg", "-y", "-f", "concat", "-safe", "0",
        "-i", str(list_file), "-c", "copy", str(out),
    ], capture_output=True)
    return out


# ── Photos ────────────────────────────────────────────────────────────────────

def load_photos():
    try:
        r = requests.get(f"{SITE_URL}/api/photos", timeout=15)
        r.raise_for_status()
        valid = [p for p in r.json()
                 if p.get("title") and not p["title"].upper().startswith("DSC_")]
        if valid:
            return valid
    except Exception as e:
        print(f"⚠️  API: {e}")
    jf = DATA_DIR / "photos.json"
    if jf.exists():
        return [p for p in json.loads(jf.read_text(encoding="utf-8"))
                if p.get("title") and not p["title"].upper().startswith("DSC_")]
    return []

def select_photos_for_guide(photos, slug, n=40):
    cats = GUIDE_PHOTO_CATS.get(slug, [])
    by_cat = defaultdict(list)
    for p in photos:
        by_cat[p.get("category", "")].append(p)

    pool = []
    for cat in cats:
        pool += by_cat.get(cat, [])

    if len(pool) < 10:
        # fallback: any photos
        pool = photos

    return random.sample(pool, min(n, len(pool)))

def download_photo(photo, tmp_dir, idx):
    url = photo.get("url") or photo.get("thumbnail", "")
    if url.startswith("/"):
        url = f"{SITE_URL}{url}"
    r = requests.get(url, timeout=30, headers={"User-Agent": "Mozilla/5.0"})
    r.raise_for_status()
    path = tmp_dir / f"photo_{idx:03d}.jpg"
    path.write_bytes(r.content)
    return path


# ── Video ─────────────────────────────────────────────────────────────────────

def get_dims(path):
    r = subprocess.run(
        ["ffprobe", "-v", "quiet", "-select_streams", "v:0",
         "-show_entries", "stream=width,height", "-of", "json", str(path)],
        capture_output=True, text=True,
    )
    s = json.loads(r.stdout)["streams"][0]
    return s["width"], s["height"]

def fit_dims(w, h, max_w=1860, max_h=1020):
    if not w or not h:
        return max_w, max_h
    ratio = min(max_w / w, max_h / h)
    return max(int(w * ratio) & ~1, 2), max(int(h * ratio) & ~1, 2)

def get_audio_duration(path):
    r = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", str(path)],
        capture_output=True, text=True,
    )
    try:
        return float(json.loads(r.stdout)["format"]["duration"])
    except Exception:
        return 300.0

def create_title_card(slug, tmp_dir):
    title = slug.replace("-", " ").title()
    vf = (
        f"drawtext=text='{title}':"
        f"fontcolor=white:fontsize=72:x=(w-text_w)/2:y=h/2-60,"
        f"drawtext=text='Amit Erez Photography':"
        f"fontcolor=white@0.65:fontsize=36:x=(w-text_w)/2:y=h/2+20,"
        f"drawtext=text='amitphotos.com':"
        f"fontcolor=0xf0a500:fontsize=28:x=(w-text_w)/2:y=h/2+80"
    )
    out = tmp_dir / "title.mp4"
    subprocess.run([
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", f"color=c=0x0a0a1a:s={W}x{H}:r=30",
        "-vf", vf, "-t", str(TITLE_DUR), "-r", "30",
        "-c:v", "libx264", "-preset", "fast", "-crf", "22", "-pix_fmt", "yuv420p",
        str(out),
    ], capture_output=True)
    return out

def create_outro(tmp_dir):
    vf = (
        "drawtext=text='Subscribe for more photography':"
        "fontcolor=white:fontsize=56:x=(w-text_w)/2:y=h/2-50,"
        "drawtext=text='amitphotos.com':"
        "fontcolor=0xf0a500:fontsize=44:x=(w-text_w)/2:y=h/2+30"
    )
    out = tmp_dir / "outro.mp4"
    subprocess.run([
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", f"color=c=0x0a0a1a:s={W}x{H}:r=30",
        "-vf", vf, "-t", str(OUTRO_DUR), "-r", "30",
        "-c:v", "libx264", "-preset", "fast", "-crf", "22", "-pix_fmt", "yuv420p",
        str(out),
    ], capture_output=True)
    return out

def create_photo_slide(photo_path, idx, tmp_dir, duration):
    out    = tmp_dir / f"slide_{idx:03d}.mp4"
    frames = int(duration * 30)
    try:
        w, h = get_dims(photo_path)
    except Exception:
        w, h = 4000, 3000
    fw, fh = fit_dims(w, h)

    inc = 0.04 / frames
    zoom_expr = (
        f"'if(lte(on,1),1.0,min(zoom+{inc:.6f},1.04))'"
        if idx % 2 == 0 else
        f"'if(lte(on,1),1.04,max(zoom-{inc:.6f},1.0))'"
    )

    fc = (
        f"[0:v]scale={W}:{H}:force_original_aspect_ratio=increase,"
        f"crop={W}:{H},gblur=sigma=28[bg];"
        f"[0:v]scale={fw}:{fh}[fg_raw];"
        f"[fg_raw]zoompan=z={zoom_expr}:"
        f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
        f"d={frames}:s={fw}x{fh}:fps=30[fg];"
        f"[bg][fg]overlay=(W-w)/2:(H-h)/2,"
        f"drawtext=text='amitphotos.com':"
        f"fontcolor=white@0.25:fontsize=20:x=W-tw-20:y=H-40,"
        f"format=yuv420p[out]"
    )

    r = subprocess.run([
        "ffmpeg", "-y", "-loop", "1", "-i", str(photo_path),
        "-filter_complex", fc, "-map", "[out]",
        "-t", str(duration), "-r", "30",
        "-c:v", "libx264", "-preset", "fast", "-crf", "22",
        str(out),
    ], capture_output=True, text=True)
    return out if r.returncode == 0 else None

def concat_clips(clips, tmp_dir):
    lf  = tmp_dir / "clips.txt"
    lf.write_text("\n".join(f"file '{c}'" for c in clips))
    out = tmp_dir / "silent_video.mp4"
    subprocess.run([
        "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(lf),
        "-c:v", "libx264", "-preset", "fast", "-crf", "21", str(out),
    ], capture_output=True)
    return out

def add_narration_and_music(video_path, narration_path, tmp_dir):
    """Mix narration (foreground) with music (background) and mux into video."""
    music_files = list(MUSIC_DIR.glob("*.mp3"))
    out = tmp_dir / "final.mp4"

    if narration_path and narration_path.exists() and music_files:
        music = random.choice(music_files)
        r = subprocess.run([
            "ffmpeg", "-y",
            "-i", str(video_path),
            "-i", str(narration_path),
            "-stream_loop", "-1", "-i", str(music),
            "-filter_complex",
            "[1:a]volume=1.0[narr];"
            "[2:a]volume=0.12[bg];"
            "[narr][bg]amix=inputs=2:duration=first[aud]",
            "-map", "0:v", "-map", "[aud]",
            "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
            "-shortest", str(out),
        ], capture_output=True, text=True)
        if r.returncode == 0:
            return out

    elif narration_path and narration_path.exists():
        r = subprocess.run([
            "ffmpeg", "-y",
            "-i", str(video_path), "-i", str(narration_path),
            "-map", "0:v", "-map", "1:a",
            "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
            "-shortest", str(out),
        ], capture_output=True, text=True)
        if r.returncode == 0:
            return out

    return video_path


# ── YouTube upload ─────────────────────────────────────────────────────────────

def upload_to_youtube(video_path, slug, n_photos, lang="en"):
    token_b64 = os.environ.get("YOUTUBE_TOKEN_JSON", "")
    if not token_b64:
        print("⚠️  YOUTUBE_TOKEN_JSON חסר — וידאו נשמר מקומית")
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

    guide_title_he = extract_guide_title_he(slug)
    title_en_raw   = slug.replace("-", " ").title()

    if lang == "he":
        yt_title = f"{guide_title_he} — מדריך צילום | עמית ארז"
        yt_desc  = (
            f"למד על {guide_title_he} עם דוגמאות אמיתיות מצילום.\n\n"
            f"עמית ארז — צלם אמנות ישראלי — מדריך אותך עם {n_photos} תמונות אמיתיות.\n\n"
            f"📷 מדריך מלא:\nhttps://amitphotos.com/camera/{slug}/\n\n"
            f"🌐 גלריה מלאה:\nhttps://amitphotos.com\n\n"
            f"#צילום #{guide_title_he.replace(' ','')} #מדריך_צילום #עמיתארז"
        )
        yt_tags  = ["צילום", "מדריך", guide_title_he, "עמית ארז", "amitphotos",
                    "מצלמה", "טיפים לצילום", "צילום ישראלי"]
        yt_lang  = "iw"
    else:
        yt_title = f"{title_en_raw} — Photography Tutorial | Amit Erez"
        yt_desc  = (
            f"Learn {title_en_raw} through real photography examples.\n\n"
            f"In this tutorial, Amit Erez — a fine art photographer based in Israel — "
            f"walks you through practical techniques with {n_photos} real photos.\n\n"
            f"📷 Full photography guide:\nhttps://amitphotos.com/camera/{slug}/\n\n"
            f"🌐 Full gallery:\nhttps://amitphotos.com\n\n"
            f"#photography #{title_en_raw.replace(' ','')} #photographytutorial #AmitErez"
        )
        yt_tags  = ["photography", "tutorial", title_en_raw, "Amit Erez", "amitphotos",
                    "camera", "photography tips", "Israel photography"]
        yt_lang  = "en"

    body = {
        "snippet": {
            "title":                yt_title,
            "description":          yt_desc,
            "tags":                 yt_tags,
            "categoryId":           "27",
            "defaultAudioLanguage": yt_lang,
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


# ── Main ──────────────────────────────────────────────────────────────────────

def process_guide(slug, photos, tmp_dir, lang="en"):
    print(f"\n🎬 מדריך: {slug}")

    # 1. Extract & build script
    if lang == "he":
        title_he  = extract_guide_title_he(slug)
        sections  = extract_hebrew_sections(slug)
        if not sections:
            print(f"⚠️  לא נמצא תוכן עברי ב-{slug}")
            return None
        script = build_hebrew_narration_script(slug, sections, title_he)
        print(f"📝 Script HE: {len(script)} תווים, {len(sections)} sections")
    else:
        sections = extract_english_sections(slug)
        if not sections:
            print(f"⚠️  לא נמצא תוכן אנגלית ב-{slug}")
            return None
        script = build_narration_script(slug, sections)
        print(f"📝 Script EN: {len(script)} תווים, {len(sections)} sections")

    # 2. TTS narration
    narration = generate_narration(script, tmp_dir, lang=lang)

    # 3. Calculate video length from narration (or default)
    if narration and narration.exists():
        target_duration = get_audio_duration(narration) + TITLE_DUR + OUTRO_DUR
    else:
        target_duration = 300.0  # 5 min default

    # 4. Select & download photos
    selected = select_photos_for_guide(photos, slug,
                                       n=int((target_duration - TITLE_DUR - OUTRO_DUR) / SLIDE_DURATION) + 2)
    print(f"📸 {len(selected)} תמונות")

    photo_paths = []
    for i, photo in enumerate(selected):
        try:
            photo_paths.append(download_photo(photo, tmp_dir, i))
        except Exception as e:
            print(f"  ✗ {e}")

    if len(photo_paths) < 3:
        print("❌ לא מספיק תמונות")
        return None

    # 5. Create video clips
    clips = []
    title_clip = create_title_card(slug, tmp_dir)
    if title_clip and title_clip.exists():
        clips.append(title_clip)

    for i, path in enumerate(photo_paths):
        s = create_photo_slide(path, i, tmp_dir, SLIDE_DURATION)
        if s:
            clips.append(s)
    if (i + 1) % 10 == 0:
        print(f"  {i+1}/{len(photo_paths)} slides")

    outro = create_outro(tmp_dir)
    if outro and outro.exists():
        clips.append(outro)

    if len(clips) < 3:
        return None

    # 6. Concat + audio
    print("🔗 מחבר...")
    silent  = concat_clips(clips, tmp_dir)
    print("🎵 מוסיף narration + מוזיקה...")
    final   = add_narration_and_music(silent, narration, tmp_dir)

    sz  = Path(final).stat().st_size / 1024 / 1024
    dur = get_audio_duration(Path(final))
    print(f"📹 {dur:.0f} שניות | {sz:.0f} MB")

    # 7. Upload
    vid_id = upload_to_youtube(Path(final), slug, len(photo_paths), lang=lang)

    if not vid_id:
        dest = ROOT / f"tutorial_{slug}.mp4"
        shutil.copy(final, dest)
        print(f"💾 נשמר: {dest}")

    return vid_id or True


def _delete_youtube_video(video_id):
    token_b64 = os.environ.get("YOUTUBE_TOKEN_JSON", "")
    if not token_b64 or not video_id:
        return
    try:
        from googleapiclient.discovery import build
        from google.oauth2.credentials import Credentials
        from google.auth.transport.requests import Request
        creds = Credentials.from_authorized_user_info(
            json.loads(base64.b64decode(token_b64).decode()))
        if creds.expired and creds.refresh_token:
            creds.refresh(Request())
        build("youtube", "v3", credentials=creds,
              cache_discovery=False).videos().delete(id=video_id).execute()
        print(f"🗑️  נמחק: {video_id}")
    except Exception as e:
        print(f"⚠️  מחיקה: {e}")


def main():
    args = sys.argv[1:]

    # --replace VIDEO_ID
    replace_id = None
    if "--replace" in args:
        idx = args.index("--replace")
        if idx + 1 < len(args):
            replace_id = args[idx + 1]
            args = [a for a in args if a not in ("--replace", replace_id)]

    # --lang he/en
    lang = "en"
    if "--lang" in args:
        idx = args.index("--lang")
        if idx + 1 < len(args):
            lang = args[idx + 1]
            args = [a for a in args if a not in ("--lang", lang)]

    if not ELEVENLABS_KEY:
        print("⚠️  ELEVENLABS_API_KEY לא מוגדר")

    photos = load_photos()
    if not photos:
        print("❌ לא נמצאו תמונות")
        sys.exit(1)

    state = load_state()

    if "--all" in args:
        guides = ALL_GUIDES
    elif args and not args[0].startswith("--"):
        guides = [args[0]]
    else:
        guides = [pick_guide(state)]

    for slug in guides:
        with tempfile.TemporaryDirectory() as tmp:
            # Delete old video before uploading improved version
            if replace_id:
                _delete_youtube_video(replace_id)
                replace_id = None

            result = process_guide(slug, photos, Path(tmp), lang=lang)
            if result:
                state.setdefault("posted_guides", []).append(slug)
                save_state(state)
                if isinstance(result, str):
                    if lang == "he":
                        update_video_id_he(slug, result)
                    else:
                        sections = extract_english_sections(slug)
                        script   = build_narration_script(slug, sections) if sections else ""
                        title_en = slug.replace("-", " ").title()
                        append_video({
                            "id":         result,
                            "id_he":      None,
                            "platform":   "youtube",
                            "type":       "tutorial",
                            "slug":       slug,
                            "title_he":   extract_guide_title_he(slug),
                            "title_en":   f"{title_en} — Photography Tutorial",
                            "summary_he": "",
                            "summary_en": extract_summary_en(script),
                        })


if __name__ == "__main__":
    main()
