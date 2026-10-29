# orchestrator.md — Amit Photos agent and automation coordination

**Status:** Coordination and inventory document, not an executable agent, scheduler, or permission to publish.
**Scope:** `erezfamily-cmyk/amit-photos` across Claude/Codex, GitHub Actions and Cloudflare.
**Reviewed:** 2026-10-29. Inventory below is based on repository files; runtime deployment/account state may differ. Revalidate before actions.

## 0. Authority, startup and safety

1. **Owner decisions and explicit approvals** override everything else. Read root `AGENTS.md` first; its safety and engineering rules apply to all agents and automated workflows. Then read the newest top sections of `handoff.md` and `TODO.md`. Read `CLAUDE.md` for historical architecture only; some counts are outdated.
2. Use fresh GitHub `main` and checked workflow/config contents as the shared source of truth. Inspect worktree state before pulling; preserve all uncommitted work. Do not run simultaneous edits to shared files.
3. Keep real payments locked: `wrangler.toml` has `PAYMENTS_ENABLED = "false"` for production AND previews. No PayPal Live, automatic checkout, Gelato, inactive commercial licensing or physical-print fulfillment without a new explicit decision.
4. No agent may independently merge, deploy, alter production D1/R2/Drive, change secrets/permissions, make destructive edits, send campaigns, post externally or turn on flags. Existing scheduled jobs are **live automations**, not authorization for a new agent to trigger or expand them. Investigations are read-only by default.
5. Prefer small isolated branches and PRs, automated regression + device QA, exact GitHub check evidence, explicit approval, then deploy verification and a dated handoff. A successful local test is not proof of production state.

## 1. Three layers: agents, scheduled workflows, runtime

| Layer | What actually lives here | Activation | Source of truth | Caution |
|---|---|---|---|---|
| **Claude/Codex Skills** | Reusable AI instructions and task-specific procedures; not persistent running workers | Explicit user/agent invocation in coding session | `.claude/skills/*/SKILL.md`, mirrored `.agents/skills/`; `AGENTS.md` | Do not assume a Skill runs itself or has access to tools mentioned in generic instructions |
| **GitHub Actions agents/jobs** | Python/Node scripts, some calling Anthropic, that ingest photos, publish content, generate newsletters/reports and run CI | `schedule`, `workflow_dispatch`, `push`, issue comments or approvals depending on workflow | `.github/workflows/*.yml` and referenced `src/` scripts | Some have real side effects and can commit to `main`; inspect exact triggers, concurrency and secrets before executing |
| **Cloudflare Worker runtime** | Site APIs, photo serving, D1/R2 and 3 scheduled job functions | HTTP traffic; two cron expressions in `wrangler.toml` | `worker.js`, `wrangler.toml`, deployed Worker | Worker scheduled handlers operate independently of Claude/GitHub; not necessarily AI agents; production binding/active cron state needs Cloudflare verification |

**Important:** This document **coordinates the systems conceptually**. It does not install a central dispatcher, create an AI agent or stop/reschedule existing jobs.

## 2. Discovered Claude/Codex skill inventory

Verified directories under `.claude/skills/`:

| Skill | Responsibility | Recommended input/output |
|---|---|---|
| `add-camera-guide` | Add a new interactive photography lesson | Read existing guide; update `camera/index.html`, `worker.js` sitemap list and `src/camera_edu_post.py` rotation; preserve cream design/simulator dark card; open PR |
| `social-media-context-sms` | Maintain brand voice, audiences and social editorial guardrails | Read/update `.agents/social-media-context-sms.md` only with approved current claims |
| `caption-writer-sms` | Captions for image/video/Reel/Pin and visual-first posts | Ground in real photo/content metadata; platform-specific draft, **no publication by itself** |
| `post-writer-sms` | Text-first social posts | Platform-specific draft; coordinate with caption-writer to avoid competing outputs |
| `performance-analyzer-sms` | Analyze actual post metrics | Timestamped baseline and evidence; distinguish impressions, engagement, clicks and sales |
| `content-pattern-analyzer-sms` | Detect repeated successful/unsuccessful themes | Compare adequate samples; avoid making statistical claims from a few posts |
| `optimization-advisor-sms` | Recommend next social experiments and priorities | Grounded input from analytics/patterns, an action plan and measurement criteria |

**Context file:** `.agents/social-media-context-sms.md` (reviewed; last_updated 2026-10-15). It includes some older references to **prints, shipping and commercial licensing**. Those are **not active offers** and must not appear in outward-facing copy until independently authorized. Root `AGENTS.md` and current owner business constraints take precedence.

The `.agents/skills/` directory contains corresponding social skills (a mirror/alternate loader); do **not** count a mirrored file as an independent running agent. General skill descriptions may reference unavailable add-ons (for example BlackTwist), or absent sibling skills; check what is installed before delegating.

## 3. Discovered GitHub Actions execution families

The repository's `.github/workflows/` includes (sample verified from directory, not a claim that all are currently enabled/healthy):

| Family | Examples (actual workflow filenames) | Human responsibility |
|---|---|---|
| **Publishing and distribution** | `instagram-post.yml`, `instagram-story.yml`, `instagram-b2b-post.yml`, `facebook-post.yml`, `location-social-post.yml`, `newsletter-social-post.yml`, `camera-edu-post.yml`, `distribute-video.yml`, `amit-character-ads.yml` | Review target, cadence, audience, copy and account permissions; no duplicate posts |
| **Photo catalog and curation** | `drive-sync-ci.yml`, `apply-flower-curation-actions.yml`, `apply-critical-low-resolution-hide.yml`, `admin-flower-curation-pilot-ci.yml`, `migrate-to-r2.yml`, `fill-descriptions.yml` | Protect image IDs, original files, hide/restore decisions, D1/R2 consistency and backups |
| **Learning/content generation** | `learn-generate.yml`, `learn-analysis-save-ci.yml`, `learn-post-gate-ci.yml`, `learn-translate-en.yml`, `fill-video-ids.yml` | Preserve actual photo facts and approval gates; no auto-publishing unapproved AI analysis |
| **Email/newsletter and guides** | `build-free-guide.yml`, `newsletter-generate-now.yml`, `newsletter-fix-hero.yml`, `newsletter-fix-new-photos.yml`, `newsletter-get-content.yml` | Validate consent, links, language, content claims and deliverability |
| **Analytics and operational reporting** | `ga-weekly-analysis.yml`, `health-check.yml`, `business-live-verification.yml` | Compare data to an actual baseline, investigate failures; no silent changes to policy |
| **Quality/deployment/security** | `deploy.yml`, `experience-led-ci.yml`, `experience-live-smoke.yml`, `gallery-taxonomy-ci.yml`, `lead-funnel-ci.yml`, `b2b-funnel-ci.yml`, `digital-licensing-ci.yml`, `admin-campaign-links-ci.yml`, `node-unit-tests.yml` | CI does not equal business approval; deploy only authorized changes |

**Evidence of live scheduled code:** `ga-weekly-analysis.yml` uses a Monday 07:00 UTC cron and runs `src/ga_weekly_report.py` and `src/photo_strength_report.py`, then can commit generated report JSON. `instagram-post.yml` is scheduled Sunday/Wednesday at 17:00 UTC, runs `src/instagram_post.py`, and can push posting state. `learn-generate.yml` proposes photo analysis weekly with an issue/email/approval gating flow. `health-check.yml` runs daily and checks the production site and photo API. These are **existing settings**, not a recommendation to increase frequency.

Other workflows may exist beyond the verified examples. For every new task, enumerate `.github/workflows/` and review the exact current file before interacting with it. Do not extrapolate a schedule from a filename.

## 4. Cloudflare: real scheduled handlers and dependencies

Verified in `wrangler.toml`:

- Worker: `amit-photos` with `worker.js` entrypoint, `ASSETS`, `DB` (D1), `PHOTOS` (R2), and `IMAGES` binding.
- Cron entries: `0 */2 * * *` and `0 9 1,15 * *` (**UTC**, verify current deployment and actual trigger routing in Cloudflare).
- Preview: `PUBLIC_GALLERY_SERVICE` binding with restrictions; `PAYMENTS_ENABLED="false"` in preview and production.

The actual `worker.js` `scheduled(event, env, ctx)` invokes **all three functions on a scheduled event**, using `ctx.waitUntil`:

1. `runPinterestCronSync(env)` — creates Pinterest pins for published D1 photos; stores pin IDs back in D1; can post Hebrew and English content.
2. `runNewsletterCron(env)` — newsletter-related scheduled processing; inspect implementation, eligibility, cadence/guards and Resend outcomes before changing.
3. `runWelcomeSequenceCron(env)` — checks eligible newsletter subscribers in D1 and sends stages of welcome email through Resend; updates `welcome_stage` after successful delivery.

**Do not assume the two cron triggers are separated by function.** The dispatcher calls all three on *each* event; their internal guards determine what work proceeds. The defined schedule and deployed schedule may differ until Cloudflare is checked. Multiple jobs may access the same D1/email/business records as GitHub workflows, so deduplication/idempotency matters.

**Business-content inconsistency discovered in code, requiring separate QA before outbound sends:** the Pinterest EN pin template in `runPinterestCronSync` describes prints as available, and welcome email stage 3 in `worker.js` says printed products/shipping are offered. These claims conflict with the currently disabled print/checkout pathway. Do not casually edit or run the cron; propose a narrow approved copy correction, with regression tests and release validation. Audit other queued emails and scheduled social captions for the same outdated claims.

## 5. Routing matrix: how the orchestrator delegates

| Request or detected issue | Lead role / system | Supporting role | Gate / completion evidence |
|---|---|---|---|
| Owner asks to improve site design or a guide | Coding agent + `add-camera-guide` if a new guide | Node tests, Chromium/WebKit mobile QA, bilingual copy check | New branch/PR; owner approves merge; live deployment verified |
| Owner asks for a photo caption/post | `caption-writer-sms` or `post-writer-sms` (choose one) | `social-media-context-sms`, verified image metadata | Draft only until publication approved; working link/UTM checked |
| Weekly social improvement plan | `performance-analyzer-sms` → `content-pattern-analyzer-sms` → `optimization-advisor-sms` | `ga-weekly-analysis.yml` and account-specific data | Evidence, limitations, prioritization; **no automatic cron/cadence edits** |
| Broken photo/metadata/hidden status | Coding/data audit agent (read-only first) | Photo ingestion and Drive/D1/R2 pipelines | Root cause, stable ID consistency, explicit approval for writes |
| New educational photo analysis | `learn-generate.yml` per its documented proposal/draft/approval gate | Editorial review + language QA | Do not bypass `social-approval` or claim publication before confirmation |
| Newsletter or welcome email | Cloudflare scheduled functions / existing newsletter workflow | Content QA, Resend/delivery logs | Consent + compliance + **no unsupported product promises**; no unsolicited trigger |
| Pinterest synchronization | Cloudflare `runPinterestCronSync` | D1 curation and current business/product wording review | Only published photos, valid board and URL, idempotent pin tracking |
| API/performance/security alert | `health-check.yml`, Worker logs and focused coding PR | CI + rollback/safe deploy plan | Diagnostic evidence; no broad production mutations |
| Payment or commercial launch | **Owner-controlled separate project decision** | Sandbox security/E2E + legal/terms/fulfillment audit | Explicit owner approval at each gate; **default OFF** |

For concurrent work: use independent branches for independent tasks, make one owner/agent responsible for a file at a time, reconcile `main` before merge and never force-push. For a failure, stop the affected operation, preserve logs/state, diagnose before retrying; do not retry outward publishing blindly.

## 6. End-to-end operating protocol

1. **Discover:** latest `AGENTS.md`, `handoff.md`, `TODO.md`, `CLAUDE.md`; branch status, CI, Worker cron, deployment. Do not rely on a historical summary alone.
2. **Classify:** advice/draft vs. code edit vs. live data edit vs. public publishing. Assign a lead agent; note whether the system is a human-invoked Skill, GitHub scheduled workflow, or Cloudflare runtime.
3. **Scope:** list exact inputs, outputs, state stores and side effects (D1, R2, Drive, Git commits, external service, outbound email/posts) and permissions required. Identify potential parallel jobs touching the same records.
4. **Plan:** start read-only; minimize changes; specify tests, failure modes, idempotency, rollback and explicit approvals. For content, confirm current commercial claims before using old templates.
5. **Implement:** one focused branch/PR, no secrets in code, no unsafe auto-publish; don't silently alter schedulers.
6. **Validate:** `node --test tests/*.test.mjs` using Node 24 where supported; targeted tests; PR CI; bilingual mobile/desktop; actual asset/link checks and applicable Sandbox constraints.
7. **Approve:** owner must explicitly authorize merge/deploy, external publishing, database mutations, commercial changes or automation scheduling changes. Never infer approval from a successful CI run.
8. **Observe:** after authorized production release check deploy job + site + relevant Worker/Actions logs + data side effects; distinguish queued, sent, delivered, viewed, clicked and sold.
9. **Record:** newest dated status at the top of `handoff.md` and `TODO.md`, with links, evidence, exact commit, owner decisions, unresolved risks and next action; never overwrite the historical trail.

## 7. Checks before changing the orchestrator or installing anything

- This file is **documentation**, not a runner. No new automation, Agent SDK app, Cloudflare Durable Object, Queue, cron or GitHub workflow was created by adding it.
- Before proposing a real central orchestrator, audit all active Cloudflare Worker deployments/triggers, all GitHub schedules, duplicate email/Pinterest publishers, current logs and access permissions. Reconcile IDs and timezone assumptions.
- The most urgent uncovered safety gap is the mismatch between some legacy **automatic outbound print/shipping promises** and today's disabled buying model. Address that independently with approval rather than quietly changing the scheduler.
- For active work, follow the newest handoff; static inventory here can become stale. Update this table whenever adding/removing a Skill or scheduled job.
