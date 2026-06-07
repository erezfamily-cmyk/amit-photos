#!/usr/bin/env python3
"""
photo_breakdown.py — 35-second TikTok breakdown video from a portfolio photo.

Usage:
  python src/photo_breakdown.py --list
  python src/photo_breakdown.py --id <photo-id-from-photos.json>
"""

import argparse, io, json, math, os, shutil, subprocess, sys, tempfile
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")

try:
    from bidi.algorithm import get_display as bidi_display
    HAS_BIDI = True
except ImportError:
    HAS_BIDI = False

def _bidi(t): return bidi_display(t) if HAS_BIDI else t

# ── paths ─────────────────────────────────────────────────────────────────────
ROOT       = Path(__file__).parent.parent
DATA_FILE  = ROOT / "data" / "photos.json"
OUT_DIR    = ROOT / "breakdown_output"
TOKEN_FILE = ROOT / "token.json"
CREDS_FILE = ROOT / "credentials.json"
DRIVE_API  = "https://www.googleapis.com/drive/v3"
SCOPES     = ["https://www.googleapis.com/auth/drive.readonly"]

# ── video constants ───────────────────────────────────────────────────────────
W, H = 1080, 1920
FPS  = 30

# ── palette (matches site design) ─────────────────────────────────────────────
GOLD  = (200, 168, 80)
WHITE = (240, 240, 245)
DIM   = (150, 150, 165)
BG    = (10,  10,  14)

FAL_KEY = os.environ.get("FAL_KEY", "")

# motion prompts per category (same as reel_post.py)
MOTION_PROMPTS = {
    "פרחים וצמחים":        "static camera, gentle breeze sways petals and leaves, warm golden light flickers softly",
    "בעלי חיים":            "static camera, animal breathes and blinks naturally, fur ripples in breeze, eyes glisten",
    "מאקרו-צילומי תקריב":  "LOCKED static frame, ZERO camera movement, micro details shimmer, wings or legs move naturally",
    "חרקים":               "LOCKED static frame, insect legs twitch, antennae wave, wings flutter naturally",
    "ישראל":               "static camera, warm Mediterranean light shifts slowly, distant elements sway gently",
    "טבע דומם":            "static camera, soft light gradually shifts, subtle shadows move in place",
    "שחור-לבן":            "static camera, deep shadows shift slowly, high contrast light pulses",
    "טנזניה":              "static camera, savanna grass sways in warm breeze, animal breathes naturally",
    "default":             "static camera locked on subject, dramatic atmospheric light shifts, shallow depth of field",
}


def _find_ffmpeg():
    hit = shutil.which("ffmpeg")
    if hit: return hit
    base = Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "WinGet" / "Packages"
    for p in base.glob("Gyan.FFmpeg_*/**/ffmpeg.exe"):
        return str(p)
    return "ffmpeg"

FFMPEG = _find_ffmpeg()


def _find_font(names):
    import platform
    if platform.system() == "Windows":
        candidates = [f"C:/Windows/Fonts/{n}" for n in names]
    else:
        candidates = (
            [f"/usr/share/fonts/truetype/liberation/Liberation{n}"
             for n in ["Sans-Regular.ttf", "Sans-Bold.ttf"]]
          + [f"/usr/share/fonts/truetype/dejavu/DejaVuSans{n}"
             for n in [".ttf", "-Bold.ttf"]]
        )
    for c in candidates:
        if Path(c).exists(): return c
    return None

FONT_REG  = _find_font(["arial.ttf",   "Arial.ttf"])       or "arial.ttf"
FONT_BOLD = _find_font(["arialbd.ttf", "Arial Bold.ttf"])  or "arial.ttf"


# ── Drive API ─────────────────────────────────────────────────────────────────
def get_drive_session():
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
    import requests as req_lib

    creds = None
    if TOKEN_FILE.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            from google_auth_oauthlib.flow import InstalledAppFlow
            flow = InstalledAppFlow.from_client_secrets_file(str(CREDS_FILE), SCOPES)
            creds = flow.run_local_server(port=0)
        TOKEN_FILE.write_text(creds.to_json())

    session = req_lib.Session()
    session.headers["Authorization"] = f"Bearer {creds.token}"
    return session


def fetch_photo_data(session, photo_id):
    """Returns (jpeg_bytes, exif_dict) from Drive API."""
    r = session.get(
        f"{DRIVE_API}/files/{photo_id}",
        params={"fields": "id,name,imageMediaMetadata"},
    )
    r.raise_for_status()
    raw_exif = r.json().get("imageMediaMetadata", {})

    img_r = session.get(
        f"{DRIVE_API}/files/{photo_id}",
        params={"alt": "media"},
    )
    img_r.raise_for_status()
    return img_r.content, raw_exif


# ── EXIF from JPEG bytes (Pillow) — fallback when no Drive credentials ────────
def read_exif_from_jpeg(jpeg_bytes):
    """Read EXIF directly from JPEG using Pillow. Returns same dict as parse_exif."""
    from PIL.ExifTags import TAGS, GPSTAGS
    try:
        img = Image.open(io.BytesIO(jpeg_bytes))
        raw = img._getexif() or {}
    except Exception:
        return {}

    data = {TAGS.get(tid, str(tid)): val for tid, val in raw.items()}
    result = {}

    make  = str(data.get("Make",  "") or "").strip()
    model = str(data.get("Model", "") or "").strip()
    if model:
        result["camera"] = model if model.lower().startswith(make.lower()) else f"{make} {model}".strip()

    def _ratio(v):
        if v is None: return None
        try:
            if hasattr(v, "numerator"): return v.numerator / v.denominator
            return float(v)
        except Exception: return None

    ap = _ratio(data.get("FNumber"))
    if ap:
        result["aperture"] = f"f/{ap:.1f}"
        result["f_number"] = ap

    et = _ratio(data.get("ExposureTime"))
    if et and et > 0:
        result["shutter"] = f"1/{round(1/et)}s" if et < 1 else f"{et:.1f}s"

    iso = data.get("ISOSpeedRatings") or data.get("PhotographicSensitivity")
    if iso:
        result["iso"] = f"ISO {iso}"

    fl = _ratio(data.get("FocalLength"))
    if fl:
        result["focal"] = f"{round(fl)}mm"

    gps_info = data.get("GPSInfo") or {}
    gps = {GPSTAGS.get(k, k): gps_info[k] for k in gps_info}

    def _dms(dms, ref):
        try:
            vals = [_ratio(x) for x in dms]
            dec  = vals[0] + vals[1]/60 + vals[2]/3600
            return -dec if str(ref) in ("S", "W") else dec
        except Exception: return None

    if gps.get("GPSLatitude") and gps.get("GPSLongitude"):
        result["lat"] = _dms(gps["GPSLatitude"],  gps.get("GPSLatitudeRef",  "N"))
        result["lon"] = _dms(gps["GPSLongitude"], gps.get("GPSLongitudeRef", "E"))

    dt_str = data.get("DateTimeOriginal") or data.get("DateTime") or ""
    result["time_str"] = str(dt_str)

    return result


# ── EXIF parsing ──────────────────────────────────────────────────────────────
def parse_exif(exif):
    """Convert imageMediaMetadata → display-ready dict."""
    result = {}

    make  = exif.get("cameraMake",  "")
    model = exif.get("cameraModel", "")
    if model:
        result["camera"] = model if model.lower().startswith(make.lower()) else f"{make} {model}".strip()

    ap = exif.get("aperture")
    if ap:
        result["aperture"]  = f"f/{float(ap):.1f}"
        result["f_number"]  = float(ap)

    et = exif.get("exposureTime")
    if et and et > 0:
        result["shutter"] = f"1/{round(1/et)}s" if et < 1 else f"{et:.1f}s"

    iso = exif.get("isoSpeed")
    if iso: result["iso"] = f"ISO {iso}"

    fl = exif.get("focalLength")
    if fl: result["focal"] = f"{round(fl)}mm"

    loc = exif.get("location", {})
    result["lat"] = loc.get("latitude")
    result["lon"] = loc.get("longitude")
    result["time_str"] = exif.get("time", "")

    return result


# ── location + light ──────────────────────────────────────────────────────────
def reverse_geocode(lat, lon):
    """Returns 'City, Country' string or None. Uses Nominatim (free)."""
    if lat is None or lon is None:
        return None
    try:
        import requests
        r = requests.get(
            "https://nominatim.openstreetmap.org/reverse",
            params={"lat": lat, "lon": lon, "format": "json"},
            headers={"User-Agent": "amitphotos-breakdown/1.0"},
            timeout=6,
        )
        r.raise_for_status()
        addr = r.json().get("address", {})
        parts = [addr.get(k) for k in ("city","town","village","county","country") if addr.get(k)]
        return ", ".join(parts[:2]) if parts else None
    except Exception:
        return None


def estimate_light_angle(time_str, lat):
    """Returns azimuth degrees (0=N, 90=E, 180=S, 270=W) or None."""
    if not time_str:
        return None
    try:
        from datetime import datetime
        dt = datetime.strptime(time_str, "%Y:%m:%d %H:%M:%S")
        h  = dt.hour + dt.minute / 60.0
        if lat is not None and lat > 0:
            if 6 <= h < 12:
                return 90 - (h - 6) / 6 * 90
            elif 12 <= h < 18:
                return 180 + (h - 12) / 6 * 90
        # Returns None for Southern hemisphere, nighttime (18-6h), or missing data.
        return None
    except Exception:
        return None


# ── --list command ─────────────────────────────────────────────────────────────
def list_photos():
    photos = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    print(f"\n{'ID':<32} {'Cat':<22} Title")
    print("-" * 85)
    for p in sorted(photos, key=lambda x: x.get("category", "")):
        print(f"{p['id']:<32} {p.get('category',''):<22} {p.get('title','')}")
    print(f"\nTotal: {len(photos)} photos")


# ── pillarbox base ────────────────────────────────────────────────────────────
def make_pillarbox_base(jpeg_bytes):
    """
    Returns 1080×1920 RGB PIL Image:
      background = photo scaled+cropped to full 9:16, blurred + darkened 65%
      foreground = original photo scaled to fit width (landscape) or height (portrait), centered
    """
    img = Image.open(io.BytesIO(jpeg_bytes)).convert("RGB")
    iw, ih = img.size

    # Background: cover entire 9:16 frame, blur heavily, darken
    scale = max(W / iw, H / ih)
    bw, bh = int(iw * scale), int(ih * scale)
    bg = img.resize((bw, bh), Image.LANCZOS)
    bx, by = (bw - W) // 2, (bh - H) // 2
    bg = bg.crop((bx, by, bx + W, by + H))
    for _ in range(4):
        bg = bg.filter(ImageFilter.GaussianBlur(radius=12))
    black = Image.new("RGB", (W, H), BG)
    bg = Image.blend(bg, black, 0.65)

    # Foreground: fit to width for landscape, fit to width for portrait
    is_landscape = iw > ih
    if is_landscape:
        fw, fh = W, int(ih * W / iw)
    else:
        fh = min(H, int(ih * W / iw))
        fw = int(iw * fh / ih)
        fw = min(fw, W)

    fg = img.resize((fw, fh), Image.LANCZOS)
    bg.paste(fg, ((W - fw) // 2, (H - fh) // 2))

    return bg


# ── title card ────────────────────────────────────────────────────────────────
def _fit_text_font(path, text, max_w, start_size=88):
    """Returns largest ImageFont where text fits within max_w pixels."""
    size = start_size
    while size > 28:
        try:
            f = ImageFont.truetype(path, size)
        except Exception:
            return ImageFont.load_default()
        tmp_img  = Image.new("RGB", (1, 1))
        tmp_draw = ImageDraw.Draw(tmp_img)
        bb = tmp_draw.textbbox((0, 0), text, font=f)
        if bb[2] - bb[0] <= max_w:
            return f
        size -= 4
    return ImageFont.load_default()


def make_title_clip(title, category, out_path, duration=3.0):
    """Dark card with gold dividers, auto-scaled title, category, watermark → MP4."""
    img  = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)

    max_w   = W - 80
    # Auto-scale title font to fit the frame
    f_title = _fit_text_font(FONT_BOLD, title, max_w, start_size=88)
    try:
        f_cat = ImageFont.truetype(FONT_REG, 48)
        f_wm  = ImageFont.truetype(FONT_REG, 38)
    except Exception:
        f_cat = f_wm = ImageFont.load_default()

    cy = H // 2 - 60

    def center_text(text, font, y, color):
        bb = draw.textbbox((0, 0), text, font=font)
        x  = (W - (bb[2] - bb[0])) // 2
        draw.text((x, y), text, font=font, fill=color)

    # Top gold line
    lw = 360
    draw.rectangle([(W//2 - lw//2, cy - 30), (W//2 + lw//2, cy - 26)], fill=GOLD)

    # Title — no _bidi() so Pillow draws the Hebrew/English as-is
    center_text(title, f_title, cy, WHITE)
    bb = draw.textbbox((0, 0), title, font=f_title)
    th = bb[3] - bb[1]

    # Bottom gold line
    draw.rectangle([(W//2 - lw//2, cy + th + 20), (W//2 + lw//2, cy + th + 24)], fill=GOLD)

    # Category
    if category:
        center_text(category, f_cat, cy + th + 50, GOLD)

    # Watermark
    wm = "amitphotos.com"
    bb3 = draw.textbbox((0, 0), wm, font=f_wm)
    draw.text(((W - (bb3[2]-bb3[0])) // 2, H - 120), wm, font=f_wm, fill=DIM)

    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        img.save(tmp.name)
        png = tmp.name

    try:
        r = subprocess.run([
            FFMPEG, "-y",
            "-loop", "1", "-framerate", str(FPS), "-t", str(duration + 0.1),
            "-i", png,
            "-vf", (f"fade=t=in:st=0:d=0.5,"
                    f"fade=t=out:st={duration-0.5:.2f}:d=0.5,"
                    f"setsar=1"),
            "-t", str(duration),
            "-c:v", "libx264", "-preset", "fast", "-crf", "20",
            "-r", str(FPS), "-pix_fmt", "yuv420p",
            str(out_path),
        ], capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError(f"title clip failed:\n{r.stderr[-300:]}")
    finally:
        os.unlink(png)


# ── icon drawers ──────────────────────────────────────────────────────────────
def _draw_aperture_icon(draw, cx, cy, r, f_number):
    """Circular aperture: outer ring + inner opening sized by f-number."""
    draw.ellipse([(cx-r, cy-r), (cx+r, cy+r)], outline=GOLD, width=3)
    open_r = int(r * max(0.15, min(0.85, 1.4 / max(f_number, 1.4) * 0.85)))
    draw.ellipse([(cx-open_r, cy-open_r), (cx+open_r, cy+open_r)], outline=GOLD, width=2)
    for i in range(6):
        a  = math.radians(i * 60)
        a2 = math.radians(i * 60 + 30)
        x1, y1 = cx + int(r*0.5*math.cos(a)),  cy + int(r*0.5*math.sin(a))
        x2, y2 = cx + int(r*0.9*math.cos(a2)), cy + int(r*0.9*math.sin(a2))
        draw.line([(x1, y1), (x2, y2)], fill=GOLD, width=2)


def _draw_sun_compass(draw, cx, cy, r, angle_deg):
    """Compass circle with sun arrow pointing in light direction."""
    draw.ellipse([(cx-r, cy-r), (cx+r, cy+r)], outline=GOLD, width=2)
    for d in range(0, 360, 90):
        a  = math.radians(d - 90)
        x1 = cx + int((r-8)*math.cos(a)); y1 = cy + int((r-8)*math.sin(a))
        x2 = cx + int(r*math.cos(a));     y2 = cy + int(r*math.sin(a))
        draw.line([(x1,y1),(x2,y2)], fill=DIM, width=2)
    a  = math.radians(angle_deg - 90)
    ax = cx + int(r*0.65*math.cos(a)); ay = cy + int(r*0.65*math.sin(a))
    draw.line([(cx, cy), (ax, ay)], fill=GOLD, width=3)
    draw.ellipse([(ax-5,ay-5),(ax+5,ay+5)], fill=GOLD)


# ── overlay element builder ───────────────────────────────────────────────────
def build_overlay_elements(exif, location_name, light_angle):
    """Returns ordered list of overlay row dicts for the breakdown panel."""
    elems = []
    if exif.get("camera"):
        elems.append({"label": "Camera",         "value": exif["camera"],   "icon": "dot"})
    if exif.get("aperture"):
        elems.append({"label": "Aperture",        "value": exif["aperture"], "icon": "aperture",
                      "f_number": exif.get("f_number", 5.6)})
    if exif.get("shutter"):
        elems.append({"label": "Shutter speed",   "value": exif["shutter"],  "icon": "dot"})
    if exif.get("iso"):
        elems.append({"label": "Sensitivity",     "value": exif["iso"],      "icon": "dot"})
    if exif.get("focal"):
        elems.append({"label": "Focal length",    "value": exif["focal"],    "icon": "dot"})
    if location_name:
        elems.append({"label": "Location",        "value": location_name,    "icon": "dot"})
    if light_angle is not None:
        elems.append({"label": "Light direction", "value": "",               "icon": "sun",
                      "angle": light_angle})
    return elems


# ── single frame compositor ───────────────────────────────────────────────────
def _render_frame(base_pil, elements, visible_count, alpha_last):
    """
    Composites visible_count overlay rows onto base_pil.
    Row at index visible_count-1 is at opacity alpha_last; all prior rows at 1.0.
    Elements slide in from left as alpha increases.
    """
    img = base_pil.copy().convert("RGBA")

    try:
        f_label = ImageFont.truetype(FONT_REG,  30)
        f_value = ImageFont.truetype(FONT_BOLD, 46)
        f_wm    = ImageFont.truetype(FONT_REG,  30)
    except Exception:
        f_label = f_value = f_wm = ImageFont.load_default()

    n_rows    = len(elements)
    row_h     = 72
    panel_h   = 50 + n_rows * row_h + 55
    panel_top = H - panel_h - 20

    # Semi-transparent dark panel
    panel = Image.new("RGBA", (W, panel_h), (8, 8, 12, 210))
    img.paste(panel, (0, panel_top), panel)

    # Gold separator line at top of panel
    sep = Image.new("RGBA", (W - 120, 3), (*GOLD, 255))
    img.paste(sep, (60, panel_top + 18), sep)

    icon_r  = 18
    left_x  = 80
    start_y = panel_top + 40

    for i, elem in enumerate(elements[:visible_count]):
        is_last = (i == visible_count - 1)
        alpha   = alpha_last if is_last else 1.0
        slide   = int((1.0 - alpha) * 70)
        x       = left_x - slide
        y       = start_y + i * row_h

        layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d     = ImageDraw.Draw(layer)

        cx, cy = x + icon_r, y + row_h // 2

        if elem["icon"] == "aperture":
            _draw_aperture_icon(d, cx, cy, icon_r, elem.get("f_number", 5.6))
        elif elem["icon"] == "sun" and "angle" in elem:
            _draw_sun_compass(d, cx, cy, icon_r, elem["angle"])
        else:
            d.ellipse([(cx-icon_r, cy-icon_r), (cx+icon_r, cy+icon_r)], outline=GOLD, width=2)
            d.ellipse([(cx-6, cy-6), (cx+6, cy+6)], fill=GOLD)

        lx = x + icon_r * 2 + 20
        d.text((lx, y + 8),  elem["label"], font=f_label, fill=(*DIM,   255))
        if elem.get("value"):
            d.text((lx, y + 44), elem["value"],  font=f_value, fill=(*WHITE, 255))

        r_ch, g_ch, b_ch, a_ch = layer.split()
        a_ch = a_ch.point(lambda v: int(v * alpha))
        layer = Image.merge("RGBA", (r_ch, g_ch, b_ch, a_ch))
        img = Image.alpha_composite(img, layer)

    # Watermark
    wm_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    wd = ImageDraw.Draw(wm_layer)
    wm = "amitphotos.com"
    bb = wd.textbbox((0, 0), wm, font=f_wm)
    wd.text(((W - (bb[2]-bb[0])) // 2, H - 55), wm, font=f_wm, fill=(*GOLD, 200))
    img = Image.alpha_composite(img, wm_layer)

    return img.convert("RGB")


# ── breakdown clip ────────────────────────────────────────────────────────────
def make_breakdown_clip(base_pil, elements, out_path, duration=17.0):
    """
    Frame-by-frame animation: each element fades+slides in over 0.5s,
    1.5s between each element, 3s final hold with all visible.
    """
    total_frames  = int(duration * FPS)
    reveal_frames = 15   # 0.5s fade-in per element
    gap_frames    = 45   # 1.5s gap between elements

    schedules = []
    t = FPS  # 1s initial hold
    for _ in elements:
        schedules.append(t)
        t += reveal_frames + gap_frames

    with tempfile.TemporaryDirectory() as td:
        print(f"  Rendering {total_frames} frames ({duration:.0f}s)...")
        for f in range(total_frames):
            visible_count = 0
            alpha_last    = 1.0
            for i, start in enumerate(schedules):
                if f >= start + reveal_frames:
                    visible_count = i + 1
                    alpha_last    = 1.0
                elif f >= start:
                    visible_count = i + 1
                    alpha_last    = (f - start) / reveal_frames
                    break

            frame = _render_frame(base_pil, elements, visible_count, alpha_last)
            frame.save(f"{td}/f{f:05d}.jpg", quality=88)
            if f % 60 == 0:
                print(f"    {f}/{total_frames} frames", end="\r")

        print(f"  Encoding...")
        r = subprocess.run([
            FFMPEG, "-y",
            "-framerate", str(FPS),
            "-i", f"{td}/f%05d.jpg",
            "-c:v", "libx264", "-preset", "fast", "-crf", "20",
            "-r", str(FPS), "-pix_fmt", "yuv420p",
            str(out_path),
        ], capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError(f"encode failed:\n{r.stderr[-400:]}")


# ── motion clip (Kling / Ken Burns fallback) ──────────────────────────────────
def _ken_burns_fallback(jpeg_bytes, out_path, duration=5.0):
    """Ken Burns fallback when Kling is unavailable."""
    img = Image.open(io.BytesIO(jpeg_bytes)).convert("RGB")
    iw, ih = img.size
    is_landscape = (iw / ih) > 1.2

    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
        img.save(tmp.name, quality=92)
        jpg = tmp.name

    frames = int(duration * FPS)
    try:
        if is_landscape:
            vf = (
                f"[0:v]scale={W}:{H}:force_original_aspect_ratio=increase,"
                f"crop={W}:{H},boxblur=40:5,eq=brightness=-0.25[bg];"
                f"[0:v]scale={W}:-2[fg];"
                f"[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[out]"
            )
            subprocess.run([
                FFMPEG, "-y", "-loop", "1", "-framerate", str(FPS),
                "-i", jpg, "-filter_complex", vf, "-map", "[out]",
                "-t", str(duration), "-c:v", "libx264", "-preset", "fast",
                "-crf", "21", "-r", str(FPS), "-pix_fmt", "yuv420p",
                str(out_path),
            ], capture_output=True, check=True)
        else:
            vf = (
                f"zoompan=z='min(zoom+0.0003,1.08)':d={frames}:"
                f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
                f"s={W}x{H}:fps={FPS},setsar=1"
            )
            subprocess.run([
                FFMPEG, "-y", "-loop", "1", "-framerate", str(FPS),
                "-i", jpg, "-vf", vf, "-t", str(duration),
                "-c:v", "libx264", "-preset", "fast", "-crf", "21",
                "-r", str(FPS), "-pix_fmt", "yuv420p",
                str(out_path),
            ], capture_output=True, check=True)
    except subprocess.CalledProcessError as e:
        raise RuntimeError(f"Ken Burns failed: {e}")
    finally:
        os.unlink(jpg)


def make_motion_clip(jpeg_bytes, category, out_path, duration=5):
    """
    Generates animated clip with Kling 1.6 (if FAL_KEY set), else Ken Burns.
    Output is always 9:16 1080x1920.
    """
    if not FAL_KEY:
        print("  No FAL_KEY — using Ken Burns")
        _ken_burns_fallback(jpeg_bytes, out_path, duration)
        return

    try:
        import fal_client, urllib.request as ul
        os.environ["FAL_KEY"] = FAL_KEY

        img = Image.open(io.BytesIO(jpeg_bytes)).convert("RGB")
        iw, ih = img.size
        is_landscape = (iw / ih) > 1.2
        kling_ratio  = "16:9" if is_landscape else "9:16"
        prompt = MOTION_PROMPTS.get(category, MOTION_PROMPTS["default"])

        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
            img.save(tmp.name, quality=92)
            jpg = tmp.name
        try:
            img_url = fal_client.upload_file(jpg)
        finally:
            os.unlink(jpg)

        print(f"  Kling 1.6 [{kling_ratio}] generating (~4 min)...")
        for attempt in range(1, 3):
            try:
                handler = fal_client.submit(
                    "fal-ai/kling-video/v1.6/standard/image-to-video",
                    arguments={"image_url": img_url, "prompt": prompt,
                               "duration": "5", "aspect_ratio": kling_ratio},
                )
                result  = handler.get()
                video_url = result["video"]["url"]
                break
            except Exception as e:
                print(f"  Kling attempt {attempt}/2 failed: {e}")
                if attempt == 2:
                    raise

        req = ul.Request(video_url, headers={"User-Agent": "Mozilla/5.0"})
        with ul.urlopen(req, timeout=120) as r:
            raw_data = r.read()

        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
            tmp.write(raw_data)
            raw = tmp.name

        try:
            if is_landscape:
                vf = (
                    f"[0:v]scale={W}:{H}:force_original_aspect_ratio=increase,"
                    f"crop={W}:{H},boxblur=40:5,eq=brightness=-0.25[bg];"
                    f"[0:v]scale={W}:-2[fg];"
                    f"[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[out]"
                )
                subprocess.run([
                    FFMPEG, "-y", "-i", raw,
                    "-filter_complex", vf, "-map", "[out]",
                    "-c:v", "libx264", "-preset", "fast", "-crf", "21",
                    "-r", str(FPS), "-pix_fmt", "yuv420p", "-an",
                    str(out_path),
                ], capture_output=True, check=True)
            else:
                subprocess.run([
                    FFMPEG, "-y", "-i", raw,
                    "-vf", f"scale={W}:{H}:force_original_aspect_ratio=increase,"
                           f"crop={W}:{H},setsar=1",
                    "-c:v", "libx264", "-preset", "fast", "-crf", "21",
                    "-r", str(FPS), "-pix_fmt", "yuv420p", "-an",
                    str(out_path),
                ], capture_output=True, check=True)
        finally:
            os.unlink(raw)

    except Exception as e:
        print(f"  Kling failed ({e}) — Ken Burns fallback")
        _ken_burns_fallback(jpeg_bytes, out_path, duration)


# ── white framed photo (polaroid reveal) ──────────────────────────────────────
def make_framed_photo_clip(jpeg_bytes, out_path, duration=4.0):
    """
    Polaroid-framed photo (-3° tilt) composited on the pillarbox blurred
    background (preserves original aspect ratio). Fades in like a print reveal.
    """
    img = Image.open(io.BytesIO(jpeg_bytes)).convert("RGB")
    iw, ih = img.size

    # Pillarbox blurred background fills the full 9:16 frame
    bg_pil = make_pillarbox_base(jpeg_bytes)
    # Extra blur so the polaroid pops against an even softer background
    for _ in range(3):
        bg_pil = bg_pil.filter(ImageFilter.GaussianBlur(radius=8))

    # Scale photo to fit inside the polaroid (max 680px on longer side)
    max_dim = 680
    scale = min(max_dim / iw, max_dim / ih)
    pw, ph = int(iw * scale), int(ih * scale)
    photo = img.resize((pw, ph), Image.LANCZOS)

    # Polaroid: equal border on sides/top, larger at bottom
    b_side, b_top, b_bot = 28, 28, 85
    frame = Image.new("RGB", (pw + b_side * 2, ph + b_top + b_bot), (255, 255, 255))
    frame.paste(photo, (b_side, b_top))

    # Rotate -3° (slight tilt like holding a photo)
    rotated = frame.convert("RGBA").rotate(-3, expand=True, fillcolor=(0, 0, 0, 0))

    # Drop shadow (slightly offset dark copy behind)
    shadow = Image.new("RGBA", rotated.size, (0, 0, 0, 0))
    dark   = Image.new("RGBA", rotated.size, (0, 0, 0, 140))
    shadow.paste(dark, (10, 10), rotated.split()[3])

    # Compose: pillarbox bg (darkened slightly) → shadow → rotated frame
    bg = bg_pil.convert("RGBA")
    # Darken the pillarbox a bit more so polaroid pops
    dark_overlay = Image.new("RGBA", (W, H), (0, 0, 0, 80))
    bg = Image.alpha_composite(bg, dark_overlay)

    rw, rh = rotated.size
    px = (W - rw) // 2
    py = (H - rh) // 2 - 40
    bg.paste(shadow,  (px, py), shadow)
    bg.paste(rotated, (px, py), rotated)

    final = bg.convert("RGB")

    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
        final.save(tmp.name, quality=93)
        jpg = tmp.name

    try:
        r = subprocess.run([
            FFMPEG, "-y",
            "-loop", "1", "-framerate", str(FPS), "-t", str(duration + 0.1),
            "-i", jpg,
            "-vf", (f"fade=t=in:st=0:d=0.6,"
                    f"fade=t=out:st={duration-0.5:.2f}:d=0.5,"
                    f"setsar=1"),
            "-t", str(duration),
            "-c:v", "libx264", "-preset", "fast", "-crf", "20",
            "-r", str(FPS), "-pix_fmt", "yuv420p",
            str(out_path),
        ], capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError(f"framed clip failed:\n{r.stderr[-300:]}")
    finally:
        os.unlink(jpg)


# ── closing slide (like reels) ────────────────────────────────────────────────
def make_closing_clip(out_path, duration=2.5):
    """'Visit my website: www.amitphotos.com' — identical style to reels closing."""
    img  = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)

    try:
        f_sub = ImageFont.truetype(FONT_REG, 60)
        f_url = _fit_text_font(FONT_BOLD, "www.amitphotos.com", W - 80, start_size=120)
    except Exception:
        f_sub = f_url = ImageFont.load_default()

    def center(text, font, y, color):
        bb = draw.textbbox((0, 0), text, font=font)
        draw.text(((W - (bb[2]-bb[0])) // 2, y), text, font=font, fill=color)

    cy = H // 2 - 110
    center("Visit my website:", f_sub, cy, (180, 180, 200))
    draw.line([(W//2 - 200, cy + 88), (W//2 + 200, cy + 88)], fill=GOLD, width=2)
    center("www.amitphotos.com", f_url, cy + 108, GOLD)

    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        img.save(tmp.name)
        png = tmp.name

    try:
        r = subprocess.run([
            FFMPEG, "-y",
            "-loop", "1", "-framerate", str(FPS), "-t", str(duration + 0.1),
            "-i", png,
            "-vf", "fade=t=in:st=0:d=0.5,setsar=1",
            "-t", str(duration),
            "-c:v", "libx264", "-preset", "fast", "-crf", "20",
            "-r", str(FPS), "-pix_fmt", "yuv420p",
            str(out_path),
        ], capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError(f"closing failed:\n{r.stderr[-300:]}")
    finally:
        os.unlink(png)


# ── reveal clip ───────────────────────────────────────────────────────────────
def make_reveal_clip(base_pil, out_path, duration=12.0):
    """Clean pillarbox photo with gentle slow zoom + gold watermark → MP4."""
    img  = base_pil.copy()
    draw = ImageDraw.Draw(img)
    try:
        f_wm = ImageFont.truetype(FONT_REG, 44)
    except Exception:
        f_wm = ImageFont.load_default()
    wm = "amitphotos.com"
    bb = draw.textbbox((0, 0), wm, font=f_wm)
    ww = bb[2] - bb[0]
    draw.text(((W - ww) // 2, H - 90), wm, font=f_wm, fill=(*GOLD, 200))

    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
        img.save(tmp.name, quality=92)
        jpg = tmp.name

    frames = int(duration * FPS)
    try:
        vf = (
            f"zoompan=z='min(zoom+0.0002,1.05)':d={frames}:"
            f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
            f"s={W}x{H}:fps={FPS},"
            f"fade=t=in:st=0:d=0.7,"
            f"fade=t=out:st={duration-0.7:.2f}:d=0.7,"
            f"setsar=1"
        )
        r = subprocess.run([
            FFMPEG, "-y",
            "-loop", "1", "-framerate", str(FPS),
            "-i", jpg,
            "-vf", vf,
            "-t", str(duration),
            "-c:v", "libx264", "-preset", "fast", "-crf", "20",
            "-r", str(FPS), "-pix_fmt", "yuv420p",
            str(out_path),
        ], capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError(f"reveal failed:\n{r.stderr[-400:]}")
    finally:
        os.unlink(jpg)


# ── assembly ──────────────────────────────────────────────────────────────────
def assemble(clips_with_durations, out_path):
    """Concatenates list of (path, duration_seconds) with 0.5s crossfade."""
    if len(clips_with_durations) == 1:
        shutil.copy2(str(clips_with_durations[0][0]), str(out_path))
        return

    inputs = []
    for path, _ in clips_with_durations:
        inputs += ["-i", str(path)]

    xdur   = 0.5
    parts  = []
    offset = clips_with_durations[0][1] - xdur
    prev   = "0"
    n      = len(clips_with_durations)

    for i in range(1, n):
        label = f"v{i:02d}" if i < n - 1 else "vout"
        parts.append(
            f"[{prev}][{i}]xfade=transition=fade:duration={xdur}:offset={offset:.3f}[{label}]"
        )
        prev = label
        if i < n - 1:
            offset += clips_with_durations[i][1] - xdur

    r = subprocess.run([
        FFMPEG, "-y", *inputs,
        "-filter_complex", ";".join(parts),
        "-map", "[vout]",
        "-c:v", "libx264", "-preset", "fast", "-crf", "20",
        "-r", str(FPS), "-pix_fmt", "yuv420p",
        str(out_path),
    ], capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"assemble failed:\n{r.stderr[-600:]}")


# ── upload video for sharing ──────────────────────────────────────────────────
def _upload_video(video_path):
    """Upload to litterbox (72h) with 0x0.st fallback. Returns public URL."""
    import requests
    data = Path(video_path).read_bytes()
    print(f"  Uploading {len(data)/1024/1024:.1f} MB...")

    for name, url, extra in [
        ("litterbox", "https://litterbox.catbox.moe/resources/internals/api.php",
         {"data": {"reqtype": "fileupload", "time": "72h"}, "field": "fileToUpload"}),
        ("0x0.st", "https://0x0.st", {"data": {}, "field": "file"}),
    ]:
        try:
            r = requests.post(
                url, data=extra["data"],
                files={extra["field"]: ("breakdown.mp4", data, "video/mp4")},
                timeout=180,
            )
            r.raise_for_status()
            pub = r.text.strip()
            if pub.startswith("http"):
                print(f"  Uploaded ({name}): {pub}")
                return pub
        except Exception as e:
            print(f"  {name} failed: {e}")
    raise RuntimeError("Upload failed on all services")


def _save_to_json(photo, video_url, video_path, duration):
    """Append/update entry in data/breakdown_videos.json."""
    json_file = ROOT / "data" / "breakdown_videos.json"
    records   = []
    if json_file.exists():
        try:
            records = json.loads(json_file.read_text(encoding="utf-8"))
        except Exception:
            records = []

    from datetime import datetime
    entry = {
        "photo_id":  photo["id"],
        "title":     photo.get("title", ""),
        "category":  photo.get("category", ""),
        "thumbnail": photo.get("thumbnail", ""),
        "video_url": video_url,
        "duration":  round(duration, 1),
        "created":   datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "size_mb":   round(Path(video_path).stat().st_size / 1024 / 1024, 1),
    }
    # Replace existing entry for same photo
    records = [r for r in records if r.get("photo_id") != photo["id"]]
    records.insert(0, entry)

    json_file.write_text(
        json.dumps(records, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"  Saved to data/breakdown_videos.json")


# ── main ──────────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser(description="Photo breakdown TikTok video generator")
    ap.add_argument("--id",   help="Photo ID from photos.json")
    ap.add_argument("--url",  help="Direct photo URL (fallback when no Drive creds)")
    ap.add_argument("--list", action="store_true", help="List all available photos")
    ap.add_argument("--no-upload", action="store_true", help="Skip upload to file host")
    args = ap.parse_args()

    if args.list:
        list_photos()
        return

    if not args.id:
        ap.print_help()
        return

    OUT_DIR.mkdir(exist_ok=True)

    photos = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    photo  = next((p for p in photos if p["id"] == args.id), None)
    if not photo:
        print(f"Photo ID '{args.id}' not found. Use --list to browse.")
        sys.exit(1)

    title    = photo.get("title", "")
    category = photo.get("category", "")
    safe     = "".join(c if c.isalnum() or c in " -_" else "_" for c in title)[:40].strip()
    out_path = OUT_DIR / f"breakdown_{safe}.mp4"

    print(f"\nPhoto: {title}  [{category}]")

    # ── Fetch JPEG + EXIF ──────────────────────────────────────────────────────
    jpeg = None
    exif = {}

    # Try Google Drive first (best EXIF, requires token.json)
    if CREDS_FILE.exists() and TOKEN_FILE.exists() and not args.url:
        try:
            print("Fetching from Google Drive...")
            session        = get_drive_session()
            jpeg, raw_exif = fetch_photo_data(session, args.id)
            exif           = parse_exif(raw_exif)
        except Exception as e:
            print(f"  Drive error ({e}) — will try URL fallback")
            jpeg = None

    # Fallback: download from URL (photo.url or --url arg)
    if jpeg is None:
        photo_url = args.url or photo.get("url") or photo.get("thumbnail") or ""
        if not photo_url:
            print("No photo URL available. Provide --url or ensure photos.json has 'url' field.")
            sys.exit(1)
        print(f"Downloading from URL...")
        import requests as req_lib
        r = req_lib.get(photo_url, timeout=60)
        r.raise_for_status()
        jpeg = r.content
        exif = read_exif_from_jpeg(jpeg)

    print(f"  Camera : {exif.get('camera', '-')}")
    print(f"  {exif.get('aperture','-')}  {exif.get('shutter','-')}  {exif.get('iso','-')}  {exif.get('focal','-')}")

    print("Building pillarbox base...")
    base = make_pillarbox_base(jpeg)

    loc   = reverse_geocode(exif.get("lat"), exif.get("lon"))
    angle = estimate_light_angle(exif.get("time_str"), exif.get("lat"))
    elems = build_overlay_elements(exif, loc, angle)
    print(f"  Location: {loc or '-'}   Light: {angle or '-'}")
    print(f"  Overlay elements: {len(elems)}")

    with tempfile.TemporaryDirectory() as td:
        td_path = Path(td)

        # 1. Motion clip — Kling or Ken Burns (5s)
        print("\n[1/4] Motion clip (Kling/Ken Burns)...")
        m_clip = td_path / "01_motion.mp4"
        make_motion_clip(jpeg, category, m_clip, duration=5)
        motion_dur = 5.0

        # 2. EXIF breakdown animation
        breakdown_dur = max(12.0, len(elems) * 2.5 + 6.0)
        print(f"\n[2/4] Breakdown animation ({breakdown_dur:.0f}s, {len(elems)} elements)...")
        b_clip = td_path / "02_breakdown.mp4"
        make_breakdown_clip(base, elems, b_clip, duration=breakdown_dur)

        # 3. Framed photo (polaroid reveal, 6.5s)
        print("\n[3/4] Framed photo reveal...")
        f_clip = td_path / "03_framed.mp4"
        make_framed_photo_clip(jpeg, f_clip, duration=6.5)

        # 4. Closing slide (2.5s)
        print("\n[4/4] Closing slide...")
        c_clip = td_path / "04_closing.mp4"
        make_closing_clip(c_clip, duration=2.5)

        print("\nAssembling with crossfades...")
        assemble(
            [(m_clip, motion_dur), (b_clip, breakdown_dur),
             (f_clip, 6.5), (c_clip, 2.5)],
            out_path,
        )

    total = motion_dur + breakdown_dur + 6.5 + 2.5
    print(f"\nDone! {out_path} ({total:.0f}s)")

    # ── Upload + save record ───────────────────────────────────────────────────
    if not args.no_upload:
        try:
            video_url = _upload_video(out_path)
            _save_to_json(photo, video_url, out_path, total)

            # Commit JSON update
            print("\nCommitting breakdown_videos.json...")
            subprocess.run(
                ["git", "config", "user.name", "Breakdown Agent"],
                cwd=ROOT, capture_output=True
            )
            subprocess.run(
                ["git", "config", "user.email", "agent@amitphotos.com"],
                cwd=ROOT, capture_output=True
            )
            subprocess.run(
                ["git", "add", "data/breakdown_videos.json"],
                cwd=ROOT, check=True, capture_output=True
            )
            diff = subprocess.run(
                ["git", "diff", "--staged", "--quiet"],
                cwd=ROOT, capture_output=True
            )
            if diff.returncode != 0:
                subprocess.run(
                    ["git", "commit", "-m", f"breakdown: {title[:50]}"],
                    cwd=ROOT, check=True, capture_output=True
                )
                for _ in range(3):
                    r = subprocess.run(
                        ["git", "pull", "--rebase", "origin", "main"],
                        cwd=ROOT, capture_output=True
                    )
                    if r.returncode == 0:
                        break
                subprocess.run(
                    ["git", "push", "origin", "main"],
                    cwd=ROOT, capture_output=True
                )

            print(f"\nVideo available: {video_url}")
        except Exception as e:
            print(f"\nUpload skipped: {e}")
    else:
        print("Upload skipped (--no-upload)")

    print("Ready to upload to TikTok!")


if __name__ == "__main__":
    main()
