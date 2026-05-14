# 🧩 פאזל הזזה — הגדרות VS Code

## מבנה התיקיות המומלץ

```
sliding-puzzle/
├── .vscode/
│   ├── settings.json
│   ├── extensions.json
│   └── launch.json
├── assets/
│   └── images/          ← תמונות מקומיות (אופציונלי)
├── index.html           ← קובץ המשחק הראשי
├── style.css            ← (אם תרצה לפצל)
├── game.js              ← (אם תרצה לפצל)
└── README.md
```

---

## שלב 1 — התקנת VS Code Extensions

פתח את VS Code ← לחץ `Ctrl+Shift+X` ← חפש והתקן:

| Extension | ID | מה עושה |
|---|---|---|
| **Live Server** | `ritwickdey.LiveServer` | מפעיל שרת מקומי עם רענון אוטומטי |
| **Prettier** | `esbenp.prettier-vscode` | עיצוב קוד אוטומטי |
| **Hebrew Support** | `wix.vscode-import-cost` | תמיכה בעברית |
| **Auto Rename Tag** | `formulahendry.auto-rename-tag` | שינוי תגי HTML אוטומטי |
| **Path Intellisense** | `christian-kohler.path-intellisense` | השלמת נתיבי קבצים |

---

## שלב 2 — קבצי הגדרות VS Code

### 📄 `.vscode/settings.json`
```json
{
  "editor.fontSize": 14,
  "editor.tabSize": 2,
  "editor.wordWrap": "on",
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "liveServer.settings.port": 5500,
  "liveServer.settings.CustomBrowser": "chrome",
  "liveServer.settings.donotShowInfoMsg": true,
  "liveServer.settings.host": "127.0.0.1",
  "files.associations": {
    "*.html": "html"
  },
  "[html]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  }
}
```

### 📄 `.vscode/extensions.json`
```json
{
  "recommendations": [
    "ritwickdey.LiveServer",
    "esbenp.prettier-vscode",
    "formulahendry.auto-rename-tag",
    "christian-kohler.path-intellisense"
  ]
}
```

### 📄 `.vscode/launch.json`
```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "פתח משחק בכרום",
      "type": "chrome",
      "request": "launch",
      "url": "http://127.0.0.1:5500/index.html",
      "webRoot": "${workspaceFolder}",
      "runtimeArgs": [
        "--disable-web-security",
        "--user-data-dir=/tmp/chrome-dev"
      ]
    }
  ]
}
```

> ⚠️ `--disable-web-security` מאפשר טעינת תמונות מאתרים חיצוניים ללא חסימת CORS בסביבת פיתוח בלבד.

---

## שלב 3 — הפעלת המשחק

### אפשרות א׳ — Live Server (מומלץ)
1. פתח את `index.html` ב-VS Code
2. לחץ **Go Live** בשורת התחתית (Status Bar)
3. הדפדפן נפתח אוטומטי בכתובת `http://127.0.0.1:5500`
4. כל שמירה מרעננת את הדפדפן אוטומטית ✅

### אפשרות ב׳ — Debugger
1. לחץ `F5`
2. בחר "פתח משחק בכרום"
3. Chrome נפתח עם DevTools מחובר

---

## שלב 4 — טיפול ב-CORS (תמונות מאתר חיצוני)

אם התמונות לא נטענות מהאתר שלך, יש שתי דרכים:

### דרך 1 — הרצה עם CORS מבוטל (פיתוח בלבד)
כבר מוגדר ב-`launch.json` למעלה.

### דרך 2 — שרת proxy מקומי פשוט
```bash
# התקן פעם אחת
npm install -g http-server

# הפעל בתיקיית הפרויקט
http-server . --cors -p 5500
```
ואז פתח: `http://localhost:5500/index.html`

---

## שלב 5 — קיצורי מקשים שימושיים

| פעולה | קיצור |
|---|---|
| פתח טרמינל | `Ctrl + `` ` |
| שמור קובץ | `Ctrl + S` |
| פורמט קוד | `Shift + Alt + F` |
| פתח DevTools בדפדפן | `F12` |
| חפש בקובץ | `Ctrl + F` |
| חפש בכל הפרויקט | `Ctrl + Shift + F` |

---

## שלב 6 — Debug שגיאות נפוצות

### תמונה לא מוצגת
```
בדפדפן → F12 → Console
לחפש שגיאות: CORS / net::ERR_BLOCKED_BY_RESPONSE
```
פתרון: ראה שלב 4

### Live Server לא עולה
```
בדוק: האם פורט 5500 תפוס?
שנה ב-settings.json → "liveServer.settings.port": 5501
```

### המשחק לא מגיב בנייד
```
חבר את הטלפון לאותה רשת WiFi
פתח: http://[IP של המחשב]:5500/index.html
מצא IP: ipconfig (Windows) / ifconfig (Mac)
```

---

## שלב 7 — שיתוף בוואטסאפ

### אפשרות א׳ — קובץ HTML בודד
שלח את `index.html` ישירות → הנמען פותח בדפדפן

### אפשרות ב׳ — GitHub Pages (חינם)
1. העלה לגיטהאב
2. Settings → Pages → Branch: main
3. קבל קישור: `https://username.github.io/sliding-puzzle`
4. שלח קישור בוואטסאפ ✅

### אפשרות ג׳ — Netlify Drop (הכי מהיר)
1. גרור את תיקיית הפרויקט לאתר: **netlify.com/drop**
2. מקבל URL מיידית
3. שלח בוואטסאפ ✅

---

## סיכום מהיר — התחלה ב-3 צעדים

```bash
# 1. צור תיקייה
mkdir sliding-puzzle && cd sliding-puzzle

# 2. העתק את index.html לתוכה

# 3. פתח ב-VS Code
code .
```

אז לחץ **Go Live** ← ✅ מוכן לפיתוח!
