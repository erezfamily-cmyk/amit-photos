# Sliding Puzzle Game Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a 4×4 sliding puzzle game at `puzzle/index.html` using random photos from `data/photos.json`, with a win screen that links to the gallery with a 20% discount banner.

**Architecture:** `puzzle/index.html` is a fully self-contained page (HTML + CSS + JS, no external dependencies beyond Google Fonts and `data/photos.json`). Game logic is pure functions on a flat `number[]` of 16 elements (0 = empty tile). Gallery integration adds a discount banner triggered by `?photo=ID&discount=puzzle` URL params, handled in `handleInitialHash()` in `gallery.js`.

**Tech Stack:** Vanilla HTML5/CSS3/JS, Google Fonts (Heebo + Syne), `data/photos.json` for photo data, existing site CSS variables.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `puzzle/index.html` | Create | Self-contained puzzle game page |
| `index.html` | Modify (line ~702) | Add `#puzzle-discount-banner` div inside lightbox |
| `assets/css/style.css` | Modify (append) | CSS for `#puzzle-discount-banner` |
| `assets/js/gallery.js` | Modify `handleInitialHash()` (line ~876) | Detect `?discount=puzzle` and show banner |

---

## Task 1: Scaffold puzzle/index.html

**Files:**
- Create: `puzzle/index.html`

- [ ] **Step 1: Create the file**

```html
<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>פאזל הזזה | עמית ארז</title>
  <link href="https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;600;700&family=Syne:wght@700;800&display=swap" rel="stylesheet">
  <style>
    /* TASK 2 */
  </style>
</head>
<body>
  <nav>
    <a href="../index.html" class="nav-logo">עמית ארז</a>
  </nav>
  <main>
    <div id="game-container">
      <p class="puzzle-label">🧩 פאזל הזזה</p>
      <div id="photo-info">
        <div id="photo-title"></div>
        <div id="photo-category"></div>
      </div>
      <div id="board"></div>
      <div id="stats">
        <span id="timer">00:00</span>
        <span id="moves">0 מהלכים</span>
      </div>
    </div>
  </main>

  <div id="win-modal" class="hidden">
    <!-- TASK 6 -->
  </div>

  <script>
    // TASKS 3-7
  </script>
</body>
</html>
```

- [ ] **Step 2: Verify**

Open `puzzle/index.html` directly in browser. Should show blank dark page (no styling yet) with no console errors.

- [ ] **Step 3: Commit**

```bash
git add puzzle/index.html
git commit -m "feat: scaffold puzzle page"
```

---

## Task 2: Add CSS

**Files:**
- Modify: `puzzle/index.html` — replace `/* TASK 2 */` comment with full CSS

- [ ] **Step 1: Replace the CSS comment**

```css
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg: #0a0a0a;
  --bg-card: #111111;
  --accent: #c8a96e;
  --accent-hover: #e0c080;
  --text: #f0ede8;
  --text-muted: #888;
  --border: #222;
  --radius: 4px;
  --font: 'Heebo', sans-serif;
  --font-display: 'Syne', sans-serif;
  --transition: 0.35s cubic-bezier(0.4, 0, 0.2, 1);
}

body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--font);
  direction: rtl;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

nav {
  padding: 1rem 2rem;
  border-bottom: 1px solid var(--border);
}

.nav-logo {
  font-family: var(--font-display);
  font-size: 1.2rem;
  color: var(--accent);
  text-decoration: none;
}

main {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem 1rem;
}

#game-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  width: 100%;
  max-width: 420px;
}

.puzzle-label {
  font-size: 0.8rem;
  color: var(--text-muted);
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

#photo-info { text-align: center; }

#photo-title {
  font-family: var(--font-display);
  font-size: 1.2rem;
  color: var(--accent);
}

#photo-category {
  font-size: 0.82rem;
  color: var(--text-muted);
  margin-top: 0.15rem;
}

#board {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 3px;
  background: var(--border);
  border: 3px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  width: min(90vw, 400px);
  height: min(90vw, 400px);
  user-select: none;
  touch-action: none;
}

.tile {
  background-color: var(--bg-card);
  background-size: 400% 400%;
  cursor: pointer;
  transition: opacity var(--transition);
}

.tile:hover { opacity: 0.82; }

.tile.empty {
  background: var(--bg);
  cursor: default;
}
.tile.empty:hover { opacity: 1; }

#stats {
  display: flex;
  gap: 2rem;
  color: var(--text-muted);
  font-size: 0.88rem;
}

/* Win modal */
.hidden { display: none !important; }

#win-modal {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.88);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
  padding: 1rem;
  backdrop-filter: blur(8px);
}

.win-box {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  max-width: 400px;
  width: 100%;
  overflow: hidden;
}

.win-photo {
  width: 100%;
  height: 200px;
  object-fit: cover;
  display: block;
}

.win-content {
  padding: 1.5rem;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.win-title {
  font-family: var(--font-display);
  font-size: 1.4rem;
  color: var(--accent);
}

.win-subtitle { color: var(--text-muted); font-size: 0.9rem; }
.win-stats-text { font-size: 0.82rem; color: var(--text-muted); }

.win-discount {
  background: linear-gradient(135deg, rgba(200,169,110,0.15), rgba(200,169,110,0.05));
  border: 1px solid rgba(200,169,110,0.3);
  border-radius: var(--radius);
  padding: 0.75rem;
  font-size: 0.88rem;
  color: var(--accent);
  line-height: 1.5;
}
.win-discount strong { font-size: 1rem; }

.win-actions { display: flex; flex-direction: column; gap: 0.5rem; }

.win-btn {
  display: block;
  width: 100%;
  padding: 0.72rem;
  border-radius: var(--radius);
  font-size: 0.9rem;
  font-weight: 600;
  font-family: var(--font);
  cursor: pointer;
  border: none;
  text-decoration: none;
  text-align: center;
  transition: opacity var(--transition);
}
.win-btn:hover { opacity: 0.82; }

.win-btn-primary  { background: var(--accent); color: #0a0a0a; }
.win-btn-whatsapp { background: #25D366; color: #fff; }
.win-btn-secondary {
  background: transparent;
  color: var(--text-muted);
  border: 1px solid var(--border);
}

.win-share-row { display: flex; gap: 0.5rem; }
.win-share-row .win-btn { flex: 1; }
```

- [ ] **Step 2: Verify**

Refresh `puzzle/index.html`. Should show dark page with gold "עמית ארז" nav link, centered layout. No console errors.

- [ ] **Step 3: Commit**

```bash
git add puzzle/index.html
git commit -m "feat: add puzzle page CSS"
```

---

## Task 3: Load random photo

**Files:**
- Modify: `puzzle/index.html` — replace `// TASKS 3-7` comment

- [ ] **Step 1: Add photo loading code inside the `<script>` tag**

```javascript
// ===== STATE =====
let currentPhoto = null;

// ===== PHOTO LOADING =====
async function loadRandomPhoto() {
  const res = await fetch('../data/photos.json');
  const photos = await res.json();
  currentPhoto = photos[Math.floor(Math.random() * photos.length)];
  document.getElementById('photo-title').textContent = currentPhoto.title;
  document.getElementById('photo-category').textContent = currentPhoto.category;
  return currentPhoto;
}
```

- [ ] **Step 2: Add temporary test call at the bottom of the script**

```javascript
loadRandomPhoto().then(p => console.log('Photo loaded:', p.title, p.thumbnail));
```

- [ ] **Step 3: Serve via HTTP (required for fetch)**

```bash
cd c:/Users/erezf/amit-photos
python -m http.server 8000
```

Open `http://localhost:8000/puzzle/index.html`. Console should show: `Photo loaded: <title> <url>`

- [ ] **Step 4: Remove the test console.log**

Delete the line added in Step 2.

- [ ] **Step 5: Commit**

```bash
git add puzzle/index.html
git commit -m "feat: load random photo from photos.json"
```

---

## Task 4: Pure game logic

**Files:**
- Modify: `puzzle/index.html` — add functions inside `<script>`, after `loadRandomPhoto`

The board is a flat array of 16 numbers: `0` = empty tile, `1–15` = tile values. Solved state: `[1,2,3,...,15,0]`.

- [ ] **Step 1: Add the game logic functions**

```javascript
// ===== GAME LOGIC =====
const SIZE = 4;
const TOTAL = SIZE * SIZE;

function solvedBoard() {
  return [...Array(TOTAL - 1).keys()].map(i => i + 1).concat(0);
  // → [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,0]
}

function emptyIndex(board) {
  return board.indexOf(0);
}

function canMove(board, tileIdx) {
  const emptyIdx = emptyIndex(board);
  const tileRow = Math.floor(tileIdx / SIZE);
  const tileCol = tileIdx % SIZE;
  const emptyRow = Math.floor(emptyIdx / SIZE);
  const emptyCol = emptyIdx % SIZE;
  return (tileRow === emptyRow && Math.abs(tileCol - emptyCol) === 1) ||
         (tileCol === emptyCol && Math.abs(tileRow - emptyRow) === 1);
}

function moveTile(board, tileIdx) {
  if (!canMove(board, tileIdx)) return null;
  const next = [...board];
  const emptyIdx = emptyIndex(board);
  [next[tileIdx], next[emptyIdx]] = [next[emptyIdx], next[tileIdx]];
  return next;
}

function isSolved(board) {
  return board.every((v, i) => v === (i === TOTAL - 1 ? 0 : i + 1));
}

function shuffle(board) {
  let b = [...board];
  let lastEmpty = emptyIndex(b);
  for (let i = 0; i < 200; i++) {
    const row = Math.floor(lastEmpty / SIZE);
    const col = lastEmpty % SIZE;
    const neighbors = [];
    if (row > 0)         neighbors.push(lastEmpty - SIZE);
    if (row < SIZE - 1)  neighbors.push(lastEmpty + SIZE);
    if (col > 0)         neighbors.push(lastEmpty - 1);
    if (col < SIZE - 1)  neighbors.push(lastEmpty + 1);
    const pick = neighbors[Math.floor(Math.random() * neighbors.length)];
    [b[lastEmpty], b[pick]] = [b[pick], b[lastEmpty]];
    lastEmpty = pick;
  }
  return b;
}
```

- [ ] **Step 2: Verify in browser console at http://localhost:8000/puzzle/index.html**

```javascript
const b = solvedBoard();
console.log('solved?', isSolved(b));           // true
const s = shuffle(b);
console.log('shuffled solved?', isSolved(s));  // false (almost always)
const next = moveTile(s, s.indexOf(14));
console.log('moveTile returns array?', Array.isArray(next)); // true or null
```

- [ ] **Step 3: Commit**

```bash
git add puzzle/index.html
git commit -m "feat: add pure game logic functions"
```

---

## Task 5: Render board and handle clicks

**Files:**
- Modify: `puzzle/index.html` — add render/state code inside `<script>`, after game logic

- [ ] **Step 1: Add mutable state, renderBoard, handleTileClick, startGame**

```javascript
// ===== RENDER & STATE =====
let board = [];
let moveCount = 0;
let timerInterval = null;
let secondsElapsed = 0;
let gameActive = false;

function formatTime(secs) {
  const m = String(Math.floor(secs / 60)).padStart(2, '0');
  const s = String(secs % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function renderBoard(photo) {
  const boardEl = document.getElementById('board');
  boardEl.innerHTML = '';
  board.forEach((value, idx) => {
    const tile = document.createElement('div');
    tile.className = 'tile' + (value === 0 ? ' empty' : '');
    tile.dataset.idx = idx;
    if (value !== 0) {
      const solvedIdx = value - 1;
      const solvedRow = Math.floor(solvedIdx / SIZE);
      const solvedCol = solvedIdx % SIZE;
      tile.style.backgroundImage = `url('${photo.thumbnail}')`;
      tile.style.backgroundSize = `${SIZE * 100}% ${SIZE * 100}%`;
      tile.style.backgroundPosition =
        `${solvedCol * (100 / (SIZE - 1))}% ${solvedRow * (100 / (SIZE - 1))}%`;
    }
    tile.addEventListener('click', () => handleTileClick(idx));
    boardEl.appendChild(tile);
  });
}

function handleTileClick(idx) {
  if (!gameActive) return;
  const next = moveTile(board, idx);
  if (!next) return;
  board = next;
  moveCount++;
  document.getElementById('moves').textContent = `${moveCount} מהלכים`;
  renderBoard(currentPhoto);
  if (isSolved(board)) onWin();
}

function startGame(photo) {
  board = shuffle(solvedBoard());
  moveCount = 0;
  secondsElapsed = 0;
  gameActive = true;
  document.getElementById('moves').textContent = '0 מהלכים';
  document.getElementById('timer').textContent = '00:00';
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    secondsElapsed++;
    document.getElementById('timer').textContent = formatTime(secondsElapsed);
  }, 1000);
  renderBoard(photo);
}

function onWin() {
  // TASK 6
}
```

- [ ] **Step 2: Add init function at the bottom of the script**

```javascript
async function init() {
  const photo = await loadRandomPhoto();
  startGame(photo);
}

init();
```

- [ ] **Step 3: Verify in browser**

Go to `http://localhost:8000/puzzle/index.html`. You should see:
- A shuffled 4×4 photo grid
- Photo title and category above the board
- Timer counting up
- Clicking tiles adjacent to the empty space moves them

- [ ] **Step 4: Commit**

```bash
git add puzzle/index.html
git commit -m "feat: render board and handle tile clicks"
```

---

## Task 6: Win screen

**Files:**
- Modify: `puzzle/index.html` — fill in win modal HTML and `onWin()` function

- [ ] **Step 1: Replace `<!-- TASK 6 -->` inside `#win-modal` with**

```html
<div class="win-box">
  <img id="win-photo-img" class="win-photo" src="" alt="">
  <div class="win-content">
    <div class="win-title">🏆 כל הכבוד!</div>
    <div class="win-subtitle" id="win-photo-name"></div>
    <div class="win-stats-text" id="win-stats-text"></div>
    <div class="win-discount">
      🎁 כמתנה על הפתרון — <strong>20% הנחה</strong> לרכישת התמונה<br>
      <small style="color:var(--text-muted)">בתוקף 24 שעות</small>
    </div>
    <div class="win-actions">
      <a id="win-gallery-btn" href="#" class="win-btn win-btn-primary">📸 לתמונה בגלריה + הנחה</a>
      <div class="win-share-row">
        <a id="win-whatsapp-btn" href="#" target="_blank" class="win-btn win-btn-whatsapp">💬 שתף</a>
        <button id="win-copy-btn" class="win-btn win-btn-secondary">🔗 העתק קישור</button>
      </div>
      <button id="win-new-btn" class="win-btn win-btn-secondary">🔄 פאזל חדש</button>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Replace the `onWin() { // TASK 6 }` stub with**

```javascript
function onWin() {
  gameActive = false;
  clearInterval(timerInterval);

  const galleryUrl = `../index.html?photo=${currentPhoto.id}&discount=puzzle`;
  const shareUrl   = `https://amitphotos.com/puzzle/`;
  const shareText  = `פתרתי פאזל של "${currentPhoto.title}" באתר עמית ארז! 🧩\nרוצה לנסות? `;

  document.getElementById('win-photo-img').src = currentPhoto.thumbnail;
  document.getElementById('win-photo-img').alt = currentPhoto.title;
  document.getElementById('win-photo-name').textContent = `"${currentPhoto.title}"`;
  document.getElementById('win-stats-text').textContent =
    `${formatTime(secondsElapsed)} · ${moveCount} מהלכים`;
  document.getElementById('win-gallery-btn').href = galleryUrl;
  document.getElementById('win-whatsapp-btn').href =
    `https://wa.me/?text=${encodeURIComponent(shareText + shareUrl)}`;

  document.getElementById('win-copy-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(shareUrl).then(() => {
      const btn = document.getElementById('win-copy-btn');
      btn.textContent = '✓ הועתק!';
      setTimeout(() => { btn.textContent = '🔗 העתק קישור'; }, 2000);
    });
  });

  document.getElementById('win-new-btn').addEventListener('click', () => {
    document.getElementById('win-modal').classList.add('hidden');
    init();
  });

  document.getElementById('win-modal').classList.remove('hidden');
}
```

- [ ] **Step 3: Test win screen via console**

In browser console:
```javascript
board = solvedBoard();
renderBoard(currentPhoto);
onWin();
```

Win modal should appear with: photo image, title, time + moves, discount banner, gallery link, WhatsApp share, copy link button, new game button.

- [ ] **Step 4: Click "פאזל חדש" — win modal should close and a new game start**

- [ ] **Step 5: Commit**

```bash
git add puzzle/index.html
git commit -m "feat: add win screen with discount and share"
```

---

## Task 7: Keyboard and swipe controls

**Files:**
- Modify: `puzzle/index.html` — add event listeners inside `<script>`, before `init()`

- [ ] **Step 1: Add keyboard controls**

```javascript
// ===== KEYBOARD =====
document.addEventListener('keydown', (e) => {
  if (!gameActive) return;
  const emptyIdx = emptyIndex(board);
  const eRow = Math.floor(emptyIdx / SIZE);
  const eCol = emptyIdx % SIZE;
  let tileIdx = -1;
  // Arrow key direction = direction the tile moves (tile slides into empty)
  if (e.key === 'ArrowUp'    && eRow < SIZE - 1) tileIdx = emptyIdx + SIZE;
  if (e.key === 'ArrowDown'  && eRow > 0)        tileIdx = emptyIdx - SIZE;
  if (e.key === 'ArrowLeft'  && eCol < SIZE - 1) tileIdx = emptyIdx + 1;
  if (e.key === 'ArrowRight' && eCol > 0)        tileIdx = emptyIdx - 1;
  if (tileIdx >= 0) { e.preventDefault(); handleTileClick(tileIdx); }
});
```

- [ ] **Step 2: Add touch/swipe controls**

```javascript
// ===== SWIPE =====
let touchStartX = 0, touchStartY = 0;

document.getElementById('board').addEventListener('touchstart', (e) => {
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
}, { passive: true });

document.getElementById('board').addEventListener('touchend', (e) => {
  if (!gameActive) return;
  const dx = e.changedTouches[0].clientX - touchStartX;
  const dy = e.changedTouches[0].clientY - touchStartY;
  const emptyIdx = emptyIndex(board);
  const eRow = Math.floor(emptyIdx / SIZE);
  const eCol = emptyIdx % SIZE;
  let tileIdx = -1;
  if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 30) {
    if (dx < 0 && eCol < SIZE - 1) tileIdx = emptyIdx + 1;
    if (dx > 0 && eCol > 0)        tileIdx = emptyIdx - 1;
  } else if (Math.abs(dy) > 30) {
    if (dy < 0 && eRow < SIZE - 1) tileIdx = emptyIdx + SIZE;
    if (dy > 0 && eRow > 0)        tileIdx = emptyIdx - SIZE;
  }
  if (tileIdx >= 0) handleTileClick(tileIdx);
}, { passive: true });
```

- [ ] **Step 3: Verify keyboard**

Click on the page to focus it, then press arrow keys. Tiles should move.

- [ ] **Step 4: Verify swipe (DevTools mobile emulation)**

Open DevTools → Toggle device toolbar → try swiping on the board.

- [ ] **Step 5: Commit**

```bash
git add puzzle/index.html
git commit -m "feat: add keyboard and swipe controls"
```

---

## Task 8: Gallery discount integration

**Files:**
- Modify: `index.html` line ~702 — add banner div inside lightbox
- Modify: `assets/css/style.css` — append discount banner CSS
- Modify: `assets/js/gallery.js` line ~876 — extend `handleInitialHash()`

- [ ] **Step 1: Add banner HTML to `index.html`**

After line 702 (`</div>` closing `.lb-actions`), insert:

```html
    <div id="puzzle-discount-banner" class="hidden">
      🎁 ניצחת בפאזל! <strong>20% הנחה</strong> על התמונה הזו<br>
      <a id="puzzle-discount-contact" href="#" target="_blank">צור קשר לרכישה במחיר מוזל</a>
    </div>
```

- [ ] **Step 2: Append CSS to `assets/css/style.css`**

```css
/* ===== PUZZLE DISCOUNT BANNER ===== */
#puzzle-discount-banner {
  margin: 0.75rem 1rem 0;
  padding: 0.75rem 1rem;
  background: linear-gradient(135deg, rgba(200,169,110,0.15), rgba(200,169,110,0.05));
  border: 1px solid rgba(200,169,110,0.3);
  border-radius: 4px;
  font-size: 0.88rem;
  color: var(--accent);
  text-align: center;
  line-height: 1.6;
  direction: rtl;
}
#puzzle-discount-banner a {
  color: var(--accent);
  font-weight: 700;
  text-decoration: underline;
}
```

- [ ] **Step 3: Extend `handleInitialHash()` in `assets/js/gallery.js`**

`handleInitialHash()` starts at line 876. At the very beginning of the function, before the `const hash = window.location.hash;` line, add:

```javascript
  // Puzzle discount: ?photo=ID&discount=puzzle
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('discount') === 'puzzle') {
    const photoId = urlParams.get('photo');
    if (photoId) {
      let idx = filteredPhotos.findIndex(p => String(p.id) === photoId);
      if (idx === -1) {
        const photo = allPhotos.find(p => String(p.id) === photoId);
        if (photo) {
          filteredPhotos.unshift(photo);
          displayedCount = Math.max(displayedCount, 1);
          renderGallery();
          idx = 0;
        }
      }
      if (idx !== -1) {
        openLightbox(idx);
        const banner = document.getElementById('puzzle-discount-banner');
        if (banner) {
          banner.classList.remove('hidden');
          const photo = filteredPhotos[idx];
          const waText = encodeURIComponent(
            `היי עמית, ניצחתי בפאזל ורוצה לרכוש את התמונה "${photo.title}" במחיר המוזל 😊`
          );
          document.getElementById('puzzle-discount-contact').href =
            `https://wa.me/972503333227?text=${waText}`;
        }
      }
    }
    return;
  }
```

- [ ] **Step 4: Test the full flow**

1. Go to `http://localhost:8000/puzzle/index.html`
2. In console: `board = solvedBoard(); renderBoard(currentPhoto); onWin();`
3. Click "לתמונה בגלריה + הנחה"
4. Gallery opens, lightbox shows the correct photo with the gold discount banner and a WhatsApp link

- [ ] **Step 5: Commit**

```bash
git add index.html assets/css/style.css assets/js/gallery.js
git commit -m "feat: show puzzle discount banner in gallery lightbox"
```

---

## Task 9: Cleanup and push

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Add .superpowers to .gitignore**

```bash
grep -q "\.superpowers" .gitignore || echo ".superpowers/" >> .gitignore
```

- [ ] **Step 2: Full browser test checklist**

Open `http://localhost:8000/puzzle/index.html` and verify each item:

- [ ] Photo loads — title and category show above board
- [ ] Board is shuffled (tiles not in order 1–15)
- [ ] Clicking a tile adjacent to the empty space moves it
- [ ] Clicking a tile not adjacent to empty does nothing
- [ ] Timer counts up every second
- [ ] Move counter increments with each valid move
- [ ] Arrow keys move tiles (ArrowUp moves tile from below empty into empty)
- [ ] Swipe works in DevTools mobile emulation
- [ ] Win screen triggers when puzzle is solved (test via console: `board = solvedBoard(); renderBoard(currentPhoto); onWin();`)
- [ ] Win screen shows: photo, title in quotes, time, move count, discount banner
- [ ] "לתמונה בגלריה + הנחה" opens `../index.html?photo=<id>&discount=puzzle`
- [ ] Gallery lightbox opens to correct photo with discount banner
- [ ] WhatsApp links open correct URL
- [ ] "העתק קישור" copies URL and shows "✓ הועתק!"
- [ ] "פאזל חדש" closes win modal and loads a new random photo

- [ ] **Step 3: Push**

```bash
git add .gitignore
git commit -m "chore: add .superpowers to .gitignore"
git push
```
