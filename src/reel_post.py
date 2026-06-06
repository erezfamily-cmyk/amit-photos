#!/usr/bin/env python3
"""
reel_post.py — יוצר רילס 10 שניות מאלבום ומפרסם ל-Instagram

שימוש:
  python src/reel_post.py --list
  python src/reel_post.py --category "בעלי חיים"
  python src/reel_post.py --category "ישראל" --lang en
  python src/reel_post.py --category "טנזניה" --dry-run   # בדיקה ללא וידאו
"""

import argparse
import json
import os
import random
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request as ul
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

try:
    from PIL import Image, ImageDraw, ImageFont
    HAS_PILLOW = True
except ImportError:
    HAS_PILLOW = False

try:
    from bidi.algorithm import get_display as bidi_display
    HAS_BIDI = True
except ImportError:
    HAS_BIDI = False


def _bidi(text):
    return bidi_display(text) if HAS_BIDI else text


# ── קבועים ───────────────────────────────────────────────────────────────────

GRAPH_API = "https://graph.facebook.com/v21.0"
SITE_URL  = "https://amitphotos.com"
ROOT      = Path(__file__).parent.parent
DATA_DIR  = ROOT / "data"

CTA_COUNTER  = DATA_DIR / "reels_cta_counter.json"
ALBUM_OUTPUT = ROOT / "reels_output"

W, H             = 1080, 1920
FPS              = 30
CLOSING_SECS     = 2.5

# Ken Burns mode (no FAL_KEY)
NUM_PHOTOS_KB    = 3
PHOTO_SECS_KB    = (10.0 - CLOSING_SECS) / NUM_PHOTOS_KB   # 2.5s each

# Kling/AI mode (FAL_KEY available)
NUM_PHOTOS_SD    = 5
PHOTO_SECS_SD    = 5.0   # Kling 1.6 outputs 5s per clip → 5×5=25s + closing

def _find_font(names):
    import platform
    candidates = (
        [f"C:/Windows/Fonts/{n}" for n in names] if platform.system() == "Windows"
        else [f"/usr/share/fonts/truetype/liberation/Liberation{n}" for n in ["Sans-Regular.ttf", "Sans-Bold.ttf"]]
          + [f"/usr/share/fonts/truetype/dejavu/DejaVuSans{n}" for n in [".ttf", "-Bold.ttf"]]
    )
    for c in candidates:
        if Path(c).exists():
            return c
    return None

FONT_REGULAR = _find_font(["arial.ttf", "Arial.ttf"]) or "arial.ttf"
FONT_BOLD    = _find_font(["arialbd.ttf", "Arial-Bold.ttf"]) or "arial.ttf"

IG_USER_ID        = os.environ.get("INSTAGRAM_USER_ID", "")
ACCESS_TOKEN      = os.environ.get("INSTAGRAM_PAGE_TOKEN", "")
FAL_KEY           = os.environ.get("FAL_KEY", "")
ANTHROPIC_API_KEY = (os.environ.get("ANTHROPIC_API_KEY") or
                     os.environ.get("AMIT_PHOTO_AGENT") or "").strip()

# פרומפטים לתנועה לפי קטגוריה
MOTION_PROMPTS = {
    "פרחים וצמחים":       "cinematic macro shot, gentle breeze moves petals softly, warm golden light, shallow depth of field, smooth slow motion",
    "בעלי חיים":           "cinematic wildlife shot, animal breathes naturally, subtle body movement, dramatic golden hour lighting, National Geographic style",
    "מאקרו-צילומי תקריב": "extreme macro cinematic, micro details emerge slowly, gentle vibration, bokeh background, ultra sharp focus pull",
    "צילום מופשט":         "slow cinematic dolly, dreamlike light rays shift, color gradient flows, artistic atmospheric mood",
    "ישראל":               "cinematic slow pan across landscape, warm Mediterranean golden light, atmospheric haze, travel film aesthetic",
    "טבע דומם":            "cinematic product shot, soft dramatic light shifts across surface, subtle shadow movement, luxury still life",
    "שחור-לבן":            "dramatic noir cinema, deep shadows shift slowly, high contrast light movement, timeless black and white film",
    "טנזניה":              "epic wildlife cinema, savanna grass sways in warm breeze, golden African sunset atmosphere, documentary style",
    "ספרד ואנדורה":        "cinematic travel film, warm mediterranean sunlight drifts across scene, gentle atmospheric motion",
    "איטליה":              "cinematic Italian golden hour, soft warm light glows across architecture, slow atmospheric drift",
    "סלובקיה":             "cinematic mountain landscape, crisp air atmospheric shimmer, dramatic clouds drift slowly",
    "גרמניה":              "cinematic European street scene, soft light drifts, atmospheric depth, travel documentary style",
    "אנגליה":              "cinematic moody British atmosphere, soft diffused light shifts, subtle fog rolls, dramatic sky movement",
    "default":             "cinematic slow motion, dramatic atmospheric light shift, shallow depth of field, professional photography reveal",
}


def _find_ffmpeg():
    hit = shutil.which("ffmpeg")
    if hit:
        return hit
    base = Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "WinGet" / "Packages"
    for p in base.glob("Gyan.FFmpeg_*/**/ffmpeg.exe"):
        return str(p)
    return "ffmpeg"

FFMPEG = _find_ffmpeg()


# ── תמונות ───────────────────────────────────────────────────────────────────

def load_photos():
    try:
        import requests
        resp = requests.get(f"{SITE_URL}/api/photos", timeout=15)
        resp.raise_for_status()
        valid = [p for p in resp.json()
                 if p.get("title") and not p["title"].upper().startswith("DSC_")]
        if valid:
            return valid
    except Exception:
        pass
    jf = DATA_DIR / "photos.json"
    if jf.exists():
        return [p for p in json.loads(jf.read_text(encoding="utf-8"))
                if p.get("title") and not p["title"].upper().startswith("DSC_")]
    print("❌ אין מקור תמונות")
    sys.exit(1)


# ── hashtags ─────────────────────────────────────────────────────────────────

HASHTAG_POOLS = {
    "default":          "#photography #reels #naturephotography #photooftheday #amitphotos #צילום",
    "פרחים וצמחים":    "#flowers #macrophotography #nature #botanicalphotography #reels #amitphotos",
    "בעלי חיים":        "#wildlife #animalphotography #nature #wildlifephotography #reels #amitphotos",
    "מאקרו-צילומי תקריב": "#macro #macrophotography #closeup #details #reels #amitphotos",
    "צילום מופשט":      "#abstractphotography #abstract #artphotography #reels #amitphotos",
    "ישראל":            "#israel #ig_israel #israelphoto #isragram #reels #amitphotos",
    "טבע דומם":         "#stilllife #stilllifephotography #fineart #reels #amitphotos",
    "שחור-לבן":         "#blackandwhite #bnw #monochrome #bwphotography #reels #amitphotos",
}

def get_hashtags(category):
    return HASHTAG_POOLS.get(category, HASHTAG_POOLS["default"])


# ── שפת CTA (חלופי) ──────────────────────────────────────────────────────────

def _next_cta_lang(forced=None):
    if forced:
        return forced
    try:
        data  = json.loads(CTA_COUNTER.read_text(encoding="utf-8"))
        count = data.get("count", 0)
    except Exception:
        count = 0
    lang = "he" if count % 2 == 0 else "en"
    CTA_COUNTER.write_text(json.dumps({"count": count + 1}), encoding="utf-8")
    return lang


# ── Video: Ken Burns clip ─────────────────────────────────────────────────────

def _download_photo(photo, dest):
    """הורד תמונה — קודם Google Drive thumbnail, אחר-כך URL ישיר."""
    import urllib.request, requests
    gid = photo.get("id", "")
    if gid:
        url = f"https://drive.google.com/thumbnail?id={gid}&sz=w2400"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=30) as r, open(dest, "wb") as f:
                f.write(r.read())
            return
        except Exception:
            pass
    url = photo.get("url") or photo.get("thumbnail", "")
    if url.startswith("/"):
        url = f"{SITE_URL}{url}"
    r = requests.get(url, timeout=30, headers={"User-Agent": "Mozilla/5.0"})
    r.raise_for_status()
    Path(dest).write_bytes(r.content)


def _ken_burns_clip(photo_path, out_path, duration, pan_dir="left"):
    """Scale landscape photo to cover 9:16 frame, animated pan L↔R."""
    frames = int(duration * FPS)
    fade_f = min(12, frames // 5)
    center = f"(iw-{W})/2"
    x_expr = (
        f"{center}-150+300*n/{frames-1}" if pan_dir == "left"
        else f"{center}+150-300*n/{frames-1}"
    )
    vf = (
        f"scale=-2:{H},"
        f"crop={W}:{H}:'{x_expr}':0,"
        f"fade=t=in:st=0:d={fade_f/FPS:.3f},"
        f"fade=t=out:st={duration - fade_f/FPS:.3f}:d={fade_f/FPS:.3f},"
        f"setsar=1"
    )
    r = subprocess.run([
        FFMPEG, "-y",
        "-loop", "1", "-framerate", str(FPS), "-t", str(duration + 0.1),
        "-i", str(photo_path),
        "-vf", vf, "-t", str(duration),
        "-c:v", "libx264", "-preset", "fast", "-crf", "21",
        "-r", str(FPS), "-pix_fmt", "yuv420p",
        str(out_path),
    ], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"Ken Burns נכשל:\n{r.stderr[-400:]}")


# ── Video: closing slide ──────────────────────────────────────────────────────

def _closing_clip(out_path, lang, category, duration):
    if not HAS_PILLOW:
        raise RuntimeError("pip install Pillow")

    # רקע כהה כמו עיצוב האתר
    img  = Image.new("RGB", (W, H), (10, 10, 14))
    draw = ImageDraw.Draw(img)

    def fit_font(path, text, max_w, start=120):
        size = start
        while size > 30:
            try:
                f = ImageFont.truetype(path, size)
            except Exception:
                return ImageFont.load_default()
            bb = ImageDraw.Draw(Image.new("RGB", (1, 1))).textbbox((0, 0), text, font=f)
            if bb[2] - bb[0] <= max_w:
                return f
            size -= 4
        return ImageFont.load_default()

    try:
        f_sub = ImageFont.truetype(FONT_REGULAR, 62)
    except Exception:
        f_sub = ImageFont.load_default()
    f_url = fit_font(FONT_BOLD, "www.amitphotos.com", W - 80)

    def draw_centered(text, font, y, color):
        bb = draw.textbbox((0, 0), text, font=font)
        draw.text(((W - (bb[2] - bb[0])) // 2, y), text, font=font, fill=color)

    cy = H // 2 - 110

    draw_centered("Visit my website:",  f_sub, cy,         (180, 180, 200))
    draw.line([(W // 2 - 200, cy + 90), (W // 2 + 200, cy + 90)],
              fill=(200, 168, 80), width=2)
    draw_centered("www.amitphotos.com", f_url, cy + 115,   (200, 168, 80))

    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        img.save(tmp.name)
        png = tmp.name

    try:
        fade_f = 15
        r = subprocess.run([
            FFMPEG, "-y",
            "-loop", "1", "-framerate", str(FPS), "-t", str(duration + 0.1),
            "-i", png,
            "-vf", f"fade=t=in:st=0:d={fade_f/FPS:.3f},setsar=1",
            "-t", str(duration),
            "-c:v", "libx264", "-preset", "fast", "-crf", "21",
            "-r", str(FPS), "-pix_fmt", "yuv420p",
            str(out_path),
        ], capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError(f"closing נכשל:\n{r.stderr[-400:]}")
    finally:
        os.unlink(png)


# ── Video: concat ─────────────────────────────────────────────────────────────

def _concat(clip_paths, out_path, clip_durations=None, xfade_dur=0.5):
    n = len(clip_paths)
    if n == 1:
        shutil.copy2(str(clip_paths[0]), str(out_path))
        return

    # בלי xfade — concat פשוט
    if not clip_durations:
        with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False, encoding="utf-8") as f:
            for p in clip_paths:
                f.write(f"file '{str(p).replace(chr(92), '/')}'\n")
            lst = f.name
        try:
            r = subprocess.run([FFMPEG, "-y", "-f", "concat", "-safe", "0",
                                "-i", lst, "-c", "copy", str(out_path)],
                               capture_output=True, text=True)
            if r.returncode != 0:
                raise RuntimeError(f"concat נכשל:\n{r.stderr[-400:]}")
        finally:
            os.unlink(lst)
        return

    # xfade cross-dissolve בין כל הקליפים
    inputs = []
    for p in clip_paths:
        inputs += ["-i", str(p)]

    # בנה filter_complex: [0][1]xfade=...[v01]; [v01][2]xfade=...[v02]; ...
    parts = []
    offset = clip_durations[0] - xfade_dur   # offset מתחיל בסוף הקליפ הראשון
    prev = "0"
    for i in range(1, n):
        label = f"v{i:02d}" if i < n - 1 else "vout"
        parts.append(
            f"[{prev}][{i}]xfade=transition=fade:duration={xfade_dur}:offset={offset:.3f}[{label}]"
        )
        prev = label
        if i < n - 1:
            offset += clip_durations[i] - xfade_dur

    filter_complex = ";".join(parts)

    r = subprocess.run([
        FFMPEG, "-y", *inputs,
        "-filter_complex", filter_complex,
        "-map", "[vout]",
        "-c:v", "libx264", "-preset", "fast", "-crf", "21",
        "-r", str(FPS), "-pix_fmt", "yuv420p",
        str(out_path),
    ], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"xfade concat נכשל:\n{r.stderr[-600:]}")


# ── Video: Seedance 2.0 clip ──────────────────────────────────────────────────

def _smart_motion_prompt(photo_path, photo_meta):
    """
    מייצר פרומפט תנועה מותאם לתמונה הספציפית באמצעות Claude vision.
    אם אין ANTHROPIC_API_KEY — חוזר לפרומפט קטגוריה גנרי.
    """
    if not ANTHROPIC_API_KEY:
        cat = photo_meta.get("category", "")
        return MOTION_PROMPTS.get(cat, MOTION_PROMPTS["default"])

    try:
        import anthropic, base64, io
        from PIL import Image as PILImage

        # דחוס את התמונה לשליחה מהירה
        img = PILImage.open(str(photo_path)).convert("RGB")
        img.thumbnail((768, 768), PILImage.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=80)
        b64 = base64.standard_b64encode(buf.getvalue()).decode()

        title    = photo_meta.get("title", "")
        category = photo_meta.get("category", "")

        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        msg = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=80,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "image",
                     "source": {"type": "base64", "media_type": "image/jpeg", "data": b64}},
                    {"type": "text", "text": (
                        f"Photo: '{title}' | Category: {category}\n\n"
                        "Write a concise cinematic motion prompt (max 25 words) for Kling AI video.\n"
                        "Describe SPECIFIC subtle natural movement visible in THIS photo: "
                        "what moves, camera direction, light change. "
                        "Cinematic, realistic, no fantasy. English only. Prompt only."
                    )}
                ]
            }],
        )
        prompt = msg.content[0].text.strip()
        print(f"  💡 פרומפט: {prompt}")
        return prompt

    except Exception as e:
        print(f"  ⚠️  Claude prompt נכשל ({e}) — גנרי")
        cat = photo_meta.get("category", "")
        return MOTION_PROMPTS.get(cat, MOTION_PROMPTS["default"])


def _smart_crop_9x16(photo_path):
    """
    חותך תמונה רוחבית ל-9:16 עם Claude Vision שמאתר את הנושא.
    מחזיר path ל-JPEG זמני שיש למחוק אחרי שימוש.
    """
    try:
        import anthropic, base64, io
        from PIL import Image as PILImage

        img = PILImage.open(str(photo_path)).convert("RGB")
        iw, ih = img.size

        # אם כבר פורטרט — אין צורך לחתוך
        if ih >= iw:
            return str(photo_path), False

        # רוחב החיתוך לפי יחס 9:16
        crop_w = int(ih * 9 / 16)
        if crop_w >= iw:
            return str(photo_path), False

        # שאל את Claude איפה הנושא
        position = "center"  # default
        if ANTHROPIC_API_KEY:
            try:
                thumb = img.copy()
                thumb.thumbnail((512, 512), PILImage.LANCZOS)
                buf = io.BytesIO()
                thumb.save(buf, format="JPEG", quality=75)
                b64 = base64.standard_b64encode(buf.getvalue()).decode()

                client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
                msg = client.messages.create(
                    model="claude-haiku-4-5-20251001",
                    max_tokens=10,
                    messages=[{"role": "user", "content": [
                        {"type": "image",
                         "source": {"type": "base64", "media_type": "image/jpeg", "data": b64}},
                        {"type": "text",
                         "text": "Where is the main subject? Reply with ONE word: left, center, or right."}
                    ]}],
                )
                position = msg.content[0].text.strip().lower().split()[0]
                if position not in ("left", "center", "right"):
                    position = "center"
                print(f"  🎯 נושא: {position}")
            except Exception:
                pass

        # חשב x offset
        if position == "left":
            x = max(0, iw // 6 - crop_w // 2)
        elif position == "right":
            x = min(iw - crop_w, iw * 5 // 6 - crop_w // 2)
        else:
            x = (iw - crop_w) // 2

        cropped = img.crop((x, 0, x + crop_w, ih))
        tmp = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
        cropped.save(tmp.name, format="JPEG", quality=92)
        return tmp.name, True

    except Exception as e:
        print(f"  ⚠️  smart crop נכשל ({e})")
        return str(photo_path), False


def _seedance_clip(photo_path, out_path, photo_meta, duration=5):
    """fal.ai Kling 1.6: מנפש תמונה → MP4 9:16."""
    try:
        import fal_client
    except ImportError:
        raise RuntimeError("pip install fal-client")

    os.environ["FAL_KEY"] = FAL_KEY

    print("  ✂️  חיתוך חכם 9:16...")
    upload_path, was_cropped = _smart_crop_9x16(photo_path)

    print("  🧠 מייצר פרומפט חכם...")
    prompt = _smart_motion_prompt(photo_path, photo_meta)

    print("  📤 מעלה לfal.ai...")
    img_url = fal_client.upload_file(upload_path)
    if was_cropped:
        os.unlink(upload_path)

    print("  🎬 Wan 2.1 מעבד...")
    import threading

    def _run():
        handler = fal_client.submit(
            "fal-ai/wan/v2.1/image-to-video",
            arguments={
                "image_url":    img_url,
                "prompt":       prompt,
                "duration":     5,
                "aspect_ratio": "9:16",
            },
        )
        return handler.get()

    result_box = [None]
    err_box    = [None]

    def _worker():
        try:   result_box[0] = _run()
        except Exception as e: err_box[0] = e

    t = threading.Thread(target=_worker, daemon=True)
    t.start()
    t.join(timeout=1200)  # 20 דקות מקסימום לקליפ
    if t.is_alive():
        raise RuntimeError("Kling Pro timeout: קליפ לא הסתיים תוך 20 דקות")
    if err_box[0]:
        raise err_box[0]
    result = result_box[0]

    video_url = result["video"]["url"]
    print(f"  ✅ וידאו מוכן: {video_url[:60]}...")

    # הורד ונרמל ל-1080×1920 H.264
    req = ul.Request(video_url, headers={"User-Agent": "Mozilla/5.0"})
    with ul.urlopen(req, timeout=120) as r:
        raw_data = r.read()

    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
        tmp.write(raw_data)
        raw_path = tmp.name

    try:
        subprocess.run([
            FFMPEG, "-y", "-i", raw_path,
            "-vf", (
                f"scale={W}:{H}:force_original_aspect_ratio=increase,"
                f"crop={W}:{H},setsar=1"
            ),
            "-c:v", "libx264", "-preset", "fast", "-crf", "21",
            "-r", str(FPS), "-pix_fmt", "yuv420p", "-an",
            str(out_path),
        ], capture_output=True, check=True)
    except subprocess.CalledProcessError as e:
        raise RuntimeError(f"נרמול Seedance נכשל: {e.stderr[-300:]}")
    finally:
        os.unlink(raw_path)


# ── יצירת Album Reel ──────────────────────────────────────────────────────────

def make_album_reel(category, lang=None, dry_run=False, photo_ids=None):
    """
    בוחר תמונות מהקטגוריה ומייצר רילס.
    - עם FAL_KEY: Kling 1.6 (5 תמונות × 5s + סיום = ~27.5s)
    - בלי FAL_KEY: Ken Burns (3 תמונות × 2.5s + סיום = 10s)
    """
    use_seedance = bool(FAL_KEY)
    n_photos     = NUM_PHOTOS_SD if use_seedance else NUM_PHOTOS_KB
    photo_secs   = PHOTO_SECS_SD if use_seedance else PHOTO_SECS_KB
    mode         = "🌀 Kling 1.6" if use_seedance else "🎞  Ken Burns"

    photos_all = load_photos()
    cat_photos = [p for p in photos_all if p.get("category") == category]
    if len(cat_photos) < n_photos:
        print(f"❌ רק {len(cat_photos)} תמונות ב-'{category}', צריך {n_photos}")
        return None

    if photo_ids:
        id_set   = set(photo_ids)
        selected = [p for p in photos_all if p["id"] in id_set][:n_photos]
        if not selected:
            print("⚠️  לא נמצאו תמונות עם ה-IDs שנבחרו — בוחר אקראי")
            selected = random.sample(cat_photos, min(n_photos, len(cat_photos)))
    else:
        selected = random.sample(cat_photos, min(n_photos, len(cat_photos)))
    lang     = _next_cta_lang(lang)

    ALBUM_OUTPUT.mkdir(exist_ok=True)
    safe     = category.replace(" ", "_").replace("/", "-").replace('"', "")
    out_path = ALBUM_OUTPUT / f"reel_{safe}_{lang}.mp4"

    print(f"\n🎬 {category} ({lang.upper()}) — {mode}")
    for p in selected:
        print(f"   • {p['title']}")

    if dry_run:
        print("🔍 dry-run — לא מייצר וידאו")
        return str(out_path)

    with tempfile.TemporaryDirectory() as td:
        tmp   = Path(td)
        clips = []

        for i, photo in enumerate(selected):
            print(f"\n⬇  {i+1}/{n_photos}: {photo['title']}")
            src = tmp / f"photo_{i}.jpg"
            _download_photo(photo, src)

            clip = tmp / f"clip_{i}.mp4"
            if use_seedance:
                try:
                    _seedance_clip(src, clip, photo, duration=int(photo_secs))
                except Exception as e:
                    print(f"  ⚠️  Seedance נכשל ({e}) — עובר ל-Ken Burns")
                    _ken_burns_clip(src, clip, photo_secs,
                                    pan_dir="left" if i % 2 == 0 else "right")
            else:
                _ken_burns_clip(src, clip, photo_secs,
                                pan_dir="left" if i % 2 == 0 else "right")
            clips.append(clip)

        closing = tmp / "closing.mp4"
        print("\n🖼  שקופית סיום...")
        _closing_clip(closing, lang, category, CLOSING_SECS)
        clips.append(closing)

        print("🔗 מרכיב עם cross-dissolve...")
        durations = [photo_secs] * len(selected) + [CLOSING_SECS]
        _concat(clips, out_path, clip_durations=durations)

    total = n_photos * photo_secs + CLOSING_SECS
    print(f"\n✅ {out_path}  ({total:.0f} שניות)")

    # העלה לאחסון ציבורי → שמור URL ל-latest_reel.json
    dl_url = _publish_reel(out_path, category, lang)
    if dl_url:
        print(f"🔗 הורדה: {dl_url}")

    return str(out_path)


# ── Publish reel → direct download URL ───────────────────────────────────────

GITHUB_RAW = "https://raw.githubusercontent.com/erezfamily-cmyk/amit-photos/main/reels_output/latest_reel.mp4"


def _publish_reel(video_path, category, lang):
    """
    1. מעתיק ל-reels_output/latest_reel.mp4 (ימשוך לריפו ע"י workflow)
    2. מנסה להעלות ל-0x0.st (3 ניסיונות) לקישור מהיר יותר
    3. שומר URL ב-data/latest_reel.json
    """
    import requests as req
    import datetime

    video_path = Path(video_path)
    if not video_path.exists():
        return None

    # תמיד מעתיק ל-latest_reel.mp4 בריפו (fallback URL)
    latest_in_repo = ROOT / "reels_output" / "latest_reel.mp4"
    latest_in_repo.parent.mkdir(exist_ok=True)
    shutil.copy2(video_path, latest_in_repo)
    print(f"📁 הועתק ל-{latest_in_repo}")

    # ניסיון העלאה ל-0x0.st
    data = video_path.read_bytes()
    print(f"📤 מנסה 0x0.st ({len(data)/1024/1024:.1f} MB)...")
    url = None
    for attempt in range(1, 4):
        try:
            r = req.post(
                "https://0x0.st",
                files={"file": (video_path.name, data, "video/mp4")},
                timeout=180,
            )
            r.raise_for_status()
            candidate = r.text.strip()
            if candidate.startswith("http"):
                url = candidate
                print(f"✅ 0x0.st: {url}")
                break
            raise ValueError(f"תגובה לא תקינה: {candidate}")
        except Exception as e:
            print(f"⚠️  0x0.st ניסיון {attempt}/3 נכשל: {e}")
            if attempt < 3:
                time.sleep(10)

    if not url:
        url = GITHUB_RAW
        print(f"📎 fallback → GitHub raw: {url}")

    # שמור ב-data/latest_reel.json
    record = {
        "url":        url,
        "category":   category,
        "lang":       lang,
        "filename":   video_path.name,
        "created_at": datetime.datetime.utcnow().isoformat(),
    }
    out = ROOT / "data" / "latest_reel.json"
    out.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"💾 שמור ב-{out}")
    return url


# ── Instagram ─────────────────────────────────────────────────────────────────

def _upload_video(video_path):
    """מעלה ל-litterbox (1h) עם fallback ל-0x0.st."""
    import requests
    data = Path(video_path).read_bytes()
    print(f"📤 {len(data)/1024/1024:.1f} MB")

    for name, url, extra in [
        ("litterbox", "https://litterbox.catbox.moe/resources/internals/api.php",
         {"data": {"reqtype": "fileupload", "time": "1h"}, "field": "fileToUpload"}),
        ("0x0.st", "https://0x0.st", {"data": {}, "field": "file"}),
    ]:
        try:
            r = requests.post(
                url,
                data=extra["data"],
                files={extra["field"]: ("reel.mp4", data, "video/mp4")},
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


def _publish_ig(video_url, caption):
    import requests
    print("📸 מפרסם IG Reel...")
    r = requests.post(f"{GRAPH_API}/{IG_USER_ID}/media", data={
        "video_url": video_url, "media_type": "REELS",
        "share_to_feed": "true", "caption": caption,
        "access_token": ACCESS_TOKEN,
    }, timeout=30)
    if not r.ok:
        print(f"❌ container: {r.status_code} {r.text[:300]}")
        return None
    cid = r.json().get("id")
    if not cid:
        return None
    print(f"📦 {cid}")
    for attempt in range(24):
        time.sleep(5)
        status = requests.get(
            f"{GRAPH_API}/{cid}",
            params={"fields": "status_code", "access_token": ACCESS_TOKEN},
            timeout=30,
        ).json().get("status_code", "")
        print(f"  ⏳ [{attempt+1}] {status}")
        if status == "FINISHED":
            break
        if status == "ERROR":
            print("❌ שגיאת עיבוד")
            return None
    pub = requests.post(f"{GRAPH_API}/{IG_USER_ID}/media_publish", data={
        "creation_id": cid, "access_token": ACCESS_TOKEN,
    }, timeout=30)
    if pub.ok:
        print(f"✅ Reel פורסם! ID: {pub.json().get('id')}")
        return pub.json().get("id")
    print(f"❌ Publish נכשל: {pub.status_code}")
    return None


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description="יוצר Album Reel 10 שניות ומפרסם ל-IG")
    ap.add_argument("--category", "-c", required=False, help="שם הקטגוריה")
    ap.add_argument("--lang", "-l", choices=["he", "en"],
                    help="שפת שקופית הסיום (ברירת מחדל: חלופי)")
    ap.add_argument("--photos", "-p",
                    help="IDs ספציפיים מופרדים בפסיק (ריק = אקראי)")
    ap.add_argument("--dry-run", action="store_true",
                    help="רק מדפיס מה יבחר, לא מייצר וידאו")
    ap.add_argument("--list", action="store_true", help="הצג קטגוריות זמינות")
    args = ap.parse_args()

    if args.list:
        photos = load_photos()
        cats   = {}
        for p in photos:
            cats[p.get("category", "?")] = cats.get(p.get("category", "?"), 0) + 1
        print("\nקטגוריות זמינות:")
        for cat, cnt in sorted(cats.items(), key=lambda x: -x[1]):
            print(f"  {cnt:3d}  {cat}")
        return

    if not args.category:
        ap.print_help()
        return

    ids = set(args.photos.split(",")) if args.photos else None
    out = make_album_reel(args.category, args.lang, dry_run=args.dry_run, photo_ids=ids)
    if not out or args.dry_run:
        return

    if not IG_USER_ID or not ACCESS_TOKEN:
        print("ℹ️  אין IG credentials — הסרטון נשמר מקומית בלבד")
        return

    lang_used = args.lang or ("he" if "he" in out else "en")
    cta_line  = "בקר באתר שלי" if lang_used == "he" else "Visit my website"
    caption   = f"{cta_line}: amitphotos.com\n\n{get_hashtags(args.category)}"

    video_url = _upload_video(Path(out))
    _publish_ig(video_url, caption)


if __name__ == "__main__":
    main()
