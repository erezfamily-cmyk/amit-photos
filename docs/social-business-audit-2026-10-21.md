# Amit Photos — Social business-signal audit (2026-10-21)

## Goal and release boundary
Read-only validation of (1) Facebook duplicate candidates, (2) qualified visitor actions and (3) traffic-source attribution in GA4. The rollout must **not** change any publication schedule, target platform, checkout or payment flag. No PayPal/Gelato/Cloudflare production writes and no secrets in reports.

## Verified code observations
- `instagram-story.yml` is daily. `src/instagram_story.py` calls `publish_ig`, `publish_fb`, **and `publish_fb_reels`** when run; Facebook Reel is an additional automated publishing surface not captured by the initial cron count. Verify Meta feed visibility before assigning the observed 12 feed posts to any publisher.
- `youtube-tutorial.yml` invokes `share_youtube.py` with Instagram/Facebook credentials after tutorial generation.
- `social_delivery_state.py` already tracks per-platform checkpoints for participating pipelines. Do not reimplement retries globally.
- `social_photo_map.json` can link some post IDs to photo IDs, but cannot reliably reconstruct **which workflow** made every FB post.
- Facebook feed query reads up to 20 posts in the last seven days. Its scope is **not** exhaustive if the page has more than 20 such posts, and stories may not appear in feed.

## Changes proposed in branch
1. `social_business_audit.py`: deterministic, read-only analytics interpretation. Do not call missing purchase/print events a tracking failure when checkout is deliberately off. Missing qualified interactions prompt a separate inspection.
2. Facebook duplicate candidates: identical **full** normalized caption on the same UTC day, with different Meta IDs, grouped for human review. Identical captions can be intentional; these are warnings, never proof of a retry bug. No automatic deletion, unpublishing or platform-target change.
3. Weekly social report: attach `business_audit` to the JSON payload and highlight qualified action counts, checkout verification state and duplicate candidates in the weekly email.
4. GA4: add one aggregate `eventName + sessionSource + sessionMedium` event-count query for qualified interactions (guide request, lead, photo contact, licensing and B2B). Report query failures as unavailable, not as zero. Preserve in `ga_reports.json` and show by source in weekly GA email. These are **event counts**, not unique people, revenue, or post-level attribution.
5. Decision engine: if >=30 sessions and zero tracked qualified actions, prioritize verifying the lead path, rather than changing frequency based on likes alone. Does not trigger an autonomous code or schedule change.
6. Regression coverage: mocked analytics query, safe HTML escaping, duplicate matching and payments-off interpretation.

## Decision gates after CI and review
- **Meta provenance:** before mutating publication targets, introduce a durable publishing ledger across each publisher, including `workflow`, `run_id`, `platform`, `content_id`, `post_id`, publish timestamp and retry/idempotency state. Reconcile unknown/approved/manual posts separately. Do not assert that a count difference is a bug.
- **Story crosspost:** decide explicitly whether Facebook Story and Facebook Reel should remain enabled from the **daily Instagram Story pipeline**. That is a platform-strategy change, so it is **not** made in this PR.
- **GA4:** after approval and merge, check real event-source query succeeds; run a non-payment DebugView test for `photo_contact_click`, `licensing_personal_interest`, `guide_request_success` and `b2b_contact_start`, without triggering purchases or sending personal data.
- **Publishing optimization:** compare channel-attributed *sessions and qualified actions* after a sufficient period; keep Instagram stable until evidence improves. Raw impressions/likes alone do not justify higher output.
- **Reels watch-time anomaly:** validate data unit, then normalize/reject inconsistent series before using it for automated recommendations. No unverified fix in this PR.
- **Facebook duplicate 16 October:** identify both exact Meta IDs and full captions before investigating retry chain; the existing top-five report excerpts cannot verify full-message identity.

## QA
Local isolated tests of the read-only audit initially passed (4/4). Full project CI must validate integration and added GA4 tests. No live Meta or GA4 API verification is claimed before rollout.

## Guardrails
No workflows' schedules or platform targets modified; purchase flags remain false; no PayPal or D1 changes; no merges or deployments from this branch. Keep PR as draft until CI is green and behavior is reviewed.
