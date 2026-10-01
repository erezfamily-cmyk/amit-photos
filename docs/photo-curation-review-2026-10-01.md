# Professional Photo Curation Review — 1.10.2026

## Purpose

The catalog should be curated as a professional portfolio and commercial image library, not simply as a complete archive.

The review must answer four separate questions:

1. Is the image technically strong enough?
2. Is it visually/editorially strong enough?
3. Does it add something distinct to the portfolio?
4. Does its category/taxonomy help users discover it?

No photo is deleted automatically. Automated checks only create review candidates.

## Current catalog snapshot

Current `data/photos.json` contains **1,390 photos** across **27 categories**.

Largest categories:
- פרחים וצמחים — 162
- ישראל — 123
- בעלי חיים — 102
- גאורגיה — 85
- איטליה — 79
- סלובקיה — 76
- צילום מופשט — 69
- טבע דומם — 60
- ספרד ואנדורה — 60
- בולגריה — 59

Current hygiene signals:
- 120 photos have no description.
- 142 rows belong to repeated-title groups.
- 650 photos have no `parent_category`.
- 78 photos have a long edge below 2,000px / short edge below 1,200px and should be reviewed for licensing suitability.
- 164 photos have no EXIF.
- `data/photo_strength_report.json` is still `waiting_for_mapped_data`, so engagement data is not yet strong enough to rank the whole portfolio.

## Important taxonomy finding

The current category system mixes different dimensions:

### Subject / visual genre
Examples:
- פרחים וצמחים
- בעלי חיים
- צילום מופשט
- טבע דומם
- מאקרו-צילומי תקריב
- אומנות רחוב
- פורטרטים
- צילומי לילה
- שחור-לבן

### Geographic collection
Examples:
- ישראל
- גאורגיה
- איטליה
- סלובקיה
- הולנד
- אבו דאבי
- סן דיאגו - ארה"ב
- וינה

This makes browsing less consistent because a user may be choosing between "animals" and "Italy" in the same category level.

## Recommended information architecture

Do not destroy current URLs immediately. First introduce a two-axis model:

### A. Primary visual category
Target 6–9 top-level portfolio categories:
- Nature & Landscape / טבע ונוף
- Wildlife / בעלי חיים
- Macro & Botanical / מאקרו, פרחים וצמחים
- Street & Urban / רחוב ועיר
- Architecture / אדריכלות
- Abstract & Fine Art / מופשט ואמנותי
- Portraits / פורטרטים
- Still Life / טבע דומם
- Night / לילה (optional if there is enough depth)

### B. Collection / location
Separate geographic filter or collection:
- Israel
- Georgia
- Italy
- Slovakia
- Spain / Andorra
- Bulgaria
- Netherlands
- Abu Dhabi
- Germany
- England
- Greece
- Czechia
- Tanzania
- Montenegro
- San Diego / USA
- Hungary
- Austria / Vienna
- Romania
- etc.

### C. Style tags
Use tags rather than primary category for:
- Black & White
- Night
- Macro
- Minimal
- Color
- Architecture
- Motion
- Wildlife
- Travel

A photo can then be:
- primary category: Wildlife
- collection: Tanzania
- tags: wildlife, safari, color

instead of forcing one value to carry all meanings.

## Professional image review rubric

Each image should eventually be reviewed on the actual image, not only metadata.

Score each dimension 1–5:

### Technical quality
- sharpness / intentional motion
- exposure
- noise
- color / white balance
- artifacts / clipping
- usable resolution

### Composition
- clear subject
- visual hierarchy
- framing
- distracting elements
- crop quality
- balance / negative space

### Distinctiveness
- does it look meaningfully different from nearby images?
- is it stronger than similar frames?
- does it add a unique story, light, moment or composition?

### Emotional / editorial value
- immediate impact
- story
- mood
- memorable subject or geometry

### Commercial / portfolio fit
- would it work on a wall, website, publication or licensed use?
- does it strengthen the Amit Photos identity?
- is it suitable as a hero, social post, digital license or B2B selection?

## Review statuses

Use only these editorial outcomes:

- **KEEP** — strong portfolio image.
- **KEEP_SECONDARY** — useful in archive/category but not featured.
- **REVIEW_DUPLICATE** — visually similar or repeated scene; keep strongest frame(s).
- **REVIEW_CATEGORY** — image may be good but taxonomy is weak/wrong.
- **REVIEW_TECHNICAL** — resolution/quality issue needs visual inspection.
- **ARCHIVE_CANDIDATE** — weak relative to similar images.
- **HIDE_CANDIDATE** — should probably leave the public portfolio, but do not delete the source file.
- **LEGAL_REVIEW** — rights/privacy/location release issue if applicable.

Never permanently delete based on an automated score.

## Rules for removing weaker images

A photo becomes an archive/hide candidate only after at least one of these is true:

1. It is technically weak and has no intentional artistic reason.
2. It is a weaker near-duplicate of a clearly stronger frame.
3. It has no distinct portfolio role and adds clutter inside an overfull category.
4. It repeatedly receives exposure but near-zero engagement compared with similar photos **and** visual review agrees.
5. It is too small for the advertised license use.
6. It creates category confusion or weakens the perceived quality of the portfolio.

Low traffic alone is not enough to remove a photo.

## Category review rules

For each category/collection check:
- total image count
- number of strong hero-worthy images
- repeated scenes
- missing descriptions
- low-resolution images
- image diversity
- whether the category is useful as a user choice

Suggested category health bands:
- fewer than 8 strong images: consider merging into another category/collection.
- 8–20 strong images: healthy focused collection.
- 20–60 strong images: strong category.
- above 60: review for duplication and create subcollections/filters instead of showing everything equally.

These are editorial guidance, not automatic rules.

## Current category observations

- **פרחים וצמחים (162)** is very large and should be reviewed for repetition. Likely split or curate a visible subset.
- **ישראל (123)** is a location collection, not a visual genre. It should eventually live under location/collection filtering.
- **בעלי חיים (102)** is a valid strong subject category but should be checked for repeated species/scenes.
- Many country categories contain 30–85 photos; these should become geographic collections rather than competing with visual genres.
- **שחור-לבן** is primarily a style attribute and should usually become a tag/filter.
- **וינה** and **סן דיאגו - ארה"ב** use a different geographic granularity than country-level categories and should be normalized.

## Automated audit vs visual review

### Automated audit can safely flag
- duplicate titles
- missing descriptions
- low resolution
- missing category metadata
- oversized categories
- category taxonomy inconsistency
- low engagement after sufficient exposure

### Automated audit cannot decide reliably
- emotional quality
- composition quality
- best frame among similar images
- artistic intent
- whether a technically imperfect image is intentionally strong

Those require actual visual review.

## Recommended execution order

### Phase 1 — catalog hygiene
Run `src/photo_catalog_audit.py`.
Fix metadata, duplicate-title clusters and taxonomy problems.
No images are removed.

### Phase 2 — visual curation
Review category by category.
Start with:
1. פרחים וצמחים
2. בעלי חיים
3. ישראל
4. צילום מופשט
5. מאקרו-צילומי תקריב

For each category, inspect actual thumbnails/full images and assign review status.

### Phase 3 — behavioral evidence
After the new photo-strength pipeline has enough mapped data:
- compare views, purchase intent, contact intent and social engagement;
- do not punish images that were barely exposed;
- use data to confirm or challenge the editorial review.

### Phase 4 — public portfolio cleanup
Only after review:
- hide/archive weak images from the public portfolio;
- preserve source files;
- strengthen category pages;
- choose a smaller featured/hero set;
- consider a "full archive" view only if useful.

## Relation to the business plan

This review supports the current business strategy:
- stronger Digital Licensing catalog;
- stronger B2B wall-art selection;
- better social posts;
- cleaner SEO/category landing pages;
- better photo-strength learning.

It does not require PayPal or Gelato.

