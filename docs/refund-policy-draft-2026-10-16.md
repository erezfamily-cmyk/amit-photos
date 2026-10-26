# טיוטה: מדיניות החזרים / Refund Policy Draft (16.10.2026)

> **סטטוס: טיוטה לעריכה בלבד. אינה מסמך משפטי, לא פורסמה, ולא מחוברת לקוד או ל-UI. כל הנוסחים דורשים בדיקה של יועץ משפטי ושל רואה חשבון לפני כל פרסום.**
> **Status: DRAFT for editing only. Not legal advice, not published, not wired into code or UI. Every wording below requires review by a lawyer and an accountant before any publication.**

**אזהרה חשובה / Important warning:** התנאי "אין החזר לאחר הורדה" **עלול שלא להיות ניתן לאכיפה** מול צרכן, בעיקר לפי דיני ביטול עסקה מרחוק והגנת הצרכן בישראל, ולפי דין צרכנות מקומי בארצות אחרות (למשל באיחוד האירופי). אין כאן קביעה משפטית. הבדיקה המשפטית נדרשת **לפני** הפרסום ולפני ה-canary. / The "no refund after download" term may not be enforceable against a consumer, notably under Israeli distance-sale and consumer-protection rules and local consumer law elsewhere (for example the EU). This is not a legal determination. Legal review is required before publication and before the canary.

מקור ההחלטות: `docs/business-and-legal-decisions-2026-10-16.md`.

---

## 1. עברית

### מדיניות החזרים, תמונה דיגיטלית

1. **לפני הורדה.** ניתן לבקש החזר כספי מלא לפני שהורדת את הקובץ. `[להחלטה: תוך כמה ימים מהרכישה]`
2. **אחרי הורדה.** לאחר שהקובץ הורד לא יינתן החזר, למעט שני מקרים: (א) תקלה טכנית שמנעה שימוש בקובץ, ו-(ב) חיוב כפול.
3. **איך מבקשים.** כותבים ל-contact@amitphotos.com עם מספר ההזמנה ועם כתובת האימייל שבה נעשתה הרכישה. אנחנו מאמתים את התשלום מול PayPal.
4. **תקלה בהורדה.** אם ההורדה נכשלה, לא חייבים החזר: יונפק קישור חדש ללא חיוב נוסף, עד שתי הנפקות חוזרות להזמנה (ראו תנאי הרישיון). אם גם אז לא ניתן להשתמש בקובץ, יינתן החזר.
5. **ביצוע ההחזר.** ההחזר מבוצע ידנית לחשבון PayPal ששימש לתשלום. הוא יופיע לפי כללי PayPal והבנק. `[להחלטה: תוך כמה ימי עסקים מאישור הבקשה]`
6. **קישורים שלא נוצלו.** עם ההחזר, קישורי הורדה שטרם נוצלו מתבטלים אוטומטית.
7. **עמלות.** `[להחלטה ולבדיקת רואה חשבון: האם עמלות PayPal מוחזרות, ומי נושא בהן]`
8. **מחלוקת.** אם נפתחה מחלוקת (dispute) ב-PayPal, ההזמנה נבדקת ידנית, ולא יונפק קישור נוסף עד סיום הבדיקה.
9. **זכויות הצרכן.** מדיניות זו אינה פוגעת בזכויות שהדין מקנה לך ושאין להתנות עליהן. `[ניסוח מחייב: בדיקה משפטית]`

---

## 2. English

### Refund Policy, Digital Image

1. **Before download.** You can request a full refund before you download the file. `[TBD: within how many days of purchase]`
2. **After download.** Once the file has been downloaded we do not give a refund, except in two cases: (a) a technical fault that prevented use of the file, and (b) a duplicate charge.
3. **How to request.** Write to contact@amitphotos.com with your order number and the e-mail address used for the purchase. We verify the payment with PayPal.
4. **Download problems.** If the download failed, a refund is not required first: a new link is issued at no extra charge, up to two re-issues per order (see the license terms). If the file still cannot be used, a refund is given.
5. **How a refund is made.** The refund is made manually to the PayPal account used for the payment. It appears according to PayPal and bank rules. `[TBD: within how many business days of approval]`
6. **Unused links.** With the refund, download links that have not been used are cancelled automatically.
7. **Fees.** `[TBD and accountant review: whether PayPal fees are returned, and who bears them]`
8. **Disputes.** If a dispute is opened with PayPal, the order is reviewed manually and no further link is issued until the review ends.
9. **Consumer rights.** This policy does not affect rights that the law gives you and that cannot be waived. `[Binding wording: legal review]`

---

## 3. הערות פנימיות (לא לפרסום)

**מה הקוד עושה היום (נכון ל-commit `b4f97ea1` בענף PR #155):**
- המערכת **אינה מבצעת החזר כספי**. ההחזר נעשה ידנית בחשבון PayPal.
- אחרי החזר מלא או היפוך (chargeback שהושלם), קישורים שטרם נוצלו מתבטלים. קובץ שכבר הורד אי אפשר "לקחת בחזרה".
- החזר חלקי או מחלוקת פתוחה: ההזמנה מסומנת ל-`REVIEW_REQUIRED`, והנפקה חוזרת נחסמת עד החלטה ידנית (`release` או `revoke`).
- הקישור "נתפס" בצורה אטומית בבקשת GET הראשונה. אם ההורדה נקטעת אחרי התפיסה, הקישור אבוד, ורק הנפקה חוזרת ידנית פותרת.

**מה עדיין לא ידוע או לא נבדק (פתוח):**
- האם תצוגת התמיכה מראה במפורש "הקובץ הורד / לא הורד". אין לסמוך על זה לפני בדיקה. בלי זה, אי אפשר ליישם את הכלל "החזר לפני הורדה בלבד" באופן מבוסס-נתונים.
- הערך האמיתי של `settings.prices` ב-D1 של ה-production לא נקרא.
- ההגדרה של "תקלה טכנית" לצורך החזר: `[להחלטה]`.

**דורש בדיקה של רואה חשבון:** הנפקת חשבונית או קבלה, החזר מע"מ, ועמלות PayPal במקרה של החזר.
