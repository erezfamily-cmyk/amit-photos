# Photo Breakdown TikTok — Design Spec
**Date:** 2026-06-07  
**Status:** Approved

## Goal

Create 35-second TikTok-style videos (9:16) from existing portfolio photos that show the technical breakdown of how the photo was taken — camera settings, lighting direction, location. Additional channel (TikTok), does not replace existing Instagram reels workflow.

## Architecture

```
Photo ID (from photos.json)
    ↓ Google Drive API (existing credentials.json + token.json)
JPEG download + imageMediaMetadata (EXIF)
    ↓ Pillow + ffmpeg
35-second 9:16 MP4
    ↓
breakdown_output/breakdown_<title>.mp4 (local, manual upload to TikTok)
```

**Script:** `src/photo_breakdown.py`  
**Usage:** `python src/photo_breakdown.py --id <photo-id>`  
**Optional:** `--list` to show available photos

## EXIF Fields Used

From Google Drive API `imageMediaMetadata`:
- `cameraModel` + `cameraMake` — camera name
- `aperture` → display as f/2.8
- `exposureTime` → display as 1/500s
- `isoSpeed` → display as ISO 400
- `focalLength` → display as 50mm
- `location.latitude` + `location.longitude` → reverse geocode to city/country
- `time` → estimate light direction (sunrise/golden/midday/sunset)

## Video Structure

### Segment 1: Title Card (0–3s)
- Dark background (#0a0a0e, matching site design)
- Hebrew photo title (large, centered)
- Category subtitle
- Fade in

### Segment 2: EXIF Breakdown (3–20s)
- Photo displayed with **pillarbox effect** (reused from reel_post.py):
  - Landscape: blurred dark background + original photo centered
  - Portrait: photo fills frame
- Overlays animate in one by one (~2s each):
  1. 📷 Camera name (top area)
  2. ⬡ f/stop with aperture visualization circle
  3. ⏱ Shutter speed
  4. 🔆 ISO
  5. 🔭 Focal length
  6. 📍 Location (city/country, from GPS or reverse geocode)
  7. ☀️ Light direction — small compass-style circle with arrow (estimated from time+GPS)

### Segment 3: Clean Reveal (20–35s)
- Same pillarbox layout, no overlays
- Gentle Ken Burns (subtle zoom, reused from reel_post.py)
- `amitphotos.com` watermark bottom-center (gold, matching site)
- Fade out

## Light Direction Estimation

Using `time` field (datetime string) and `location`:
- Morning (6-9h): arrow points East
- Late morning (9-11h): arrow points SE
- Midday (11-14h): arrow points South (in Israel latitude)
- Afternoon (14-16h): arrow points SW
- Golden hour (16-19h): arrow points West

If no GPS/time → omit light direction overlay.

## Code Reuse from reel_post.py

- `_ken_burns_clip()` pillarbox logic → extract as shared util
- `_find_ffmpeg()` → reuse directly
- `_find_font()` → reuse directly
- `_closing_clip()` color palette → match same dark theme

## Dependencies

All already installed in the project:
- `Pillow` — overlay rendering
- `requests` — Drive API + image download
- `google-auth` + `google-auth-oauthlib` — Drive credentials
- `ffmpeg` (system) — video encoding

No new paid APIs. Cost: $0.

## Output

- File: `breakdown_output/breakdown_<safe_title>.mp4`
- Resolution: 1080×1920 (9:16)
- Duration: ~35 seconds
- Format: H.264, yuv420p, 30fps
- Upload to TikTok manually for now

## Out of Scope

- Automatic TikTok API publishing (manual upload first, validate engagement)
- GitHub Actions workflow (local only for now)
- Veo/AI-generated BTS footage (Approach B, future)
- YouTube version (future)
