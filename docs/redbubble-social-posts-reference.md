# Redbubble Social Posts — מסמך תיעוד ומעקב

עדכון אחרון: 6.7.2026 (השקה ראשונה)

## מה זה

אוטומציה שבועית שמקדמת תמונות עם מוצרי Redbubble (הדפסה על דרישה) ברשתות החברתיות, לקהל יעד אמריקאי — אותה ארכיטקטורה בדיוק כמו [Zazzle](zazzle-social-posts-reference.md), עם `PRODUCT_FIELD` שונה.

## מה מתפרסם, איפה, מתי

| פלטפורמה | תדירות | תוכן |
|----------|--------|------|
| Instagram | 1x/שבוע (יום ראשון) | פוסט אחד, מוצר אקראי אחד מהתמונה המומלצת השבוע |
| Facebook | 1x/שבוע (יום ראשון) | אותו פוסט/מוצר כמו אינסטגרם |
| Threads | 1x/שבוע (יום ראשון) | אותו פוסט/מוצר |
| Pinterest | 1x/שבוע (יום ראשון) | **פין נפרד לכל מוצר** של אותה תמונה, ללוח ייעודי "Redbubble Prints" |

**שפה:** אנגלית בלבד (כמו Zazzle).

**יום שונה מ-Zazzle בכוונה** — עמית ביקש יום אחר בשבוע כדי שהפרסומים לא יתנגשו/יחפפו. Zazzle = רביעי, Redbubble = ראשון.

## איך התמונה נבחרת

מסתובב בין כל התמונות שיש להן מוצרי Redbubble מוגדרים (עמודת `redbubble_products` ב-D1, כרגע כ-10 תמונות). בכל שבוע — תמונה חדשה שעוד לא פורסמה; כשכל התמונות "עברו תור" — מתחיל סבב חדש.

## איך לבדוק שזה עובד

1. **באדמין** — `/admin` → סקציית "פעילות רשתות" (Social Activity) → שורה "🎨 מוצרי Redbubble" בטבלה אחרי כל ריצה
2. **ב-GitHub** — `.github/workflows/redbubble-social-post.yml`, טאב Actions
3. **בפועל ברשתות** — לבדוק שהפוסט/פינים אכן עלו ושהקישורים למוצר עובדים (חנות Redbubble מאומתת כפעילה לגולשים אנונימיים — בניגוד ל-Zazzle שעדיין ב-indexing delay)

## קבצים רלוונטיים

| קובץ | תפקיד |
|------|--------|
| `src/redbubble_social_post.py` | הסקריפט עצמו (עותק מותאם של `zazzle_social_post.py`) |
| `.github/workflows/redbubble-social-post.yml` | ה-cron (יום ראשון, 12:00 UTC) |
| `data/redbubble_social_posted.json` | מעקב אילו תמונות כבר פורסמו (נוצר אוטומטית בריצה הראשונה) |
| `tests/test_redbubble_social_post.py` | 9 טסטים ללוגיקת הבחירה/רוטציה (זהים במבנה לטסטים של Zazzle) |

## הבדלים מ-Zazzle

- `PRODUCT_FIELD = "redbubble_products"` (במקום `zazzle_products`)
- לוח Pinterest נפרד: "Redbubble Prints" (במקום "Zazzle Prints")
- קרון ביום ראשון (במקום רביעי)
- קישור לחנות: `redbubble.com/people/erezphoto/shop`

מומש ישירות בסשן (לא דרך subagent-driven-development מלא) — זו הרחבה מכנית של דפוס שכבר נבדק ואושר במלואו עם Zazzle, בלי שינויי עיצוב.
