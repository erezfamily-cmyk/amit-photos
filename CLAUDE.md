# עמית פוטוס — Photography Portfolio

## סקירה
אתר פורטפוליו צילום עברי, רספונסיבי ומודרני עבור צלם ישראלי.
מציג תמונות מחולקות לקטגוריות, עמוד אודות, ועמוד צור קשר.

## טכנולוגיה
- HTML5 / CSS3 / Vanilla JS — ללא frameworks
- Google Fonts: Syne (כותרות) + Heebo (עברית)
- אחסון: GitHub Pages (חינם)

## מקור תמונות
התמונות מגיעות מ-Google Photos דרך API או מ-`data/photos.json`.

### מבנה data/photos.json
```json
[
  {
    "id": "unique-id",
    "title": "כותרת התמונה",
    "category": "טבע | פורטרט | עירוני | אירועים",
    "url": "URL לתמונה מלאה",
    "thumbnail": "URL לתמונה מוקטנת",
    "description": "תיאור קצר"
  }
]
```

## קבצים מרכזיים
- `index.html` — עמוד ראשי (גלריה + אודות + צור קשר)
- `assets/css/style.css` — עיצוב מלא
- `assets/js/gallery.js` — לוגיקה: גלריה, פילטרים, לייטבוקס, טופס
- `data/photos.json` — נתוני תמונות
- `src/fetch_photos.py` — סקריפט לשליפה מ-Google Photos

## הרצה מקומית
```bash
# פתח את index.html ישירות בדפדפן, או:
python -m http.server 8000
# ואז: http://localhost:8000
```

## הוספת תמונות
1. הוסף רשומה ל-`data/photos.json`
2. או הרץ `python src/fetch_photos.py` לשליפה מ-Google Photos

## קטגוריות קיימות
טבע, פורטרט, עירוני, אירועים
(ניתן להוסיף כל קטגוריה ב-photos.json — הפילטרים מתעדכנים אוטומטית)

## שפה
ממשק בעברית מלאה, RTL.

## GitHub Pages
פרוס מ-branch `main`, תיקייה root.
URL: `https://<username>.github.io/amit-photos/`
