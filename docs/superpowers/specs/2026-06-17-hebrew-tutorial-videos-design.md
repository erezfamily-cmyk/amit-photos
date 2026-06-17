# Hebrew Tutorial Videos — Design Spec
**Date:** 2026-06-17

## Goal

Generate Hebrew-dubbed versions of all camera education tutorial videos and integrate them into the site alongside the English versions. Hebrew speakers can watch the tutorial in their native language directly from the `/camera/<slug>/` guide page.

## Scope

Only `type: "tutorial"` videos (those with a `slug` linking to `/camera/<slug>/`). Gallery and reel videos are excluded — they have no narration text.

## Architecture

### Approach: Separate Hebrew video per tutorial

`youtube_tutorial.py` already parses `data-en` text, sends it to ElevenLabs, and uploads to YouTube. We add a `--lang he` flag that does the same with `data-he` text and a Hebrew ElevenLabs voice. The result is a separate YouTube video, same slides and music.

```
/camera/<slug>/index.html
       │
       ├─ data-en → ElevenLabs (EN voice) → YouTube EN → id: "abc123"
       │
       └─ data-he → ElevenLabs (HE voice) → YouTube HE → id_he: "xyz789"
```

### Why not multi-language audio (YouTube dubbing)?

YouTube Studio supports dubbing via the UI but the YouTube Data API v3 has no dubbing endpoint. This would break the GitHub Actions automation. Separate videos remain fully automatable.

### Why not subtitles only?

Hebrew viewers would hear English while reading Hebrew subtitles and simultaneously watching on-screen demos — poor learning experience. Native-language narration is significantly better for educational content.

## Data: `data/videos.json`

Add `id_he` field to tutorial entries:

```json
{
  "id": "2tdd4vksWyE",
  "id_he": "xxxxxxx",
  "platform": "youtube",
  "type": "tutorial",
  "slug": "depth-of-field",
  "title_he": "עומק שדה",
  "title_en": "Depth Of Field — Photography Tutorial",
  "summary_he": "...",
  "summary_en": "...",
  "date": "2026-01-01"
}
```

- `id_he: null` — Hebrew video not yet generated
- `id: null` — English video not yet uploaded (existing behavior)
- Gallery and reel entries have no `id_he` field

## Pipeline: `src/youtube_tutorial.py`

Add `--lang` argument (default: `"en"`):

```python
parser.add_argument("--lang", choices=["en", "he"], default="en")
```

When `--lang he`:

| Parameter | Value |
|---|---|
| Narration text source | `data-he` attributes from guide HTML |
| ElevenLabs voice | Hebrew voice (TBD on first run — select from ElevenLabs voice library) |
| YouTube title | `title_he` from `videos.json` |
| YouTube description | Hebrew text |
| `defaultAudioLanguage` | `"iw"` (Hebrew ISO code for YouTube API) |
| YouTube playlist | Hebrew tutorial playlist (auto-created on first upload if not exists) |
| `videos.json` field written | `id_he` |

Same slides (Ken Burns photos), same background music, different narration audio.

After upload, appends `id_he` to the matching entry in `data/videos.json` (matched by `slug`).

## GitHub Actions: `youtube-tutorial.yml`

Run both languages in sequence, commit `videos.json` once at the end:

```yaml
- name: Generate English tutorial
  run: python src/youtube_tutorial.py ${{ inputs.slug }}

- name: Generate Hebrew tutorial
  run: python src/youtube_tutorial.py ${{ inputs.slug }} --lang he

- name: Commit videos.json
  run: |
    git add data/videos.json
    git commit -m "add tutorial videos: ${{ inputs.slug }}"
    git push
```

## UI: `/camera/<slug>/` pages (all 20 tutorial pages)

### Placement

A compact video section inserted after the page hero and before the first interactive section.

### Layout

```
┌─────────────────────────────────────────────────┐
│  🎬  צפה במדריך הווידאו  /  Watch the Tutorial  │
│                                    [ EN ] [ HE ] │
│  ┌───────────────────────────────────────────┐  │
│  │                                           │  │
│  │         YouTube embed (lazy loaded)       │  │
│  │                                           │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

### HTML

```html
<div class="video-section" data-video-en="2tdd4vksWyE" data-video-he="xxxxxxx">
  <div class="video-header">
    <span data-he="צפה במדריך הווידאו" data-en="Watch the Tutorial"></span>
    <div class="lang-toggle">
      <button class="vtog active" data-lang="he">HE</button>
      <button class="vtog" data-lang="en">EN</button>
    </div>
  </div>
  <iframe id="tutorial-embed" loading="lazy" allowfullscreen
    src="https://www.youtube.com/embed/INITIAL_ID"></iframe>
</div>
```

### Behavior

- **Default language** — reads `localStorage` key `lang` (same as the rest of the site), defaults to `"he"`
- **Toggle** — swaps the iframe `src` between EN and HE video IDs, no page reload
- **`id_he` is null** — HE button hidden, only EN shown
- **Both IDs null** — entire `.video-section` hidden
- **JS** — small inline script per page (reads `data-video-en` / `data-video-he` attributes). Not a shared file — pages are static HTML.

### Styling

Consistent with existing guide page design: dark background (`--surface`), gold accent border (`--accent`), responsive (full width on mobile).

## UI: `/videos/` page

Minimal change — tutorial cards already render a YouTube embed using `id`. Update render logic:

- When `lang === "he"` and `id_he` is not null → embed `id_he`
- Otherwise → embed `id` (existing behavior)
- If both null → hide embed (existing behavior)
- Language toggle buttons (EN/HE) appear on tutorial cards that have both IDs

## Files to Create / Modify

| File | Action |
|---|---|
| `src/youtube_tutorial.py` | **Modify** — add `--lang he` flag, Hebrew voice, `id_he` field write |
| `data/videos.json` | **Modify** — add `id_he: null` to existing tutorial entries |
| `camera/*/index.html` (20 files) | **Modify** — add `.video-section` block after hero |
| `videos/index.html` | **Modify** — use `id_he` when lang=he |
| `.github/workflows/youtube-tutorial.yml` | **Modify** — add `--lang he` step |

## Out of Scope

- Gallery and reel videos — no narration text, no Hebrew version
- TikTok / Facebook
- Subtitles / SRT files
- Auto-translation of guides not yet in Hebrew (all 20 are already bilingual)
- Backfilling old YouTube videos with dubbing via YouTube Studio UI
