# Videos Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a `/videos/` page that auto-updates with YouTube tutorials, album slideshows and reels whenever a GitHub Action publishes a video.

**Architecture:** A central `data/videos.json` array holds all video records. Three existing Python scripts append to it after each successful upload. The static HTML page fetches the JSON at load time and builds three sections: Tutorials, Galleries, Reels.

**Tech Stack:** HTML5/CSS3/Vanilla JS, Python 3.11, GitHub Actions, YouTube Data API v3

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `data/videos.json` | Create | Master list of all published videos |
| `src/videos_utils.py` | Create | Shared `append_video()` helper |
| `src/seed_videos.py` | Create | One-time script to seed existing videos |
| `src/youtube_tutorial.py` | Modify | Append tutorial record after YouTube upload |
| `src/youtube_video.py` | Modify | Append gallery record after YouTube upload |
| `src/distribute_video.py` | Modify | Append reel record after YouTube upload |
| `assets/js/nav.js` | Modify | Add "סרטונים / Videos" nav link |
| `videos/index.html` | Create | The videos page |
| `.github/workflows/youtube-tutorial.yml` | Modify | `git add data/videos.json` in commit step |
| `.github/workflows/youtube-post.yml` | Modify | `git add data/videos.json` in commit step |
| `.github/workflows/distribute-video.yml` | Modify | `git add data/videos.json` in commit step |

---

## Task 1: Create `data/videos.json` and shared helper

**Files:**
- Create: `data/videos.json`
- Create: `src/videos_utils.py`

- [ ] **Step 1: Create empty videos.json**

```bash
echo "[]" > data/videos.json
```

- [ ] **Step 2: Create `src/videos_utils.py`**

```python
#!/usr/bin/env python3
"""Shared helper — append a video record to data/videos.json."""

import json
import datetime
from pathlib import Path

VIDEOS_FILE = Path(__file__).parent.parent / "data" / "videos.json"


def append_video(record: dict) -> None:
    """Append record to data/videos.json. Adds today's date if missing."""
    record.setdefault("date", datetime.date.today().isoformat())
    videos = json.loads(VIDEOS_FILE.read_text(encoding="utf-8")) if VIDEOS_FILE.exists() else []
    videos.append(record)
    VIDEOS_FILE.write_text(json.dumps(videos, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"✅ videos.json ← {record.get('type')} [{record.get('id')}]")
```

- [ ] **Step 3: Verify helper works**

```bash
python -c "
import sys; sys.path.insert(0, 'src')
from videos_utils import append_video
append_video({'id':'TEST','platform':'youtube','type':'tutorial','slug':'test','title_he':'בדיקה','title_en':'Test','summary_he':'','summary_en':''})
import json; v = json.load(open('data/videos.json'))
assert v[-1]['id'] == 'TEST', 'append failed'
print('OK')
"
# Remove the test entry
python -c "import json,pathlib; f=pathlib.Path('data/videos.json'); v=json.loads(f.read_text()); f.write_text(json.dumps([x for x in v if x.get('id')!='TEST'],ensure_ascii=False,indent=2))"
```

Expected output: `OK`

- [ ] **Step 4: Commit**

```bash
git add data/videos.json src/videos_utils.py
git commit -m "feat: add data/videos.json and videos_utils helper"
```

---

## Task 2: Seed existing published videos

**Files:**
- Create: `src/seed_videos.py`

Existing videos don't have YouTube IDs stored in the repo. Tutorials and galleries get `"id": null` — the user fills them in manually after running this script. The one distributed video (`lrHKvebfKhs`) has a stored ID.

- [ ] **Step 1: Create `src/seed_videos.py`**

```python
#!/usr/bin/env python3
"""
One-time seed script — populates data/videos.json from existing tracking files.

Tutorial/gallery video IDs are not stored in the repo. Those records get id=null
and must be filled in manually (find the IDs on youtube.com/channel/yours).

Run: python src/seed_videos.py
"""

import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).parent))
from videos_utils import append_video

ROOT     = Path(__file__).parent.parent
DATA_DIR = ROOT / "data"

# Hebrew category → English title for gallery videos
ALBUM_EN = {
    "יוון": "Greece",
    "גרמניה": "Germany",
    "טבע דומם": "Still Life",
    "איטליה": "Italy",
    "טנזניה": "Tanzania",
    "ספרד ואנדורה": "Spain & Andorra",
    "מונטנגרו": "Montenegro",
    "אנגליה": "England",
}

# Guide slug → Hebrew title
GUIDE_TITLE_HE = {
    "depth-of-field":  "עומק שדה",
    "composition":     "קומפוזיציה",
    "exposure":        "חשיפה",
    "light":           "אור",
    "focus":           "פוקוס",
    "landscape":       "נוף",
    "portrait":        "פורטרט",
    "macro":           "מאקרו",
    "histogram":       "היסטוגרם",
    "white-balance":   "איזון לבן",
    "filters":         "פילטרים",
    "editing":         "עריכה",
    "lenses":          "עדשות",
    "controls":        "כפתורי המצלמה",
    "dynamic-range":   "טווח דינמי",
    "visual-language": "שפה ויזואלית",
    "types":           "סוגי מצלמות",
    "sports":          "ספורט",
    "mobile":          "צילום סלולרי",
    "software":        "תוכנות עריכה",
}

# Clear existing file
(DATA_DIR / "videos.json").write_text("[]", encoding="utf-8")

# 1. Tutorial videos
tutorials_file = DATA_DIR / "youtube_tutorials_posted.json"
if tutorials_file.exists():
    state = json.loads(tutorials_file.read_text(encoding="utf-8"))
    for slug in state.get("posted_guides", []):
        title_en = slug.replace("-", " ").title()
        append_video({
            "id":         None,   # fill in manually
            "platform":   "youtube",
            "type":       "tutorial",
            "slug":       slug,
            "title_he":   GUIDE_TITLE_HE.get(slug, title_en),
            "title_en":   f"{title_en} — Photography Tutorial",
            "summary_he": "",
            "summary_en": "",
            "date":       "2026-01-01",
        })

# 2. Album slideshow videos
posted_file = DATA_DIR / "youtube_posted.json"
if posted_file.exists():
    state = json.loads(posted_file.read_text(encoding="utf-8"))
    for album in state.get("posted_albums", []):
        append_video({
            "id":         None,   # fill in manually
            "platform":   "youtube",
            "type":       "gallery",
            "slug":       None,
            "title_he":   album,
            "title_en":   ALBUM_EN.get(album, album),
            "summary_he": "",
            "summary_en": "",
            "date":       "2026-01-01",
        })

# 3. Distributed videos (YouTube IDs known)
dist_file = DATA_DIR / "distributed_videos.json"
if dist_file.exists():
    for entry in json.loads(dist_file.read_text(encoding="utf-8")):
        yt_id = entry.get("platforms", {}).get("youtube")
        filename = entry.get("filename", "")
        name = filename.split("-", 1)[-1].replace("-", " ").replace(".mp4", "").title()
        if yt_id:
            append_video({
                "id":         yt_id,
                "platform":   "youtube",
                "type":       "reel",
                "slug":       None,
                "title_he":   name,
                "title_en":   name,
                "summary_he": "",
                "summary_en": "",
                "date":       entry.get("date", "2026-01-01"),
            })

print("\n✅ Seeding complete. Open data/videos.json and fill in 'id': null entries.")
```

- [ ] **Step 2: Run the seed script**

```bash
python src/seed_videos.py
```

Expected output:
```
✅ videos.json ← tutorial [None]
✅ videos.json ← tutorial [None]
✅ videos.json ← tutorial [None]
✅ videos.json ← gallery [None]
...
✅ videos.json ← reel [lrHKvebfKhs]
✅ Seeding complete. Open data/videos.json and fill in 'id': null entries.
```

- [ ] **Step 3: Open `data/videos.json` and fill in the missing YouTube video IDs**

Find IDs at `https://studio.youtube.com/channel/` → Content tab.
Replace `"id": null` with the actual YouTube video ID string for each tutorial and gallery video.

- [ ] **Step 4: Verify JSON is valid**

```bash
python -c "import json; v=json.load(open('data/videos.json')); print(f'{len(v)} videos loaded OK')"
```

Expected: `N videos loaded OK` (no error)

- [ ] **Step 5: Commit**

```bash
git add data/videos.json src/seed_videos.py
git commit -m "feat: seed existing videos into data/videos.json"
```

---

## Task 3: `youtube_tutorial.py` — append on publish

**Files:**
- Modify: `src/youtube_tutorial.py` (add after line ~601 in `main()`)

- [ ] **Step 1: Add import at top of file**

In `src/youtube_tutorial.py`, add after the existing imports block (after `from collections import defaultdict`, line ~20):

```python
from videos_utils import append_video
```

Python adds the script's own directory (`src/`) to `sys.path` automatically when you run `python src/youtube_tutorial.py`, so no path manipulation needed.

- [ ] **Step 2: Add helper to extract Hebrew title from guide HTML**

Add this function after `extract_english_sections()` (around line 120):

```python
def extract_guide_title_he(slug):
    """Extract Hebrew <h1> text from guide HTML."""
    guide_path = ROOT / "camera" / slug / "index.html"
    if guide_path.exists():
        content = guide_path.read_text(encoding="utf-8")
        m = re.search(r'<h1[^>]+data-he="([^"]+)"', content)
        if m:
            return html.unescape(m.group(1))
    return slug.replace("-", " ").title()


def extract_summary_en(script, n_sentences=3):
    """Return first N sentences of narration script as English summary."""
    sentences = re.split(r'(?<=[.!?])\s+', script.strip())
    return " ".join(sentences[:n_sentences])
```

- [ ] **Step 3: Append to videos.json in `main()` after successful upload**

In `main()`, find the block (around line 599–602):
```python
            result = process_guide(slug, photos, Path(tmp))
            if result:
                state.setdefault("posted_guides", []).append(slug)
                save_state(state)
```

Replace with:
```python
            result = process_guide(slug, photos, Path(tmp))
            if result:
                state.setdefault("posted_guides", []).append(slug)
                save_state(state)
                # Append to central videos.json
                if isinstance(result, str):  # result is video_id string on success
                    sections = extract_english_sections(slug)
                    script   = build_narration_script(slug, sections) if sections else ""
                    title_en = slug.replace("-", " ").title()
                    append_video({
                        "id":         result,
                        "platform":   "youtube",
                        "type":       "tutorial",
                        "slug":       slug,
                        "title_he":   extract_guide_title_he(slug),
                        "title_en":   f"{title_en} — Photography Tutorial",
                        "summary_he": "",
                        "summary_en": extract_summary_en(script),
                    })
```

Note: `process_guide()` returns `vid_id or True` — check `isinstance(result, str)` to confirm we have a real ID (not just `True` from local-save path).

- [ ] **Step 4: Verify change is syntactically correct**

```bash
python -c "import src.youtube_tutorial" 2>&1 || python -c "
import ast, sys
with open('src/youtube_tutorial.py') as f:
    src = f.read()
try:
    ast.parse(src)
    print('Syntax OK')
except SyntaxError as e:
    print(f'Syntax error: {e}')
    sys.exit(1)
"
```

Expected: `Syntax OK`

- [ ] **Step 5: Commit**

```bash
git add src/youtube_tutorial.py
git commit -m "feat: youtube_tutorial appends to videos.json after upload"
```

---

## Task 4: `youtube_video.py` — append on publish

**Files:**
- Modify: `src/youtube_video.py`

- [ ] **Step 1: Add import**

In `src/youtube_video.py`, add after the existing imports (after `from collections import defaultdict`):

```python
from videos_utils import append_video
```

- [ ] **Step 2: Add English album name mapping**

Add near the top of the file after the constants (after `MIN_PHOTOS = 15`):

```python
ALBUM_EN = {
    "יוון": "Greece", "גרמניה": "Germany", "טבע דומם": "Still Life",
    "איטליה": "Italy", "טנזניה": "Tanzania", "ספרד ואנדורה": "Spain & Andorra",
    "מונטנגרו": "Montenegro", "אנגליה": "England", "אבו דאבי": "Abu Dhabi",
    "אומנות רחוב": "Street Art",
}
```

- [ ] **Step 3: Append to videos.json after upload**

In `main()`, find the block (around line 743–748):
```python
        # Auto-share YouTube link on social media
        if vid_id:
            share_youtube_on_social(vid_id, category, exif_summary)

    # Update state
    state.setdefault("posted_albums", []).append(category)
    save_state(state)
```

Replace with:
```python
        # Auto-share YouTube link on social media
        if vid_id:
            share_youtube_on_social(vid_id, category, exif_summary)
            append_video({
                "id":         vid_id,
                "platform":   "youtube",
                "type":       "gallery",
                "slug":       None,
                "title_he":   category,
                "title_en":   ALBUM_EN.get(category, category),
                "summary_he": "",
                "summary_en": "",
            })

    # Update state
    state.setdefault("posted_albums", []).append(category)
    save_state(state)
```

- [ ] **Step 4: Verify syntax**

```bash
python -c "
import ast
with open('src/youtube_video.py') as f: src = f.read()
try:
    ast.parse(src); print('Syntax OK')
except SyntaxError as e:
    print(f'Syntax error: {e}'); import sys; sys.exit(1)
"
```

Expected: `Syntax OK`

- [ ] **Step 5: Commit**

```bash
git add src/youtube_video.py
git commit -m "feat: youtube_video appends to videos.json after upload"
```

---

## Task 5: `distribute_video.py` — append on publish

**Files:**
- Modify: `src/distribute_video.py`

- [ ] **Step 1: Add import**

After the existing imports in `src/distribute_video.py` (after `import requests`), add:

```python
from videos_utils import append_video
```

Python adds `src/` to `sys.path` automatically when running `python src/distribute_video.py`.

- [ ] **Step 2: Append to videos.json in `main()` after publishing**

In `main()`, find (around line 268–271):
```python
    posted = load_posted()
    posted.append(results)
    save_posted(posted)
```

Replace with:
```python
    posted = load_posted()
    posted.append(results)
    save_posted(posted)

    # Append to central videos.json — prefer YouTube ID (better embed)
    yt_id = results["platforms"].get("youtube")
    ig_id = results["platforms"].get("instagram")
    video_name = Path(filename).stem.split("-", 1)[-1].replace("-", " ").title()
    if yt_id or ig_id:
        append_video({
            "id":         yt_id or ig_id,
            "platform":   "youtube" if yt_id else "instagram",
            "type":       "reel",
            "slug":       None,
            "title_he":   video_name,
            "title_en":   video_name,
            "summary_he": "",
            "summary_en": "",
        })
```

- [ ] **Step 3: Verify syntax**

```bash
python -c "
import ast
with open('src/distribute_video.py') as f: src = f.read()
try:
    ast.parse(src); print('Syntax OK')
except SyntaxError as e:
    print(f'Syntax error: {e}'); import sys; sys.exit(1)
"
```

Expected: `Syntax OK`

- [ ] **Step 4: Commit**

```bash
git add src/distribute_video.py
git commit -m "feat: distribute_video appends to videos.json after publish"
```

---

## Task 6: Update GitHub Actions workflows

**Files:**
- Modify: `.github/workflows/youtube-tutorial.yml`
- Modify: `.github/workflows/youtube-post.yml`
- Modify: `.github/workflows/distribute-video.yml`

- [ ] **Step 1: Update `youtube-tutorial.yml`**

Find the `שמירת היסטוריה` step (the last step in the workflow):
```yaml
      - name: שמירת היסטוריה
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add data/youtube_tutorials_posted.json || true
          git diff --cached --quiet || git commit -m "🤖 עדכון youtube_tutorials_posted.json"
          git pull --rebase origin main
          git push
```

Replace with:
```yaml
      - name: שמירת היסטוריה
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add data/youtube_tutorials_posted.json || true
          git add data/videos.json || true
          git diff --cached --quiet || git commit -m "🤖 עדכון youtube_tutorials_posted.json + videos.json"
          git pull --rebase origin main
          git push
```

- [ ] **Step 2: Update `youtube-post.yml`**

Find the `שמירת היסטוריה` step and add `git add data/videos.json || true` the same way:

```yaml
      - name: שמירת היסטוריה
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add data/youtube_posted.json || true
          git add data/videos.json || true
          git diff --cached --quiet || git commit -m "🤖 עדכון youtube_posted.json + videos.json"
          git pull --rebase origin main
          git push
```

- [ ] **Step 3: Update `distribute-video.yml`**

Find the `permissions` block and add a `שמירת היסטוריה` step at the end:

```yaml
      - name: שמירת היסטוריה
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add data/distributed_videos.json || true
          git add data/videos.json || true
          git diff --cached --quiet || git commit -m "🤖 עדכון distributed_videos.json + videos.json"
          git pull --rebase origin main
          git push
```

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/youtube-tutorial.yml .github/workflows/youtube-post.yml .github/workflows/distribute-video.yml
git commit -m "feat: workflows commit videos.json after each video publish"
```

---

## Task 7: Add "סרטונים" to nav.js

**Files:**
- Modify: `assets/js/nav.js`

- [ ] **Step 1: Add translation keys**

In `assets/js/nav.js`, find `NAV_T`:
```javascript
    he: {
      ...
      newsletter: 'ניוזלטר',
      menu: 'תפריט'
    },
    en: {
      ...
      newsletter: 'Newsletter',
      menu: 'Menu'
    }
```

Add `videos` key to both locales:
```javascript
    he: {
      ...
      newsletter: 'ניוזלטר',
      videos: 'סרטונים',
      menu: 'תפריט'
    },
    en: {
      ...
      newsletter: 'Newsletter',
      videos: 'Videos',
      menu: 'Menu'
    }
```

- [ ] **Step 2: Add to translation map in `applyNavLang`**

Find the `map` object inside `applyNavLang`:
```javascript
    const map = {
      'nav.gallery': t.gallery, 'nav.new': t.navNew, 'nav.sale': t.navSale,
      'nav.challenges': t.challenges, 'nav.camera': t.camera, 'nav.learn': t.learn, 'nav.gear': t.gear,
      'nav.how-to-buy': t.howToBuy, 'nav.pricing': t.pricing, 'nav.contact': t.contact,
      'nav.locations': t.locations, 'nav.newsletter': t.newsletter
    };
```

Add `'nav.videos': t.videos` to the map:
```javascript
    const map = {
      'nav.gallery': t.gallery, 'nav.new': t.navNew, 'nav.sale': t.navSale,
      'nav.challenges': t.challenges, 'nav.camera': t.camera, 'nav.learn': t.learn, 'nav.gear': t.gear,
      'nav.how-to-buy': t.howToBuy, 'nav.pricing': t.pricing, 'nav.contact': t.contact,
      'nav.locations': t.locations, 'nav.newsletter': t.newsletter, 'nav.videos': t.videos
    };
```

- [ ] **Step 3: Add nav link to the HTML template**

Find in the nav HTML template:
```javascript
  <li><a href="/learn/" data-i18n="nav.learn">ניתוח תמונות</a></li>
```

Add after it:
```javascript
  <li><a href="/videos/" data-i18n="nav.videos">סרטונים</a></li>
```

- [ ] **Step 4: Commit**

```bash
git add assets/js/nav.js
git commit -m "feat: add videos link to nav"
```

---

## Task 8: Create `videos/index.html`

**Files:**
- Create: `videos/index.html`

- [ ] **Step 1: Create the directory and file**

```bash
mkdir -p videos
```

Create `videos/index.html` with the full content below.

- [ ] **Step 2: Write `videos/index.html`**

```html
<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="canonical" href="https://amitphotos.com/videos/" />
<title data-he="הסרטונים שלי — Amit Photos" data-en="My Videos — Amit Photos">הסרטונים שלי — Amit Photos</title>
<meta name="description" content="מדריכי צילום, גלריות אלבום וריילס מאת עמית ארז.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;600;700&family=Syne:wght@700&display=swap" rel="stylesheet">
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --bg: #0a0a0a; --surface: #111; --border: #222;
  --accent: #c8a96e; --text: #f0ede8; --muted: #888;
}
body { font-family: 'Heebo', sans-serif; background: var(--bg); color: var(--text);
  direction: rtl; min-height: 100vh; padding: 0 0 4rem; }

.page-hero { text-align: center; padding: 2.5rem 1.25rem 1.5rem; }
.page-hero .badge { display: inline-block; font-size: .72rem;
  background: rgba(200,169,110,.12); border: 1px solid rgba(200,169,110,.3);
  color: var(--accent); border-radius: 20px; padding: .3rem .8rem; margin-bottom: .75rem; }
.page-hero h1 { font-family: 'Syne', sans-serif; font-size: 1.8rem;
  color: var(--accent); margin-bottom: .5rem; }
.page-hero p { color: var(--muted); font-size: .9rem; max-width: 420px; margin: 0 auto; }

.tabs { display: flex; gap: .5rem; justify-content: center; padding: 1rem 1.25rem;
  flex-wrap: wrap; }
.tab-btn { background: var(--surface); border: 1px solid var(--border);
  color: var(--muted); font-family: 'Heebo', sans-serif; font-size: .85rem;
  padding: .5rem 1.2rem; border-radius: 20px; cursor: pointer; transition: all .2s; }
.tab-btn.active { background: rgba(200,169,110,.15); border-color: var(--accent);
  color: var(--accent); font-weight: 600; }
.tab-btn:hover:not(.active) { border-color: #444; color: var(--text); }

.section { max-width: 900px; margin: 0 auto; padding: 1.5rem 1.25rem; }
.section-title { font-family: 'Syne', sans-serif; font-size: 1.2rem;
  color: var(--accent); margin-bottom: 1.25rem;
  border-bottom: 1px solid var(--border); padding-bottom: .5rem; }

/* Tutorial cards — single column */
.tutorial-card { background: var(--surface); border: 1px solid var(--border);
  border-radius: 14px; padding: 1.5rem; margin-bottom: 1.5rem; }
.tutorial-card .card-title { font-family: 'Syne', sans-serif; font-size: 1.1rem;
  color: var(--accent); margin-bottom: .5rem; }
.tutorial-card .card-summary { color: var(--muted); font-size: .88rem;
  line-height: 1.6; margin-bottom: 1rem; }
.tutorial-card .yt-embed { position: relative; padding-bottom: 56.25%; height: 0;
  overflow: hidden; border-radius: 10px; background: #000; margin-bottom: .75rem; }
.tutorial-card .yt-embed iframe { position: absolute; top: 0; right: 0;
  width: 100%; height: 100%; border: 0; }
.card-link { display: inline-block; margin-top: .5rem; background: var(--accent);
  color: #000; font-weight: 700; font-size: .83rem; padding: .5rem 1.1rem;
  border-radius: 8px; text-decoration: none; transition: background .15s; }
.card-link:hover { background: #e0c080; }

/* Gallery + Reel grids — 2 columns */
.two-col { display: grid; grid-template-columns: 1fr; gap: 1.25rem; }
@media (min-width: 640px) { .two-col { grid-template-columns: 1fr 1fr; } }
.media-card { background: var(--surface); border: 1px solid var(--border);
  border-radius: 14px; overflow: hidden; }
.media-card .yt-embed { position: relative; padding-bottom: 56.25%; height: 0; }
.media-card .yt-embed iframe { position: absolute; top: 0; right: 0;
  width: 100%; height: 100%; border: 0; }
.media-card .card-label { padding: .75rem 1rem; font-size: .88rem; color: var(--text); }

/* Instagram reel card */
.ig-card { background: var(--surface); border: 1px solid var(--border);
  border-radius: 14px; padding: 1rem; display: flex; flex-direction: column; gap: .75rem; }
.ig-card .card-label { font-size: .88rem; color: var(--text); }
.ig-link { display: inline-block; background: rgba(200,169,110,.15);
  border: 1px solid var(--accent); color: var(--accent); font-size: .83rem;
  font-weight: 700; padding: .5rem 1rem; border-radius: 8px;
  text-decoration: none; transition: background .15s; }
.ig-link:hover { background: rgba(200,169,110,.3); }

.empty-msg { color: var(--muted); font-size: .9rem; text-align: center;
  padding: 2rem; }
.hidden { display: none; }
</style>
<script src="/assets/js/nav.js?v=1" defer></script>
</head>
<body>

<div class="page-hero">
  <div class="badge" data-he="סרטונים" data-en="Videos">סרטונים</div>
  <h1 data-he="הסרטונים שלי" data-en="My Videos">הסרטונים שלי</h1>
  <p data-he="מדריכי צילום, גלריות אלבום וריילס" data-en="Photography tutorials, album galleries and reels">מדריכי צילום, גלריות אלבום וריילס</p>
</div>

<div class="tabs">
  <button class="tab-btn active" data-section="tutorials" data-he="מדריכי צילום" data-en="Tutorials">מדריכי צילום</button>
  <button class="tab-btn" data-section="galleries" data-he="גלריות אלבום" data-en="Galleries">גלריות אלבום</button>
  <button class="tab-btn" data-section="reels" data-he="ריילס וקליפים" data-en="Reels">ריילס וקליפים</button>
</div>

<section id="tutorials" class="section">
  <div class="section-title" data-he="מדריכי צילום" data-en="Photography Tutorials">מדריכי צילום</div>
  <div id="tutorials-grid"></div>
</section>

<section id="galleries" class="section hidden">
  <div class="section-title" data-he="גלריות אלבום" data-en="Album Galleries">גלריות אלבום</div>
  <div id="galleries-grid" class="two-col"></div>
</section>

<section id="reels" class="section hidden">
  <div class="section-title" data-he="ריילס וקליפים" data-en="Reels & Clips">ריילס וקליפים</div>
  <div id="reels-grid" class="two-col"></div>
</section>

<script>
var LANG = localStorage.getItem('lang') || 'he';
var ALL_VIDEOS = [];

function t(he, en) { return LANG === 'en' ? en : he; }

function ytEmbed(id) {
  return '<div class="yt-embed"><iframe src="https://www.youtube.com/embed/' + id +
    '" loading="lazy" allowfullscreen title="YouTube video"></iframe></div>';
}

function buildTutorials(videos) {
  var grid = document.getElementById('tutorials-grid');
  if (!videos.length) {
    grid.innerHTML = '<p class="empty-msg">' + t('אין מדריכים עדיין', 'No tutorials yet') + '</p>';
    return;
  }
  grid.innerHTML = videos.map(function(v) {
    var title   = v['title_'   + LANG] || v.title_he || '';
    var summary = v['summary_' + LANG] || '';
    var link    = v.slug
      ? '<a href="/camera/' + v.slug + '/" class="card-link" data-he="למדריך המלא" data-en="Full Tutorial">' +
        t('למדריך המלא', 'Full Tutorial') + '</a>'
      : '';
    return '<div class="tutorial-card">' +
      '<div class="card-title">' + title + '</div>' +
      (summary ? '<p class="card-summary">' + summary + '</p>' : '') +
      ytEmbed(v.id) + link +
      '</div>';
  }).join('');
}

function buildGalleries(videos) {
  var grid = document.getElementById('galleries-grid');
  if (!videos.length) {
    grid.innerHTML = '<p class="empty-msg">' + t('אין גלריות עדיין', 'No galleries yet') + '</p>';
    return;
  }
  grid.innerHTML = videos.map(function(v) {
    var title = v['title_' + LANG] || v.title_he || '';
    return '<div class="media-card">' + ytEmbed(v.id) +
      '<div class="card-label">' + title + '</div></div>';
  }).join('');
}

function buildReels(videos) {
  var grid = document.getElementById('reels-grid');
  if (!videos.length) {
    grid.innerHTML = '<p class="empty-msg">' + t('אין ריילס עדיין', 'No reels yet') + '</p>';
    return;
  }
  grid.innerHTML = videos.map(function(v) {
    var title = v['title_' + LANG] || v.title_he || '';
    if (v.platform === 'youtube') {
      return '<div class="media-card">' + ytEmbed(v.id) +
        '<div class="card-label">' + title + '</div></div>';
    }
    // Instagram — link card
    return '<div class="ig-card">' +
      '<div class="card-label">' + title + '</div>' +
      '<a href="https://www.instagram.com/p/' + v.id + '/" target="_blank" rel="noopener" class="ig-link">' +
      t('צפה באינסטגרם', 'Watch on Instagram') + '</a></div>';
  }).join('');
}

function rebuildAll() {
  var valid = ALL_VIDEOS.filter(function(v) { return v.id; });
  buildTutorials(valid.filter(function(v) { return v.type === 'tutorial'; }));
  buildGalleries(valid.filter(function(v) { return v.type === 'gallery'; }));
  buildReels(valid.filter(function(v) { return v.type === 'reel'; }));
  applyStaticLang();
}

function applyStaticLang() {
  document.querySelectorAll('[data-he]').forEach(function(el) {
    if (!el.closest('#tutorials-grid') && !el.closest('#galleries-grid') && !el.closest('#reels-grid')) {
      el.textContent = LANG === 'en' ? (el.dataset.en || el.dataset.he) : el.dataset.he;
    }
  });
}

// setLang — called by nav.js when user switches language
function setLang(lang) {
  LANG = lang;
  rebuildAll();
}

// Tab switching
document.querySelectorAll('.tab-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    var target = btn.dataset.section;
    document.querySelectorAll('.section').forEach(function(s) {
      s.classList.toggle('hidden', s.id !== target);
    });
  });
});

// Load videos
fetch('/data/videos.json')
  .then(function(r) { return r.json(); })
  .then(function(videos) {
    ALL_VIDEOS = videos.slice().reverse(); // newest first
    rebuildAll();
  })
  .catch(function(e) {
    console.error('videos.json load error', e);
  });
</script>
</body>
</html>
```

- [ ] **Step 3: Open the page locally and verify**

```bash
python -m http.server 8000
# Then open: http://localhost:8000/videos/
```

Check:
- All three tab sections render
- Switching tabs shows/hides sections
- Tutorial cards show title + summary + YouTube embed + "למדריך המלא" link
- Gallery cards show YouTube embed + title
- Reel cards show embed or Instagram link
- Language toggle (HE/EN) updates all text and video titles

- [ ] **Step 4: Commit**

```bash
git add videos/index.html
git commit -m "feat: add /videos/ page — tutorials, galleries, reels"
```

---

## Task 9: Push and verify

- [ ] **Step 1: Push all commits**

```bash
git push
```

- [ ] **Step 2: Verify deployment**

Open `https://amitphotos.com/videos/` — page should load with seeded videos.

Check nav: "סרטונים" link should appear and route to `/videos/`.

- [ ] **Step 3: Verify nav.js version bump**

In `videos/index.html`, the nav.js `?v=` query string should match the current version used in other pages (check `camera/index.html` for the correct value and update if needed):

```bash
grep "nav.js" camera/index.html
grep "nav.js" videos/index.html
```

Update the `?v=` in `videos/index.html` to match if different, then:

```bash
git add videos/index.html
git diff --cached --quiet || git commit -m "fix: sync nav.js version in videos page"
git push
```
