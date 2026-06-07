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
def make_title_clip(title, category, out_path, duration=3.0):
    """Dark card with gold dividers, Hebrew title, category, watermark → MP4."""
    img  = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)

    try:
        f_title = ImageFont.truetype(FONT_BOLD, 88)
        f_cat   = ImageFont.truetype(FONT_REG,  50)
        f_wm    = ImageFont.truetype(FONT_REG,  38)
    except Exception:
        f_title = f_cat = f_wm = ImageFont.load_default()

    cy = H // 2 - 60

    def center_text(text, font, y, color):
        bb = draw.textbbox((0, 0), text, font=font)
        draw.text(((W - (bb[2] - bb[0])) // 2, y), text, font=font, fill=color)

    # Top gold line
    lw = 360
    draw.rectangle([(W//2 - lw//2, cy - 30), (W//2 + lw//2, cy - 26)], fill=GOLD)

    # Title
    title_disp = _bidi(title)
    center_text(title_disp, f_title, cy, WHITE)
    bb = draw.textbbox((0, 0), title_disp, font=f_title)
    th = bb[3] - bb[1]

    # Bottom gold line
    draw.rectangle([(W//2 - lw//2, cy + th + 20), (W//2 + lw//2, cy + th + 24)], fill=GOLD)

    # Category
    if category:
        center_text(_bidi(category), f_cat, cy + th + 50, GOLD)

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
        f_label = ImageFont.truetype(FONT_REG,  38)
        f_value = ImageFont.truetype(FONT_BOLD, 58)
        f_wm    = ImageFont.truetype(FONT_REG,  36)
    except Exception:
        f_label = f_value = f_wm = ImageFont.load_default()

    n_rows    = len(elements)
    row_h     = 88
    panel_h   = 60 + n_rows * row_h + 70
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


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--id")
    args = ap.parse_args()
    if args.list:
        list_photos()
    elif args.id:
        print("--id processing not yet implemented (coming in Task 5)")
    else:
        ap.print_help()
