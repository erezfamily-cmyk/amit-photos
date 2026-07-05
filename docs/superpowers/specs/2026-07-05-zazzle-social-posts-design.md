# Zazzle Product Social Posts — Design Spec (5.7.2026)

## Goal

Automatically promote photos that have Zazzle print-on-demand products configured, across Pinterest, Instagram, Facebook, and Threads — once a week per platform — in English, targeting US buyers. Built so a second marketplace (Redbubble) can be turned on later without a rewrite.

## Context

- Only 3 of ~1200 photos currently have `zazzle_products` populated in D1 (JSON column, up to 5 products per photo: Poster, Photo Tile, Canvas Print, Metal Print, + a rotating 5th — see [[feedback_zazzle_product_variety]]). Amit plans to add more before this launches; the design must scale naturally as the catalog grows, not assume a fixed small set.
- 7 photos have `redbubble_products` populated already, but Amit wants Redbubble posting held back until the Redbubble links are confirmed live/correct on the site. This feature must not touch Redbubble yet — only prepare the seam.
- Same IG/Facebook/Threads accounts as the existing Hebrew content — English Zazzle posts will mix into the same feed. Confirmed acceptable by Amit.
- Cadence: 1x/week per platform (not 2x), based on today's finding that over-posting likely contributed to the mid-June engagement crash (avg likes 3.2 on 14.6 → 1.2 by 28.6, see [[project_instagram_performance_insights]]). All 4 platforms can post on the same day/week — just once each.

## Architecture

**New files:**

- `src/zazzle_social_post.py` — the posting script
- `.github/workflows/zazzle-social-post.yml` — weekly cron (Wednesday, `0 12 * * 3` — spreads load away from Sunday's week-photo-social and Tuesday's reels)
- `data/zazzle_social_posted.json` — rotation/history state (new file, committed by the workflow)

**Flow:**

1. Fetch photos from `/api/photos`, filter to `zazzle_products` non-empty.
2. Pick the next photo in rotation: track posted IDs in `zazzle_social_posted.json` (same `used_ids` pattern as `instagram_story.py`); when the pool is exhausted, reset and start over. This means with only 3 photos today, the same 3 photos cycle repeatedly (weekly) until Amit adds more — acceptable per Amit's plan to grow the catalog first.
3. Pick one specific product at random from that photo's `zazzle_products` list to feature in the copy (not "all 5" — a concrete product makes for a stronger, more specific post per the existing caption-quality principles).
4. **IG/Facebook/Threads** (single-product feed posts): generate one English caption per platform via Claude (`opus-4-8`), first-person voice, specific to the photo + one randomly chosen product from that photo's list, ending with the Zazzle store link. Style follows [[feedback_caption_style]] principles (specific over generic, no formulaic question-opener) translated to English — not a direct Hebrew→English translation of existing Hebrew copy logic, a fresh English generation.
5. **Pinterest** (all products get pushed): unlike the feed platforms, Pinterest gets **one pin per product** in that week's photo's `zazzle_products` list — e.g. 5 products → 5 pins, each with its own Claude-generated English description naming that specific product (mug, poster, canvas, etc.) and linking to that product's own Zazzle URL. All of that week's pins go out together, once a week (not spread across the week).
6. Post to each platform independently:
   - Instagram + Facebook: Graph API, same pattern as `week_photo_social.py`
   - Threads: same pattern as `threads_post.py` / `threads-post.yml` (`THREADS_USER_ID`, `THREADS_ACCESS_TOKEN`)
   - Pinterest: reuse `pinterest_post.py`'s pin-creation logic, posting all of the week's product pins to a single dedicated "Zazzle Prints" board (created once, reused every week) — kept separate from the existing per-category photography boards so commercial product pins don't mix into them
7. Record what was posted (photo id, which products got Pinterest pins, feed-post product choice, platforms succeeded) in `zazzle_social_posted.json`.

**Redbubble extensibility (not built now):** the "product source" (`zazzle_products` column name + store link template) will be a named constant/config at the top of the script, not hardcoded inline — so adding Redbubble later means adding a second named source and a switch, not rewriting the photo-selection/caption/posting logic.

## Error handling

- Each platform posts independently in its own try/except — one platform failing (e.g. today's litterbox/0x0.st style transient failure) must not block the others or crash the run.
- Missing credentials for a platform → skip that platform with a log line, don't fail the whole script (matches existing scripts' `if not TOKEN: print("⚠️ skipping"); return None` pattern).
- Any upload-to-temporary-host step (if video/image hosting is needed for any platform) gets a 2-attempt retry with backoff, per today's fix to `instagram_story.py`.
- Workflow's git-commit step must `git add` the actual state file this script writes (`data/zazzle_social_posted.json`) — today's `weekly-report.yml` bug (writes 2 files, commits only 1, breaks `git pull --rebase`) must not be repeated. Use `git pull --rebase --autostash` as defense-in-depth regardless.

## Testing / verification

- `--dry-run` flag (matching `reel_post.py`'s convention): prints which photo/product/captions would be used without actually posting anywhere.
- After first real run: manually check each platform to confirm the post looks right and the Zazzle link works, then let it run unattended.

## Out of scope (explicitly deferred)

- Redbubble posting — wait for Amit's go-ahead once links are confirmed live.
- Any change to the existing Hebrew posting cadence/scripts.
- A dedicated "Zazzle" Pinterest board strategy beyond reusing the existing category-board logic (can revisit if it turns out mixing marketplace pins into category boards is suboptimal after seeing real results).
