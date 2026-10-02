# Gallery taxonomy — business consolidation — 2026-10-02

## Decision

The public gallery should optimize discovery and conversion, while Google Drive remains the master archive.

The 27 current categories are reorganized into three presentation roles without deleting or physically moving source files:

- **7 subject galleries:** פרחים וצמחים, בעלי חיים, צילום מופשט, טבע דומם, מאקרו-צילומי תקריב, אומנות רחוב, פורטרטים.
- **1 location collection:** מקומות בעולם, containing all 18 geographic categories including ישראל and גאורגיה.
- **2 style filters:** שחור-לבן and צילומי לילה.

This creates **8 primary gallery destinations** instead of presenting all categories at the same hierarchy level.

## Business rationale

- Reduce choice overload in the primary gallery navigation.
- Keep geographic discovery and SEO value without making every destination compete with subject galleries.
- Treat visual styles as ways to filter work rather than as competing business categories.
- Preserve every source image in Drive unless a future explicit archive-cleanup decision identifies a true duplicate/corrupt source.
- Keep merchandising decisions reversible: KEEP, KEEP_SECONDARY and HIDE remain site-layer decisions.

## Curation rollout

The flower pilot remains the reference workflow. Other galleries can adopt the same scoring/review model incrementally.

Rules:
- already-reviewed owner decisions are not overwritten;
- strong images do not need owner review just to remain public;
- problematic images are surfaced for review;
- low-resolution policy may later automate reversible HIDE, but never Drive deletion;
- DELETE remains explicit and destructive.

Source snapshot: `data/gallery-taxonomy.json`.
