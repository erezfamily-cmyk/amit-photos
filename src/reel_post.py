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

# Seedance mode (FAL_KEY available)
NUM_PHOTOS_SD    = 2
PHOTO_SECS_SD    = 5.0   # Seedance output is 5s per clip

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

IG_USER_ID   = os.environ.get("INSTAGRAM_USER_ID", "")
ACCESS_TOKEN = os.environ.get("INSTAGRAM_PAGE_TOKEN", "")
FAL_KEY      = os.environ.get("FAL_KEY", "")

# פרומפטים לתנועה לפי קטגוריה
MOTION_PROMPTS = {
    "פרחים וצמחים":       "gentle breeze, petals and leaves swaying softly, macro beauty",
    "בעלי חיים":           "subtle natural animal movement, breathing, wildlife in habitat",
    "מאקרו-צילומי תקריב": "micro vibration, delicate texture details, macro world revealed",
    "צילום מופשט":         "dreamlike slow morphing, abstract color flow, artistic motion",
    "ישראל":               "slow cinematic camera drift, golden Mediterranean light shift",
    "טבע דומם":            "gentle light play, soft shadows drifting, still life breathing",
    "שחור-לבן":            "dramatic light and shadow shift, cinematic noir motion",
    "טנזניה":              "savanna warm breeze, golden hour glow, African wildlife atmosphere",
    "ספרד ואנדורה":        "mediterranean warmth, architecture breathing, travel cinematic",
    "איטליה":              "italian golden light, gentle atmospheric drift, cinematic beauty",
    "default":             "gentle cinematic motion, subtle atmospheric movement, fine art photography",
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
        f"crop={W}:{H}:'{x_expr}':0:eval=frame,"
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

    img  = Image.new("RGB", (W, H), (18, 18, 35))
    draw = ImageDraw.Draw(img)

    for y in range(H):           # gradient
        a = int(25 * y / H)
        draw.line([(0, y), (W, y)], fill=(18 + a // 3, 18 + a // 2, 35 + a))

    try:
        f_cat = ImageFont.truetype(FONT_REGULAR, 42)
        f_cta = ImageFont.truetype(FONT_BOLD,    68)
        f_url = ImageFont.truetype(FONT_REGULAR, 52)
    except Exception:
        f_cat = f_cta = f_url = ImageFont.load_default()

    def draw_centered(text, font, y, color):
        bb = draw.textbbox((0, 0), text, font=font)
        draw.text(((W - (bb[2] - bb[0])) // 2, y), text, font=font, fill=color)

    draw_centered(_bidi(category),      f_cat, H // 2 - 220, (160, 160, 180))
    draw.line([(W // 2 - 120, H // 2 - 140), (W // 2 + 120, H // 2 - 140)],
              fill=(100, 100, 140), width=2)
    cta = _bidi("בקר באתר שלי:") if lang == "he" else "Visit my website:"
    draw_centered(cta,                  f_cta, H // 2 - 80,  (240, 240, 255))
    draw_centered("www.amitphotos.com", f_url, H // 2 + 40,  (240, 192, 64))

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

def _concat(clip_paths, out_path):
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".txt", delete=False, encoding="utf-8"
    ) as f:
        for p in clip_paths:
            f.write(f"file '{str(p).replace(chr(92), '/')}'\n")
        lst = f.name
    try:
        r = subprocess.run([
            FFMPEG, "-y", "-f", "concat", "-safe", "0",
            "-i", lst, "-c", "copy", str(out_path),
        ], capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError(f"concat נכשל:\n{r.stderr[-400:]}")
    finally:
        os.unlink(lst)


# ── Video: Seedance 2.0 clip ──────────────────────────────────────────────────

def _seedance_clip(photo_path, out_path, photo_meta, duration=5):
    """fal.ai Seedance 2.0: מנפש תמונה → MP4 9:16."""
    try:
        import fal_client
    except ImportError:
        raise RuntimeError("pip install fal-client")

    os.environ["FAL_KEY"] = FAL_KEY

    import urllib.request as ul
    category = photo_meta.get("category", "")
    prompt   = MOTION_PROMPTS.get(category, MOTION_PROMPTS["default"])

    print("  📤 מעלה לfal.ai...")
    img_url = fal_client.upload_file(str(photo_path))

    print("  🌀 Seedance 2.0 מעבד (~60 שניות)...")
    # duration: "4" or "15" only (fal.ai Seedance 2.0 valid values)
    dur_str = "4" if duration <= 5 else "15"
    handler = fal_client.submit(
        "bytedance/seedance-2.0/image-to-video",
        arguments={
            "image_url":       img_url,
            "prompt":          prompt,
            "duration":        dur_str,
            "aspect_ratio":    "9:16",
            "resolution":      "720p",
            "generate_audio":  False,
        },
    )
    result = handler.get()

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
            "-vf", (f"scale={W}:{H}:force_original_aspect_ratio=decrease,"
                    f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1"),
            "-c:v", "libx264", "-preset", "fast", "-crf", "21",
            "-r", str(FPS), "-pix_fmt", "yuv420p", "-an",
            str(out_path),
        ], capture_output=True, check=True)
    except subprocess.CalledProcessError as e:
        raise RuntimeError(f"נרמול Seedance נכשל: {e.stderr[-300:]}")
    finally:
        os.unlink(raw_path)


# ── יצירת Album Reel ──────────────────────────────────────────────────────────

def make_album_reel(category, lang=None, dry_run=False):
    """
    בוחר תמונות מהקטגוריה ומייצר רילס.
    - עם FAL_KEY: Seedance 2.0 (2 תמונות × 5s + סיום = ~12.5s)
    - בלי FAL_KEY: Ken Burns (3 תמונות × 2.5s + סיום = 10s)
    """
    use_seedance = bool(FAL_KEY)
    n_photos     = NUM_PHOTOS_SD if use_seedance else NUM_PHOTOS_KB
    photo_secs   = PHOTO_SECS_SD if use_seedance else PHOTO_SECS_KB
    mode         = "🌀 Seedance 2.0" if use_seedance else "🎞  Ken Burns"

    photos_all = load_photos()
    cat_photos = [p for p in photos_all if p.get("category") == category]
    if len(cat_photos) < n_photos:
        print(f"❌ רק {len(cat_photos)} תמונות ב-'{category}', צריך {n_photos}")
        return None

    selected = random.sample(cat_photos, n_photos)
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

        print("🔗 מרכיב...")
        _concat(clips, out_path)

    total = n_photos * photo_secs + CLOSING_SECS
    print(f"\n✅ {out_path}  ({total:.0f} שניות)")

    # העלה ל-R2 אם יש credentials
    r2_url = _upload_to_r2(out_path)
    if r2_url:
        print(f"☁️  R2: {r2_url}")

    return str(out_path)


# ── R2 Upload ────────────────────────────────────────────────────────────────

def _upload_to_r2(video_path):
    """מעלה MP4 ל-Cloudflare R2. מחזיר URL להורדה או None."""
    account_id  = os.environ.get("CF_ACCOUNT_ID", "")
    key_id      = os.environ.get("R2_ACCESS_KEY_ID", "")
    secret_key  = os.environ.get("R2_SECRET_ACCESS_KEY", "")
    bucket      = "amit-photos-images"

    if not all([account_id, key_id, secret_key]):
        return None

    try:
        import boto3
        from botocore.config import Config

        s3 = boto3.client(
            "s3",
            endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=key_id,
            aws_secret_access_key=secret_key,
            config=Config(signature_version="s3v4"),
            region_name="auto",
        )
        key = f"reels/{Path(video_path).name}"
        s3.upload_file(str(video_path), bucket, key,
                       ExtraArgs={"ContentType": "video/mp4"})
        return f"https://amitphotos.com/api/reels/file/{Path(video_path).name}"
    except Exception as e:
        print(f"⚠️  R2 upload נכשל: {e}")
        return None


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

    out = make_album_reel(args.category, args.lang, dry_run=args.dry_run)
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
