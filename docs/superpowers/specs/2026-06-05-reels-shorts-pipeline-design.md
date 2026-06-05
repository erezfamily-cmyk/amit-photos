# Reels & YouTube Shorts Pipeline — Design Spec
_תאריך: 2026-06-05_

## בעיה שנפתרת

Instagram מפרסם כיום תמונות בלבד. תמונות מוצגות רק לעוקבים קיימים (657).
Reels מופצים לדף Discovery — הדרך היחידה להגיע לקהל חדש.
YouTube מפרסם slideshow ארוך (5 דקות) — לא Shorts, לכן לא מקבל reach אורגני.

## גילוי מרכזי

`instagram_story.py` כבר מכיל:
- ✅ יצירת וידאו 9:16 עם Ken Burns (FFmpeg)
- ✅ העלאה ל-catbox.moe/0x0.st (URL ציבורי)
- ✅ פרסום ל-IG Stories דרך Graph API

`reel_post.py` הוא למעשה גרסה פשוטה של `instagram_story.py` שמשתמשת בתשתית הקיימת.

---

## מה בונים

### קבצים חדשים

| קובץ | תפקיד |
|---|---|
| `src/reel_post.py` | בוחר תמונה, מייצר וידאו, מפרסם ל-IG Reel + YouTube Short |
| `.github/workflows/reels-post.yml` | ראשון 08:00 UTC = 11:00 ישראל, 1x/שבוע |
| `data/reels_posted.json` | מעקב מה פורסם (מתחיל ריק: `[]`) |

### לא נוגעים ב

- `instagram_story.py` — קיים ופועל, לא משנים
- `youtube_video.py` — קיים, רק מעתיקים את לוגיקת ה-upload

---

## זרימת reel_post.py

```
1. טוען תמונות מ-API (amitphotos.com/api/photos)
2. מסנן: לא ב-reels_posted.json, לא DSC_
3. בוחר תמונה אקראית
4. מוריד thumbnail מ-R2
5. FFmpeg: 25 שניות, 1080×1920, Ken Burns, טקסט+watermark, מוזיקה
6. מעלה וידאו ל-catbox.moe (public URL)
7. מייצר caption עברי עם Claude (כמו instagram_post.py)
8. פרסום IG Reel: POST /{IG_USER_ID}/media → media_type=REELS
9. פרסום YouTube Short: title=[שם] #Shorts, description=caption
10. שומר ID ל-reels_posted.json + commit
```

---

## הבדל IG Stories → IG Reels

| פרמטר | Stories | **Reels** |
|---|---|---|
| `media_type` | `STORIES` | `REELS` |
| `share_to_feed` | — | `true` |
| `caption` | — | ✅ טקסט + hashtags |
| מוצג ב-Discovery | ❌ | ✅ |

---

## YouTube Short

- אותו YouTube API כמו `youtube_video.py`
- Title: `{photo_title} #Shorts`
- Description: caption + "amitphotos.com"
- 9:16 (1080×1920) → YouTube מזהה אוטומטית כ-Short
- אורך < 60 שניות → חובה להיות Short

---

## Secrets — הכל קיים

| Secret | שימוש |
|---|---|
| `INSTAGRAM_USER_ID` | IG Reels |
| `INSTAGRAM_PAGE_TOKEN` | IG Reels |
| `YOUTUBE_TOKEN_JSON` | YouTube Shorts |
| `AMIT_PHOTO_AGENT` | Claude caption |
| `ADMIN_TOKEN` | amitphotos.com API |

**אין secrets חדשים.**

---

## תזמון

```
ראשון  08:00 UTC   → reel_post.py    (Reel + Short)
ראשון  17:00 UTC   → instagram_post.py  (תמונה רגילה)
```

לא מתנגשים. מגדיל את הנוכחות ביום ראשון בלי להגדיל כמות פוסטים ב-IG feed.

---

## מה לא בגרסה זו

- **TikTok** — דורש אישור app. ניתן להוסיף בהמשך כפונקציה נוספת ב-reel_post.py
- **Facebook Reels** — אפשרי עם `/{PAGE_ID}/video_reels`, נדחה לשלב ב'
- **כיתוב אנגלי** — הרשת בעברית, caption בעברית בלבד בשלב זה

---

## הגדרת הצלחה

- Reel מפורסם ב-IG ומופיע ב-Explore
- Short מפורסם ב-YouTube Shorts feed
- ממוצע views על Reels > ממוצע likes על תמונות (נמדד אחרי 4 שבועות)
