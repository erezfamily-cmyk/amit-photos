# Week Photo Social Auto-Post — Design Spec

> Created: 2026-04-20

---

## Goal

When the admin confirms a Photo of the Week, Claude Vision automatically generates a first-person Hebrew caption describing the photo and how it was shot. The caption is saved to the DB, displayed in the website strip, and posted to Instagram and Facebook immediately.

---

## Architecture

```
Admin clicks "אשר"
    ↓
POST /api/admin/photo-of-week/set
    → saves photo_of_week_id to settings
    → triggers week-photo-social.yml via GitHub API (fire-and-forget)
    → returns 200 immediately (workflow runs async)

week-photo-social.yml
    → src/week_photo_social.py
        → fetch photo details from GET /api/photos
        → download image bytes
        → Claude Vision: generate first-person Hebrew caption
        → POST /api/admin/photo-of-week/caption  (saves to settings)
        → post to Instagram (feed post + hashtags)
        → post to Facebook (page post)
```

---

## Components

### 1. worker.js — `handlePhotoOfWeekSet`

**Change:** after saving `photo_of_week_id`, trigger the new GitHub Actions workflow:

```js
await triggerGitHubWorkflow(env, 'week-photo-social.yml', { photo_id });
```

Uses the existing `triggerGitHubWorkflow` helper (already used elsewhere in worker.js).

---

### 2. worker.js — new endpoint `handlePhotoOfWeekCaption`

`POST /api/admin/photo-of-week/caption`  
Body: `{ caption: string }`  
Auth: admin session required

Saves `photo_of_week_caption` to settings table:
```sql
INSERT OR REPLACE INTO settings (key, value) VALUES ('photo_of_week_caption', ?)
```

Also: `handlePhotoOfWeekClear` must delete `photo_of_week_caption` alongside `photo_of_week_id`.

---

### 3. worker.js — `handlePhotos` (GET /api/photos)

Add `week_photo_caption` to the week photo object:

```js
const captionRow = await env.DB.prepare("SELECT value FROM settings WHERE key='photo_of_week_caption'").first();
// on the week photo:
week_photo_caption: weekPhotoId && p.id === weekPhotoId ? (captionRow?.value || '') : '',
```

---

### 4. src/week_photo_social.py (new file)

```
1. GET https://amitphotos.com/api/photos → find is_week_photo photo
2. Download image (R2 URL or proxy)
3. Claude Vision (claude-sonnet-4-5 or haiku):
   Prompt: analyze the photo, write first-person Hebrew caption
   - What was photographed, the scene, the mood
   - How it was shot (light, timing, technique — inferred from visual)
   - Warm, personal, authentic tone
   - ~120-150 words for Instagram, ~80-100 words for Facebook
4. POST /api/admin/photo-of-week/caption with ADMIN_TOKEN header
5. Post to Instagram (Graph API — same pattern as instagram_post.py)
6. Post to Facebook (Graph API — same pattern as facebook_post.py)
7. No posted.json tracking needed (week photo is a special one-off post)
```

**Claude prompt template:**
```
אתה עמית, צלם ישראלי. נתח את התמונה וכתוב פוסט בגוף ראשון בעברית.
כתוב מה צילמת, מה הרגשת, ואיך צילמת אותה (אור, רגע, טכניקה).
סגנון: אישי, חם, אמיתי. אורך: {length} מילים בערך.
אל תתחיל ב"אני" — תתחיל ישירות מהסצנה.
```

---

### 5. .github/workflows/week-photo-social.yml (new file)

```yaml
on:
  workflow_dispatch:
    inputs:
      photo_id:
        description: 'Photo ID'
        required: false

jobs:
  post:
    runs-on: ubuntu-latest
    steps:
      - checkout
      - setup python 3.11
      - pip install requests anthropic
      - run: python src/week_photo_social.py
    env:
      INSTAGRAM_USER_ID, INSTAGRAM_PAGE_TOKEN,
      FACEBOOK_PAGE_ID, FACEBOOK_PAGE_TOKEN,
      ANTHROPIC_API_KEY: ${{ secrets.AMIT_PHOTO_AGENT }}
      ADMIN_TOKEN: ${{ secrets.ADMIN_TOKEN }}
```

---

### 6. Frontend — index.html + gallery.js + style.css

**Strip main row:** show `week_photo_caption` truncated at 80 chars + "..." if longer.

**Expanded area:** show full caption above the large image.

**gallery.js — `updateWeekPhotoStrip`:**
```js
const caption = weekPhoto.week_photo_caption || '';
const short = caption.length > 80 ? caption.slice(0, 80) + '…' : caption;
document.getElementById('wps-caption-short').textContent = short;
document.getElementById('wps-caption-full').textContent = caption;
```

**index.html strip HTML additions:**
```html
<!-- in wps-info, after wps-discount -->
<span id="wps-caption-short" class="wps-caption-short"></span>

<!-- in wps-expanded, above wps-img-lg -->
<p id="wps-caption-full" class="wps-caption-full"></p>
```

**CSS:**
- `.wps-caption-short`: small muted text, single line, overflow ellipsis
- `.wps-caption-full`: readable text, RTL, padding, shown only when expanded

---

## Error Handling

- Workflow failure does NOT block the admin "אשר" action — the photo of the week is set regardless
- If caption is empty (workflow failed), strip shows without caption text — same UX as today
- Social posting failures are logged in GitHub Actions — no retry needed (admin can re-trigger manually)

---

## Secrets Required

- `ADMIN_TOKEN` — new secret needed in GitHub Actions + Cloudflare Worker (for the caption endpoint auth)

OR reuse the existing pattern: the workflow calls the caption endpoint with a shared secret header.

---

## Out of Scope

- Editing the caption after generation
- Separate caption lengths per platform (both use the same caption; Instagram gets hashtags appended)
- Stories (handled by existing Instagram Story workflow separately)
