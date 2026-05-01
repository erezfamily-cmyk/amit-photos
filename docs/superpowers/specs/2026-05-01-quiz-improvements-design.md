# Quiz Improvements Design

## Goal

Upgrade the quiz from 5 to 10 questions, add Facebook sharing on the win screen, and change the automated social promotion from weekly to biweekly.

## Architecture

Three isolated changes: a constant update in `quiz/index.html`, a button addition on the win screen in the same file, and a workflow step addition in `.github/workflows/quiz-social-post.yml`. No backend or DB changes required.

## Tech Stack

Vanilla JS (quiz/index.html), GitHub Actions (YAML workflow)

---

## Part 1 — 10 Questions

**File:** `quiz/index.html`

- `QUESTIONS = 5` → `QUESTIONS = 10`
- `WIN_SCORE = 3` → `WIN_SCORE = 6` (60% threshold, same difficulty)
- Photo of the week continues to be guaranteed as one of the 10 questions
- Result dots row renders 10 dots instead of 5 (existing loop already uses `QUESTIONS`, no code change needed beyond the constant)

## Part 2 — Facebook Share Button

**File:** `quiz/index.html`

On the win screen, a Facebook share button is added alongside the existing WhatsApp button. Both buttons appear only when `score >= WIN_SCORE`.

**Facebook share URL:**
```
https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Famitphotos.com%2Fquiz%2F
```

The button opens in `_blank`. No custom message text — Facebook's sharer shows the page's Open Graph preview (title + image from `quiz/index.html` meta tags).

**WhatsApp button:** unchanged.

**Button layout:** both buttons sit in the same `.share-row` container, side by side, styled consistently.

## Part 3 — Biweekly Automated Promotion

**File:** `.github/workflows/quiz-social-post.yml`

GitHub Actions cron does not support "every 2 weeks" natively. The schedule stays at `0 15 * * 3` (every Wednesday 15:00 UTC = 18:00 Israel). A new first step checks the ISO week number and writes an output variable. All subsequent steps use `if: steps.check.outputs.run == 'true'` so they are skipped cleanly when it's an odd week.

```yaml
- name: Check biweekly
  id: check
  run: |
    WEEK=$(date +%V)
    if [ $(( WEEK % 2 )) -eq 0 ]; then
      echo "run=true" >> $GITHUB_OUTPUT
    else
      echo "run=false" >> $GITHUB_OUTPUT
      echo "Odd week — skipping"
    fi

- name: Run promotion
  if: steps.check.outputs.run == 'true'
  run: python src/quiz_social_post.py
  # ... secrets as before
```

Only even ISO week numbers trigger the actual promotion. This produces a consistent biweekly cadence on Wednesdays without marking the job as failed on skip weeks.
