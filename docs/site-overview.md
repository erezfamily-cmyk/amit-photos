# amitphotos.com — סקירה מלאה של האתר

> עודכן: 2026-05-17

---

## 🌐 טכנולוגיה

| רכיב | פתרון |
|---|---|
| Hosting | Cloudflare Worker + Assets |
| Database | Cloudflare D1 (SQLite) |
| Storage | Cloudflare R2 (תמונות) |
| Frontend | HTML5 / CSS3 / Vanilla JS |
| שפות | Python 3 (GitHub Actions) |
| AI | Claude Sonnet 4.6 — כיתובים, ניתוח תמונות, העשרת תוכן |
| תשלומים | PayPal (הורדות דיגיטליות) |
| הדפסות | Gelato API |
| מיילים | Resend |
| Domain | amitphotos.com |

---

## 📄 מפת עמודים

### עמוד ראשי
- `/` — גלריה ראשית, hero, אודות, חנות, צור קשר

### בית ספר לצילום `/camera/`
| עמוד | נושא |
|---|---|
| `/camera/` | מדריך כניסה — 16 נושאים |
| `/camera/exposure/` | משולש החשיפה (ISO, צמצם, תריס) |
| `/camera/composition/` | קומפוזיציה — חוק השליש, קווים מובילים |
| `/camera/lenses/` | עדשות — מרחק מוקד, בוקה, Wide vs Tele |
| `/camera/depth-of-field/` | עומק שדה + סימולטור אינטראקטיבי |
| `/camera/light/` | אור וצבע — Golden Hour, טמפרטורת צבע |
| `/camera/white-balance/` | איזון לבן + סליידר Kelvin |
| `/camera/histogram/` | קריאת היסטוגרמה |
| `/camera/dynamic-range/` | טווח דינמי — חיישן מול עין |
| `/camera/filters/` | פילטרים — ND, CPL, GND, UV |
| `/camera/macro/` | צילום מאקרו — יחס הגדלה, ציוד |
| `/camera/sports/` | ספורט ותנועה — burst, AI tracking |
| `/camera/editing/` | עריכה — RAW, Lightroom, Capture One |
| `/camera/types/` | סוגי מצלמות — Full Frame vs APS-C |
| `/camera/software/` | תוכנות וארגון |
| `/camera/visual-language/` | שפה צילומית אישית |
| `/camera/controls/` | כפתורי מצלמה — מ-Auto ל-Manual |

### מקומות לצילום `/locations/`
| עמוד | תוכן |
|---|---|
| `/locations/` | רשימת 13 מקומות עם כרטיסיות ומפה (Leaflet) |
| `/locations/spot/?slug=...` | עמוד מקום בודד: גלריה, מתי לבוא, ציוד מומלץ, מקומות קרובים |

**15 מקומות פורסמים:**
מצדה, ים המלח, העיר העתיקה ירושלים, מערות בית גוברין, פארק אוטופיה, שמורת החולה, מסגד שייח' זאיד (אבו דאבי), הדולומיטים (איטליה), ספארי טנזניה, מנזרי מטאורה (יוון), כנרת, הר חרמון, גנים בהאי (חיפה), טוסה דה מאר (ספרד), אנדורה

### ניתוח תמונות `/learn/`
| עמוד | תוכן |
|---|---|
| `/learn/` | רשת כל הניתוחים שנוצרו |
| `/learn/{photoId}/` | ניתוח מלא: שכבת הגדרות מצלמה, הסברי קומפוזיציה, דיאגרמות פיזיקה (DOF/בוקה), עריכת annotation |

### משחקים `/games/`
| עמוד | תוכן |
|---|---|
| `/games/` | דף ניווט לשני המשחקים |
| `/puzzle/` | פאזל הזזה — 3×3 ו-4×4, טיימר, שיתוף WhatsApp |
| `/quiz/` | "מאיפה הצילום?" — 10 שאלות, 15 שניות לשאלה, 20% הנחה ל-6+ נכון |

### מבצע `/sale/`
- 50 תמונות במבצע שבועי, countdown timer, החלפה אוטומטית ב-workflow

### עמודים נוספים
- `/privacy/` — מדיניות פרטיות דו-לשונית (עברית + אנגלית)

---

## 📱 עמוד ראשי — תכונות מפורטות

### גלריה
- פילטרים היררכיים: קטגוריות + "מקומות בעולם" עם תת-קטגוריות
- חיפוש חופשי לפי שם
- Infinite scroll (100 ראשונות + טעינה בגלילה)
- **סדר:** תמונות עם `sort_order` ראשון → שאר אקראי (מתחלף כל שבוע)
- **Lightbox:** ניווט חצים/מקלדת, תמונות קשורות, שיתוף WA/FB, "הוסף לסל", "ראה על הקיר", EXIF, progress bar
- **רמז מחיר בלייטבוקס:** כפתור "רכישה" מציג "החל מ-₪19" — המחיר בפועל של התמונה
- הגנת תמונות: בלוק קליק ימני, גרירה, Ctrl+S
- SEO: alt text עברי אוטומטי

### Explore Strip — "ללמוד, לגלות, ליצור"

- סקשן חדש בדף הבית, בין פרסים לפלטפורמות
- 3 כרטיסיות: 📷 למד לצלם → /camera/, 🔍 ניתוח תמונות → /learn/, 📍 מקומות לצילום → /locations/
- דו-לשוני מלא (HE/EN)

### תמונת השבוע ⭐
- סטריפ מעל הגלריה עם badge ⭐ על הכרטיס
- 25% הנחה (ניתן לשינוי) על הורדה דיגיטלית
- כפתור "הצג תמונה" — מורחב עם wall mockup + רכישה
- ממשק דו-לשוני

### חנות הדפסות
- 3 סוגי מוצר: פוסטר / קנבס / מתכת (Gelato)
- Crop tool + בדיקת רזולוציה
- תשלום PayPal, מייל אישור, webhook סטטוס

### ניוזלטר
- הרשמה מהעמוד הראשי
- מייל ברוכים הבאים אוטומטי
- ביטול הרשמה בכל מייל

---

## 🔧 ניהול — admin.html

### לוח בקרה
- מונים: נרשמים / פניות / תמונות / סטטוס מהיר

### תמונות
- עריכת כותרת / קטגוריה / תיאור
- published toggle, מחיקה (כולל R2)
- העלאה drag & drop → R2 + D1
- יצירת כותרת עברית עם Claude
- מחיר מיוחד לתמונה בודדת
- סימון "חדש" (badge)
- **Bulk:** קטגוריה / מחיר / מחיקה על כמה תמונות בבת אחת
- **Drag & Drop לסדר ידני** — sort_order

### תמונת השבוע ⭐
- הצע אוטומטית / אשר / הצע שוב / נקה
- שינוי discount ו-caption

### מקומות לצילום
- רשימת כל המקומות עם פרסום/הסרה
- עריכה מלאה: כל שדות + when_to_visit (JSON) + recommended_gear (JSON)
- העשרה מחדש עם Claude
- ניהול תמונות לכל מקום (gallery photo מ-D1 / exclusive upload)

### ניתוח תמונות
- עורך split-pane: טקסט מצד ימין, תצוגה מיידית משמאל
- עריכת annotations ויזואליות

### נרשמים לניוזלטר
- רשימה עם תאריך + שם

### לקוחות ופניות
- שינוי סטטוס (ממתין / טופל / סגור)
- כפתור "השב" → Gmail מוכן
- צפייה בפנייה מלאה

### סטטיסטיקות

- **KPI cards:** צפיות השבוע + Δ% לעומת שבוע קודם, מדינה מובילה, דף פופולרי ביותר
- גרף page views 30 יום + פירוט מדינות
- **Top Pages chart:** גרף אופקי של כל סוגי הדפים מתוך `analytics_pages` (בית, תמונה, מקום, מצלמה, משחקים, מבצע, ניתוח)
- **פאנל המרה:** לכל תמונה — צפיות, כוונת רכישה, **% כוונה**, רכישות, הכנסה, % המרה

### ניוזלטר
- עריכה + תצוגה מקדימה + שליחה לכל הנרשמים

### רכישות
- הכנסה כוללת + פירוט לפי גודל
- גרף 30 יום + 5 הכי נמכרות

### הזמנות הדפסה
- טבלה מלאה + רענון סטטוס מ-Gelato + החזר PayPal

---

## 🤖 אוטומציות (GitHub Actions)

### פרסום תמונות לרשתות
| Workflow | תדירות | פלטפורמות |
|---|---|---|
| `instagram-post.yml` | א/ד/ו בשעה 20:00 | Instagram |
| `instagram-story.yml` | מתוזמן | Instagram Stories |
| `facebook-post.yml` | ג/ו בשעה 20:00 | Facebook |
| `pinterest-post.yml` | יומי | Pinterest (3 תמונות) |
| `threads-post.yml` | מתוזמן | Threads |

### פרסום תוכן מיוחד
| Workflow | תדירות | מה עושה |
|---|---|---|
| `camera-edu-post.yml` | ב/ה בשעה 12:00 | מקדם דף לימוד לכל 4 רשתות (גוף ראשון, נגיש למתחילים) |
| `location-social-post.yml` | כל 3 ימים 20:00 | מפרסם מקום לצילום ל-4 רשתות (round-robin, 13 מקומות) |
| `week-photo-social.yml` | שבועי | תמונת השבוע ל-4 רשתות |
| `puzzle-social-post.yml` | שבועי | פרומו לפאזל |
| `quiz-social-post.yml` | דו-שבועי | פרומו לקוויז |
| `learn-generate.yml` | מתוזמן | יצירת ניתוח תמונה חדש עם Claude |

### תחזוקה ותשתית
| Workflow | תדירות | מה עושה |
|---|---|---|
| `update-photos.yml` | יומי | סנכרון תמונות חדשות |
| `weekly-sale-rotation.yml` | שבועי | החלפת 50 תמונות במבצע |
| `weekly-report.yml` | שבועי | דוח אנליטיקה שבועי |
| `scan-dimensions.yml` | מתוזמן | סריקת ממדי תמונות |
| `token-refresh.yml` | מתוזמן | חידוש טוקני Pinterest/Meta |
| `deploy.yml` | ידני/trigger | Deploy Worker לפרודקשן |
| `migrate-to-r2.yml` | ידני | מיגרציה מ-Google Drive ל-R2 |
| `fill-descriptions.yml` | ידני | מילוי תיאורים חסרים עם Claude |

**גוף ראשון בכל הפוסטים:** כל הפוסטים נכתבים בגוף ראשון של עמית ("צילמתי", "בחרתי", "גיליתי"). מונחים טכניים מוסברים בסוגריים. ללא שאלות בסוף.

**Anti-repeat:** כל פלטפורמה שומרת `data/*_posted.json` עם IDs שפורסמו.

---

## 🗄️ מסד נתונים (D1)

| טבלה | תוכן |
|---|---|
| `photos` | כל התמונות — כולל `sort_order`, `price_overrides`, `is_new`, `on_sale`, `quiz_eligible` |
| `photo_analyses` | ניתוחי קומפוזיציה שנוצרו ע"י Claude — composition_rule, annotations, camera_json |
| `locations` | 13 מקומות — title, region, coordinates, when_to_visit, recommended_gear |
| `location_photos` | תמונות לכל מקום — type (gallery/exclusive), url, thumbnail, sort_order |
| `subscribers` | נרשמים לניוזלטר |
| `customers` | פניות + לקוחות |
| `print_orders` | הזמנות הדפסה מ-Gelato |
| `download_tokens` | טוקני הורדה דיגיטלית |
| `analytics` | page views יומיים |
| `analytics_countries` | פירוט לפי מדינה |
| `analytics_pages` | page views יומיים לפי סוג דף (home/photo/learn/location/camera/games/sale) |
| `sessions` | session tokens לאדמין |
| `login_attempts` | הגנה מפני brute force |
| `settings` | הגדרות מערכת: מחירים, photo_of_week, discount |
| `reset_tokens` | איפוס סיסמה |

---

## 🔌 API — נקודות קצה עיקריות

**Auth:** `/api/login`, `/api/logout`, `/api/forgot-password`, `/api/reset-password`

**תמונות:** `/api/photos`, `/api/upload`, `/api/photos/reorder`, `/api/fill-titles`, `/api/generate-alt`

**ניתוחים:** `/api/analyses`, `/api/analyses/{photoId}` (GET/PUT), `/api/analyses/generate`, `/api/analyses/publish-all`

**מקומות:** `/api/locations`, `/api/locations/{slug}`, `/api/locations/suggest`
Admin: `/api/admin/locations` (GET/POST/PUT/DELETE), `/api/admin/locations/{slug}/photos`

**תמונת שבוע:** `/api/admin/photo-of-week/suggest`, `/api/admin/photo-of-week/set`, `/api/admin/photo-of-week/clear`, `/api/admin/photo-of-week/caption`

**מבצע:** `/api/sale/rotate`, `/api/sale-photos`

**רכישות:** `/api/verify-payment`, `/api/download/{token}`, `/api/purchases`

**הדפסות:** `/api/print/catalog`, `/api/print/quote`, `/api/print/upload-crop`, `/api/print/order-complete`, `/api/print/webhook`, `/api/print/refresh-status`, `/api/print/orders`

**לקוחות:** `/api/customers`, `/api/subscribers`, `/api/reply`, `/api/newsletter`, `/api/unsubscribe`

**אנליטיקס:** `/api/analytics` — מחזיר `daily`, `countries`, `pages` (top pages), `weekTotal`, `prevWeekTotal`

**תשתית:** `/api/proxy-image`, `/api/trigger-workflow`

---

## 💡 מה נשאר לשפר

### עדיפות גבוהה

**1. חידוש טוקן אינסטגרם — יוני 2026**
הטוקן פג בסביבות יוני 2026. חייבים לחדש ידנית לפי הנחיות ב-`memory/reference_instagram_config.md`.

**2. ממשק קנייה — Buy Modal Wizard**
הממשק הנוכחי (לחיצה → PayPal ישיר) מפחיד משתמשים. עוצב מוקאפ של wizard 2 שלבים:
- שלב 1: בחירת רזולוציה
- שלב 2: אישור + PayPal
מוקאפ קיים ב-`.superpowers/brainstorm/`. ממתין לאישור סופי ויישום.

### עדיפות בינונית

**3. היסטוריית שליחות ניוזלטר**
אין כרגע רישום של מיילים ששלחנו — לא ידוע מתי נשלח האחרון ומה כלל.

**4. עמוד סטטוס הזמנה ללקוח**
לקוח שהזמין הדפסה מקבל רק מייל. אין `/order/{id}` שבו הלקוח יכול לראות סטטוס עדכני.

**5. המלצות לקוחות — ניהול מהאדמין**
הציטוטים בסקשן "לקוחות ממליצים" hardcoded ב-HTML. כדאי לנהל מהאדמין.

### עדיפות נמוכה / עתיד

**6. שיווק**
רעיונות ממתינים: Reels, Google Business, בלוג, שיתוף עסקים, ניוזלטר חודשי.

---

## 📋 שינויים אחרונים — 2026-05-17

- ✅ מקומות חדשים: טוסה דה מאר (ספרד), אנדורה — כולל תוכן אנגלי
- ✅ תיקון קריסת Worker בעמודי מקומות עם שדות JSON לא תקינים (`safeJson` helper)
- ✅ ממשק עריכת ניתוח תמונה — תמיכה מלאה בעברית + אנגלית (כפתור 🌍, EN✓ indicator, שדות עריכה)
- ✅ אנליטיקס משודרג: מעקב לפי סוג דף, KPI cards שבועיים, גרף Top Pages, עמודת % כוונה
- ✅ רמז מחיר בלייטבוקס ("החל מ-₪19" על כפתור הרכישה)
- ✅ מחירי USD בסקשן מחירים (מוצג בלשונית אנגלית)
- ✅ Explore Strip בדף הבית — לינקים ל-camera/learn/locations
- ✅ קופסת הנחה עם ספירה לאחור 30 דקות בסוף הקוויז (למנצחים)
