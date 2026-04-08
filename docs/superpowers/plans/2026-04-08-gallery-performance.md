# Gallery Performance & Workflow Optimization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace "load more" button with infinite scroll and fix JSON cache in the gallery; add early-exit logic to the daily workflow so it finishes in ~30 seconds when no new photos exist.

**Architecture:** Two fully independent changes. Part A touches only frontend files (gallery.js, index.html, style.css). Part B touches only the Python agent (agent_photos.py) and adds a new data/last_scan.json file.

**Tech Stack:** Vanilla JS (IntersectionObserver), Python 3.11, Google Drive API v3

---

## Part A — Gallery Infinite Scroll

### Task 1: Replace button with sentinel div in HTML

**Files:**
- Modify: `index.html:131`

- [ ] **Step 1: Replace the load-more button with a sentinel div**

In `index.html`, find this block (around line 130):
```html
    <div class="load-more-wrap">
      <button id="load-more-btn" class="load-more-btn" style="display:none">טען עוד</button>
    </div>
```
Replace with:
```html
    <div class="load-more-wrap">
      <div id="gallery-sentinel" class="gallery-sentinel"></div>
    </div>
```

- [ ] **Step 2: Verify in browser**

Open `index.html` in browser. Open DevTools → Elements. Confirm `#gallery-sentinel` div exists inside `.load-more-wrap`. No button visible.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: replace load-more button with infinite scroll sentinel"
```

---

### Task 2: Update CSS — remove button styles, add sentinel styles

**Files:**
- Modify: `assets/css/style.css:359-381`

- [ ] **Step 1: Replace load-more styles with sentinel styles**

In `assets/css/style.css`, find the entire `/* ===== LOAD MORE ===== */` block:
```css
/* ===== LOAD MORE ===== */
.load-more-wrap {
  text-align: center;
  margin-top: 3rem;
}
.load-more-btn {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-muted);
  padding: 0.875rem 2.5rem;
  border-radius: 2px;
  font-family: var(--font);
  font-size: 0.82rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  cursor: pointer;
  transition: border-color 0.2s, color 0.2s, transform 0.2s;
}
.load-more-btn:hover {
  border-color: var(--accent);
  color: var(--text);
  transform: translateY(-2px);
}
```

Replace with:
```css
/* ===== INFINITE SCROLL SENTINEL ===== */
.load-more-wrap {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 60px;
  margin-top: 1rem;
}
.gallery-sentinel {
  display: none;
  width: 32px;
  height: 32px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: sentinel-spin 0.8s linear infinite;
}
@keyframes sentinel-spin {
  to { transform: rotate(360deg); }
}
```

- [ ] **Step 2: Verify styles load**

Open browser, open gallery. No "load more" button visible. Scroll to bottom — spinner appears briefly while loading (won't be visible yet until JS is updated in Task 3, but no 404 errors in console for CSS).

- [ ] **Step 3: Commit**

```bash
git add assets/css/style.css
git commit -m "feat: replace load-more button styles with infinite scroll sentinel"
```

---

### Task 3: Update gallery.js — infinite scroll logic

**Files:**
- Modify: `assets/js/gallery.js`

This task has 5 targeted edits to gallery.js.

- [ ] **Step 1: Fix cache-busting in `loadPhotos()`**

Find line 137:
```js
      fetch('data/photos.json?v=' + Date.now()).then(r => r.ok ? r.json() : []),
```
Replace with:
```js
      fetch('data/photos.json').then(r => r.ok ? r.json() : []),
```

- [ ] **Step 2: Replace `updateLoadMoreBtn()` with `updateSentinel()`**

Find the entire `updateLoadMoreBtn` function (lines 247–257):
```js
function updateLoadMoreBtn() {
  const btn = document.getElementById('load-more-btn');
  if (!btn) return;
  const remaining = filteredPhotos.length - displayedCount;
  if (remaining > 0) {
    btn.style.display = 'block';
    btn.textContent = `טען עוד (${remaining} נותרו)`;
  } else {
    btn.style.display = 'none';
  }
}
```
Replace with:
```js
function updateSentinel() {
  const sentinel = document.getElementById('gallery-sentinel');
  if (!sentinel) return;
  sentinel.style.display = displayedCount < filteredPhotos.length ? 'block' : 'none';
}
```

- [ ] **Step 3: Replace all calls to `updateLoadMoreBtn()` with `updateSentinel()`**

There are two calls in `renderGallery()`:
- Line 197 (in the empty-state branch): `updateLoadMoreBtn();` → `updateSentinel();`
- Line 244 (end of renderGallery): `updateLoadMoreBtn();` → `updateSentinel();`

- [ ] **Step 4: Replace `initLoadMore()` with `initInfiniteScroll()`**

Find the entire `initLoadMore` function (lines 404–412):
```js
// ===== LOAD MORE =====
function initLoadMore() {
  const btn = document.getElementById('load-more-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    displayedCount = Math.min(displayedCount + PAGE_SIZE, filteredPhotos.length);
    renderGallery(true);
  });
}
```
Replace with:
```js
// ===== INFINITE SCROLL =====
function initInfiniteScroll() {
  const sentinel = document.getElementById('gallery-sentinel');
  if (!sentinel) return;
  const io = new IntersectionObserver(entries => {
    if (!entries[0].isIntersecting) return;
    if (displayedCount >= filteredPhotos.length) return;
    displayedCount = Math.min(displayedCount + PAGE_SIZE, filteredPhotos.length);
    renderGallery(true);
  }, { rootMargin: '200px' });
  io.observe(sentinel);
}
```

- [ ] **Step 5: Update call site in `initLightbox()`**

Find line 419 (inside `initLightbox()`):
```js
  initLoadMore();
```
Replace with:
```js
  initInfiniteScroll();
```

- [ ] **Step 6: Verify in browser**

Open `index.html`. Open DevTools → Network. Reload page:
- `data/photos.json` loads once with no `?v=` query string
- Reload again → `photos.json` shows `(disk cache)` or `304 Not Modified`

Scroll to bottom of gallery → spinner appears → more photos load automatically. No "load more" button anywhere.

- [ ] **Step 7: Verify filter still works**

Click a category filter. Gallery resets to first 25 photos. Scroll down → more photos load. Spinner disappears when all photos in that category are shown.

- [ ] **Step 8: Commit**

```bash
git add assets/js/gallery.js
git commit -m "feat: infinite scroll gallery with browser JSON caching"
```

---

## Part B — Workflow Early Exit

### Task 4: Add `last_scan.json` read/write and early-exit to `agent_photos.py`

**Files:**
- Modify: `src/agent_photos.py`
- Create: `data/last_scan.json` (created automatically on first run)

- [ ] **Step 1: Add `LAST_SCAN_FILE` constant**

In `src/agent_photos.py`, find the `# ===== PATHS =====` block (lines 28–30):
```python
ROOT = Path(__file__).parent.parent
DATA_FILE = ROOT / "data" / "photos.json"
CREDENTIALS_FILE = ROOT / "credentials.json"
TOKEN_FILE = ROOT / "token.json"
```
Add one line after `DATA_FILE`:
```python
ROOT = Path(__file__).parent.parent
DATA_FILE = ROOT / "data" / "photos.json"
LAST_SCAN_FILE = ROOT / "data" / "last_scan.json"
CREDENTIALS_FILE = ROOT / "credentials.json"
TOKEN_FILE = ROOT / "token.json"
```

- [ ] **Step 2: Add `load_last_scan_time()` and `save_last_scan_time()` helper functions**

Add these two functions right after `load_existing_photos()` (after line 237):
```python
def load_last_scan_time():
    """קורא את זמן הסריקה האחרונה מ-data/last_scan.json. מחזיר ISO string או None."""
    if LAST_SCAN_FILE.exists():
        try:
            return json.loads(LAST_SCAN_FILE.read_text(encoding="utf-8")).get("last_scan_time")
        except Exception:
            pass
    return None


def save_last_scan_time(iso_time):
    """שומר את זמן הסריקה הנוכחית ב-data/last_scan.json."""
    LAST_SCAN_FILE.write_text(
        json.dumps({"last_scan_time": iso_time}, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )
```

- [ ] **Step 3: Add `has_new_files()` function**

Add this function right after `save_last_scan_time()`:
```python
def has_new_files(session, since_iso):
    """בודק אם יש קבצי תמונה שהשתנו מאז since_iso. מחזיר True/False."""
    import requests
    params = {
        "q": f"mimeType contains 'image/' and modifiedTime > '{since_iso}' and trashed=false",
        "fields": "files(id)",
        "pageSize": 1,
    }
    data = drive_get(session, "files", params)
    return len(data.get("files", [])) > 0
```

- [ ] **Step 4: Add early-exit logic to `main()`**

In `main()`, after the line `session = get_drive_session()` (after line 249) and before the Portfolio folder search, add the early-exit block:

Find:
```python
    print("🔐 מתחבר ל-Google Drive...")
    session = get_drive_session()

    print(f"📂 מחפש תיקייה '{PORTFOLIO_FOLDER}'...")
    portfolio = find_folder(session, PORTFOLIO_FOLDER)
```

Replace with:
```python
    print("🔐 מתחבר ל-Google Drive...")
    session = get_drive_session()

    from datetime import datetime, timezone
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    last_scan = load_last_scan_time()
    if last_scan and not DRY_RUN:
        print(f"⏱️  סריקה אחרונה: {last_scan}")
        print("🔍 בודק אם יש תמונות חדשות...")
        if not has_new_files(session, last_scan):
            print("✅ אין תמונות חדשות מאז הסריקה האחרונה — מסיים.")
            save_last_scan_time(now_iso)
            return

    print(f"📂 מחפש תיקייה '{PORTFOLIO_FOLDER}'...")
    portfolio = find_folder(session, PORTFOLIO_FOLDER)
```

- [ ] **Step 5: Save `last_scan_time` at end of `main()` on success**

Find the end of `main()` where `DATA_FILE.write_text(...)` is called (lines 364–369):
```python
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    DATA_FILE.write_text(
        json.dumps(all_photos, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )
    print(f"💾 נשמר ל-{DATA_FILE}")
```

Replace with:
```python
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    DATA_FILE.write_text(
        json.dumps(all_photos, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )
    print(f"💾 נשמר ל-{DATA_FILE}")
    save_last_scan_time(now_iso)
    print(f"🕐 זמן סריקה נשמר: {now_iso}")
```

- [ ] **Step 6: Add `data/last_scan.json` to git tracking**

The file doesn't exist yet — it'll be created on first workflow run. Add an empty placeholder so GitHub Actions has it on checkout:

```bash
echo '{"last_scan_time": null}' > data/last_scan.json
```

- [ ] **Step 7: Test locally (dry run)**

```bash
python src/agent_photos.py --dry-run
```

Expected output includes:
```
🔐 מתחבר ל-Google Drive...
⏱️  סריקה אחרונה: ...   (if last_scan.json has a real timestamp)
🔍 בודק אם יש תמונות חדשות...
✅ אין תמונות חדשות מאז הסריקה האחרונה — מסיים.
```
(or proceeds with full scan if photos were added since last run)

- [ ] **Step 8: Commit**

```bash
git add src/agent_photos.py data/last_scan.json
git commit -m "feat: workflow early exit when no new Drive photos"
```

---

### Task 5: Push and verify workflow

- [ ] **Step 1: Push all changes**

```bash
git push origin main
```

- [ ] **Step 2: Trigger workflow manually**

```bash
gh workflow run update-photos.yml
```

- [ ] **Step 3: Watch the run**

```bash
gh run watch
```

Expected: If no new photos since last run → completes in ~30 seconds with "אין תמונות חדשות" message. If new photos exist → full 16-minute run.

- [ ] **Step 4: Verify gallery in browser**

Open the site. Open DevTools → Network → reload:
- `photos.json` loads once, subsequent reloads show cached version
- Scroll down → photos auto-load without any button
