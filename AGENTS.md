# AGENTS.md — Amit Photos repository instructions

Applies to the entire repository. These are standing instructions for coding agents (Codex, Claude Code, VS Code agents, and other assistants). Keep this file concise; it defines how to work, not the current task list.

## First steps: current state, not stale assumptions

1. Read **`handoff.md` from the top** and **`TODO.md` from the top** before making changes. Their newest dated sections supersede older entries; historical PR statuses further down may be obsolete.
2. Check the current `main` branch, open PRs, working tree, and relevant GitHub Actions results. GitHub is the shared source of truth across computers and phones.
3. Start with `git status --short` and `git fetch origin`. **Never discard, reset, stash, overwrite, or switch away from uncommitted work without understanding it.** Only use `git switch main` / `git pull --ff-only origin main` when safe.
4. Verify the actual code, live behavior and workflows before proposing a fix. Do not assume that previous chat messages or old handoff entries describe today's production state.
5. If the user asks to continue, select the highest-priority *still-open* item in the newest handoff/TODO and make progress without repeating completed work.

## Project and release architecture

- Repository: `erezfamily-cmyk/amit-photos`; production: `https://amitphotos.com/`.
- This is a bilingual (Hebrew RTL / English LTR), mobile-first photography portfolio, learning site and personal-use photo inquiry experience.
- Production is deployed as a **Cloudflare Worker**, configured by `wrangler.toml` and `worker.js`, with static assets, D1 and R2. Do not mistake static local `file://` previews for working API-backed pages.
- Production deployment is controlled by GitHub workflows (including `.github/workflows/deploy.yml`); a successful PR check does **not** by itself prove successful deployment. Verify the actual deploy run and live site separately.
- Existing integrations and scheduled jobs (including photo ingestion, social automation, Pinterest, analytics, Resend and PayPal Sandbox) must not be changed casually.

- **Cloudflare review requirement:** When a task touches or may affect Cloudflare Workers, `worker.js`, scheduled handlers, cron triggers, Wrangler configuration, bindings (including D1/R2/assets/service bindings), or Worker security boundaries, read `orchestrator.md` before proposing or making changes. Use it to identify the relevant runtime paths, side effects, guards and dependencies; then verify current code/config and live deployment state where available. Treat the inventory as potentially stale, and preserve the existing safety and approval rules.

- Read `CLAUDE.md` for gallery architecture, R2 keys, photo ingestion and SEO background, **but some snapshot counts and instructions in it are old**. Confirm the implementation in code and current data; newest `handoff.md` overrides historical status.
- **Gallery data boundaries:** `assets/js/gallery.js` combines D1 `/api/photos` (published catalog) with `data/photos.json` (static enrichment). When D1 is available, do not accidentally surface unpublished JSON-only images, replace verified D1 WebP URLs with stale Drive URLs, or lose curated English text because an API translation field is empty. Read `docs/gallery-merge-architecture.md` and the current merging code before changing photo queries.
- Shared sub-page navigation is built by `assets/js/nav.js`; the homepage and its lightbox use `index.html`, `assets/js/gallery.js` and `assets/js/i18n.js`. A guide's bilingual logic can be standalone, so confirm its local `data-he`/`data-en` and `setLang` handling rather than assuming all pages use the same i18n mechanism.
- The live sitemap is handled by the Worker, not necessarily the local `sitemap.xml` stub. Preserve canonical tags, article structured data, `hreflang`, SEO metadata and Hebrew/English crawlability when changing routes.

## Immutable safety / business guardrails unless owner explicitly authorizes a separate change

- **Keep all real payments disabled.** Preserve `PAYMENTS_ENABLED = "false"` in both production and preview config. Never activate PayPal Live, real checkout, Gelato fulfillment, or commerce feature flags as part of a UI or docs task.
- Commercial licensing is currently paused. Do not reintroduce a live commercial purchase offer, unapproved prices, or imply physical prints are currently sold. Current primary purchase journey is **personal-use inquiry**, not instant checkout.
- Never expose, print, log, commit or share secrets, credentials, private tokens, buyer information or protected data. Redact them in reports.
- Treat production D1, R2, Google Drive photos, user records and curation statuses as sensitive. Default to read-only checks. **No destructive operations, bulk photo edits, database migrations, Drive changes, or outbound messages/publications without explicit approval.**
- Do not force-push or rewrite shared branch history. Do not merge, deploy, enable settings or change access/permissions without explicit owner approval. If approval is given, re-check the exact PR head and CI immediately before merging.

- Public-facing marketing, scheduled social publishing and email/lead flows are external actions. Read their current workflows and privacy policies; do not increase posting cadence, send messages or change contact automations without an approved business decision.
- Treat webhook verification, admin sessions, credentials, authentication, buyer email flows and Worker preview-to-production data access as security boundaries. Preview must fail closed; do not bypass auth or loosen host/environment checks to fix a demo.

## Git workflow and collaboration

- For code, CSS, content, automation or config changes, create a focused branch from the latest `main` and open a PR. Avoid unrelated modifications and broad rewrites.
- State the problem, root cause, scope, expected user-visible behavior, validation, deployment risks and remaining caveats in the PR. Add appropriate regression tests.
- For documentation-only changes, make the smallest authorized update; preserve the old handoff history and put the new dated resume point at the top.
- Before merge: check latest head SHA, conflicts, required CI, and browser QA if UI changed. After an approved merge: validate the deploy and live behavior, then update `handoff.md` / `TODO.md` on GitHub.
- If another person/agent advances `main`, refresh and reconcile; do not overwrite another change. Be particularly careful with `index.html`, shared CSS and browser tests that other branches may also edit.
- End each work session with a short factual Hebrew report: changes, files/PR links, exact tests/results, deployed vs. not deployed, unresolved items, and next action. Never call a task “verified” when only a test was queued.

## Design and content rules

- **Mobile first**: check narrow phone sizes (around 390px), tablet (around 768px) and desktop (around 1440px), including a real phone when available.
- **One site-wide visual language**, per the latest owner-approved Option B: warm cream shell (e.g. `#f5f1e9`), refined bronze/olive accents, generous whitespace and photography as the visual focus.
- Hebrew headings typically use **Frank Ruhl Libre**; English headings use **DM Sans** where the homepage design specifies it; body text uses **Heebo** where appropriate. Preserve established page-specific typography instead of blindly replacing fonts.
- The photography guides under `camera/` use shared `assets/css/guide-cream.css`. Interactive simulators remain **dark cards** (`.lab` or `.guide-dark`) within the cream page. Read `tests/guide-cream-shell.test.mjs` before changing this design system.
- Keep Hebrew and English copy, titles, labels, alt text, accessibility names and state transitions consistent. No Hebrew leakage on English routes, especially photo lightboxes, social platform cards and sharing flows.
- Preserve responsive image composition: artwork must not overlap navigation, captions, floating buttons or furniture mockups. Avoid sideways overflow, cropped CTA text and intrusive overlays.
- **Do not disable pinch-to-zoom** (`user-scalable=no` or `maximum-scale=1`); retain accessibility and effective zoom-in behavior.
- Preserve accessible contrast, visible keyboard focus, semantic buttons, accessible names, mobile tap targets and right-to-left correctness. When replacing pictographic text in migrated guides, use inline SVG where the existing design/tests require it.
- Preserve image origin and authorship metadata. No silent removal of photos, gallery categories or valuable content.

- Photo-backed storytelling should be grounded in actual visible details or owner-provided memories. **Do not fabricate** a location, event, personal memory or provenance in emotional captions, social posts or metadata. Avoid long technical specifications at the expense of the visual/emotional story.
- Room mockups are **visual demonstrations only**. If showing a framed photo above a sofa, make it clear the offered product is a **digital photo for personal use**; frames, printing and shipping are not included.
- Camera learning pages: there are 24 standalone `camera/<topic>/index.html` guides plus `camera/index.html`, including interactive simulators. Keep simulated imagery, controls and explanatory text synchronized; don't pin content beyond the simulator section or leave unusable empty video embeds. The current guide CSS and its tests are the authoritative design constraints.
- Preserve navigation's mobile scroll behavior, functional keyboard controls and accessible icon labels. Current guides use inline SVG icons, often adjacent to separately translated text spans so language switching doesn't erase the SVG.

## Validation and implementation practices

- Prefer minimal, well-scoped changes with reproducible diagnosis; check current code and existing tests before editing.
- Broad Node suite (from repository root): `node --test tests/*.test.mjs` (Node 24 in GitHub Actions). Run relevant targeted tests as well, including `tests/guide-cream-shell.test.mjs` for guide designs.
- Review the current `.github/workflows/` rather than guessing the CI matrix. Browser tests commonly run **Playwright Chromium and WebKit**. Test the **current PR checkout**, not only an older Sandbox preview. Local browser tests may need Playwright installed.

- The **full Node test workflow** is `.github/workflows/node-unit-tests.yml` (Node 24, `node --test tests/*.test.mjs`). Do not assume a topic-specific green check covers the full suite. The repository has no meaningful npm package scripts in `package.json` (`{}` at this review); use the commands actually defined by the workflows.
- The `Experience Preview Browser QA` workflow (`.github/workflows/experience-live-smoke.yml`) does both a Sandbox smoke test and current-checkout fixture QA. Confirm that real photo loading, private asset permissions and device layout are independently validated, since fixture screenshots alone cannot prove the production experience.
- If a CI browser job stalls at Playwright installation, distinguish infrastructure stalls from product failures and inspect step logs; never silently remove WebKit checks, drop assertions or claim Safari was verified. Capture regression screenshots when UI changed.
- CSS assets used by pages have cache-busting versions. When editing shared styles, refresh their expected hash as required by the relevant tests (for `guide-cream.css`, first eight hexadecimal characters of the MD5 of LF-normalized file content). Do not blindly hardcode a stale version.
- For UI work, validate screenshots, geometry, legibility, correct image URLs, accessibility and both language modes. Contrast checks and real iPhone review complement automated tests; neither should be claimed if not performed.
- For APIs and financial or privacy-sensitive paths, use read-only calls/fixtures and never place real orders. When relevant, check `/api/payments-status` reports disabled, without turning it on.
- Distinguish **CI passed**, **preview tested**, **production deployed** and **owner visually accepted** in all status reports.

- GitHub `.github/workflows/deploy.yml` is **path-filtered** and normally deploys on selected production asset paths. **Documentation-only changes (including `AGENTS.md`) do not trigger that deploy.** Always verify the deploy actually ran before claiming production changed.
- A design change to the shared `guide-cream.css` must update the cache-bust reference across **every** migrated guide and pass `tests/guide-cream-shell.test.mjs`; use the LF-normalized MD5 rule asserted by that test. Keep semantic color tokens readable on both cream pages and dark simulators (contrast target at least WCAG AA for normal text).
- For business evaluation: use verified GA4 funnel events (experience path → photo open → wall preview → WhatsApp click intent) and multi-week measurement windows. Don't equate click events with qualified leads, sales or purchase completions. Record dates of UX changes when comparing periods.

## Handoff and next-step discipline

- `handoff.md`: current state and decisions; write newest dated entry at the top, without deleting history.
- `TODO.md`: prioritized actionable checklist; mark completed work only after verification.
- Recheck open issues/PRs against GitHub before citing them as unfinished; many prior PRs have already merged or been superseded.
- Ask the owner only for a genuine decision, permission, secret connection or visual acceptance that cannot be supplied by code/tests. Do not invent approvals.

- **Current project context at time of writing (2026-10-29):** the latest handoff describes the owner-approved **Option B** cream-shell rollout across all 24 camera guides and the guide index (PRs #211–#220 merged). This is historical context for future agents, **not** an instruction to reopen those PRs. The still-unverified next items include real-iPhone checks for the latest guide batches, English QA on representative guides, optional focus-guide pinned imagery and optional YouTube embeds. Re-read the latest handoff and GitHub before deciding what's actually outstanding.
- Closing or merging stale/superseded PRs (#208, #210 or others), setting required checks, enabling embeds or changing publishing policy each needs verification of current status and the owner's approval where appropriate. Do not treat a list in this file as permission.
