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
