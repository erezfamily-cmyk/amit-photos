# Amit Photos — Experience-led marketing & UX roadmap
Date: 2026-10-25  
Main task: https://github.com/erezfamily-cmyk/amit-photos/issues/177  
P0: PR #178 merged. P1: PR #179 merged into `main` (commit `c1b8c9c6`); see [updated photo review sheet](experience-photo-selection-review-2026-10-25.md). P1.1: detail-path refresh on branch `feature/experience-details-refresh-2026-10-25` pending separate merge approval.

## Objective
Sell the **experience around an image** before discussing file format, pixel dimensions, or pricing. A natural visitor journey is **Discover → Connect → Imagine → Inquire/Choose**.

Proposed brand promise to validate: **לא רק לראות את העולם. להרגיש אותו.** / *Don't just see the world. Feel it.*

The site remains both an original-art photography portfolio and a learning destination. Keep actual photos, guides, galleries, author credibility, video content, and business licensing discoverable.

## Known starting point (as reviewed on 25 October)
- The homepage Hero previously focused on “תמונות שמדברות אליך” with purchase-led copy; there is already an off-state message for direct enquiries.
- The category presentation was consolidated in `docs/gallery-taxonomy-business-2026-10-02.md`; keep this architecture, all source photos in Drive, and prior curation decisions.
- The homepage already has a wall-preview feature, wishlist, guide capture, photo learning hub, photo analysis and locations.
- Pricing and usage messages remain to audit: some copy suggests commercial rights and “all rights included”, while the separate checkout proposal (#173/#174) considers a personal license only.
- Relevant checkout PRs #155, #157, #173 and #174 remain **separate**. `PAYMENTS_ENABLED=false`, PayPal Live disabled, no Gelato.
- Prior social review warned that raising posting volume could hurt engagement; do not change social schedules in this project.

## P0 — initial experience-first copy (on review branch)
- [x] Update homepage Hero in Hebrew and English using existing i18n keys. Opening: **יש רגעים / שלא רוצים שייגמרו.** / **Some moments / deserve to stay.**
- [x] Offer *גלו את הרגע שלכם* as the gallery action and *ללמוד לראות אחרת* for the existing free-guide popup. Keep their destinations and tracked actions unchanged.
- [x] Make the About introduction personal and approachable, retaining professional proof and awards elsewhere.
- [x] Ensure longer Hero copy wraps in the original responsive design and add a regression test.
- [ ] Run `node --test tests/experience-hero.test.mjs tests/i18n-translation-parity.test.mjs tests/purchase-disabled-ux.test.mjs tests/homepage-hierarchy-redesign.test.mjs tests/ux-analytics-instrumentation.test.mjs`.
- [ ] Visual QA for Hebrew RTL, English LTR, keyboard/focus, narrow iPhone Safari and desktop, LCP and image quality, and the guide popup.
- [ ] Audit remaining visible, SEO-indexed, and disabled-mode purchase messaging; avoid “instant download” or PayPal promises with checkout off, and verify commercial rights claims. Do not revise pricing, checkout, or legal terms in this PR.
- [ ] Request a **separate approval to merge/deploy** when all gates pass.

### P0 actual copy
**Hebrew Hero**
- H1: יש רגעים / שלא רוצים שייגמרו.
- Description: אור שמופיע לרגע, מקום שנשאר בזיכרון, פרט קטן שכמעט פספסנו. בואו לגלות את העולם דרך העיניים שלי.
- Payment-off: הגלריה פתוחה להשראה. התאהבתם בצילום? אפשר לפנות אליי ישירות לבירור רכישה.
- CTA: גלו את הרגע שלכם / ללמוד לראות אחרת

**English Hero**
- H1: Some moments / deserve to stay.
- Description: A fleeting light, a place you remember, a detail you almost missed. Explore the world through my lens.
- Payment-off: Explore the gallery and find your moment. Love a photograph? Contact me directly to ask about purchasing it.
- CTA: Find your moment / Learn to see differently

## P1 implementation checkpoint — 25.10.2026 (draft, not merged)

- Branch: `feature/experience-discovery-paths-2026-10-25`. Phase P0 has already been merged as PR #178.
- Four HE/EN cards between Hero and category filters, with 16 source-catalog candidates from existing photographs (4 per feeling).
- **Security clarification:** cards are rendered only if `/api/photos` returned a non-empty published-image list from the Worker/D1. If the endpoint errors, returns empty, or demo/JSON fallback is used, all four experience cards are hidden, even though the old gallery may still display its fallback. Candidates are then matched by ID only against D1-derived `allPhotos`; fewer than two matches hides a path. No image source is hardcoded in HTML.
- Editorial grouping relies on catalog titles and description. **A visual quality check and owner approval of the specific 16 candidates are still required before merging.** Source resolution is not a visual quality guarantee.
- Selection reuses gallery thumbnails, lightbox, masonry, existing filters and search; standard filters clear an active emotional path. Language switching and #experience-path hash links are supported.
- Anonymous click measurement is limited to `experience_path_click` with allowlisted label and result count; no PII.
- Still blocked by authentic photographer input: 8–12 personal behind-the-frame anecdotes. Do not generate imaginary shooting memories.
- Pending: GitHub CI, mobile Safari/desktop visual QA, two-language text, published-image availability, and **separate approval to merge/deploy**.
- No PayPal, D1, source photo, pricing, Gelato or publishing schedule changes.

## P1.1 — refinements after owner review (25.10.2026)

- The owner reviewed the live experience categories and requested a softer “הקסם שבפרטים” set.
- Replace only the `details` allowlist IDs, preserving its existing 4-photo count and all other three routes:
  1. `1c_MjQDRqBDKXXUs8J2IRYpUtq68hF0d5` — אבקת הפרח הזהובה (retained; old visual review flag remains)
  2. `1T_sZuDJIECAtqscPBtZ1qoi7KECxxmLu` — פרחים ורודים בתקריב (new)
  3. `1qAYmV4wg-5I8isvUTrP1kZnT1leAHkvA` — ורד ורוד עדין (new; distinct from identically titled abstract photo)
  4. `1WZUI8vzx_VBpg6yfXb_mAth6guweU2JH` — עדינות של טבע (new)
- Remove from this route only: עלה תאורה; שבלול זעיר על קצה עלה; כדור פרחוני כחול. **No photo deletion, hide, D1 change or category reassignment.**
- HE route description: **עדינות של הטבע**; EN: **The delicate beauty of nature**. Keep the existing section title.
- Selected from exact catalog title matches and existing photo IDs at source resolutions >=1000 px. The actual publication state continues to be validated through the existing public API/D1 fail-closed route; no new in-code overrides.
- Tests must assert the exact IDs, labels, i18n parity and payment-off state. Visual QA on iPhone/desktop remains a separate requirement.

## P2 idea — four optional experiences, not four new database categories

**Recommendation:** start with four visible emotional paths. If click-through, scroll depth and qualified enquiries indicate demand after a 14–28-day baseline, add a compact **“גלו עוד רגעים / Explore more moments”** affordance that reveals four more paths rather than placing eight equally weighted cards above the gallery. No schema/Drive taxonomy changes.

| Path (HE) | English | Example photographic territory | Distinguishing emotion |
|---|---|---|---|
| כשהאור מספר סיפור | When light tells a story | golden hour, long exposures, backlight, shadows | intrigue / wonder at light |
| מפגשים בטבע | Encounters in the wild | birds, foxes, wildlife portraits | connection / curiosity |
| ערים עם נשמה | Cities with character | architecture, street scenes, local details | discovery / nostalgia |
| עולם של צבעים | A world of color | flower fields, colorful facades, abstract palettes | joy / energy |

**Constraints before P2 build:** review 3–5 publishable photo IDs per path; minimize overlap with “רגעים של התרגשות”/“הקסם שבפרטים”, verify public `/api/photos` and curation decisions, supply localized titles/captions, tag analytics with anonymous allowlisted path IDs only, check mobile 2-column layout, do not expand automatically based solely on provisional technical scores. All further work needs a separate PR/approval.

## P1 — discovery by emotion rather than inventory
- [ ] Add four **reversible navigation paths** over existing published images: רגעים של שקט; רגעים של התרגשות; הקסם שבפרטים; מקומות להתגעגע אליהם.
- [ ] Select 3–5 strong, already-approved real images per path, manually. Do not use AI image scores as emotional labels or expose hidden/unapproved photos.
- [ ] Introduce 8–12 authentic “behind the frame” stories, only with photographer-approved memories/location/date details. No invented anecdotes or metadata.
- [ ] Bring wall-preview and wishlist opportunities closer to the story and provide manual purchase enquiry. Keep images primary and avoid heavy text overlays, layout shifts, or extra loading.
- [ ] Consider a lightweight room-preview framing; do not implement a checkout or Gelato integration as part of this stage.

## P1 — content, social and B2B
- [ ] Position the existing 50-tips guide as “learn to see differently”, with deep links to real tutorials, locations, image analysis and gallery pages.
- [ ] Create an editorial series of 3–5 actual photographs with short stories. Agent 38 may offer a comedic setup, with the real photo as payoff and an annotated landing link.
- [ ] Pitch office/hospitality imagery as atmosphere and brand identity with a **manual** commercial licensing contact path.
- [ ] Respect the 21.10.2026 social-volume audit. Do not increase automated publication frequency until it is measured.

## P1/P2 — measurement & decision
- [ ] Capture pre-launch baseline (GA4 session source/medium, engaged sessions, gallery and photo views, favorites, wall previews, free-guide signup, qualified contact/licensing leads). Validate which events actually exist, including work proposed on the social-business-audit branch.
- [ ] Add only **anonymous** events missing in current instrumentation: `experience_path_click`, `photo_story_open`, `wall_preview_open`, `experience_contact_click`. Never transmit name, email, phone number, free text or secrets.
- [ ] Review after 14–28 days with channel attribution and sample size caveats. Evaluate click-through, viewing depth and qualified enquiries; do **not** misread zero verified sales as zero demand when purchases remain disabled.
- [ ] Iterate on presentation and image choice. Preserve original Drive files and all owner review decisions.

## Safety and handoff
Do not merge, deploy, change D1, enable payment flags/PayPal Live, change prices or legal rules, connect Gelato, publish social posts, or alter Drive photos without separate authorization. Keep all work in a dedicated branch based on `main`. Existing checkout work stays independent. Before approval, confirm page/asset cache busting, HE/EN parity, tests, mobile screenshots and CI. Track progress in Issue #177, TODO.md and the first block of handoff.md.
