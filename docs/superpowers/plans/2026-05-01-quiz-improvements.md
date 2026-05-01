# Quiz Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade quiz to 10 questions, add Facebook share button on win screen, and make the automated social promotion biweekly.

**Architecture:** Three isolated edits — two in `quiz/index.html` (constants + HTML/JS), one in `.github/workflows/quiz-social-post.yml`. No backend or DB changes.

**Tech Stack:** Vanilla HTML/JS, GitHub Actions YAML

---

## Files

- Modify: `quiz/index.html` — constants, result screen HTML, showResult() JS
- Modify: `.github/workflows/quiz-social-post.yml` — biweekly gate step

---

### Task 1: 10 Questions

**Files:**
- Modify: `quiz/index.html:295-296`

- [ ] **Step 1: Change the constants**

In `quiz/index.html`, lines 295–296, change:

```js
const QUESTIONS  = 5;
const WIN_SCORE  = 3;
```

to:

```js
const QUESTIONS  = 10;
const WIN_SCORE  = 6;
```

No other code changes needed — the dots loop uses `results.forEach` (dynamic), and the score summary text is set dynamically in `showResult()` at line 554.

- [ ] **Step 2: Verify manually**

Open `http://localhost:8000/quiz/` (run `python -m http.server 8000` from repo root if needed).

Expected:
- Quiz shows exactly 10 questions (progress bar reads "שאלה 1 מתוך 10", etc.)
- Win requires 6 correct — complete a round answering 5 correct, result screen should show "📸 כמעט!" (not win)
- Complete a round answering 6+ correct, result screen should show "🏆 כל הכבוד!" and discount box

- [ ] **Step 3: Commit**

```bash
git add quiz/index.html
git commit -m "feat: upgrade quiz to 10 questions, win threshold 6/10"
```

---

### Task 2: Facebook Share Button

**Files:**
- Modify: `quiz/index.html` — HTML (line 286), CSS (add `.btn-facebook`), JS `showResult()` (lines 566–573)

- [ ] **Step 1: Add the HTML button**

In `quiz/index.html`, find line 286:

```html
      <a class="result-btn btn-whatsapp" id="btn-share" href="#" target="_blank">💬 שתף בוואטסאפ</a>
```

Replace with:

```html
      <a class="result-btn btn-whatsapp" id="btn-share" href="#" target="_blank">💬 שתף בוואטסאפ</a>
      <a class="result-btn btn-facebook" id="btn-share-fb" href="#" target="_blank">📘 שתף בפייסבוק</a>
```

- [ ] **Step 2: Add CSS for the Facebook button**

Find the `.btn-whatsapp` CSS rule in `quiz/index.html` (it's in the `<style>` block). Add right after it:

```css
.btn-facebook { background: #1877f2; color: #fff; }
.btn-facebook:hover { background: #1465d4; }
```

- [ ] **Step 3: Wire the button in showResult()**

In `quiz/index.html`, find the `if (won)` block in `showResult()` (around line 566):

```js
  if (won) {
    document.getElementById('btn-gallery').style.display = '';
    const waText = encodeURIComponent(`ניצחתי במשחק "מאיפה הצילום?" של עמית! 🎉 — ${QUIZ_URL}`);
    document.getElementById('btn-share').href = `https://wa.me/?text=${waText}`;
  } else {
    document.getElementById('btn-gallery').style.display = 'none';
    document.getElementById('result-badge').textContent = '🌍 סיבוב הושלם';
  }
```

Replace with:

```js
  if (won) {
    document.getElementById('btn-gallery').style.display = '';
    const waText = encodeURIComponent(`ניצחתי במשחק "מאיפה הצילום?" של עמית! 🎉 — ${QUIZ_URL}`);
    document.getElementById('btn-share').href = `https://wa.me/?text=${waText}`;
    document.getElementById('btn-share-fb').href = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(QUIZ_URL)}`;
    document.getElementById('btn-share-fb').style.display = '';
  } else {
    document.getElementById('btn-gallery').style.display = 'none';
    document.getElementById('btn-share-fb').style.display = 'none';
    document.getElementById('result-badge').textContent = '🌍 סיבוב הושלם';
  }
```

- [ ] **Step 4: Verify manually**

Open `http://localhost:8000/quiz/` and complete a winning round (6+ correct).

Expected:
- Win screen shows three buttons: gold "לגלריה המבצע", green "שתף בוואטסאפ", blue "שתף בפייסבוק"
- Clicking Facebook button opens `https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Famitphotos.com%2Fquiz%2F` in new tab
- Lose screen shows Facebook button hidden (only "סיבוב חדש" visible)

- [ ] **Step 5: Commit**

```bash
git add quiz/index.html
git commit -m "feat: add Facebook share button on quiz win screen"
```

---

### Task 3: Biweekly Promotion Gate

**Files:**
- Modify: `.github/workflows/quiz-social-post.yml`

- [ ] **Step 1: Add the biweekly check step**

Replace the entire contents of `.github/workflows/quiz-social-post.yml` with:

```yaml
name: פרסום פרומו קוויז דו-שבועי

on:
  schedule:
    - cron: '0 15 * * 3'  # כל רביעי 15:00 UTC = 18:00 ישראל
  workflow_dispatch:

jobs:
  quiz-promo:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: בדיקה דו-שבועית
        id: check
        run: |
          WEEK=$(date +%V)
          if [ $(( WEEK % 2 )) -eq 0 ]; then
            echo "run=true" >> $GITHUB_OUTPUT
            echo "שבוע $WEEK — שבוע זוגי, מפרסמים"
          else
            echo "run=false" >> $GITHUB_OUTPUT
            echo "שבוע $WEEK — שבוע אי-זוגי, מדלגים"
          fi

      - name: Python setup
        if: steps.check.outputs.run == 'true'
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: התקנת חבילות
        if: steps.check.outputs.run == 'true'
        run: pip install requests anthropic pillow

      - name: פרסום פרומו קוויז
        if: steps.check.outputs.run == 'true'
        env:
          INSTAGRAM_USER_ID: ${{ secrets.INSTAGRAM_USER_ID }}
          INSTAGRAM_PAGE_TOKEN: ${{ secrets.INSTAGRAM_PAGE_TOKEN }}
          FACEBOOK_PAGE_ID: ${{ secrets.FACEBOOK_PAGE_ID }}
          FACEBOOK_PAGE_TOKEN: ${{ secrets.FACEBOOK_PAGE_TOKEN }}
          ANTHROPIC_API_KEY: ${{ secrets.AMIT_PHOTO_AGENT }}
          ADMIN_TOKEN: ${{ secrets.ADMIN_PASSWORD }}
        run: python src/quiz_social_post.py
```

- [ ] **Step 2: Verify the YAML is valid**

```bash
python -c "import yaml; yaml.safe_load(open('.github/workflows/quiz-social-post.yml'))"
```

Expected: no output (no error).

- [ ] **Step 3: Commit and push**

```bash
git add .github/workflows/quiz-social-post.yml
git commit -m "feat: make quiz social promo biweekly (even ISO weeks only)"
git push
```

- [ ] **Step 4: Verify on GitHub**

Open the repo on GitHub → Actions → "פרסום פרומו קוויז דו-שבועי" → click "Run workflow" (workflow_dispatch).

Expected: workflow runs, the "בדיקה דו-שבועית" step logs either "שבוע זוגי, מפרסמים" or "שבוע אי-זוגי, מדלגים". If odd week, Python setup and run steps show as skipped (grey), not failed.
