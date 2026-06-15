# Videos Page — Design Spec
**Date:** 2026-06-15

## Goal

A new page at `/videos/` that centralizes all published videos from YouTube and Instagram/Facebook, organized by topic. Updated automatically whenever a GitHub Action publishes a new video.

## Architecture

**Approach: Centralized JSON** — `data/videos.json`

Every Action that publishes a video appends a record to `data/videos.json`. The page reads this file at load time and renders the grid. No API calls from the browser, consistent with existing patterns (same as `data/photos.json`, `data/distributed_videos.json`).

## Data Structure

### `data/videos.json`

```json
[
  {
    "id": "abc123xyz",
    "platform": "youtube",
    "type": "tutorial",
    "slug": "depth-of-field",
    "title_he": "עומק שדה — מה מטשטש את הרקע?",
    "title_en": "Depth of Field — What Blurs the Background?",
    "summary_he": "עומק שדה קובע מה חד ומה מטושטש בתמונה. למד איך פתח עדשה, מרחק מהנושא ואורך מוקד משפיעים יחד.",
    "summary_en": "Depth of field determines what's sharp and what's blurred in a photo. Learn how aperture, subject distance and focal length work together.",
    "date": "2026-05-14"
  }
]
```

**Field reference:**

| Field | Values | Notes |
|---|---|---|
| `id` | string | YouTube video ID or Instagram shortcode |
| `platform` | `youtube` \| `instagram` \| `facebook` | |
| `type` | `tutorial` \| `gallery` \| `reel` | |
| `slug` | string \| `null` | Only for tutorials — links to `/camera/<slug>/` |
| `title_he` / `title_en` | string | Required |
| `summary_he` / `summary_en` | string | 2-3 sentences, required for tutorials; empty string for gallery/reel |
| `date` | `YYYY-MM-DD` | Publish date |

**Reel platform priority:** If a reel was published to both Instagram and YouTube (common via `distribute-video.yml`), store the YouTube ID with `platform: youtube`. Only use `platform: instagram` when there is no YouTube counterpart.

## Page: `/videos/index.html`

### Layout

- **Hero**: page title + subtitle (HE/EN)
- **Tab bar**: 3 tabs — מדריכי צילום | גלריות אלבום | ריילס וקליפים
- **Section per tab** — all sections visible on page, tabs scroll to anchor

### Section 1 — מדריכי צילום (type: tutorial)

Single-column cards. For each video:
```
┌─────────────────────────────────────────────┐
│ [Title]                                      │
│ [2-3 line summary]                           │
│ [YouTube embed — lazy loaded]                │
│                     [← למדריך המלא]         │
└─────────────────────────────────────────────┘
```
- "למדריך המלא" / "Full Tutorial" links to `/camera/<slug>/`
- Ordered newest first

### Section 2 — גלריות אלבום (type: gallery)

2-column grid (1 column on mobile). Each card:
- YouTube embed (lazy loaded)
- Title below

### Section 3 — ריילס וקליפים (type: reel)

- **YouTube platform**: YouTube embed (lazy loaded) + title
- **Instagram platform** (no YouTube counterpart): thumbnail image (from photo used to create the reel, pulled from `data/photos.json` by matching category) + title + "צפה באינסטגרם" / "Watch on Instagram" button linking to `https://www.instagram.com/p/<id>/`
- 2-column grid (1 column on mobile)

### YouTube Embed Pattern

Lazy-loaded iframes to avoid slow page load:
```html
<iframe
  src="https://www.youtube.com/embed/<id>"
  loading="lazy"
  allowfullscreen
  ...>
</iframe>
```

No third-party JS required. No Instagram embed.js.

### Internationalization

Full HE/EN with `data-he` / `data-en` attributes on all static text + `setLang()` from `assets/js/i18n.js`. Language synced via `localStorage` with rest of site.

### Navigation

Added to `assets/js/nav.js` as a new nav item: `nav.videos` → `/videos/`

Key in `NAV_T`:
- he: `'סרטונים'`
- en: `'Videos'`

## GitHub Actions — Changes Required

### `src/youtube_tutorial.py`

After successful YouTube upload, append to `data/videos.json`:
```python
{
  "id": video_id,           # returned by YouTube API
  "platform": "youtube",
  "type": "tutorial",
  "slug": guide_slug,       # already known (e.g. "depth-of-field")
  "title_he": guide_title_he,
  "title_en": guide_title_en,
  "summary_he": generated_summary_he,  # 2-3 sentence AI summary
  "summary_en": generated_summary_en,
  "date": today_iso
}
```
Summary generation: take the first 2-3 sentences of the narration text already extracted from the guide HTML (`data-en` attributes). No extra API call needed — the text is already in memory during the Action run.

### `src/youtube_video.py` (album slideshow)

After successful YouTube upload, append to `data/videos.json`:
```python
{
  "id": video_id,
  "platform": "youtube",
  "type": "gallery",
  "slug": None,
  "title_he": f"{album_name}",
  "title_en": album_name_en,   # translated or transliterated
  "summary_he": "",
  "summary_en": "",
  "date": today_iso
}
```

### `src/distribute_video.py`

After successful publish, append to `data/videos.json`. Prefer YouTube ID if available:
```python
{
  "id": youtube_id or instagram_shortcode,
  "platform": "youtube" if youtube_id else "instagram",
  "type": "reel",
  "slug": None,
  "title_he": video_title_he,
  "title_en": video_title_en,
  "summary_he": "",
  "summary_en": "",
  "date": today_iso
}
```

## Files to Create / Modify

| File | Action |
|---|---|
| `videos/index.html` | **Create** |
| `data/videos.json` | **Create** (empty array `[]`, seed with existing published videos) |
| `src/youtube_tutorial.py` | **Modify** — append to videos.json after upload |
| `src/youtube_video.py` | **Modify** — append to videos.json after upload |
| `src/distribute_video.py` | **Modify** — append to videos.json after upload |
| `assets/js/nav.js` | **Modify** — add `nav.videos` entry |
| `.github/workflows/youtube-tutorial.yml` | **Modify** — commit videos.json |
| `.github/workflows/youtube-post.yml` | **Modify** — commit videos.json |
| `.github/workflows/distribute-video.yml` | **Modify** — commit videos.json |

## Seeding Existing Videos

A one-time script `src/seed_videos.py` will:
1. Read `data/youtube_tutorials_posted.json` → create tutorial entries (no video IDs available, mark as `"id": null` — can be filled manually)
2. Read `data/youtube_posted.json` (album names) → create gallery entries (same)
3. Read `data/distributed_videos.json` → create reel entries (YouTube IDs available)
4. Write `data/videos.json`

Missing video IDs (tutorials + album slideshows) should be filled in manually by the user after running the seed script. The page handles `id: null` gracefully by hiding the embed.

## Out of Scope

- TikTok (no public API, CAPTCHA blocks scraping) — can be added later
- Facebook embeds — only Instagram/YouTube
- Search / filter within the page
- View counts or analytics display
