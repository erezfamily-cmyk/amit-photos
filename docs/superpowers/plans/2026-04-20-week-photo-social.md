# Week Photo Social Auto-Post — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When admin confirms Photo of the Week, Claude Vision generates a first-person Hebrew caption, saves it to DB, displays it in the website strip, and posts it to Instagram + Facebook immediately.

**Architecture:** Admin "אשר" → worker saves photo_id + fire-and-forget triggers GitHub Actions workflow → Python script uses Claude Vision to write caption → saves caption to settings table → posts to Instagram + Facebook.

**Tech Stack:** Cloudflare Worker (JS), Python 3.11, Claude Vision API (claude-sonnet-4-6), Instagram Graph API, Facebook Graph API, GitHub Actions

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `worker.js` | Modify | Add caption endpoint, update clear, update GET /api/photos, trigger workflow from set |
| `src/week_photo_social.py` | Create | Vision caption generation + IG + FB posting |
| `.github/workflows/week-photo-social.yml` | Create | GitHub Actions workflow |
| `index.html` | Modify | Add caption-short and caption-full HTML elements to strip |
| `assets/js/gallery.js` | Modify | Populate caption elements in updateWeekPhotoStrip() |
| `assets/css/style.css` | Modify | Style caption elements |

---

## Task 1: worker.js — Caption endpoint + clear update + GET update

**Files:**
- Modify: `worker.js`

### Context

`handlePhotos` is at line ~265. It currently fetches `photo_of_week_id` and `photo_of_week_discount` from settings.
`handlePhotoOfWeekClear` is at line ~1604. It currently only deletes `photo_of_week_id`.
Routes are registered at line ~1778.

- [ ] **Step 1: Add caption DB query to handlePhotos**

Find this block in `worker.js` (around line 275):
```js
const weekRow = await env.DB.prepare("SELECT value FROM settings WHERE key='photo_of_week_id'").first();
const discountRow = await env.DB.prepare("SELECT value FROM settings WHERE key='photo_of_week_discount'").first();
const weekPhotoId = weekRow?.value || '';
const weekDiscount = parseFloat(discountRow?.value || '0.25');
const photos = results.map(p => ({
  ...p,
  is_week_photo: !!(weekPhotoId && p.id === weekPhotoId),
  week_photo_discount: (weekPhotoId && p.id === weekPhotoId) ? weekDiscount : 0,
}));
```

Replace with:
```js
const weekRow = await env.DB.prepare("SELECT value FROM settings WHERE key='photo_of_week_id'").first();
const discountRow = await env.DB.prepare("SELECT value FROM settings WHERE key='photo_of_week_discount'").first();
const captionRow = await env.DB.prepare("SELECT value FROM settings WHERE key='photo_of_week_caption'").first();
const weekPhotoId = weekRow?.value || '';
const weekDiscount = parseFloat(discountRow?.value || '0.25');
const weekCaption = captionRow?.value || '';
const photos = results.map(p => ({
  ...p,
  is_week_photo: !!(weekPhotoId && p.id === weekPhotoId),
  week_photo_discount: (weekPhotoId && p.id === weekPhotoId) ? weekDiscount : 0,
  week_photo_caption: (weekPhotoId && p.id === weekPhotoId) ? weekCaption : '',
}));
```

- [ ] **Step 2: Add handlePhotoOfWeekCaption function**

Add this new function after `handlePhotoOfWeekClear` (around line 1608):

```js
async function handlePhotoOfWeekCaption(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  if (authHeader !== `Bearer ${env.ADMIN_PASSWORD}`) {
    if (!await checkAuth(request, env)) return unauth(request);
  }
  const { caption } = await request.json().catch(() => ({}));
  if (!caption) return jsonRes({ error: 'caption required' }, 400, request);
  await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('photo_of_week_caption', ?)").bind(caption).run();
  return jsonRes({ ok: true }, 200, request);
}
```

- [ ] **Step 3: Update handlePhotoOfWeekClear to also delete caption**

Find (around line 1604):
```js
async function handlePhotoOfWeekClear(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  await env.DB.prepare("DELETE FROM settings WHERE key='photo_of_week_id'").run();
  return jsonRes({ ok: true }, 200, request);
}
```

Replace with:
```js
async function handlePhotoOfWeekClear(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  await env.DB.prepare("DELETE FROM settings WHERE key='photo_of_week_id'").run();
  await env.DB.prepare("DELETE FROM settings WHERE key='photo_of_week_caption'").run();
  return jsonRes({ ok: true }, 200, request);
}
```

- [ ] **Step 4: Register the new route**

Find (around line 1779):
```js
if (path === '/api/admin/photo-of-week/set' && request.method === 'POST') return handlePhotoOfWeekSet(request, env);
if (path === '/api/admin/photo-of-week/clear' && request.method === 'POST') return handlePhotoOfWeekClear(request, env);
```

Add after:
```js
if (path === '/api/admin/photo-of-week/caption' && request.method === 'POST') return handlePhotoOfWeekCaption(request, env);
```

- [ ] **Step 5: Commit**

```bash
git add worker.js
git commit -m "feat: add week photo caption endpoint and expose week_photo_caption in API"
```

---

## Task 2: worker.js — Trigger workflow from handlePhotoOfWeekSet

**Files:**
- Modify: `worker.js`

### Context

`handlePhotoOfWeekSet` is at line ~1595. After saving to DB it returns immediately. We need to fire-and-forget a GitHub Actions dispatch to `week-photo-social.yml`. The dispatch pattern already exists in `handleTriggerWorkflow` (around line 419).

- [ ] **Step 1: Update handlePhotoOfWeekSet to trigger workflow**

Find (around line 1595):
```js
async function handlePhotoOfWeekSet(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  const { photo_id } = await request.json().catch(() => ({}));
  if (!photo_id) return jsonRes({ error: 'photo_id required' }, 400, request);
  await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('photo_of_week_id', ?)").bind(photo_id).run();
  await env.DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('photo_of_week_discount', '0.25')").run();
  return jsonRes({ ok: true }, 200, request);
}
```

Replace with:
```js
async function handlePhotoOfWeekSet(request, env) {
  if (!await checkAuth(request, env)) return unauth(request);
  const { photo_id } = await request.json().catch(() => ({}));
  if (!photo_id) return jsonRes({ error: 'photo_id required' }, 400, request);
  await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('photo_of_week_id', ?)").bind(photo_id).run();
  await env.DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('photo_of_week_discount', '0.25')").run();
  // fire-and-forget: trigger social posting workflow
  fetch(
    `https://api.github.com/repos/erezfamily-cmyk/amit-photos/actions/workflows/week-photo-social.yml/dispatches`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'User-Agent': 'amit-photos-worker',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ ref: 'main' }),
    }
  ).catch(() => {}); // intentionally not awaited
  return jsonRes({ ok: true }, 200, request);
}
```

- [ ] **Step 2: Deploy worker**

```bash
npx wrangler deploy
```

Expected output: `Deployed amit-photos ... (version ...)`

- [ ] **Step 3: Commit**

```bash
git add worker.js
git commit -m "feat: trigger week-photo-social workflow on photo-of-week set"
```

---

## Task 3: src/week_photo_social.py — New Python script

**Files:**
- Create: `src/week_photo_social.py`

- [ ] **Step 1: Create the file**

```python
#!/usr/bin/env python3
"""
Week Photo Social Agent
כשתמונת השבוע מוגדרת — מייצר כיתוב בגוף ראשון עם Claude Vision ומפרסם לאינסטגרם ופייסבוק.
"""

import base64
import os
import random
import sys

import anthropic
import requests

SITE_URL   = "https://amitphotos.com"
GRAPH_API  = "https://graph.facebook.com/v21.0"

IG_USER_ID    = os.environ.get("INSTAGRAM_USER_ID", "")
IG_TOKEN      = os.environ.get("INSTAGRAM_PAGE_TOKEN", "")
FB_PAGE_ID    = os.environ.get("FACEBOOK_PAGE_ID", "")
FB_TOKEN      = os.environ.get("FACEBOOK_PAGE_TOKEN", "")
ANTHROPIC_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()
ADMIN_TOKEN   = os.environ.get("ADMIN_TOKEN", "")

HASHTAGS_BY_CATEGORY = {
    "default": "#photography #photooftheday #israeliphotographer #amitphotos #צילום #ישראל",
    "טבע":     "#nature #naturephotography #wildlife #israel_nature #הטבע_הישראלי #amitphotos",
    "פורטרט":  "#portrait #portraitphotography #צילום_פורטרט #amitphotos #israeliphotographer",
    "עירוני":  "#urban #streetphotography #architecture #israel_urban #amitphotos",
    "אירועים": "#events #weddingphotography #momentscaptured #amitphotos #צילום",
}


def get_week_photo():
    """מושך את תמונת השבוע מה-API."""
    resp = requests.get(f"{SITE_URL}/api/photos", timeout=15)
    resp.raise_for_status()
    photos = resp.json()
    week = next((p for p in photos if p.get("is_week_photo")), None)
    if not week:
        print("❌ לא נמצאה תמונת שבוע מוגדרת")
        sys.exit(1)
    print(f"📸 תמונת השבוע: {week['title']} (id: {week['id']})")
    return week


def fetch_image_as_base64(url, max_bytes=4_500_000):
    """מוריד תמונה ומחזיר base64 + mime type. דוחס אם צריך."""
    if url.startswith("/"):
        url = f"{SITE_URL}{url}"
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    img_bytes = resp.content

    try:
        from PIL import Image
        import io
        img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        if max(img.size) > 7000:
            img.thumbnail((7000, 7000), Image.LANCZOS)
        quality = 85
        while quality >= 40:
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=quality)
            img_bytes = buf.getvalue()
            if len(img_bytes) <= max_bytes:
                break
            quality -= 15
        print(f"🗜️  תמונה עובדה: {len(img_bytes)//1024}KB")
    except ImportError:
        pass

    b64 = base64.standard_b64encode(img_bytes).decode("utf-8")
    return b64, "image/jpeg"


def generate_caption(photo):
    """Claude Vision מנתח את התמונה וכותב כיתוב בגוף ראשון בעברית."""
    client = anthropic.Anthropic(api_key=ANTHROPIC_KEY)

    img_url = photo.get("url") or photo.get("thumbnail")
    image_content = []
    try:
        b64, mime = fetch_image_as_base64(img_url)
        image_content = [{"type": "image", "source": {"type": "base64", "media_type": mime, "data": b64}}]
        print("🖼️  תמונה הורדה לניתוח Vision")
    except Exception as e:
        print(f"⚠️  לא הצלחתי להוריד תמונה ({e}) — ממשיך בלי Vision")

    title    = photo.get("title", "")
    category = photo.get("category", "")
    exif     = photo.get("exif") or {}
    meta_lines = []
    if title:                 meta_lines.append(f"שם: {title}")
    if category:              meta_lines.append(f"קטגוריה: {category}")
    if exif.get("camera"):    meta_lines.append(f"מצלמה: {exif['camera']}")
    if exif.get("focal"):     meta_lines.append(f"עדשה: {exif['focal']}mm")
    if exif.get("aperture"):  meta_lines.append(f"צמצם: f/{exif['aperture']}")
    if exif.get("shutter"):   meta_lines.append(f"חשיפה: {exif['shutter']}s")
    if exif.get("iso"):       meta_lines.append(f"ISO: {exif['iso']}")
    meta_text = "\n".join(meta_lines) if meta_lines else ""

    prompt = f"""אתה עמית, צלם ישראלי. נתח את התמונה וכתוב פוסט בגוף ראשון בעברית.

כתוב:
- מה צילמת ואיפה
- מה הרגשת ברגע הצילום
- איך צילמת — אור, זמן, טכניקה (בהתבסס על מה שאתה רואה בתמונה ועל המטא-דאטה)

כללים:
- גוף ראשון (אני, צילמתי, הלכתי)
- עברית בלבד, ללא תווי ערבית
- סגנון אישי, חם, אמיתי — לא פרסומי
- אל תתחיל ב"אני" — תתחיל ישירות מהסצנה
- כ-120 מילים

{f"מטא-דאטה:{chr(10)}{meta_text}" if meta_text else ""}

כתוב רק את הטקסט עצמו, ללא כותרת."""

    msg = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=600,
        messages=[{"role": "user", "content": image_content + [{"type": "text", "text": prompt}]}],
    )
    caption = msg.content[0].text.strip()
    print(f"✍️  כיתוב נוצר ({len(caption)} תווים)")
    return caption


def save_caption_to_db(caption):
    """שומר את הכיתוב ל-DB דרך ה-API."""
    resp = requests.post(
        f"{SITE_URL}/api/admin/photo-of-week/caption",
        json={"caption": caption},
        headers={"Authorization": f"Bearer {ADMIN_TOKEN}"},
        timeout=15,
    )
    if resp.ok:
        print("💾 כיתוב נשמר ל-DB")
    else:
        print(f"⚠️  שמירת כיתוב נכשלה: {resp.status_code} — {resp.text}")


def upload_to_public_host(source_url):
    """מעלה תמונה לשרת ציבורי (R2 ישיר / litterbox / 0x0.st)."""
    if source_url.startswith(f"{SITE_URL}/photos/"):
        print(f"⬆️  תמונה ב-R2, URL ישיר: {source_url}")
        return source_url

    resp = requests.get(source_url, timeout=30)
    resp.raise_for_status()
    img_bytes = resp.content

    try:
        upload = requests.post(
            "https://litterbox.catbox.moe/resources/internals/api.php",
            data={"reqtype": "fileupload", "time": "1h"},
            files={"fileToUpload": ("photo.jpg", img_bytes, "image/jpeg")},
            timeout=60,
        )
        if upload.ok and upload.text.strip().startswith("http"):
            print(f"⬆️  תמונה הועלתה (litterbox): {upload.text.strip()}")
            return upload.text.strip()
    except Exception as e:
        print(f"⚠️  litterbox נכשל ({e})")

    upload = requests.post("https://0x0.st", files={"file": ("photo.jpg", img_bytes, "image/jpeg")}, timeout=60)
    upload.raise_for_status()
    print(f"⬆️  תמונה הועלתה (0x0.st): {upload.text.strip()}")
    return upload.text.strip()


def post_to_instagram(photo, caption):
    """מפרסם לאינסטגרם עם הכיתוב + hashtags."""
    if not IG_USER_ID or not IG_TOKEN:
        print("⚠️  חסרים INSTAGRAM_USER_ID / INSTAGRAM_PAGE_TOKEN — מדלג")
        return

    source_url = photo.get("url") or photo.get("thumbnail")
    if source_url and source_url.startswith("/"):
        source_url = f"{SITE_URL}{source_url}"

    image_url = upload_to_public_host(source_url)
    hashtags  = HASHTAGS_BY_CATEGORY.get(photo.get("category", ""), HASHTAGS_BY_CATEGORY["default"])
    buy_link  = f"{SITE_URL}/photo/{photo['id']}"
    full_caption = f"{caption}\n\n🛍️ זמין לרכישה — amitphotos.com (link in bio)\n\n{hashtags}"

    container = requests.post(f"{GRAPH_API}/{IG_USER_ID}/media", data={
        "image_url": image_url, "caption": full_caption, "access_token": IG_TOKEN,
    }, timeout=30)
    if not container.ok:
        print(f"❌ IG container נכשל: {container.status_code} — {container.text}")
        return
    container_id = container.json().get("id")

    publish = requests.post(f"{GRAPH_API}/{IG_USER_ID}/media_publish", data={
        "creation_id": container_id, "access_token": IG_TOKEN,
    }, timeout=30)
    if publish.ok:
        print(f"✅ פורסם לאינסטגרם! ID: {publish.json().get('id')}")
    else:
        print(f"❌ IG publish נכשל: {publish.status_code} — {publish.text}")


def post_to_facebook(photo, caption):
    """מפרסם לפייסבוק עם הכיתוב + hashtags."""
    if not FB_PAGE_ID or not FB_TOKEN:
        print("⚠️  חסרים FACEBOOK_PAGE_ID / FACEBOOK_PAGE_TOKEN — מדלג")
        return

    source_url = photo.get("url") or photo.get("thumbnail")
    if source_url and source_url.startswith("/"):
        source_url = f"{SITE_URL}{source_url}"

    image_url = upload_to_public_host(source_url)
    hashtags  = HASHTAGS_BY_CATEGORY.get(photo.get("category", ""), HASHTAGS_BY_CATEGORY["default"])
    buy_link  = f"{SITE_URL}/photo/{photo['id']}"
    full_caption = f"{caption}\n\n🛍️ לרכישת התמונה: {buy_link}\n\n{hashtags}"

    resp = requests.post(f"{GRAPH_API}/{FB_PAGE_ID}/photos", data={
        "url": image_url, "message": full_caption, "access_token": FB_TOKEN,
    }, timeout=30)
    if resp.ok:
        print(f"✅ פורסם לפייסבוק! ID: {resp.json().get('id')}")
    else:
        print(f"❌ FB post נכשל: {resp.status_code} — {resp.text}")


def main():
    if not ANTHROPIC_KEY:
        print("❌ חסר ANTHROPIC_API_KEY")
        sys.exit(1)

    photo   = get_week_photo()
    caption = generate_caption(photo)
    print(f"\n--- כיתוב ---\n{caption}\n-----------\n")

    save_caption_to_db(caption)
    post_to_instagram(photo, caption)
    post_to_facebook(photo, caption)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Commit**

```bash
git add src/week_photo_social.py
git commit -m "feat: add week_photo_social.py — Vision caption + IG + FB posting"
```

---

## Task 4: .github/workflows/week-photo-social.yml — New workflow

**Files:**
- Create: `.github/workflows/week-photo-social.yml`

- [ ] **Step 1: Create the workflow file**

```yaml
name: פרסום תמונת השבוע לסושיאל

on:
  workflow_dispatch:

jobs:
  post:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Python setup
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: התקנת חבילות
        run: pip install requests anthropic pillow

      - name: פרסום תמונת השבוע
        env:
          INSTAGRAM_USER_ID: ${{ secrets.INSTAGRAM_USER_ID }}
          INSTAGRAM_PAGE_TOKEN: ${{ secrets.INSTAGRAM_PAGE_TOKEN }}
          FACEBOOK_PAGE_ID: ${{ secrets.FACEBOOK_PAGE_ID }}
          FACEBOOK_PAGE_TOKEN: ${{ secrets.FACEBOOK_PAGE_TOKEN }}
          ANTHROPIC_API_KEY: ${{ secrets.AMIT_PHOTO_AGENT }}
          ADMIN_TOKEN: ${{ secrets.ADMIN_PASSWORD }}
        run: python src/week_photo_social.py
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/week-photo-social.yml
git commit -m "feat: add week-photo-social GitHub Actions workflow"
git push
```

- [ ] **Step 3: Verify workflow appears in GitHub**

Go to `https://github.com/erezfamily-cmyk/amit-photos/actions` — confirm "פרסום תמונת השבוע לסושיאל" appears in the workflow list.

---

## Task 5: GitHub Secret — Add ADMIN_PASSWORD

**Files:** GitHub repository settings (manual step)

- [ ] **Step 1: Add secret in GitHub**

Go to: `https://github.com/erezfamily-cmyk/amit-photos/settings/secrets/actions`

Click "New repository secret":
- Name: `ADMIN_PASSWORD`
- Value: the same password used for `amitphotos.com/admin`

Click "Add secret".

> This is already set as a Cloudflare Worker secret. The workflow uses it as `ADMIN_TOKEN` env var to authenticate the caption endpoint call.

---

## Task 6: Frontend — Caption display in strip

**Files:**
- Modify: `index.html`
- Modify: `assets/js/gallery.js`
- Modify: `assets/css/style.css`

### Context

The strip HTML is at line ~136 in `index.html`. The `.wps-info` div contains `.wps-label`, `#wps-title`, `.wps-discount`. `updateWeekPhotoStrip()` starts at line ~198 in `gallery.js`.

- [ ] **Step 1: Add caption elements to index.html**

Find in `index.html`:
```html
          <span class="wps-discount" data-i18n="week.discount">25% הנחה השבוע על כל גדלי הרכישה</span>
        </div>
```

Replace with:
```html
          <span class="wps-discount" data-i18n="week.discount">25% הנחה השבוע על כל גדלי הרכישה</span>
          <span id="wps-caption-short" class="wps-caption-short"></span>
        </div>
```

Then find in `index.html`:
```html
      <div class="wps-expanded" id="wps-expanded">
        <img id="wps-img-lg" class="wps-img-lg" src="" alt="">
```

Replace with:
```html
      <div class="wps-expanded" id="wps-expanded">
        <p id="wps-caption-full" class="wps-caption-full"></p>
        <img id="wps-img-lg" class="wps-img-lg" src="" alt="">
```

- [ ] **Step 2: Update updateWeekPhotoStrip() in gallery.js**

Find (around line 209):
```js
  document.getElementById('wps-title').textContent = weekPhoto.title;
```

Add after it:
```js
  const caption = weekPhoto.week_photo_caption || '';
  const shortEl = document.getElementById('wps-caption-short');
  const fullEl  = document.getElementById('wps-caption-full');
  if (shortEl) shortEl.textContent = caption.length > 80 ? caption.slice(0, 80) + '…' : caption;
  if (fullEl)  fullEl.textContent  = caption;
```

- [ ] **Step 3: Add CSS for caption elements**

Find in `assets/css/style.css`:
```css
.wps-discount { font-size: .8rem; color: var(--text-muted, #888); }
```

Add after:
```css
.wps-caption-short {
  font-size: .78rem; color: var(--text-muted, #999);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 100%; display: block; direction: rtl;
}
.wps-caption-full {
  font-size: .88rem; color: var(--text, #ddd); line-height: 1.6;
  direction: rtl; padding: .75rem 1.25rem .25rem;
  margin: 0; white-space: pre-wrap;
}
```

- [ ] **Step 4: Commit and push**

```bash
git add index.html assets/js/gallery.js assets/css/style.css
git commit -m "feat: display week photo caption in strip — short preview + full on expand"
git push
```

---

## Task 7: End-to-end test

- [ ] **Step 1: Set a photo of the week in admin**

Go to `amitphotos.com/admin` → Photos → תמונת השבוע → הצע → אשר.

- [ ] **Step 2: Verify workflow triggered**

Go to `https://github.com/erezfamily-cmyk/amit-photos/actions` — confirm "פרסום תמונת השבוע לסושיאל" run appeared and completed successfully.

- [ ] **Step 3: Verify caption in DB**

Check API: `https://amitphotos.com/api/photos` — find the week photo, confirm `week_photo_caption` is non-empty.

- [ ] **Step 4: Verify strip shows caption**

Go to `amitphotos.com` — confirm truncated caption appears in the strip main row. Click "הצג תמונה ▼" — confirm full caption appears above the image.

- [ ] **Step 5: Verify social posts**

Check Instagram and Facebook page for the new post with first-person Hebrew caption.
