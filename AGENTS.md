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

## Immutable safety / business guardrails unless owner explicitly authorizes a separate change

- **Keep all real payments disabled.** Preserve `PAYMENTS_ENABLED = "false"` in both production and preview config. Never activate PayPal Live, real checkout, Gelato fulfillment, or commerce feature flags as part of a UI or docs task.
- Commercial licensing is currently paused. Do not reintroduce a live commercial purchase offer, unapproved prices, or imply physical prints are currently sold. Current primary purchase journey is **personal-use inquiry**, not instant checkout.
- Never expose, print, log, commit or share secrets, credentials, private tokens, buyer information or protected data. Redact them in reports.
- Treat production D1, R2, Google Drive photos, user records and curation statuses as sensitive. Default to read-only checks. **No destructive operations, bulk photo edits, database migrations, Drive changes, or outbound messages/publications without explicit approval.**
- Do not force-push or rewrite shared branch history. Do not merge, deploy, enable settings or change access/permissions without explicit owner approval. If approval is given, re-check the exact PR head and CI immediately before merging.

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

## Validation and implementation practices

- Prefer minimal, well-scoped changes with reproducible diagnosis; check current code and existing tests before editing.
- Broad Node suite (from repository root): `node --test tests/*.test.mjs` (Node 24 in GitHub Actions). Run relevant targeted tests as well, including `tests/guide-cream-shell.test.mjs` for guide designs.
- Review the current `.github/workflows/` rather than guessing the CI matrix. Browser tests commonly run **Playwright Chromium and WebKit**. Test the **current PR checkout**, not only an older Sandbox preview. Local browser tests may need Playwright installed.
- CSS assets used by pages have cache-busting versions. When editing shared styles, refresh their expected hash as required by the relevant tests (for `guide-cream.css`, first eight hexadecimal characters of the MD5 of LF-normalized file content). Do not blindly hardcode a stale version.
- For UI work, validate screenshots, geometry, legibility, correct image URLs, accessibility and both language modes. Contrast checks and real iPhone review complement automated tests; neither should be claimed if not performed.
- For APIs and financial or privacy-sensitive paths, use read-only calls/fixtures and never place real orders. When relevant, check `/api/payments-status` reports disabled, without turning it on.
- Distinguish **CI passed**, **preview tested**, **production deployed** and **owner visually accepted** in all status reports.

## Handoff and next-step discipline

- `handoff.md`: current state and decisions; write newest dated entry at the top, without deleting history.
- `TODO.md`: prioritized actionable checklist; mark completed work only after verification.
- Recheck open issues/PRs against GitHub before citing them as unfinished; many prior PRs have already merged or been superseded.
- Ask the owner only for a genuine decision, permission, secret connection or visual acceptance that cannot be supplied by code/tests. Do not invent approvals.
