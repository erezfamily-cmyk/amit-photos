# CSP Report-Only rollout — 25.9.2026

## מה השתנה

`_headers` עכשיו כולל:
- `Strict-Transport-Security: max-age=31536000; includeSubDomains` — **אוכף**, לא Report-Only. HSTS אין לו מצב דיווח-בלבד; הוספתו בטוחה כי האתר כבר מוגש רק ב-HTTPS דרך Cloudflare.
- `Content-Security-Policy-Report-Only` — **לא אוכף כלום**. הדפדפן רק מדפיס אזהרת console על כל דבר שהיה נחסם אילו זו הייתה CSP אוכפת. אין `report-uri`/`report-to` מוגדר (לא הוקמה תשתית איסוף) — כרגע הדרך היחידה לראות הפרות היא לדפדף באתר עם DevTools פתוח (Console tab) ולבדוק אזהרות `[Report Only]`.

זה חל רק על עמודים שמוגשים דרך `env.ASSETS.fetch` (הבית, camera/*, learn/*, index.html וכו'). עמודי SSR (locations/{slug}/, /prices, /category/*, /free-guide/ — נבנים ב-`handleLocationSpotPage`/`handleCategoryPage` וכו' ב-worker.js) **לא** עוברים דרך `_headers` בכלל — יש להם כבר CSP **אוכפת** משלהם דרך `SEC_HEADERS`/`htmlRes()` ב-worker.js, שלא נגעתי בה (היא כבר בפרודקשן וללא תלונות ידועות).

## ניסוי: הסרת `unsafe-eval`

חיפשתי `eval(` ו-`new Function(` בכל `assets/js/*.js` ובכל קובצי `*.html` — **אפס תוצאות**. ה-CSP האוכפת הקיימת (`SEC_HEADERS` ב-worker.js) עדיין כוללת `unsafe-eval` ב-script-src, אבל ה-Report-Only החדשה **לא** כוללת אותו בכוונה, כדי לבדוק אם אפשר להסיר אותו לגמרי. אם אחרי כמה ימים לא מופיעה אף הפרת `unsafe-eval` ב-console אצל אף אחד — אפשר להסיר אותו גם מ-`SEC_HEADERS` וגם מהגרסה האוכפת העתידית.

## דומיינים חדשים ב-connect-src

נמצאו דרך `grep` על `fetch(` בכל קובצי ה-HTML/JS הצד-לקוח (לא כולל worker.js/Python — אלה server-side ולא כפופים ל-CSP של הדף):
- `https://api.web3forms.com` — שליחת טופס יצירת קשר (`assets/js/gallery.js`)
- `https://raw.githubusercontent.com` — סטטיסטיקות סושיאל שנטענות ב-`index.html`/`admin.html`

שאר הדומיינים ב-CSP (GA, GTM, Cloudflare Insights, fonts, open-meteo, sunrise-sunset, PayPal, OpenStreetMap) כבר היו ב-`SEC_HEADERS` הקיימת והועתקו כמו שהם.

**לא נכללו בכוונה:** facebook.com, instagram.com, pinterest.com, twitter.com/x.com, youtube.com, tiktok.com, threads.com, redbubble.com, zazzle.com, whatsapp — כל אלה מופיעים רק כ-`<a href>` (קישורי שיתוף/ניווט), לא כמשאבים שהדף טוען, ולכן לא רלוונטיים ל-CSP בכלל.

## מלאי inline scripts/handlers — מה יידרש כדי להסיר `unsafe-inline`

מדגם (לא סריקה מלאה של כל 24+ עמודי camera/ + learn/ + locations/ — יש 28 קבצי `index.html` בשלוש התיקיות האלה בלבד):

| קובץ | inline `<script>` | `on*=` attributes |
|------|---|---|
| `index.html` | 4 | 7 (6× onclick, 1× onload) |
| `camera/exposure/index.html` | 1 | 0 |
| `camera/night/index.html` | 1 | 0 |
| `learn/index.html` | 1 | 0 |
| `locations/index.html` | 1 | 1 |

כל עמוד עצמאי (per CLAUDE.md: "`/camera/` — כל אחד קובץ HTML עצמאי") נשען על `<script>` מוטבע לפחות אחד. הסרת `unsafe-inline` תדרוש אחת מהשתיים על כל קובץ (מוערך: עשרות קבצים):
1. **nonce**: כל תגובת HTML צריכה nonce אקראי חדש שמוזרק גם ל-CSP header וגם לכל תג `<script>`/`style`/`on*=` — לא ישים לעמודים סטטיים שמוגשים כ-asset קבוע (nonce צריך CSP דינמי לכל בקשה, כלומר SSR לכל עמוד, שינוי ארכיטקטוני).
2. **hash-based** (`'sha256-...'`): אפשרי לעמודים סטטיים — hash קבוע per inline block, אבל צריך לחשב ולעדכן בכל שינוי לקוד ה-inline (שברירי, קל לשכוח בעדכון).
3. **refactor**: להוציא את כל ה-inline scripts לקבצי `.js` חיצוניים ואת ה-`on*=` handlers ל-`addEventListener` — הכי נקי לטווח ארוך, אבל נפח עבודה משמעותי על פני כל האתר.

**המלצה:** לא לגעת בזה עכשיו. Report-Only כבר נותן ראות על כל בעיה אחרת (domains חסרים וכו') בלי לגעת ב-`unsafe-inline`; הסרתו היא פרויקט נפרד.

## Checklist לפני מעבר ל-CSP אוכפת (לא בוצע במסגרת ביקורת זו)

- [ ] לדפדף בכל סוגי העמודים (בית, גלריה/lightbox, buy/print modal, camera/*, learn/*, locations/*, admin) עם DevTools פתוח, לאסוף כל אזהרת `[Report Only]`
- [ ] לוודא ש-GA, PayPal (redirect + frame-src), Cloudflare Insights, מפות (OpenStreetMap iframe), תמונות R2/Drive ממשיכות לעבוד
- [ ] להחליט אם `unsafe-eval` באמת מיותר (בהתבסס על נתוני ה-Report-Only בפועל, לא רק על ה-grep הזה)
- [ ] להחליט על אחת משלוש הגישות ל-`unsafe-inline` (nonce / hash / refactor) אם ורק אם רוצים להסיר אותו — אפשר גם להישאר עם CSP אוכפת שכוללת `unsafe-inline` (עדיין חוסמת `object-src`, `frame-ancestors`, ודומיינים לא-רשומים, שזה כבר שיפור אמיתי מול המצב היום שבו אין CSP בכלל בדף הבית)
