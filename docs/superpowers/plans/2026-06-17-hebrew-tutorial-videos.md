# Hebrew Tutorial Videos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate Hebrew-dubbed YouTube tutorial videos from `/camera/` guide pages and embed them alongside the English versions with a language toggle.

**Architecture:** `youtube_tutorial.py` gains a `--lang he` flag that reads `data-he` text, calls ElevenLabs with a Hebrew voice, uploads a separate YouTube video, and writes `id_he` to `data/videos.json`. Camera guide pages load `videos.json` dynamically and show an EN/HE toggle embed. `/videos/` page picks the language-appropriate video ID.

**Tech Stack:** Python 3.11, ElevenLabs API (`eleven_multilingual_v2`), YouTube Data API v3, ffmpeg, vanilla JS fetch, HTML data attributes.

---

## File Map

| File | Change |
|---|---|
| `src/videos_utils.py` | Add `update_video_id_he(slug, video_id)` |
| `src/youtube_tutorial.py` | Add `--lang he` flag, Hebrew extract/script/upload functions |
| `data/videos.json` | Add `id_he: null` to 3 existing tutorial entries |
| `videos/index.html` | Use `id_he` in `buildTutorials` when `LANG==="he"` |
| `camera/*/index.html` (23 files) | Add `.video-section` CSS + HTML + inline JS after `.page-hero` |
| `.github/workflows/youtube-tutorial.yml` | Add `--lang he` step |
| `tests/test_hebrew_tutorial.py` | New test file |

---

## Task 1: `videos_utils.py` — add `update_video_id_he()`

**Files:**
- Modify: `src/videos_utils.py`
- Create: `tests/test_hebrew_tutorial.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_hebrew_tutorial.py`:

```python
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

import videos_utils


def test_update_video_id_he_existing_entry(tmp_path):
    f = tmp_path / "videos.json"
    f.write_text(json.dumps([
        {"id": "abc", "id_he": None, "type": "tutorial", "slug": "exposure", "platform": "youtube",
         "title_he": "חשיפה", "title_en": "Exposure", "summary_he": "", "summary_en": "", "date": "2026-01-01"}
    ], ensure_ascii=False), encoding="utf-8")
    videos_utils.VIDEOS_FILE = f

    videos_utils.update_video_id_he("exposure", "xyz789")

    result = json.loads(f.read_text(encoding="utf-8"))
    assert result[0]["id_he"] == "xyz789"


def test_update_video_id_he_creates_entry_if_missing(tmp_path):
    f = tmp_path / "videos.json"
    f.write_text("[]", encoding="utf-8")
    videos_utils.VIDEOS_FILE = f

    videos_utils.update_video_id_he("landscape", "he999")

    result = json.loads(f.read_text(encoding="utf-8"))
    assert len(result) == 1
    assert result[0]["slug"] == "landscape"
    assert result[0]["id_he"] == "he999"
    assert result[0]["id"] is None


def test_update_video_id_he_only_updates_tutorial_type(tmp_path):
    f = tmp_path / "videos.json"
    f.write_text(json.dumps([
        {"id": "gal1", "type": "gallery", "slug": "exposure", "platform": "youtube",
         "title_he": "", "title_en": "", "summary_he": "", "summary_en": "", "date": "2026-01-01"}
    ], ensure_ascii=False), encoding="utf-8")
    videos_utils.VIDEOS_FILE = f

    videos_utils.update_video_id_he("exposure", "xyz789")

    result = json.loads(f.read_text(encoding="utf-8"))
    # gallery entry untouched, new tutorial entry created
    assert len(result) == 2
    assert result[1]["type"] == "tutorial"
    assert result[1]["id_he"] == "xyz789"
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd c:\Users\erezf\amit-photos
python -m pytest tests/test_hebrew_tutorial.py -v
```

Expected: 3 failures — `update_video_id_he` not defined.

- [ ] **Step 3: Add `update_video_id_he` to `src/videos_utils.py`**

Open `src/videos_utils.py` and append after the existing `append_video` function:

```python
def update_video_id_he(slug: str, video_id: str) -> None:
    """Set id_he on the existing tutorial entry matching slug. Creates entry if missing."""
    videos = json.loads(VIDEOS_FILE.read_text(encoding="utf-8")) if VIDEOS_FILE.exists() else []
    for v in videos:
        if v.get("slug") == slug and v.get("type") == "tutorial":
            v["id_he"] = video_id
            VIDEOS_FILE.write_text(json.dumps(videos, ensure_ascii=False, indent=2), encoding="utf-8")
            print(f"[OK] videos.json <- id_he [{video_id}] for slug [{slug}]")
            return
    # No matching entry — create minimal record
    videos.append({
        "id": None,
        "id_he": video_id,
        "platform": "youtube",
        "type": "tutorial",
        "slug": slug,
        "title_he": "",
        "title_en": "",
        "summary_he": "",
        "summary_en": "",
        "date": datetime.date.today().isoformat(),
    })
    VIDEOS_FILE.write_text(json.dumps(videos, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[OK] videos.json <- new tutorial id_he [{video_id}] for slug [{slug}]")
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
python -m pytest tests/test_hebrew_tutorial.py -v
```

Expected: 3 PASSED.

- [ ] **Step 5: Commit**

```bash
git add src/videos_utils.py tests/test_hebrew_tutorial.py
git commit -m "feat: add update_video_id_he to videos_utils"
```

---

## Task 2: `youtube_tutorial.py` — Hebrew text extraction

**Files:**
- Modify: `src/youtube_tutorial.py`
- Modify: `tests/test_hebrew_tutorial.py`

- [ ] **Step 1: Write failing tests**

Add to `tests/test_hebrew_tutorial.py`:

```python
import youtube_tutorial


def test_extract_hebrew_sections_returns_list(tmp_path):
    html = '''<html><body>
      <p data-he="עומק שדה קובע כמה הרקע מטושטש בתמונה שלך. שלושה גורמים שולטים בו." data-en="Depth of field determines blur."></p>
      <p data-he="f/1.4 יתן בוקה בולט — f/11 ישמור הכל חד. הבן את הפשרות." data-en="f/1.4 bokeh."></p>
      <p data-he="←" data-en="←"></p>
    </body></html>'''
    guide_dir = tmp_path / "depth-of-field"
    guide_dir.mkdir()
    (guide_dir / "index.html").write_text(html, encoding="utf-8")

    original_root = youtube_tutorial.ROOT
    youtube_tutorial.ROOT = tmp_path
    try:
        sections = youtube_tutorial.extract_hebrew_sections("depth-of-field")
    finally:
        youtube_tutorial.ROOT = original_root

    assert len(sections) == 2
    assert all(len(s) >= 40 for s in sections)


def test_extract_hebrew_sections_skips_ui_text(tmp_path):
    html = '''<html><body>
      <p data-he="ראה באדוראמה ←" data-en="View at Adorama"></p>
      <p data-he="קנה לי קפה ותמוך ביצירת תוכן איכותי לצלמים ישראלים" data-en="Buy me coffee"></p>
      <p data-he="מדריך מלא ומפורט על עומק שדה, בוקה וצמצם בצילום." data-en="Full guide."></p>
    </body></html>'''
    guide_dir = tmp_path / "focus"
    guide_dir.mkdir()
    (guide_dir / "index.html").write_text(html, encoding="utf-8")

    original_root = youtube_tutorial.ROOT
    youtube_tutorial.ROOT = tmp_path
    try:
        sections = youtube_tutorial.extract_hebrew_sections("focus")
    finally:
        youtube_tutorial.ROOT = original_root

    assert len(sections) == 1
    assert "מדריך" in sections[0]


def test_build_hebrew_narration_script_contains_slug_title():
    sections = ["עומק שדה קובע כמה הרקע מטושטש.", "f/1.4 נותן בוקה בולט."]
    script = youtube_tutorial.build_hebrew_narration_script("exposure", sections, "חשיפה")
    assert "חשיפה" in script
    assert "עמית" in script
    assert "amitphotos.com" in script
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
python -m pytest tests/test_hebrew_tutorial.py::test_extract_hebrew_sections_returns_list tests/test_hebrew_tutorial.py::test_extract_hebrew_sections_skips_ui_text tests/test_hebrew_tutorial.py::test_build_hebrew_narration_script_contains_slug_title -v
```

Expected: 3 failures.

- [ ] **Step 3: Add constants and Hebrew functions to `src/youtube_tutorial.py`**

After the existing `ELEVENLABS_VOICE` constant, add:

```python
ELEVENLABS_VOICE_HE = "cgSgspJ2msm6clMCkdW9"  # Liam — multilingual, works well for Hebrew
ELEVENLABS_MODEL_HE  = "eleven_multilingual_v2"
```

After `SKIP_PATTERNS`, add:

```python
SKIP_PATTERNS_HE = [
    r"ראה באדוראמה", r"ב-adorama", r"ב-skylum", r"ב-flexclip",
    r"קנה לי קפה", r"קישור שותף", r"עמלה קטנה",
    r"חזרה לבית ספר לצילום",
    r"kofi", r"gumroad", r"awin", r"affiliate",
    r"←", r"→",
]
```

After the existing `extract_english_sections` function, add:

```python
def extract_hebrew_sections(slug):
    """Parse Hebrew content from guide HTML into narration sections."""
    guide_path = ROOT / "camera" / slug / "index.html"
    if not guide_path.exists():
        try:
            r = requests.get(f"{SITE_URL}/camera/{slug}/", timeout=15)
            r.raise_for_status()
            content = r.text
        except Exception as e:
            print(f"❌ לא נמצא מדריך: {slug} ({e})")
            sys.exit(1)
    else:
        content = guide_path.read_text(encoding="utf-8")

    raw = re.findall(r'data-he="([^"]{30,})"', content)

    sections = []
    for text in raw:
        text = html.unescape(text)
        text = re.sub(r"<[^>]+>", " ", text)
        text = re.sub(r"\s+", " ", text).strip()
        lower = text.lower()
        if any(re.search(p, lower) for p in SKIP_PATTERNS_HE):
            continue
        if len(text) < 40:
            continue
        sections.append(text)

    return sections
```

After the existing `build_narration_script` function, add:

```python
def build_hebrew_narration_script(slug, sections, guide_title_he):
    """Build a Hebrew narration script."""
    lines = [
        f"ברוכים הבאים לבית ספר לצילום של עמית ארז.",
        f"במדריך הזה נלמד על {guide_title_he}.",
        "",
    ]
    lines += sections
    lines += [
        "",
        "תודה על הצפייה.",
        "למדריכים נוספים, היכנסו ל-amitphotos.com.",
        "אל תשכחו להירשם לתוכן צילום שבועי.",
    ]

    script = " ".join(l if l else "..." for l in lines)
    script = re.sub(r"\.{3,}", "...", script)
    return script
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
python -m pytest tests/test_hebrew_tutorial.py -v
```

Expected: all pass (the 3 new + the 3 from Task 1).

- [ ] **Step 5: Commit**

```bash
git add src/youtube_tutorial.py tests/test_hebrew_tutorial.py
git commit -m "feat: add Hebrew text extraction and narration script builder"
```

---

## Task 3: `youtube_tutorial.py` — `--lang` flag + Hebrew upload

**Files:**
- Modify: `src/youtube_tutorial.py`

- [ ] **Step 1: Add Hebrew TTS generation**

In `generate_narration(script, tmp_dir)`, the function already uses `ELEVENLABS_VOICE`. To support Hebrew, add a `lang` parameter:

Replace the function signature:
```python
def generate_narration(script, tmp_dir):
```
with:
```python
def generate_narration(script, tmp_dir, lang="en"):
```

Inside `generate_narration`, replace the line:
```python
        r = requests.post(
            f"{ELEVENLABS_URL}/{ELEVENLABS_VOICE}",
```
with:
```python
        voice = ELEVENLABS_VOICE_HE if lang == "he" else ELEVENLABS_VOICE
        model = ELEVENLABS_MODEL_HE if lang == "he" else "eleven_turbo_v2_5"
        r = requests.post(
            f"{ELEVENLABS_URL}/{voice}",
```

And inside the `json={...}` payload, replace:
```python
                "model_id": "eleven_turbo_v2_5",
```
with:
```python
                "model_id": model,
```

- [ ] **Step 2: Add Hebrew YouTube upload**

In `upload_to_youtube(video_path, slug, n_photos)`, add `lang` parameter:

Replace:
```python
def upload_to_youtube(video_path, slug, n_photos):
```
with:
```python
def upload_to_youtube(video_path, slug, n_photos, lang="en"):
```

Replace the existing `body` dict construction with:

```python
    guide_title_he = extract_guide_title_he(slug)
    title_en_raw   = slug.replace("-", " ").title()

    if lang == "he":
        yt_title = f"{guide_title_he} — מדריך צילום | עמית ארז"
        yt_desc  = (
            f"למד על {guide_title_he} עם דוגמאות אמיתיות מצילום.\n\n"
            f"עמית ארז — צלם אמנות ישראלי — מדריך אותך עם {n_photos} תמונות אמיתיות.\n\n"
            f"📷 מדריך מלא:\nhttps://amitphotos.com/camera/{slug}/\n\n"
            f"🌐 גלריה מלאה:\nhttps://amitphotos.com\n\n"
            f"#צילום #{guide_title_he.replace(' ','')} #מדריך_צילום #עמיתארז"
        )
        yt_tags  = ["צילום", "מדריך", guide_title_he, "עמית ארז", "amitphotos",
                    "מצלמה", "טיפים לצילום", "צילום ישראלי"]
        yt_lang  = "iw"
    else:
        yt_title = f"{title_en_raw} — Photography Tutorial | Amit Erez"
        yt_desc  = (
            f"Learn {title_en_raw} through real photography examples.\n\n"
            f"In this tutorial, Amit Erez — a fine art photographer based in Israel — "
            f"walks you through practical techniques with {n_photos} real photos.\n\n"
            f"📷 Full photography guide:\nhttps://amitphotos.com/camera/{slug}/\n\n"
            f"🌐 Full gallery:\nhttps://amitphotos.com\n\n"
            f"#photography #{title_en_raw.replace(' ','')} #photographytutorial #AmitErez"
        )
        yt_tags  = ["photography", "tutorial", title_en_raw, "Amit Erez", "amitphotos",
                    "camera", "photography tips", "Israel photography"]
        yt_lang  = "en"

    body = {
        "snippet": {
            "title":                yt_title,
            "description":          yt_desc,
            "tags":                 yt_tags,
            "categoryId":           "27",
            "defaultAudioLanguage": yt_lang,
        },
        "status": {"privacyStatus": "public"},
    }
```

- [ ] **Step 3: Add `--lang` argument to `main()` and wire Hebrew flow**

In `main()`, after the `--replace` block and before `if not ELEVENLABS_KEY:`, add:

```python
    # --lang he/en
    lang = "en"
    if "--lang" in args:
        idx = args.index("--lang")
        if idx + 1 < len(args):
            lang = args[idx + 1]
            args = [a for a in args if a not in ("--lang", lang)]
```

In `process_guide(slug, photos, tmp_dir)`, add `lang="en"` parameter:

```python
def process_guide(slug, photos, tmp_dir, lang="en"):
```

Inside `process_guide`, replace the narration call:
```python
    narration = generate_narration(script, tmp_dir)
```
with:
```python
    if lang == "he":
        title_he  = extract_guide_title_he(slug)
        sections  = extract_hebrew_sections(slug)
        if not sections:
            print(f"⚠️  לא נמצא תוכן עברי ב-{slug}")
            return None
        script = build_hebrew_narration_script(slug, sections, title_he)
        print(f"📝 Script HE: {len(script)} תווים, {len(sections)} sections")
    else:
        sections = extract_english_sections(slug)
        if not sections:
            print(f"⚠️  לא נמצא תוכן אנגלית ב-{slug}")
            return None
        script = build_narration_script(slug, sections)
        print(f"📝 Script EN: {len(script)} תווים, {len(sections)} sections")

    narration = generate_narration(script, tmp_dir, lang=lang)
```

Replace the upload call:
```python
    vid_id = upload_to_youtube(Path(final), slug, len(photo_paths))
```
with:
```python
    vid_id = upload_to_youtube(Path(final), slug, len(photo_paths), lang=lang)
```

In `main()`, update the `process_guide` call:
```python
            result = process_guide(slug, photos, Path(tmp), lang=lang)
```

And update the `append_video` block — wrap with an `if lang == "he":` / `else:` branch:

Replace:
```python
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
with:
```python
                if isinstance(result, str):
                    from videos_utils import update_video_id_he
                    if lang == "he":
                        update_video_id_he(slug, result)
                    else:
                        sections = extract_english_sections(slug)
                        script   = build_narration_script(slug, sections) if sections else ""
                        title_en = slug.replace("-", " ").title()
                        append_video({
                            "id":         result,
                            "id_he":      None,
                            "platform":   "youtube",
                            "type":       "tutorial",
                            "slug":       slug,
                            "title_he":   extract_guide_title_he(slug),
                            "title_en":   f"{title_en} — Photography Tutorial",
                            "summary_he": "",
                            "summary_en": extract_summary_en(script),
                        })
```

- [ ] **Step 4: Verify the script runs without error on a dry-run**

```bash
cd c:\Users\erezf\amit-photos\src
python youtube_tutorial.py --help 2>&1 || python youtube_tutorial.py depth-of-field --lang he --help 2>&1 || echo "no crash"
```

Expected: no ImportError or SyntaxError.

- [ ] **Step 5: Run all tests**

```bash
cd c:\Users\erezf\amit-photos
python -m pytest tests/ -v
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/youtube_tutorial.py
git commit -m "feat: add --lang he flag to youtube_tutorial.py for Hebrew dubbing"
```

---

## Task 4: Update `data/videos.json` — add `id_he: null`

**Files:**
- Modify: `data/videos.json`

- [ ] **Step 1: Add `id_he: null` to the 3 existing tutorial entries**

Open `data/videos.json`. For each of the 3 tutorial entries (`depth-of-field`, `composition`, `exposure`), add `"id_he": null` after the `"id"` field:

```json
{
  "id": "2tdd4vksWyE",
  "id_he": null,
  "platform": "youtube",
  ...
}
```

Do this for all 3 tutorial entries. Gallery and reel entries remain unchanged (no `id_he` field).

- [ ] **Step 2: Verify JSON is valid**

```bash
python -c "import json; json.load(open('data/videos.json', encoding='utf-8')); print('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add data/videos.json
git commit -m "feat: add id_he field to existing tutorial entries in videos.json"
```

---

## Task 5: Update `videos/index.html` — language-aware tutorial embed

**Files:**
- Modify: `videos/index.html`

The `buildTutorials` function currently calls `ytEmbed(v.id)`. We need to pick `id_he` when `LANG === "he"` and both exist.

- [ ] **Step 1: Add CSS for language toggle buttons**

Inside the `<style>` block in `videos/index.html`, add after `.card-link` styles:

```css
.vid-lang-toggle { display: flex; gap: .35rem; margin-bottom: .5rem; }
.vtog { background: var(--surface); border: 1px solid var(--border); color: var(--muted);
  font-size: .75rem; font-weight: 700; padding: .25rem .65rem; border-radius: 6px;
  cursor: pointer; transition: all .15s; }
.vtog.active { border-color: var(--accent); color: var(--accent); background: rgba(200,169,110,.1); }
```

- [ ] **Step 2: Update `buildTutorials` to use `id_he`**

In the `buildTutorials` function, replace the `ytEmbed(v.id)` call:

Old `buildTutorials` card construction:
```javascript
    var card = '<div class="tutorial-card">' +
      '<div class="card-title">' + title + '</div>' +
      (summary ? '<p class="card-summary">' + summary + '</p>' : '') +
      ytEmbed(v.id) + link + gear +
      '</div>';
```

New:
```javascript
    var vidEn   = v.id    || null;
    var vidHe   = v.id_he || null;
    var activeId = (LANG === 'he' && vidHe) ? vidHe : (vidEn || vidHe);
    var toggleHtml = '';
    if (vidEn && vidHe) {
      toggleHtml = '<div class="vid-lang-toggle">' +
        '<button class="vtog' + (LANG === 'he' ? ' active' : '') + '" onclick="switchVidLang(this,\'' + vidHe + '\')">HE</button>' +
        '<button class="vtog' + (LANG === 'en' ? ' active' : '') + '" onclick="switchVidLang(this,\'' + vidEn + '\')">EN</button>' +
        '</div>';
    }
    var embedHtml = activeId ? ytEmbed(activeId) : '';
    var card = '<div class="tutorial-card">' +
      '<div class="card-title">' + title + '</div>' +
      (summary ? '<p class="card-summary">' + summary + '</p>' : '') +
      toggleHtml + embedHtml + link + gear +
      '</div>';
```

- [ ] **Step 3: Add `switchVidLang` helper**

Before the `fetch('/data/videos.json')` call, add:

```javascript
function switchVidLang(btn, videoId) {
  var wrap = btn.closest('.tutorial-card');
  var iframe = wrap.querySelector('iframe');
  if (iframe) iframe.src = 'https://www.youtube.com/embed/' + videoId;
  wrap.querySelectorAll('.vtog').forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
}
```

Also update the `rebuildAll` filter to include entries where either `id` or `id_he` is set:

Replace:
```javascript
  var valid = ALL_VIDEOS.filter(function(v) { return v.id; });
```
with:
```javascript
  var valid = ALL_VIDEOS.filter(function(v) { return v.id || v.id_he; });
```

- [ ] **Step 4: Verify locally**

```bash
python -m http.server 8000
```

Open `http://localhost:8000/videos/`. Switch language (HE/EN via nav). Verify:
- Tutorial cards show the correct-language embed by default
- If both `id` and `id_he` are set (manually test by adding fake id_he to videos.json), toggle appears and switches embed.

- [ ] **Step 5: Commit**

```bash
git add videos/index.html
git commit -m "feat: language-aware video embed in /videos/ tutorial cards"
```

---

## Task 6: Add `.video-section` to all `/camera/*/index.html` pages

**Files:**
- Modify: 23 files — `camera/<slug>/index.html` for each slug below

**Slugs:**
`black-and-white`, `color-channels`, `color-theory`, `composition`, `controls`, `depth-of-field`, `dynamic-range`, `editing`, `exposure`, `filters`, `focus`, `histogram`, `landscape`, `lenses`, `light`, `macro`, `mobile`, `portrait`, `software`, `sports`, `types`, `visual-language`, `white-balance`

The same CSS + HTML + JS block is added to each page. Only `var SLUG` changes.

- [ ] **Step 1: Add CSS to each page's `<style>` block**

Find the closing `</style>` tag and insert before it (same content in all 23 pages):

```css
.video-section{max-width:760px;margin:0 auto 1.5rem;padding:0 1.25rem;display:none}
.vid-sec-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:.75rem}
.vid-sec-label{font-family:'Syne',sans-serif;color:var(--accent);font-size:.93rem;font-weight:700}
.vtog-wrap{display:flex;gap:.35rem}
.vtog{background:var(--surface);border:1px solid var(--border);color:var(--muted);font-size:.78rem;font-weight:700;padding:.3rem .7rem;border-radius:6px;cursor:pointer;transition:all .15s}
.vtog.active{border-color:var(--accent);color:var(--accent);background:rgba(200,169,110,.1)}
.yt-embed-wrap{position:relative;padding-bottom:56.25%;height:0;border-radius:12px;overflow:hidden;background:#000}
.yt-embed-wrap iframe{position:absolute;top:0;right:0;width:100%;height:100%;border:0}
```

- [ ] **Step 2: Add HTML block after `.page-hero` div**

After the closing `</div>` of `.page-hero` (i.e. after `</div>` that closes the hero), add:

```html
<div class="video-section" id="vid-sec">
  <div class="vid-sec-header">
    <span class="vid-sec-label" data-he="צפה במדריך הווידאו" data-en="Watch the Tutorial">צפה במדריך הווידאו</span>
    <div class="vtog-wrap">
      <button class="vtog active" id="vtog-he" onclick="switchVidSec('he')">HE</button>
      <button class="vtog" id="vtog-en" onclick="switchVidSec('en')">EN</button>
    </div>
  </div>
  <div class="yt-embed-wrap">
    <iframe id="vid-embed" loading="lazy" allowfullscreen></iframe>
  </div>
</div>
```

- [ ] **Step 3: Add inline JS at bottom of `<body>` (before `</body>`)**

Each page gets this script with `SLUG` changed to match the page:

```html
<script>
(function(){
  var SLUG    = 'depth-of-field'; /* CHANGE PER PAGE */
  var sec     = document.getElementById('vid-sec');
  var embed   = document.getElementById('vid-embed');
  var togHe   = document.getElementById('vtog-he');
  var togEn   = document.getElementById('vtog-en');
  var ids     = { en: null, he: null };
  var curLang = localStorage.getItem('lang') || 'he';

  function setEmbed(lang) {
    curLang = lang;
    var id = ids[lang] || ids.en || ids.he;
    if (!id) return;
    embed.src = 'https://www.youtube.com/embed/' + id;
    togHe.classList.toggle('active', lang === 'he');
    togEn.classList.toggle('active', lang === 'en');
  }

  window.switchVidSec = function(lang) { setEmbed(lang); };

  fetch('/data/videos.json')
    .then(function(r){ return r.json(); })
    .then(function(videos){
      var v = videos.find(function(x){ return x.slug === SLUG && x.type === 'tutorial'; });
      if (!v) return;
      ids.en = v.id   || null;
      ids.he = v.id_he || null;
      if (!ids.en && !ids.he) return;
      if (!ids.he) { togHe.style.display = 'none'; curLang = 'en'; }
      if (!ids.en) { togEn.style.display = 'none'; curLang = 'he'; }
      setEmbed(curLang);
      sec.style.display = '';
    });
})();
</script>
```

**SLUG value per file:**

| File | SLUG value |
|---|---|
| `camera/black-and-white/index.html` | `black-and-white` |
| `camera/color-channels/index.html` | `color-channels` |
| `camera/color-theory/index.html` | `color-theory` |
| `camera/composition/index.html` | `composition` |
| `camera/controls/index.html` | `controls` |
| `camera/depth-of-field/index.html` | `depth-of-field` |
| `camera/dynamic-range/index.html` | `dynamic-range` |
| `camera/editing/index.html` | `editing` |
| `camera/exposure/index.html` | `exposure` |
| `camera/filters/index.html` | `filters` |
| `camera/focus/index.html` | `focus` |
| `camera/histogram/index.html` | `histogram` |
| `camera/landscape/index.html` | `landscape` |
| `camera/lenses/index.html` | `lenses` |
| `camera/light/index.html` | `light` |
| `camera/macro/index.html` | `macro` |
| `camera/mobile/index.html` | `mobile` |
| `camera/portrait/index.html` | `portrait` |
| `camera/software/index.html` | `software` |
| `camera/sports/index.html` | `sports` |
| `camera/types/index.html` | `types` |
| `camera/visual-language/index.html` | `visual-language` |
| `camera/white-balance/index.html` | `white-balance` |

- [ ] **Step 4: Verify one page locally**

```bash
python -m http.server 8000
```

Open `http://localhost:8000/camera/depth-of-field/`. The video section should appear if `data/videos.json` has a non-null `id` for `depth-of-field`. Verify toggle hides/shows correctly if only one language available.

- [ ] **Step 5: Commit**

```bash
git add camera/
git commit -m "feat: add language-aware video section to all /camera/ guide pages"
```

---

## Task 7: Update `.github/workflows/youtube-tutorial.yml`

**Files:**
- Modify: `.github/workflows/youtube-tutorial.yml`

- [ ] **Step 1: Add `--lang he` step after the English step**

Find the step named `יצירת סרטון הדרכה ופרסום ל-YouTube` and replace its `run` block:

Old:
```yaml
      - name: יצירת סרטון הדרכה ופרסום ל-YouTube
        env:
          ELEVENLABS_API_KEY: ${{ secrets.ELEVENLABS_API_KEY }}
          YOUTUBE_TOKEN_JSON: ${{ secrets.YOUTUBE_TOKEN_JSON }}
          PYTHONUNBUFFERED: "1"
        run: |
          GUIDE="${{ github.event.inputs.guide }}"
          REPLACE="${{ github.event.inputs.replace_id }}"
          ARGS=""
          [ -n "$GUIDE" ] && ARGS="$GUIDE"
          [ -n "$REPLACE" ] && ARGS="$ARGS --replace $REPLACE"
          python src/youtube_tutorial.py $ARGS
```

New (two steps, common env block):
```yaml
      - name: יצירת סרטון הדרכה — אנגלית
        env:
          ELEVENLABS_API_KEY: ${{ secrets.ELEVENLABS_API_KEY }}
          YOUTUBE_TOKEN_JSON: ${{ secrets.YOUTUBE_TOKEN_JSON }}
          PYTHONUNBUFFERED: "1"
        run: |
          GUIDE="${{ github.event.inputs.guide }}"
          REPLACE="${{ github.event.inputs.replace_id }}"
          ARGS=""
          [ -n "$GUIDE" ] && ARGS="$GUIDE"
          [ -n "$REPLACE" ] && ARGS="$ARGS --replace $REPLACE"
          python src/youtube_tutorial.py $ARGS --lang en

      - name: יצירת סרטון הדרכה — עברית
        env:
          ELEVENLABS_API_KEY: ${{ secrets.ELEVENLABS_API_KEY }}
          YOUTUBE_TOKEN_JSON: ${{ secrets.YOUTUBE_TOKEN_JSON }}
          PYTHONUNBUFFERED: "1"
        run: |
          GUIDE="${{ github.event.inputs.guide }}"
          ARGS=""
          [ -n "$GUIDE" ] && ARGS="$GUIDE"
          python src/youtube_tutorial.py $ARGS --lang he
```

- [ ] **Step 2: Verify the social sharing step still works**

The social sharing inline Python script checks `latest["id"]` — this is the English video ID and is still set correctly. No change needed.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/youtube-tutorial.yml
git commit -m "feat: add Hebrew tutorial video step to youtube-tutorial workflow"
```

---

## Self-Review

**Spec coverage:**
- ✅ `--lang he` flag in `youtube_tutorial.py` — Task 3
- ✅ Hebrew ElevenLabs voice with multilingual model — Task 3
- ✅ `id_he` field in `videos.json` — Tasks 1, 4
- ✅ `/camera/*/` video section with toggle — Task 6
- ✅ `/videos/` language-aware embed — Task 5
- ✅ GitHub Actions — Task 7
- ✅ Gallery/reel entries excluded — `update_video_id_he` only matches `type: tutorial`

**Placeholder check:** None. All code blocks are complete.

**Type consistency:**
- `update_video_id_he(slug, video_id)` called consistently in Task 3
- `extract_hebrew_sections(slug)` returns `list[str]` — matches usage in `build_hebrew_narration_script`
- `generate_narration(script, tmp_dir, lang="en")` — default keeps existing callers unchanged
- `upload_to_youtube(video_path, slug, n_photos, lang="en")` — default keeps existing callers unchanged
- `switchVidSec` / `switchVidLang` are separate (camera pages vs videos page) — no conflict

**Note on ElevenLabs voice ID:** `ELEVENLABS_VOICE_HE = "cgSgspJ2msm6clMCkdW9"` is the Liam multilingual voice. If it doesn't produce good Hebrew, browse https://elevenlabs.io/voice-library, filter by Hebrew, and replace the ID constant.
