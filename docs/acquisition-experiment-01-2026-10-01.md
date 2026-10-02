# Acquisition Experiment 01 — 1.10.2026

> Status: code merged; live verification technically passed; distribution not launched yet.  
> Goal: get a clean first signal with only three distribution paths and without paid traffic.

## Launch gates

Code status:
- PR #79 measurement changes are merged to `main`.
- PR #83 UTM builder is merged to `main`.
- PR #84 Digital Licensing is merged to `main`.
- PR #85 B2B is merged to `main`.

Launch gate status:
- `/free-guide/` live markup includes `guide_request_success`, `generate_lead` and GA bootstrap.
- `/licensing/` live markup includes `licensing_personal_interest`, live prices API and GA bootstrap.
- `/business/` live markup includes `b2b_contact_start`, B2B context and analytics loader.
- Admin UTM builder is present in the live Admin.
- `/api/payments-status` is still `enabled=false`.
- Business Live Verification is the automated receipt for these gates.

The experiment is now **launch-ready technically**. The 7-day measurement window starts only when the first three distribution actions are actually published/sent.

---

## Experiment design

Use only these three paths for the first 7-day window.

### Path A — Free Guide

**Audience:** photography learners / existing social audience  
**Primary goal:** `guide_request_success`  
**Secondary goal:** `generate_lead`

**Instagram / Story URL**

`https://amitphotos.com/free-guide/?utm_source=instagram&utm_medium=social&utm_campaign=202610_freeguide_photo_tips&utm_content=guide_50tips`

**Suggested copy — HE**

> 50 טיפים קטנים שיכולים לשפר את הצילום כבר מהיציאה הבאה. הכנתי מדריך קצר וחינמי להורדה.

**Suggested copy — EN**

> 50 practical photography tips you can use on your next shoot. I put them into a short free guide.

**Do not change during the 7-day test:**
- page copy
- offer
- consent wording
- download asset

---

### Path B — Personal Digital Licensing

**Audience:** people who already engage with the photography  
**Primary goal:** `licensing_personal_interest`  
**Secondary goal:** return to gallery / `purchase_intent`

**Threads / social URL**

`https://amitphotos.com/licensing/?utm_source=threads&utm_medium=social&utm_campaign=202610_licensing_personal&utm_content=personal_file`

**Suggested copy — HE**

> יש תמונה מהגלריה שהיית רוצה לשמור באיכות גבוהה לשימוש אישי? ריכזתי בעמוד אחד מה מקבלים ומה מותר לעשות עם הקובץ.

**Suggested copy — EN**

> Found an image in the gallery you’d like to keep in high resolution for personal use? Here’s a simple explanation of the available digital files and license.

**Important:**
- payments remain off
- no claim that checkout is currently available
- do not change digital prices during the test

---

### Path C — B2B Wall Art

**Audience:** interior designers / offices / clinics / hospitality  
**Primary goal:** `b2b_contact_start`  
**Secondary goal:** `contact_form_success`

**Targeted outreach URL**

`https://amitphotos.com/business/?utm_source=linkedin&utm_medium=social&utm_campaign=202610_b2b_outreach&utm_content=business_wall_art`

If sent directly by WhatsApp instead:

`https://amitphotos.com/business/?utm_source=whatsapp&utm_medium=message&utm_campaign=202610_b2b_outreach&utm_content=business_wall_art`

**Suggested outreach — HE**

> אני בודק בימים אלה שירות חדש של בחירת צילום אמנותי לחללים עסקיים — משרדים, קליניקות, מסעדות ומלונות. הכנתי עמוד קצר שמסביר את הכיוון. אם זה רלוונטי לפרויקט קיים או עתידי, אשמח לשמוע מה היית מחפש לחלל.

**Suggested outreach — EN**

> I’m testing a new curated photography offer for business spaces — offices, clinics, restaurants and hospitality. I put together a short page explaining the idea. If it fits a current or future project, I’d be interested to hear what kind of imagery you would look for.

**Volume:**
- 10–20 targeted contacts maximum
- no mass outreach
- no paid promotion

---

## Measurement sheet

At the end of the 7-day window record:

| Path | Sessions | Engaged | Main intent | Lead/contact | Notes |
|---|---:|---:|---:|---:|---|
| Free Guide | | | guide_request_success | generate_lead | |
| Licensing | | | licensing_personal_interest | purchase_intent assist | |
| B2B | | | b2b_contact_start | contact_form_success | |

Also record:
- Direct share for the week
- source / medium / campaign rows
- landing pages
- mobile vs desktop
- any obvious qualitative feedback

---

## Interpretation rules

### Free Guide
Do not judge only by marketing opt-in. A guide request without marketing consent still proves the asset itself has value.

### Licensing
Because payments are disabled, do not use purchases as the success metric. The useful signals are:
- landing engagement
- personal-license interest
- return to gallery
- purchase intent after viewing licensing

### B2B
One serious inquiry can be more informative than many clicks. Keep a manual note of:
- real reply
- qualified need
- request for quote
- requested number/type of images

No company/contact details go into GA.

---

## Decision after 7 days

Choose only one follow-up:

- **Free Guide strongest:** improve owned-audience funnel and repeat the acquisition test.
- **Licensing strongest:** refine digital-license UX/copy and prepare launch readiness.
- **B2B strongest:** run a second targeted outreach batch and define quote/package workflow.
- **No clear signal:** improve distribution/traffic before building more commerce.

Do not start a fourth monetization feature during this experiment.


## Launch receipt — 2.10.2026

Technical launch gate verified before distribution:
- Free Guide live ✅
- Digital Licensing live ✅
- B2B page live ✅
- Admin UTM builder live ✅
- Production payments still disabled ✅

Distribution remains intentionally manual:
- no paid traffic;
- no automatic social publishing;
- no mass outreach;
- start date is the timestamp of the first actual distribution action, not the code merge date.

Frozen campaign links for the first 7-day window:
- Free Guide / Instagram:
  `https://amitphotos.com/free-guide/?utm_source=instagram&utm_medium=social&utm_campaign=202610_freeguide_photo_tips&utm_content=guide_50tips`
- Personal Licensing / Threads:
  `https://amitphotos.com/licensing/?utm_source=threads&utm_medium=social&utm_campaign=202610_licensing_personal&utm_content=personal_file`
- B2B / LinkedIn:
  `https://amitphotos.com/business/?utm_source=linkedin&utm_medium=social&utm_campaign=202610_b2b_outreach&utm_content=business_wall_art`

Do not change destination, offer, campaign name or primary KPI during the 7-day window.
