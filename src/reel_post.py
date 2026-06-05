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
ALBUM_SECS       = 10.0
CLOSING_SECS     = 2.5
NUM_PHOTOS       = 3
PHOTO_SECS       = (ALBUM_SECS - CLOSING_SECS) / NUM_PHOTOS   # 2.5s per photo

FONT_REGULAR = "C:/Windows/Fonts/arial.ttf"
FONT_BOLD    = "C:/Windows/Fonts/arialbd.ttf"

IG_USER_ID   = os.environ.get("INSTAGRAM_USER_ID", "")
ACCESS_TOKEN = os.environ.get("INSTAGRAM_PAGE_TOKEN", "")


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


# ── יצירת Album Reel ──────────────────────────────────────────────────────────

def make_album_reel(category, lang=None, dry_run=False):
    """
    בוחר NUM_PHOTOS תמונות אקראיות מהקטגוריה,
    מייצר רילס 10 שניות עם שקופית סיום.
    מחזיר נתיב MP4 או None.
    """
    photos_all = load_photos()
    cat_photos = [p for p in photos_all if p.get("category") == category]
    if len(cat_photos) < NUM_PHOTOS:
        print(f"❌ רק {len(cat_photos)} תמונות ב-'{category}', צריך {NUM_PHOTOS}")
        return None

    selected = random.sample(cat_photos, NUM_PHOTOS)
    lang     = _next_cta_lang(lang)

    ALBUM_OUTPUT.mkdir(exist_ok=True)
    safe     = category.replace(" ", "_").replace("/", "-").replace('"', "")
    out_path = ALBUM_OUTPUT / f"reel_{safe}_{lang}.mp4"

    print(f"\n🎬 {category} ({lang.upper()})")
    for p in selected:
        print(f"   • {p['title']}")

    if dry_run:
        print("🔍 dry-run — לא מייצר וידאו")
        return str(out_path)

    with tempfile.TemporaryDirectory() as td:
        tmp   = Path(td)
        clips = []

        for i, photo in enumerate(selected):
            print(f"⬇  {i+1}/{NUM_PHOTOS}: {photo['title']}")
            src = tmp / f"photo_{i}.jpg"
            _download_photo(photo, src)

            clip = tmp / f"clip_{i}.mp4"
            _ken_burns_clip(src, clip, PHOTO_SECS,
                            pan_dir="left" if i % 2 == 0 else "right")
            clips.append(clip)

        closing = tmp / "closing.mp4"
        print("🖼  שקופית סיום...")
        _closing_clip(closing, lang, category, CLOSING_SECS)
        clips.append(closing)

        print("🔗 מרכיב...")
        _concat(clips, out_path)

    print(f"✅ {out_path}")
    return str(out_path)


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
