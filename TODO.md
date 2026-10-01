# TODO — Amit Photos business model

> נוצר: 1.10.2026  
> מטרה: לבנות מודל עסקי מבוסס נתונים לאתר לפני שמעמיקים בהשקעה ב-Gelato או בכל ערוץ מכירה יחיד.

---

## מצב נוכחי

- Production payments נשארים כבויים: `PAYMENTS_ENABLED=false`.
- PayPal Orders API v2 מיושר ברמת תשתית/אבטחה הרבה יותר מבעבר, אבל עדיין לא "סגור לפרודקשן":
  - PR #76 עדיין Draft.
  - Digital Sandbox E2E עבר.
  - Buyer cancel path עבר.
  - Real Sandbox webhook E2E עבר.
  - Production checkout עדיין לא פעיל.
  - Print/Gelato Orders v2 עדיין לא הושלם.
- אין להשתמש ב-0 רכישות כראיה לכך שאין ביקוש, כי התשלומים כבויים בכוונה.
- Gelato הוא ספק fulfillment אפשרי, לא המודל העסקי עצמו.

---

## מה האנליטיקה כבר אומרת

הדוח האחרון השימושי לאחר שינויי UX מכסה 21–28.9.2026:

- 51 sessions
- 27 active users
- 134 page views
- engagement rate: 60.8%
- 53 `photo_view`
- 4 `purchase_intent`
- 1 `add_size`
- 1 `print_intent`
- 2 `photo_contact_click`
- 46/51 sessions הגיעו מ-Direct
- Organic Social תרם 3 sessions בלבד
- `/free-guide/` כבר הופיע בין העמודים הנצפים ביותר
- 0 verified purchases — צפוי, כי התשלומים כבויים

### מסקנות עבודה ראשוניות

1. יש עניין בתמונות עצמן.
2. יש סימני כוונת רכישה, אבל המדגם קטן מדי כדי להכתיר הדפסות כמודל העיקרי.
3. צוואר בקבוק גדול כרגע הוא acquisition: האתר נשען מאוד על Direct.
4. lead capture, newsletter וקישורים ישירים לתמונות חשובים גם לפני פתיחת commerce.
5. צריך לבדוק ביקוש להדפסות, לא להניח שהוא קיים.
6. החלטת מודל עסקי צריכה להיבדק שוב סביב checkpoint של 14 יום (~10.10) ועדיף 28 יום (~24.10).

---

# מודלים עסקיים לבדיקה

## A. Fine-art prints

### היפותזה
מבקר שמתאהב בתמונה מסוימת עשוי לשלם על מוצר פיזי אם ההצעה מרגישה פרימיום ומאוצרת, לא כמו קטלוג הדפסה גנרי.

### וריאציות
- open edition
- limited numbered editions
- signed / certificate of authenticity
- monthly collection של 3–5 תמונות
- pre-order drop במקום חנות תמיד-פתוחה
- tier פרימיום ממוסגר בהמשך

### KPI
- `print_intent / photo_view`
- בחירת סוג מוצר
- בחירת גודל
- checkout start
- completed purchase
- gross margin per SKU
- refunds/cancellations
- delivery/support incidents

### Gelato
לא להעמיק אינטגרציה לפני שבודקים:
- quality
- margin
- packaging
- delivery reliability
- geographic coverage
- support/cancellation
- API reliability

---

## B. Digital downloads / licensing

### היפותזה
מוצר דיגיטלי עשוי להמיר טוב יותר בגלל שאין משלוח, עלויות fulfillment נמוכות יותר ו-margin גבוה.

### מוצרים
- personal-use download
- high-resolution print-at-home
- social/web commercial license
- editorial license
- small-business / office license

### KPI
- digital purchase intent
- size/license selection
- completed purchase
- refund/support rate
- revenue per visitor
- repeat buyer rate

### TODO
- [ ] להפריד "גודל קובץ" מ-"סוג רישיון".
- [ ] לנסח Personal / Commercial policy.
- [ ] להגדיר deliverables ברורים לכל tier.
- [ ] לבדוק האם המחירים הנוכחיים תואמים לערך הנתפס.

---

## C. Curated drops / pre-orders

### היפותזה
קולקציה קטנה ומוגבלת בזמן עשויה לעבוד טוב יותר מחנות של אלפי תמונות.

### ניסוי
- 3–5 תמונות בלבד
- סיפור קצר לכל תמונה
- deadline ברור
- pre-order / reservation
- CTA אחד
- בלי לייצר מלאי מראש

### KPI
- collection landing views
- email signups
- reservation intent
- conversion per image
- average order value

### יתרון
אפשר לבדוק ביקוש לפני התחייבות עמוקה ל-Gelato.

---

## D. B2B licensing / offices / hospitality

### היפותזה
עסקה בודדת מול משרד, קליניקה, מלון, מסעדה או מעצב פנים יכולה להיות שווה יותר מהרבה מכירות B2C קטנות.

### מוצרים
- סט תמונות לחלל
- license + print package
- digital display license
- customized Israel / nature / travel collections

### TODO
- [ ] ליצור page/CTA ייעודי ל-"אמנות לחללים ועסקים".
- [ ] להגדיר inquiry form קצר.
- [ ] להכין 3 חבילות לדוגמה.
- [ ] למדוד `b2b_intent` ו-`contact_form_success`.

---

## E. Education products

האתר כבר כולל /camera/, /learn/, locations ו-free guide.

### מוצרים אפשריים
- mini course
- paid PDF
- presets
- composition checklist
- field guide
- location pack / map
- critique / review session

### KPI
- camera content sessions
- free-guide conversion
- email subscriber growth
- content_link_click
- paid education interest

### TODO
- [ ] לבדוק איזה מדריכים מושכים הכי הרבה traffic.
- [ ] לזהות 3 נושאים עם engagement חזק.
- [ ] לבנות MVP דיגיטלי קטן לפני קורס גדול.

---

## F. Services / commissions

### אפשרויות
- photo critique
- private lesson
- photo walk
- lecture/workshop
- commissioned wall-art selection

### KPI
- contact intent
- qualified lead
- closed deal
- lead value

### TODO
- [ ] לבדוק האם יש מספיק ביקוש מפניות קיימות.
- [ ] לא להעמיס שירותים בדף הבית לפני שיש ראיה.

---

## G. Newsletter / collector club

### היפותזה
רשימת תפוצה איכותית יכולה להפוך לערוץ owned acquisition ולהקטין תלות ב-Direct/social algorithms.

### MVP
- monthly image story
- early access to drops
- collector-only offer
- behind-the-scenes
- optional paid tier רק לאחר שיש audience

### KPI
- `generate_lead / sessions`
- free-guide signup rate
- open/click rate
- return visits
- revenue attributed to email

---

# סדר ניסויים מומלץ

## Phase 1 — עכשיו, בלי לפתוח תשלומים

- [ ] לשמור `PAYMENTS_ENABLED=false`.
- [ ] להמשיך למדוד post-redesign baseline.
- [ ] להשלים photo-strength pipeline PR #77 רק לאחר review; לא לבצע auto-ranking.
- [ ] לשפר mapping בין social post ל-photo_id.
- [ ] לבדוק free-guide → subscriber funnel.
- [ ] למדוד direct-to-photo traffic.
- [ ] להוסיף business-model events רק אם חסרים, בלי PII.
- [ ] לבחור 10–20 תמונות candidate למסלול print test על בסיס data + editorial review.

## Phase 2 — checkpoint 14 יום (~10.10.2026)

לבדוק:
- hero_gallery_click / sessions
- photo_view / sessions
- purchase_intent / photo_view
- print_intent / photo_view
- photo_contact_click
- contact_form_success
- generate_lead
- mobile vs desktop
- landing pages
- source/medium
- strongest photos/collections

החלטה:
- אם print intent מתחזק → להכין curated print/pre-order test.
- אם digital intent חזק יותר → להעדיף digital/licensing.
- אם contact/B2B חזק → לבנות B2B page/package.
- אם free-guide/education חזק → לפתח education funnel.
- אם acquisition נשאר חלש → לא להשקיע עדיין בעוד checkout; לעבוד על distribution/SEO/social/direct links.

## Phase 3 — checkpoint 28 יום (~24.10.2026)

- [ ] לבחור 1 primary monetization model.
- [ ] לבחור 1 secondary model.
- [ ] להקפיא 2–3 מודלים חלשים במקום לפתח הכול.
- [ ] להגדיר יעד revenue/lead ל-90 יום.
- [ ] לקבוע האם Gelato נשאר, מוחלף, או משמש רק ב-pre-order/limited collection.

---

# Gelato decision framework

Gelato נשאר מועמד אם:
- print intent קיים בפועל.
- margin נטו סביר אחרי production/shipping/PayPal/support.
- quality עומדת ברמת Fine Art.
- delivery אמין בשווקים החשובים.
- support/cancellation recoverable.
- API/webhook flow יציב.

Gelato לא צריך להיות priority אם:
- כמעט אין print intent.
- digital/license/lead funnels חזקים יותר.
- acquisition עדיין קטן מדי.
- margin נמוך מדי.
- המותג דורש מוצר פרימיום ש-Gelato לא מספק מספיק טוב.

---

# VS Code / Claude Code Skills — מדיניות בטוחה

## מה כבר קיים
- repo-local skill: `.claude/skills/add-camera-guide/SKILL.md`.

## המלצה
לא להתקין כרגע חבילת third-party skills/marketplace אקראית. עבור הפרויקט הזה עדיף skills מקומיים בתוך הריפו, כי הם:
- version-controlled
- ניתנים ל-review
- עוברים עם הפרויקט לכל מחשב
- לא דורשים הרשאות חיצוניות בפני עצמם
- קלים לביטול/שינוי

## Skills שכדאי ליצור בהמשך

### 1. paypal-sandbox-safety
מטרות:
- לוודא staging בלבד
- לוודא production kill switch
- לוודא no live credentials
- checklist לפני migration/E2E
- לעצור לפני destructive action / merge / enablement

### 2. d1-migration-guard
מטרות:
- verify target DB
- backup/bookmark first
- additive migration preference
- schema verification
- never run destructive SQL without explicit approval

### 3. business-model-review
מטרות:
- לקרוא GA reports + D1 funnel + photo-strength report
- להשוות מול business hypotheses
- להוציא weekly/monthly decision memo
- לא להמציא conclusions כש-sample קטן

### 4. safe-release-check
מטרות:
- git status
- changed-files scope
- tests
- security review
- production flags
- deploy/rollback checklist

## מה לא צריך להתקין
- security skill צד-שלישי רק כדי לבצע code security review — Claude Code כבר כולל `/security-review`.
- skill שמריץ shell/hooks אוטומטית בלי review.
- MCP/plugin שמקבל secrets, filesystem רחב או write access בלי צורך ברור.
- marketplace package שלא בדקנו את המקור ואת הקבצים שלו.

## כלל אבטחה
Skill שמכיל רק Markdown instructions הוא בסיכון נמוך יחסית. אם skill כולל scripts, hooks, MCP או commands:
1. לקרוא את כל הקוד לפני התקנה.
2. לבדוק permissions.
3. לא לאפשר secret exfiltration/network calls לא מוכרים.
4. לא לתת auto-approve ל-Bash/write/deploy.
5. להעדיף project-local על global.

---

# קבצים קשורים

- `handoff.md`
- `docs/analytics-driven-ux-plan-2026-09-26.md`
- `docs/pre-commerce-readiness-2026-10-01.md`
- `docs/paypal-sandbox-staging-2026-10-01.md`
- `docs/paypal-orders-v2-migration-2026-09-30.md`
- `data/ga_reports.json`
- `data/photo_strength_report.json` (PR #77 / advisory pipeline)
- `.claude/skills/add-camera-guide/SKILL.md`

---

## כלל עבודה

לא בונים feature מסחרי גדול רק כי הוא אפשרי טכנית. קודם:
**measure → hypothesis → smallest test → compare → decide → build.**


---

# Business Model Review #1 — 1.10.2026

## נתונים ששימשו

מקורות:
- `data/ga_reports.json` — דוח 21–28.9.2026.
- `docs/analytics-driven-ux-plan-2026-09-26.md`.
- `docs/pre-commerce-readiness-2026-10-01.md`.
- `data/photo_strength_report.json` מענף PR #77 — כרגע `waiting_for_mapped_data`, ולכן אין עדיין דירוג תמונות אמין.

### תמונת מצב מספרית
- 51 sessions
- 27 active users
- 134 page views
- 60.8% engagement rate
- 53 photo views
- 4 digital purchase intents
- 1 size selection
- 1 print intent
- 2 photo contact clicks
- 10 page views ל-`/free-guide/`
- 6 page views ל-`/learn/`
- 46/51 sessions מסווגים Direct
- 45 sessions מישראל
- 30 desktop / 22 mobile
- verified revenue = 0, כאשר payments disabled

## מה כן אפשר להסיק

### 1. יש product interest, אבל עדיין אין הוכחת willingness-to-pay
`purchase_intent=4` ו-`print_intent=1` מוכיחים שיש לפחות מעט משתמשים שחיפשו מסלול רכישה. זה מספיק כדי להצדיק ניסויים, לא מספיק כדי לבנות חנות פיזית מלאה.

### 2. הבעיה העסקית הראשונה היא לא fulfillment אלא acquisition + conversion
רוב התנועה היא Direct, ורק 3 sessions סווגו Organic Social. לפני השקעה עמוקה ב-Gelato צריך לדעת להביא יותר משתמשים מזוהים ולשמר אותם.

### 3. ל-free guide יש signal חיובי
10 page views בשבוע שבו היו 134 page views בסך הכול הופכים אותו לנכס שראוי לחבר למסלול lead capture מסודר.

### 4. content/education קיים, אבל אין עדיין מספיק signal למוצר לימודי בתשלום
`/learn/` קיבל 6 צפיות. זה מעניין, אבל לא מצדיק כרגע בניית קורס או membership.

### 5. photo-strength עדיין לא מוכן להחלטות merchandising
PR #77 מחזיר כרגע `waiting_for_mapped_data`; לכן אסור לבחור “best sellers” אוטומטית או לשנות סדר גלריה לפי score שעדיין לא קיים.

---

## סדר עדיפות עסקי ראשון

### Priority 1 — Owned audience / lead capture
זה אינו revenue model בפני עצמו, אבל הוא התשתית לכל המודלים האחרים.

למה ראשון:
- acquisition עדיין חלש ולא מזוהה.
- free guide כבר מקבל תנועה.
- payments עדיין כבויים.
- מאפשר לא לאבד מבקרים בתקופת ההמתנה.

### Priority 2 — Digital downloads + licensing
זה המוצר העסקי הראשון שכדאי להכין לניסוי אמיתי.

למה:
- כבר יש 4 `purchase_intent` לעומת 1 `print_intent`.
- אין fulfillment פיזי.
- margin גבוה יותר.
- PayPal Orders v2 digital Sandbox כבר עבר E2E.
- קל יותר לבדוק pricing ו-license tiers לפני שמוסיפים מורכבות תפעולית.

החלטה:
- לא לפתוח production עדיין.
- כן להכין product definition, licensing, pricing experiment ו-copy.

### Priority 3 — Curated print drop / pre-order
לא לבנות עדיין “חנות Gelato מלאה”.

ניסוי מומלץ:
- 3–5 תמונות.
- edition / collection מוגדרת.
- intent או reservation לפני production.
- בדיקת price sensitivity.
- רק אם יש signal: להשלים Gelato Print Orders v2.

### Priority 4 — B2B outbound test
לא צריך לבנות מערכת חדשה כדי לבדוק את ההיפותזה.

MVP:
- דף/one-pager פשוט או PDF/landing בעתיד.
- 10–20 פניות ממוקדות למעצבי פנים / קליניקות / משרדים / hospitality.
- למדוד replies ו-qualified leads.

### Hold — education paid product
להמשיך למדוד את התוכן הקיים; לא לבנות קורס עדיין.

---

# Sprint 1 — לפני checkpoint של 14 יום

## A. Lead funnel audit
- [ ] לאמת ש-`generate_lead` נורה אחרי הרשמה מוצלחת ב-free guide וב-newsletter.
- [ ] למדוד `free_guide_view -> generate_lead`.
- [ ] לבדוק כמה subscribers חדשים נוספו מאז 26.9 ללא חשיפת PII.
- [ ] לוודא source/UTM על קישורי social.
- [ ] להוסיף attribution בסיסי ל-newsletter signups אם חסר.

## B. Digital product definition
- [ ] להחליט 2–3 license tiers בלבד ל-MVP.
- [ ] להגדיר מה מקבלים בכל tier.
- [ ] להגדיר מחיר test, לא מחיר “סופי”.
- [ ] לנסח HE/EN קצר וברור.
- [ ] לבדוק legal copy מול התנאים הקיימים.
- [ ] לא לשנות `PAYMENTS_ENABLED`.

## C. Print demand validation
- [ ] לא להשלים עדיין full Gelato checkout.
- [ ] להגדיר 3–5 candidate prints.
- [ ] לחכות ל-photo-strength data או לבצע editorial shortlist ידני + לתעד שהוא ידני.
- [ ] לתכנן event ל-`print_reservation_intent` או waitlist, בלי חיוב.
- [ ] לא לבחור supplier סופי לפני margin/quality test.

## D. Acquisition
- [ ] כל פוסט social חדש יוביל ל-photo/collection/free-guide URL ספציפי עם UTM.
- [ ] לא להפנות כברירת מחדל לדף הבית.
- [ ] למדוד sessions לפי campaign.
- [ ] לבדוק אם Direct יורד כש-attribution משתפר.

---

## Decision rules ל-10.10.2026

לא להחליט לפי מספר מוחלט בודד. לבדוק מגמה + denominator.

### Digital
אם `purchase_intent / photo_view` נשאר משמעותית גבוה מ-`print_intent / photo_view` ויש יותר מקרים אמיתיים לאורך התקופה:
→ להמשיך להכנת digital/licensing launch.

### Print
אם `print_intent` גדל ויש repeat interest בכמה תמונות:
→ לבצע curated print reservation test, ורק אחריו להעמיק Gelato.

### Lead
אם free-guide signup rate טוב:
→ newsletter הופך לערוץ owned מרכזי ומקבל השקעה לפני paid commerce.

### Acquisition
אם Direct עדיין >70% גם אחרי UTM discipline:
→ priority עובר ל-distribution/SEO/social deep links לפני פיתוח commerce נוסף.

---

## מה לא עושים בספרינט הזה

- לא מפעילים production payments.
- לא ממזגים אוטומטית PR #76.
- לא בונים full Gelato store.
- לא בונים cart מורכב.
- לא בונים paid course.
- לא משנים את סדר הגלריה לפי photo-strength לפני שיש mapped data.
- לא מוסיפים הרבה CTAs מתחרים לדף הבית.
