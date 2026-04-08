# Gallery Performance & Workflow Optimization — Design Spec

**Date:** 2026-04-08  
**Status:** Approved

---

## Overview

Two independent optimizations:
1. **Gallery Infinite Scroll** — replace "load more" button with auto-loading on scroll, fix JSON cache
2. **Workflow Early Exit** — skip Drive scan when no new photos, reducing daily runtime from ~16 min to ~30 sec

---

## Part A — Gallery Infinite Scroll

### Problem

- `data/photos.json` (275 KB) is fetched with `?v=Date.now()` on every page load, defeating browser cache
- "Load more" button requires manual clicks; infinite scroll fits a photo portfolio better

### Changes

#### `assets/js/gallery.js`

1. **`loadPhotos()`** — remove `?v=Date.now()` cache-busting. Fetch with default cache behavior (browser caches up to HTTP headers, no forced revalidation). `photos.json` remains a bare array — no format change.

2. **`initLoadMore()` → `initInfiniteScroll()`** — replace click listener with `IntersectionObserver` on `#gallery-sentinel`:
   - When sentinel enters viewport: `displayedCount = Math.min(displayedCount + PAGE_SIZE, filteredPhotos.length)` + `renderGallery(true)`
   - Observer disconnects when all photos are displayed

3. **`updateLoadMoreBtn()` → `updateSentinel()`** — shows/hides sentinel based on remaining photos. When loading is in progress, sentinel shows a small spinner.

4. All call sites of `updateLoadMoreBtn()` → `updateSentinel()`.

#### `index.html`

- Replace `<button id="load-more-btn" class="load-more-btn">` with `<div id="gallery-sentinel" class="gallery-sentinel"></div>`

#### `assets/css/style.css`

- Remove `.load-more-btn`, `.load-more-wrap` styles
- Add `.gallery-sentinel` — height: 40px, display: flex, justify-content: center, align-items: center
- Add `.gallery-sentinel.loading::after` — small CSS spinner (reuse existing spinner pattern if any)

---

## Part B — Workflow Early Exit

### Problem

`agent_photos.py` scans all Drive folders and lists all 447 images on every run, even when nothing has changed. This takes ~16 minutes daily.

### Approach

Use Google Drive's `modifiedTime` filter in the files list query. Store the last successful scan timestamp in `data/photos.json`.

### Data Structure Change

`data/photos.json` changes from a bare array to an object:

```json
{
  "last_scan_time": "2026-04-08T09:00:00Z",
  "photos": [ ...existing photo objects... ]
}
```

**Migration:** `agent_photos.py` handles both formats on read (bare array = legacy, no `last_scan_time`).

### Changes to `agent_photos.py`

1. **`load_existing_photos()`** — returns `(dict_of_photos, last_scan_time_or_None)`. Handles both old (array) and new (object) JSON format.

2. **`list_images(session, folder_id, since=None)`** — adds `and modifiedTime > '{since}'` to the Drive query when `since` is provided.

3. **`main()` logic:**
   ```
   load existing photos + last_scan_time
   if last_scan_time exists:
       scan Drive for files with modifiedTime > last_scan_time
       if no new files found → print "אין תמונות חדשות" → save updated last_scan_time → exit 0
       else → process only new files, merge with existing
   else:
       full scan (first run or reset)
   save photos + new last_scan_time to JSON
   ```

4. **Save format** — `DATA_FILE.write_text(json.dumps({"last_scan_time": now_iso, "photos": all_photos}, ...))`.

### `gallery.js` update (from Part A)

`loadPhotos()` must handle both formats for backward compatibility during transition:
```js
const raw = await fetch('data/photos.json').then(r => r.json());
const photos = Array.isArray(raw) ? raw : (raw.photos || []);
```

### Workflow YAML — no changes needed

`git diff data/photos.json` still detects changes correctly (new `last_scan_time` field updates on every run, so diff always triggers commit/push). To avoid committing on every run even when no photos changed, the workflow step should check for changes in the `photos` array specifically:

```yaml
- name: בדוק אם יש שינויים
  id: changes
  run: |
    git diff --quiet data/photos.json || echo "changed=true" >> $GITHUB_OUTPUT
```

This is acceptable — `last_scan_time` changes every run, so the file always changes. To avoid unnecessary commits, `agent_photos.py` should only write the file when photos actually changed, passing `last_scan_time` as a separate lightweight file: `data/last_scan.json`.

**Revised approach:** Store `last_scan_time` in a separate `data/last_scan.json` file (not in `photos.json`). This keeps `photos.json` unchanged when no new photos are found, so the workflow commit step correctly detects "no changes".

- `data/last_scan.json`: `{"last_scan_time": "2026-04-08T09:00:00Z"}`
- Always written (even on early exit) so next run knows when last scan was
- Added to `.gitignore` is NOT desired — it should be committed so GitHub Actions has it on checkout

`photos.json` stays as a bare array (no breaking change to JS).

---

## Summary of Files Changed

| File | Change |
|------|--------|
| `assets/js/gallery.js` | Infinite scroll, remove cache-bust, handle `last_scan.json` format |
| `assets/css/style.css` | Remove load-more styles, add sentinel styles |
| `index.html` | Replace button with sentinel div |
| `src/agent_photos.py` | Early exit logic, `last_scan.json` read/write, `modifiedTime` filter |
| `data/last_scan.json` | New file (created on first workflow run) |

**`photos.json` format: unchanged** (still a bare array).

---

## Expected Outcome

- **Gallery:** JSON cached by browser; infinite scroll replaces button click
- **Workflow (no new photos):** ~30 seconds instead of ~16 minutes
- **Workflow (new photos found):** unchanged, ~16 minutes
