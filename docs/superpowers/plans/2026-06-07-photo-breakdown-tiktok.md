# Photo Breakdown TikTok — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `src/photo_breakdown.py` — a script that generates visually impressive 35-second TikTok breakdown videos from portfolio photos, showing camera settings (from Google Drive EXIF) with animated overlays, light direction compass, and a clean reveal.

**Architecture:** 4-stage pipeline: (1) fetch JPEG + EXIF from Drive API using existing credentials, (2) render title card clip, (3) render animated breakdown via frame-by-frame Pillow → ffmpeg encode, (4) render pillarbox reveal with Ken Burns, then crossfade-concat all three clips.

**Tech Stack:** Python 3.11, Pillow, ffmpeg, google-auth + requests (all already installed in the project)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/photo_breakdown.py` | Create | Entire pipeline — Drive API, EXIF parsing, frame rendering, clip assembly, CLI |
| `breakdown_output/` | Create at runtime | Output MP4s |

---

### Task 1: Skeleton + Drive API + EXIF parsing

**Files:**
- Create: `src/photo_breakdown.py`

- [ ] **Step 1: Create the file with constants, helpers, Drive API, and EXIF parser**

```python
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


# ── ffmpeg + fonts ────────────────────────────────────────────────────────────
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
        stream=True,
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
        result["aperture"]  = f"f/{ap:.1f}"
        result["f_number"]  = float(ap)

    et = exif.get("exposureTime")
    if et:
        result["shutter"] = f"1/{round(1/et)}s" if et < 1 else f"{et:.1f}s"

    iso = exif.get("isoSpeed")
    if iso: result["iso"] = f"ISO {iso}"

    fl = exif.get("focalLength")
    if fl: result["focal"] = f"{round(fl)}mm"

    loc = exif.get("location", {})
    result["lat"] = loc.get("latitude")
    result["lon"] = loc.get("longitude")
    result["time_str"] = exif.get("time", "")   # "2024:03:15 07:23:45"

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
        # Northern hemisphere simple solar arc
        if lat is not None and lat > 0:
            if 6 <= h < 12:
                return 90 - (h - 6) / 6 * 90    # E → N
            elif 12 <= h < 18:
                return 180 + (h - 12) / 6 * 90  # S → W
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
```

- [ ] **Step 2: Run `--list` to verify Drive auth and photo data load**

```
python src/photo_breakdown.py --list
```

Expected: table of photo IDs, categories, titles. If Drive auth dialog appears — log in once.

- [ ] **Step 3: Commit**

```bash
git add src/photo_breakdown.py
git commit -m "feat: photo_breakdown skeleton — Drive API, EXIF parsing, light direction"
```

---

### Task 2: Pillarbox base frame

**Files:**
- Modify: `src/photo_breakdown.py` — add `make_pillarbox_base()`

- [ ] **Step 1: Add function after `list_photos()`**

```python
# ── pillarbox base ────────────────────────────────────────────────────────────
def make_pillarbox_base(jpeg_bytes):
    """
    Returns 1080×1920 RGB PIL Image:
      background = photo scaled+cropped to full 9:16, blurred 65% dark
      foreground = original photo scaled to fit width, centered
    """
    img = Image.open(io.BytesIO(jpeg_bytes)).convert("RGB")
    iw, ih = img.size

    # Background: cover + blur + darken
    scale = max(W / iw, H / ih)
    bw, bh = int(iw * scale), int(ih * scale)
    bg = img.resize((bw, bh), Image.LANCZOS)
    bx, by = (bw - W) // 2, (bh - H) // 2
    bg = bg.crop((bx, by, bx + W, by + H))
    for _ in range(4):
        bg = bg.filter(ImageFilter.GaussianBlur(radius=12))
    black = Image.new("RGB", (W, H), BG)
    bg = Image.blend(bg, black, 0.65)

    # Foreground: fit to width (landscape) or height (portrait)
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
```

- [ ] **Step 2: Quick visual check — save base PNG**

Add to bottom of file (above `if __name__ == "__main__":`):

```python
def _test_base():
    photos  = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    session = get_drive_session()
    p       = photos[0]
    jpeg, _ = fetch_photo_data(session, p["id"])
    base    = make_pillarbox_base(jpeg)
    OUT_DIR.mkdir(exist_ok=True)
    base.save(OUT_DIR / "test_base.png")
    print(f"Saved {OUT_DIR / 'test_base.png'}")
```

Run: `python -c "import src.photo_breakdown as m; m._test_base()"`
Expected: `breakdown_output/test_base.png` — blurred dark background, photo centered in original ratio.

- [ ] **Step 3: Delete `_test_base()`, commit**

```bash
git add src/photo_breakdown.py
git commit -m "feat: pillarbox base frame builder"
```

---

### Task 3: Title card clip

**Files:**
- Modify: `src/photo_breakdown.py` — add `make_title_clip()`

- [ ] **Step 1: Add function**

```python
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
```

- [ ] **Step 2: Quick test**

```python
# temp test — delete after
OUT_DIR.mkdir(exist_ok=True)
make_title_clip("זריחה בגליל", "ישראל", OUT_DIR / "test_title.mp4")
print("Saved test_title.mp4")
```

Run: `python src/photo_breakdown.py`
Expected: `breakdown_output/test_title.mp4` — 3-second dark card, centered Hebrew title, gold lines, category below.

- [ ] **Step 3: Delete temp test, commit**

```bash
git add src/photo_breakdown.py
git commit -m "feat: title card clip generator"
```

---

### Task 4: Animated EXIF breakdown clip (visually impressive)

**Files:**
- Modify: `src/photo_breakdown.py` — add icon drawers, overlay element builder, frame renderer, `make_breakdown_clip()`

This is the core visual feature. Frame-by-frame Pillow compositing gives full control over animations: each EXIF row fades+slides in from the left. A semi-transparent panel sits over the lower third of the photo.

- [ ] **Step 1: Add aperture icon and sun compass drawers**

```python
# ── icon drawers ──────────────────────────────────────────────────────────────
def _draw_aperture_icon(draw, cx, cy, r, f_number):
    """Circular aperture: outer ring + inner opening sized by f-number."""
    draw.ellipse([(cx-r, cy-r), (cx+r, cy+r)], outline=GOLD, width=3)
    # Opening: f/1.4 → 80% radius, f/22 → 15% radius
    open_r = int(r * max(0.15, min(0.85, 1.4 / max(f_number, 1.4) * 0.85)))
    draw.ellipse([(cx-open_r, cy-open_r), (cx+open_r, cy+open_r)], outline=GOLD, width=2)
    # 6 blade lines
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
        x1 = cx + int((r-8)*math.cos(a));  y1 = cy + int((r-8)*math.sin(a))
        x2 = cx + int(r*math.cos(a));      y2 = cy + int(r*math.sin(a))
        draw.line([(x1,y1),(x2,y2)], fill=DIM, width=2)
    # Arrow
    a  = math.radians(angle_deg - 90)
    ax = cx + int(r*0.65*math.cos(a)); ay = cy + int(r*0.65*math.sin(a))
    draw.line([(cx, cy), (ax, ay)], fill=GOLD, width=3)
    draw.ellipse([(ax-5,ay-5),(ax+5,ay+5)], fill=GOLD)
```

- [ ] **Step 2: Add overlay element builder**

```python
def build_overlay_elements(exif, location_name, light_angle):
    """
    Returns ordered list of dicts for overlay panel rows.
    Each dict: label, value, icon (str key), and optional f_number/angle.
    """
    elems = []
    if exif.get("camera"):
        elems.append({"label": "Camera",        "value": exif["camera"],    "icon": "dot"})
    if exif.get("aperture"):
        elems.append({"label": "Aperture",       "value": exif["aperture"],  "icon": "aperture",
                      "f_number": exif.get("f_number", 5.6)})
    if exif.get("shutter"):
        elems.append({"label": "Shutter speed",  "value": exif["shutter"],   "icon": "dot"})
    if exif.get("iso"):
        elems.append({"label": "Sensitivity",    "value": exif["iso"],       "icon": "dot"})
    if exif.get("focal"):
        elems.append({"label": "Focal length",   "value": exif["focal"],     "icon": "dot"})
    if location_name:
        elems.append({"label": "Location",       "value": location_name,     "icon": "dot"})
    if light_angle is not None:
        elems.append({"label": "Light direction","value": "",                "icon": "sun",
                      "angle": light_angle})
    return elems
```

- [ ] **Step 3: Add single frame compositor**

```python
def _render_frame(base_pil, elements, visible_count, alpha_last):
    """
    Composites `visible_count` overlay rows onto base_pil.
    Row `visible_count-1` is at opacity `alpha_last` (0.0–1.0); all others at 1.0.
    Each row slides in from the left as alpha increases.
    """
    img = base_pil.copy().convert("RGBA")

    try:
        f_label = ImageFont.truetype(FONT_REG,  38)
        f_value = ImageFont.truetype(FONT_BOLD, 58)
        f_wm    = ImageFont.truetype(FONT_REG,  36)
    except Exception:
        f_label = f_value = f_wm = ImageFont.load_default()

    # Semi-transparent panel — lower portion
    n_rows    = len(elements)
    panel_h   = 60 + n_rows * 88 + 70      # top pad + rows + watermark area
    panel_top = H - panel_h - 20
    panel     = Image.new("RGBA", (W, panel_h), (8, 8, 12, 210))
    img.paste(panel, (0, panel_top), panel)

    # Gold separator at top of panel
    sep = Image.new("RGBA", (W - 120, 3), (*GOLD, 255))
    img.paste(sep, (60, panel_top + 18), sep)

    icon_r  = 18          # icon circle radius
    row_h   = 88
    left_x  = 80
    start_y = panel_top + 40

    for i, elem in enumerate(elements[:visible_count]):
        is_last = (i == visible_count - 1)
        alpha   = alpha_last if is_last else 1.0
        slide   = int((1.0 - alpha) * 70)  # slides from left
        x       = left_x - slide
        y       = start_y + i * row_h

        # --- overlay layer for this element ---
        layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        d     = ImageDraw.Draw(layer)

        cx, cy = x + icon_r, y + row_h // 2

        if elem["icon"] == "aperture":
            _draw_aperture_icon(d, cx, cy, icon_r, elem.get("f_number", 5.6))
        elif elem["icon"] == "sun" and "angle" in elem:
            _draw_sun_compass(d, cx, cy, icon_r, elem["angle"])
        else:
            # Simple gold dot
            d.ellipse([(cx-icon_r, cy-icon_r), (cx+icon_r, cy+icon_r)],
                      outline=GOLD, width=2)
            d.ellipse([(cx-6, cy-6), (cx+6, cy+6)], fill=GOLD)

        lx = x + icon_r * 2 + 20
        d.text((lx, y + 8),  elem["label"], font=f_label, fill=(*DIM,   255))
        if elem.get("value"):
            d.text((lx, y + 44), elem["value"],  font=f_value, fill=(*WHITE, 255))

        # Apply alpha to the layer, then composite
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
```

- [ ] **Step 4: Add breakdown clip generator**

```python
def make_breakdown_clip(base_pil, elements, out_path, duration=17.0):
    """
    Frame-by-frame animation: each element appears with 0.5s fade+slide,
    1.5s between each element, 3s final hold with all visible.
    """
    total_frames  = int(duration * FPS)
    reveal_frames = 15   # 0.5s fade-in per element
    gap_frames    = 45   # 1.5s gap between elements

    # Build schedule: frame index when each element starts appearing
    schedules = []
    t = FPS  # 1s initial hold
    for _ in elements:
        schedules.append(t)
        t += reveal_frames + gap_frames

    with tempfile.TemporaryDirectory() as td:
        print(f"  🎨 Rendering {total_frames} frames ({duration:.0f}s)...")
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

        print(f"  ✅ Encoding...")
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
```

- [ ] **Step 5: Quick visual test — generate 8-second breakdown clip**

```python
# temp test — delete after
session = get_drive_session()
photos  = json.loads(DATA_FILE.read_text(encoding="utf-8"))
p       = photos[0]
jpeg, raw_exif = fetch_photo_data(session, p["id"])
exif    = parse_exif(raw_exif)
print("EXIF:", exif)
base    = make_pillarbox_base(jpeg)
loc     = reverse_geocode(exif.get("lat"), exif.get("lon"))
angle   = estimate_light_angle(exif.get("time_str"), exif.get("lat"))
elems   = build_overlay_elements(exif, loc, angle)
OUT_DIR.mkdir(exist_ok=True)
make_breakdown_clip(base, elems, OUT_DIR / "test_breakdown.mp4", duration=8.0)
print("Saved test_breakdown.mp4")
```

Run: `python src/photo_breakdown.py`
Expected: 8-second MP4 with animated overlay rows fading+sliding in over the photo. EXIF printed to console.

- [ ] **Step 6: Delete temp test, commit**

```bash
git add src/photo_breakdown.py
git commit -m "feat: animated EXIF breakdown — frame-by-frame Pillow compositing"
```

---

### Task 5: Reveal clip + final assembly + CLI

**Files:**
- Modify: `src/photo_breakdown.py` — add `make_reveal_clip()`, `assemble()`, `main()`

- [ ] **Step 1: Add reveal clip (Ken Burns zoom on pillarbox base)**

```python
# ── reveal clip ───────────────────────────────────────────────────────────────
def make_reveal_clip(base_pil, out_path, duration=12.0):
    """
    Clean pillarbox photo with gentle slow zoom (Ken Burns).
    Watermark baked into the static PNG, ffmpeg adds zoom + fades.
    """
    # Bake watermark onto the frame
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
        # Subtle zoom: 1.00 → 1.05 over full duration
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
```

- [ ] **Step 2: Add crossfade assembler**

```python
# ── assembly ──────────────────────────────────────────────────────────────────
def assemble(clips_with_durations, out_path):
    """
    Concatenates list of (path, duration_seconds) with 0.5s crossfade between clips.
    """
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
        prev    = label
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
```

- [ ] **Step 3: Add `main()` and entry point**

```python
# ── main ──────────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser(description="Photo breakdown TikTok video generator")
    ap.add_argument("--id",   help="Photo ID from photos.json")
    ap.add_argument("--list", action="store_true", help="List all available photos")
    args = ap.parse_args()

    if args.list:
        list_photos()
        return

    if not args.id:
        ap.print_help()
        return

    OUT_DIR.mkdir(exist_ok=True)

    # Resolve photo metadata
    photos = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    photo  = next((p for p in photos if p["id"] == args.id), None)
    if not photo:
        print(f"❌ Photo ID '{args.id}' not found. Use --list to browse.")
        sys.exit(1)

    title    = photo.get("title", "")
    category = photo.get("category", "")
    safe     = "".join(c if c.isalnum() or c in " -_" else "_" for c in title)[:40].strip()
    out_path = OUT_DIR / f"breakdown_{safe}.mp4"

    print(f"\n📸 {title}  [{category}]")

    # 1. Fetch from Drive
    print("⬇️  Fetching from Google Drive...")
    session        = get_drive_session()
    jpeg, raw_exif = fetch_photo_data(session, args.id)
    exif           = parse_exif(raw_exif)
    print(f"   Camera : {exif.get('camera', '—')}")
    print(f"   Aperture: {exif.get('aperture','—')}  Shutter: {exif.get('shutter','—')}  ISO: {exif.get('iso','—')}")
    print(f"   Focal  : {exif.get('focal','—')}")

    # 2. Build pillarbox base
    print("🖼  Building pillarbox base...")
    base = make_pillarbox_base(jpeg)

    # 3. Enrich with location + light
    loc   = reverse_geocode(exif.get("lat"), exif.get("lon"))
    angle = estimate_light_angle(exif.get("time_str"), exif.get("lat"))
    elems = build_overlay_elements(exif, loc, angle)
    print(f"   Location: {loc or '—'}   Light angle: {angle or '—'}°")
    print(f"   Overlay elements: {len(elems)}")

    with tempfile.TemporaryDirectory() as td:
        td_path = Path(td)

        # Clip 1: Title card (3s)
        print("\n🎬 [1/3] Title card...")
        t_clip = td_path / "01_title.mp4"
        make_title_clip(title, category, t_clip, duration=3.0)

        # Clip 2: Breakdown animation (~14-20s depending on element count)
        breakdown_dur = max(12.0, len(elems) * 2.5 + 6.0)
        print(f"\n🎨 [2/3] Breakdown animation ({breakdown_dur:.0f}s, {len(elems)} elements)...")
        b_clip = td_path / "02_breakdown.mp4"
        make_breakdown_clip(base, elems, b_clip, duration=breakdown_dur)

        # Clip 3: Clean reveal (12s)
        print("\n✨ [3/3] Reveal clip...")
        r_clip = td_path / "03_reveal.mp4"
        make_reveal_clip(base, r_clip, duration=12.0)

        # Assemble with crossfades
        print("\n🔗 Assembling with crossfades...")
        assemble(
            [(t_clip, 3.0), (b_clip, breakdown_dur), (r_clip, 12.0)],
            out_path,
        )

    total = 3.0 + breakdown_dur + 12.0
    print(f"\n✅ Done!  {out_path}  ({total:.0f}s)")
    print(f"   Upload manually to TikTok")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Full end-to-end test**

Run:
```
python src/photo_breakdown.py --list
# Pick any ID from the output, then:
python src/photo_breakdown.py --id <photo-id>
```

Expected:
- Console shows EXIF fields, location, progress
- `breakdown_output/breakdown_<title>.mp4` created
- Watch the video: title card (3s) → animated EXIF overlays (12-20s) → clean zoom reveal (12s)
- Total ~30-35 seconds, all segments crossfade smoothly

- [ ] **Step 5: Commit + push**

```bash
git add src/photo_breakdown.py
git commit -m "feat: complete photo_breakdown TikTok generator — title/EXIF/reveal"
git push origin main
```

---

## Self-Review

**Spec coverage:**
- ✅ Title card with dark background, Hebrew, gold lines
- ✅ Pillarbox for landscape photos (blurred dark bg + original centered)
- ✅ Animated overlays: camera, aperture, shutter, ISO, focal, location, light direction
- ✅ Aperture circle icon
- ✅ Sun compass icon
- ✅ Reverse geocode location
- ✅ Light direction from time+GPS
- ✅ Ken Burns zoom on reveal
- ✅ `amitphotos.com` gold watermark
- ✅ `--list` and `--id` CLI
- ✅ Output to `breakdown_output/`
- ✅ No new paid APIs ($0 cost)

**Placeholder scan:** None found — all steps contain complete code.

**Type consistency:**
- `build_overlay_elements()` returns list of dicts with keys: `label`, `value`, `icon`, optionally `f_number`, `angle` — all consumed correctly in `_render_frame()`
- `make_pillarbox_base()` returns `PIL.Image` (RGB) — consumed by `_render_frame()`, `make_breakdown_clip()`, `make_reveal_clip()` ✅
- `assemble()` takes `list[(Path, float)]` — correctly passed in `main()` ✅
