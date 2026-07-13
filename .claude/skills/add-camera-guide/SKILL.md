---
name: add-camera-guide
description: Use when adding a new interactive tutorial page under /camera/ on amitphotos.com — covers the 3 places that must be registered so the new guide shows up in the hub, sitemap, and social auto-posting rotation.
---

24+ מדריכים אינטראקטיביים תחת `/camera/`, כל אחד קובץ HTML עצמאי (ללא תלויות חיצוניות מעבר לפונטים/nav.js/share.js), בדוגמת `camera/exposure/index.html`.

**כשמוסיפים מדריך /camera/ חדש — 3 מקומות רישום:**

| קובץ | מה מוסיפים |
|------|------------|
| `camera/index.html` | כרטיס hub (card-icon/title/desc/cta) |
| `worker.js` — `staticPages` array | שורת sitemap (`loc`/`priority`/`changefreq`) — דורש `npx wrangler deploy` |
| `src/camera_edu_post.py` — `EDUCATION_PAGES` | ערך לרוטציית פרסום אוטומטי לרשתות (key/url/title/emoji/best_categories/angle/hook) |

**TODO ידוע:** ברשומות ישנות ב-`EDUCATION_PAGES`, חלק מערכי `best_categories` (למשל "עירוני", "טבע", "פורטרט") לא קיימים כקטגוריות אמיתיות ב-`photos.json` (הקטגוריות האמיתיות הן שמות מקומות/מדינות). יש fallback לכל מאגר התמונות כשאין התאמה — עובד, אבל בלי טירגוט. שווה ניקוי מרוכז.
