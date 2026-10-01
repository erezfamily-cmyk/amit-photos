# TODO — Amit Photos business model

> נוצר: 1.10.2026  
> מטרה: לבנות מודל עסקי מבוסס נתונים לאתר לפני שמעמיקים בהשקעה ב-Gelato או בכל ערוץ מכירה יחיד.

---


## סטטוס ביצוע עדכני — 1.10.2026

זהו מקור האמת להמשך העבודה. הסעיפים ההיסטוריים בהמשך המסמך נשמרים כהקשר, אבל במקרה של סתירה הסטטוס כאן גובר.

- [x] PR #79 — Lead funnel measurement — מוזג ל-`main`.
- [x] PR #83 — Admin UTM Campaign Link Builder — מוזג ל-`main`.
- [x] PR #84 — Digital Licensing MVP — מוזג ל-`main`.
- [x] PR #85 — B2B Art & Licensing MVP — מוזג ל-`main`.
- [x] PR #80/#81/#82 הישנים נסגרו והוחלפו ב-#84/#85/#83.
- [ ] Live verification של `/licensing/`, `/business/`, Admin UTM builder ואירועי GA.
- [ ] לאחר live verification: להתחיל Acquisition Experiment 01 למשך 7 ימים.
- [ ] בסוף 7 ימים: לבחור follow-up עסקי אחד בלבד לפי הנתונים.
- [ ] checkpoint רחב יותר סביב 10.10, ואז 24.10 אם עדיין אין sample מספיק.
- [ ] PR #76 PayPal Orders v2 נשאר נפרד; אין להפעיל Production payments במסגרת הניסוי.
- [x] `PAYMENTS_ENABLED=false` נשאר guardrail מחייב.
- [ ] Gelato נשאר בהמתנה עד שיש print-demand signal + בדיקת margin/quality.

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
- [x] ליצור page/CTA ייעודי ל-"אמנות לחללים ועסקים" — `/business/`.
- [x] לחבר למסלול inquiry הקיים עם context קצר-חיים.
- [x] להכין 3 חבילות לדוגמה.
- [x] להוסיף `b2b_intent`, `b2b_package_select`, `b2b_contact_start` ו-attribution ל-`contact_form_success`.
- [ ] לבצע live verification לפני outreach.

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
- [x] להגדיר `generate_lead` רק ל-marketing lead אמיתי; guide delivery נמדד בנפרד.
- [ ] למדוד `free_guide_view -> generate_lead`.
- [ ] לבדוק כמה subscribers חדשים נוספו מאז 26.9 ללא חשיפת PII.
- [x] להגדיר UTM standard + Admin UTM builder; live discipline מתחיל עם הניסוי.
- [x] attribution לפי source הוגדר לכל מקורות ההרשמה הפעילים.

## B. Digital product definition
- [x] MVP דיגיטלי הוגדר כ-Personal use עם small/medium/large; Commercial נשאר inquiry/quote.
- [ ] להגדיר מה מקבלים בכל tier.
- [ ] להגדיר מחיר test, לא מחיר “סופי”.
- [x] נוסף עמוד `/licensing/` דו-לשוני.
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


---

# Business KPI Scorecard v1

מטרת ה-scorecard היא להכריע בין מודלים עסקיים בלי לתת לנתון יחיד או למדגם קטן להוביל את ההחלטה.

## Acquisition

| KPI | נוסחה / מקור | למה חשוב |
|---|---|---|
| Identified traffic share | sessions עם source/medium מזוהה / sessions | בודק אם אנחנו עדיין "עיוורים" בגלל Direct |
| Organic Social share | organic social sessions / sessions | מודד אם תוכן חברתי מביא קהל אמיתי |
| Organic Search share | organic search sessions / sessions | מודד בסיס SEO ולא רק שיתופים |
| Deep-link share | sessions שנוחתים על photo/content/free-guide ולא רק home / sessions | בודק איכות distribution |
| UTM coverage | קמפיינים עם UTM / קמפיינים ששיתפנו | תנאי למדידה אמינה |

## Audience / Lead

| KPI | נוסחה | פירוש |
|---|---|---|
| Guide request rate | guide_request_success / free-guide sessions | כמה מבקרים באמת מבקשים את המדריך |
| Lead rate | generate_lead / sessions | כמה מהתנועה הופכת לקהל שאפשר לחזור אליו |
| Marketing opt-in rate | marketing opt-in / new subscribers | איכות lead מבחינת owned audience |
| Source contribution | new subscribers לפי source | איזה placement מייצר volume |
| Source quality | marketing opt-in לפי source / new subscribers לפי source | איזה placement מייצר audience איכותי |
| Repeat/upgrade rate | marketing_upgraded / existing successful submissions | האם נכסים חינמיים משדרגים קשר קיים |

### כלל פרשנות
- `guide_request_success` אינו שווה ל-`generate_lead`.
- בקשת PDF בלי marketing consent היא הצלחת lead magnet, אבל לא הרשמה שיווקית.
- `generate_lead` צריך לשקף רק subscriber חדש או upgrade אמיתי להסכמה.

## Digital commerce

| KPI | נוסחה |
|---|---|
| Digital intent rate | purchase_intent / photo_view |
| Product-selection rate | add_size / purchase_intent |
| Checkout completion | verified digital purchases / checkout starts — רק כשהתשלומים יופעלו |
| Revenue per qualified visit | verified digital revenue / photo-detail or product sessions |
| License mix | purchases לפי Personal / Commercial tier |

## Print commerce

| KPI | נוסחה |
|---|---|
| Print intent rate | print_intent / photo_view |
| Print selection rate | print_type_selected / print_intent |
| Print checkout rate | print_checkout / print_type_selected |
| Reservation rate | print_reservation_intent / curated collection sessions |
| Gross margin | sell price - production - shipping - fees - support/refund allowance |
| Supplier failure rate | failed/cancelled/delayed orders / orders |

## B2B

| KPI | מדידה |
|---|---|
| B2B landing interest | b2b_intent / B2B page sessions |
| Qualified lead rate | qualified B2B inquiries / inquiries |
| Reply rate | replies / targeted outreach |
| Proposal rate | proposals / qualified leads |
| Close rate | won deals / proposals |
| Average deal value | revenue / won B2B deals |

## Education

| KPI | מדידה |
|---|---|
| Content engagement | engaged sessions בעמודי camera/learn |
| Free-guide assist | sessions שקראו תוכן ואז הגיעו ל-free-guide |
| Education intent | click/interest event למוצר לימודי עתידי |
| Email-assisted return | חוזרים דרך newsletter לתוכן לימודי |

---

# Guardrails נגד החלטות מוקדמות

לא להכריז על "ערוץ מנצח" רק כי יש לו 1–5 המרות.

לפני השוואת conversion בין מקורות:
- להמתין לפחות 14 יום מהמדידה התקינה.
- לדרוש denominator ברור.
- עדיף לפחות 20 successful submissions לכל source לפני השוואה כמותית; מתחת לזה לסמן directional בלבד.
- אם אין מספיק volume גם אחרי 28 יום — ההחלטה היא קודם להגדיל acquisition, לא לבצע אופטימיזציה זעירה של conversion.
- לא להשתמש ב-0 purchases כל עוד `PAYMENTS_ENABLED=false`.
- לא להסיק מסקנות על Gelato מ-`print_intent` בלבד; יש להוסיף margin + quality + delivery test.

---

# Decision table — checkpoint 14 יום

## אם free-guide מייצר הרבה guide requests אבל מעט marketing opt-in
פעולה:
- לא להסיר את המדריך.
- לשפר את הערך/נוסח של opt-in השיווקי.
- לבדוק follow-up לא שיווקי סביב delivery בלבד.
- לא לסמן את ה-lead magnet ככישלון.

## אם homepage newsletter מייצר opt-in גבוה יותר מה-free-guide
פעולה:
- להשאיר newsletter CTA ברור.
- לבחון האם ה-free guide צריך לשמש acquisition ולא subscription.
- להשוות quality לאורך זמן, לא רק signup count.

## אם popup מייצר מעט leads או opt-in נמוך
פעולה:
- לשקול להקטין/להסיר popup כדי לא לפגוע UX.
- לא לבצע זאת לפני denominator מספיק.

## אם subpage strip עובד טוב
פעולה:
- להרחיב placement בסוף תוכן איכותי.
- לחבר topic/context ל-CTA במקום נוסח כללי.

## אם newsletter_issue מייצר leads
פעולה:
- להפוך כל גיליון גם לנכס acquisition ציבורי.
- למדוד שיתוף → issue view → generate_lead.

---

# Decision table — מודל הכנסה

### Signal חזק יותר לדיגיטל
אם לאורך תקופה מספקת:
- `purchase_intent / photo_view` גבוה מ-`print_intent / photo_view`
- ויש המשך ל-`add_size`
→ להכין Digital/License MVP ראשון.

### Signal חזק יותר להדפס
אם:
- `print_intent` גדל
- יש interest חוזר במספר מצומצם של תמונות
- curated reservation test מקבל תגובה
→ להשלים Print Orders v2 + supplier validation.

### Signal חזק יותר ל-B2B
אם:
- contact intent / direct inquiries גדלים
- outreach test מקבל replies/qualified leads
→ להשקיע בדף B2B וחבילות, לפני storefront מורכב.

### Signal חזק יותר ל-Education
אם:
- camera/learn traffic גדל
- free-guide assist חזק
- newsletter clicks חוזרים לתוכן לימודי
→ לבנות paid micro-product לפני קורס גדול.

---

# מה צריך להיות בדוח העסקי השבועי

1. Acquisition לפי source/medium.
2. Landing pages.
3. `guide_request_success` ו-`generate_lead`.
4. D1 aggregate: new subscribers + marketing opt-in לפי source.
5. Digital intent funnel.
6. Print intent funnel.
7. Contact/B2B signals.
8. verified revenue בלבד, בנפרד מאירועי GA.
9. הערת sample size מפורשת.
10. החלטה אחת בלבד לשבוע הבא — לא רשימת שינויים גדולה.



---

# Acquisition Sprint — 1.10.2026

מסמך עבודה: `docs/acquisition-playbook-2026-10-01.md`

## הושלם
- [x] הוגדר UTM standard קבוע ל-source / medium / campaign / content.
- [x] הוגדר כלל deep-link: לא שולחים homepage כשיש יעד מדויק יותר.
- [x] הוגדר ניסוי attribution ראשון ל-7 ימים.
- [x] הוגדרו ניסויי follow-up ל-free guide, licensing ו-B2B.
- [x] הדוח השבועי ב-PR #79 הורחב ל-source / medium / campaign.
- [x] הדוח השבועי מכיר גם אירועי licensing ו-B2B החדשים.

## מצב נוכחי
- [x] PR #79 מוזג לאחר QA/CI.
- [x] UTM builder מוזג דרך PR #83.
- [x] Digital Licensing מוזג דרך PR #84.
- [x] B2B מוזג דרך PR #85.
- [ ] לבצע live verification של העמודים/אירועים לאחר deploy.
- [ ] להתחיל 7 ימים של UTM discipline רק לאחר live verification.
- [ ] בסוף 7 ימים לבדוק האם Direct share יורד והאם campaign מזוהה מביא פעולה עסקית.

## כלל
לא מתחילים paid ads בשלב הזה. קודם מוכיחים attribution ו-organic distribution.


---

# Acquisition Experiment 01 — prepared

מסמך: `docs/acquisition-experiment-01-2026-10-01.md`

## שלושת המסלולים הראשונים
- [x] Free Guide — Instagram/social.
- [x] Personal Digital Licensing — Threads/social.
- [x] B2B Wall Art — targeted LinkedIn/WhatsApp outreach.
- [x] לכל מסלול הוגדרו URL עם UTM, copy, KPI ראשי ומשני.
- [x] הוגדר חלון ניסוי של 7 ימים.
- [x] הוגדרו כללי פירוש כדי לא להסיק מסקנות שגויות בזמן שהתשלומים כבויים.

## Launch gates
- [x] מדידת PR #79 מוזגה ל-`main`.
- [x] Digital Licensing מוזג דרך PR #84.
- [x] B2B מוזג דרך PR #85.
- [x] UTM builder מוזג דרך PR #83.
- [ ] לאמת live שה-deploy והאירועים עובדים לפני התחלת חלון ה-7 ימים.

## כלל
במהלך 7 ימי הניסוי לא משנים pricing, hero, checkout או offer. בסוף בוחרים follow-up אחד בלבד.
