# Acquisition Playbook — Amit Photos

> נוצר: 1.10.2026  
> מטרה: להפחית תלות ב-Direct, למדוד הפצה בצורה אמינה, ולגלות איזה תוכן/הצעה באמת מביאים קהל איכותי.

## עיקרון

לא שולחים יותר קישורים כלליים לדף הבית כשיש יעד מדויק יותר.

כל שיתוף צריך להוביל לאחד מאלה:
- תמונה ספציפית
- קולקציה/קטגוריה
- `/free-guide/`
- `/licensing/`
- `/business/`
- מדריך צילום ספציפי

## UTM standard

### utm_source
מקור אמיתי:
- `instagram`
- `facebook`
- `threads`
- `tiktok`
- `youtube`
- `newsletter`
- `whatsapp`
- `partner`

### utm_medium
סוג הערוץ:
- `social`
- `email`
- `message`
- `referral`

### utm_campaign
שם קצר שמייצג את הניסוי/המטרה.

פורמט:
`YYYYMM_<goal>_<theme>`

דוגמאות:
- `202610_freeguide_photo_tips`
- `202610_licensing_personal`
- `202610_b2b_wall_art`
- `202610_photo_jerusalem`

### utm_content
הקריאייטיב או היעד הספציפי:
- `photo_<photo_id>`
- `story_1`
- `reel_1`
- `carousel_1`
- `business_wall_art`
- `licensing_personal`

## דוגמאות

Instagram post לתמונה:
`/?photo=<id>&utm_source=instagram&utm_medium=social&utm_campaign=202610_photo_jerusalem&utm_content=photo_<id>`

Free guide:
`/free-guide/?utm_source=instagram&utm_medium=social&utm_campaign=202610_freeguide_photo_tips&utm_content=story_1`

Digital licensing:
`/licensing/?utm_source=threads&utm_medium=social&utm_campaign=202610_licensing_personal&utm_content=post_1`

B2B wall art:
`/business/?utm_source=linkedin&utm_medium=social&utm_campaign=202610_b2b_wall_art&utm_content=business_wall_art`

> אם משתמשים ב-LinkedIn בהמשך, מוסיפים `linkedin` ל-`utm_source`; אין צורך לשנות קוד.

## Experiment 1 — Attribution cleanup

משך: 7 ימים לאחר שהמדידה החדשה זמינה.

כלל:
- כל פוסט/סטורי/הודעה יזומה חדשה מקבלת UTM.
- לא משנים במקביל hero, pricing או checkout.
- יעד ברירת מחדל אינו homepage; בוחרים deep link.

מדדים:
- Direct share
- Organic Social sessions
- source / medium / campaign
- landing page
- photo_view
- generate_lead
- guide_request_success
- licensing events
- B2B events

הצלחה אינה "יותר טראפיק" בלבד.

הצלחה = לפחות אחד:
- ירידה ב-Direct בגלל attribution טוב יותר
- campaign שמביא engaged sessions
- campaign שמביא lead / licensing / B2B intent
- deep-link שמביא photo views איכותיים יותר מה-homepage

## Experiment 2 — Free guide acquisition

שני creative בלבד:
- creative A: "50 טיפים"
- creative B: "מדריך לצלם המתחיל"

אותו יעד ואותו offer.

שונים רק `utm_content`:
- `guide_50tips`
- `guide_beginner`

לא משנים copy בעמוד עצמו באותו שבוע.

## Experiment 3 — Digital licensing

רק אחרי review/merge של עמוד licensing.

שתי זוויות:
- "תמונה לשימוש אישי"
- "קובץ איכותי להדפסה אישית"

מדדים:
- landing sessions
- scroll depth
- `licensing_personal_interest`
- מעבר לגלריה
- purchase_intent לאחר שהמשתמש חוזר לתמונה

## Experiment 4 — B2B

לא מתחילים בפרסום רחב.

שלב ראשון:
- 10–20 פניות ממוקדות בלבד
- מעצבי פנים / משרדים / קליניקות / hospitality
- deep link ל-`/business/`
- campaign אחיד `202610_b2b_outreach`
- `utm_content` לפי package

מדדים:
- business landing session
- `b2b_package_select`
- `b2b_contact_start`
- `contact_form_success`
- reply / qualified lead ידני

## שבוע ראשון — מה לא לעשות

- לא להתחיל paid ads.
- לא לקנות טראפיק.
- לא לפתוח 5 ערוצי social חדשים.
- לא לשנות מחירים תוך כדי attribution experiment.
- לא לפרסם homepage link כשאפשר deep link.
- לא להסיק מסקנה לפי 1–2 sessions.

## Weekly decision

הדוח השבועי צריך לענות על 4 שאלות:
1. מאיפה הגיעו אנשים?
2. לאיזה עמוד הם נחתו?
3. מה הם עשו?
4. איזה source/campaign יצר את הפעולה העסקית הכי קרובה להכנסה?

ואז לבחור שינוי אחד בלבד לשבוע הבא.


## Implementation status — 1.10.2026

- Lead/campaign measurement is merged via PR #79.
- Admin UTM builder is merged via PR #83.
- Digital Licensing page is merged via PR #84.
- B2B page/funnel is merged via PR #85.
- Next gate is live verification, then start the 7-day experiment.
- Production payments remain disabled.
