# Proposal: external uptime check for a non-responding Worker (14.10.2026)

Status: **proposal only.** No service was created or enabled, no workflow file was added, no code changed. Payment flags stay `false`.
Why it is needed: a Worker that is down or returning 5xx cannot alert about itself. The 15-minute payment health check (PR #156, unmerged) runs *inside* the Worker, so it is silent exactly when the Worker is dead. Today only `health-check.yml` looks at the home page, once a day.

## 1. What the check does (public, read-only, no secrets)
| # | Request | Pass condition | Detects |
|---|---|---|---|
| 1 | `GET https://amitphotos.com/` | HTTP 200 within 15 s | Worker down, 5xx, route/DNS broken |
| 2 | `GET https://amitphotos.com/api/payments-status` | HTTP 200, valid JSON with boolean `enabled` and `digitalEnabled` | Worker code failing on an API route |

Properties: GET only (no writes, no order created, no PayPal call), no admin password, no token, no cookies. The responses carry no personal or order data (`payments-status` returns two booleans). The check stores nothing except pass/fail.

Limit (honest): with the flags off, `payments-status` does not touch D1, so these two requests prove the Worker answers, **not** that the database works. A database probe needs one new public route, e.g. `GET /api/ping` returning `{ok:true}` after `SELECT 1` (no data, no write). That is a code change and is **not made** (decision 3 below).

## 2. Frequency and the confirm-twice rule
- Every **15 minutes** (matches the in-Worker check); external providers' free tiers offer about 5 minutes.
- One failed run retries once after 60 s inside the same run. **Two consecutive failed runs** raise the alert (about 30 minutes at 15-minute spacing, about 10 at 5). Recovery sends one "back up" notice. This avoids waking the owner for a single blip.

## 3. Options (cost, alert channel)
| Option | Cost | Alert channel | Notes |
|---|---|---|---|
| **A. GitHub Actions scheduled workflow** (YAML draft below) | $0 (public repo; about 5 s per run) | GitHub failure e-mail to the repo owner | Already in use, no new vendor. Scheduling is best-effort (delays of minutes, skipped runs happen); a scheduled workflow is switched off after 60 days without repo activity. Independent of Cloudflare, not of GitHub |
| **B. External uptime service** (UptimeRobot or Better Stack, free tier) | $0 on the free tier (verify current limits at sign-up) | E-mail, plus push/Telegram where the free tier allows | Independent of both Cloudflare and GitHub, multi-location. New third-party account; it sees only public URLs |
| **C. Cloudflare Notifications** (Worker error rate, Builds failed) | $0 | E-mail | Sees only what Cloudflare sees; blind if the account or zone itself is down. Complements A/B, does not replace them |
| **D. Dead-man's-switch heartbeat** (e.g. Healthchecks.io free) | $0 | E-mail | The 15-minute cron pings out after a good health run; silence = alert. Needs a small code change and one URL variable. Optional, after PR #156 is live |

**Recommendation:** B as the primary uptime check (independent vendor, e-mail to `erez.family@gmail.com`) plus C as a free complement; A is the zero-new-vendor fallback; D later. Alert channel: **e-mail only** for now (Telegram receipt is unverified, so it must not be the only channel). Expected cost: **$0**. Nothing here touches payments.

## 4. YAML draft for option A (documentation only, NOT added under `.github/workflows/`)
```yaml
name: uptime
on:
  schedule: [{ cron: '*/15 * * * *' }]
  workflow_dispatch:
permissions: {}            # no token scopes needed
jobs:
  probe:
    runs-on: ubuntu-latest
    timeout-minutes: 3
    steps:
      - name: home page and payments-status (GET only, public)
        run: |
          for i in 1 2; do
            ok=1
            curl -fsS --max-time 15 https://amitphotos.com/ -o /dev/null || ok=0
            curl -fsS --max-time 15 https://amitphotos.com/api/payments-status \
              | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8"));process.exit(typeof j.enabled==="boolean"&&typeof j.digitalEnabled==="boolean"?0:1)' || ok=0
            [ "$ok" = 1 ] && exit 0
            sleep 60
          done
          exit 1
```
No secrets, no `secrets.*` references, no write permission. A failing job triggers GitHub's failure e-mail. Checking "payments are closed when they should be" would need editing whenever payments are deliberately opened, so it is left out of the draft (decision 4).

## 5. Decisions needed (nothing is done until you answer)
1. Which option: B (recommended), A, or both?
2. Alert recipient: `erez.family@gmail.com` (assumed). Is e-mail alone enough?
3. May I add the minimal public `GET /api/ping` (`SELECT 1`, read-only) to the #155 branch so the check also proves the database answers? Without it the check proves the Worker only.
4. Should "payments open when they should be closed" be part of the check?

Not verified: delivery of GitHub/Cloudflare/provider alert mail to Gmail (needs one deliberate test failure after you approve a service); free-tier limits as of today.
