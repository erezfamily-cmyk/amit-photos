# Buy Modal 2-Step Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat buy modal (click size → PayPal immediately) with a 2-step wizard: Step 1 = choose resolution, Step 2 = confirm order + PayPal button.

**Architecture:** The buy modal HTML is rewritten with two sibling divs (`#buy-step-1`, `#buy-step-2`). JS shows/hides steps. Clicking a size row auto-advances to step 2; back button returns to step 1. `redirectToPayPal()` is called only from the step 2 PayPal button. All text is i18n-keyed.

**Tech Stack:** Vanilla JS, CSS custom properties, `data-i18n` attributes for i18n (same pattern as rest of site).

---

## File Map

| File | Change |
|------|--------|
| `assets/js/i18n.js` | Add 8 new translation keys (HE + EN) |
| `index.html` | Replace `#buy-modal` inner HTML with 2-step structure |
| `assets/css/style.css` | Add styles for step indicator, row-style size options, step 2 layout |
| `assets/js/gallery.js` | Rewrite `initBuyModal()` + `openBuyModal()`, add `showBuyStep2()` |

---

## Task 1: Add i18n keys

**Files:**
- Modify: `assets/js/i18n.js`

- [ ] **Step 1: Add Hebrew keys**

Find the Hebrew section around line 235 (after `'buy.size.requires'`). Add:

```js
    'buy.step.size.done': 'רזולוציה',
    'buy.step.confirm':   'אישור',
    'buy.confirm.buying': 'אתה קונה',
    'buy.total':          'סה״כ לתשלום',
    'buy.paypal.btn':     'שלם עם PayPal',
    'buy.secure.note':    '🔒 תועבר לדף התשלום המאובטח של PayPal',
    'buy.auto.download':  'הקובץ יורד אוטומטית לאחר האישור',
    'buy.back':           '← חזרה',
```

- [ ] **Step 2: Add English keys**

Find the English section around line 526 (after `'buy.size.requires'`). Add:

```js
    'buy.step.size.done': 'Resolution',
    'buy.step.confirm':   'Confirm',
    'buy.confirm.buying': "You're buying",
    'buy.total':          'Total',
    'buy.paypal.btn':     'Pay with PayPal',
    'buy.secure.note':    '🔒 You\'ll be redirected to PayPal\'s secure checkout',
    'buy.auto.download':  'File downloads automatically after payment',
    'buy.back':           '← Back',
```

- [ ] **Step 3: Commit**

```bash
git add assets/js/i18n.js
git commit -m "feat: add buy wizard i18n keys (HE+EN)"
```

---

## Task 2: Update buy modal HTML in index.html

**Files:**
- Modify: `index.html` lines 641–674

The existing buy modal block:
```html
  <!-- ===== BUY MODAL ===== -->
  <div class="buy-modal" id="buy-modal" ...>
    <div class="buy-modal-inner">
      <button class="buy-modal-close" id="buy-modal-close" ...>✕</button>
      <div class="buy-modal-preview"> ... </div>
      <p class="buy-modal-label" ...>רכישת תמונה</p>
      <h3 class="buy-modal-title" id="buy-modal-title"></h3>
      <p class="buy-modal-subtitle" ...>בחר רזולוציה</p>
      <div class="buy-size-options"> ... </div>
      <p class="buy-modal-note" ...>...</p>
    </div>
  </div>
```

- [ ] **Step 1: Replace entire buy modal inner content**

Replace the block from `<!-- ===== BUY MODAL ===== -->` through the closing `</div>` of `buy-modal` (before `<!-- ===== PRINT MODAL ===== -->`):

```html
  <!-- ===== BUY MODAL ===== -->
  <div class="buy-modal" id="buy-modal" aria-modal="true" role="dialog" data-i18n-aria="buy.modal.aria" aria-label="רכישת תמונה">
    <div class="buy-modal-inner">
      <button class="buy-modal-close" id="buy-modal-close" data-i18n-aria="close" aria-label="סגור">✕</button>

      <!-- STEP 1 -->
      <div id="buy-step-1">
        <div class="buy-step-indicator">
          <div class="buy-step-item active" id="buy-dot-1-item">
            <div class="buy-step-dot" id="buy-dot-1">1</div>
            <span class="buy-step-label" data-i18n="buy.subtitle">בחר רזולוציה</span>
          </div>
          <div class="buy-step-line"></div>
          <div class="buy-step-item" id="buy-dot-2-item-s1">
            <div class="buy-step-dot" id="buy-dot-2-s1">2</div>
            <span class="buy-step-label" data-i18n="buy.step.confirm">אישור</span>
          </div>
        </div>

        <div class="buy-modal-preview">
          <img id="buy-modal-img" src="" alt="" />
        </div>
        <h3 class="buy-modal-title" id="buy-modal-title"></h3>

        <div class="buy-size-options-v2">
          <button class="buy-size-row" data-size="small" data-price="39">
            <div class="buy-size-row-left">
              <span class="buy-size-name" data-i18n="buy.size.small">קובץ רשת</span>
              <span class="buy-size-px">1500px</span>
              <span class="buy-size-use" data-i18n="buy.size.small.use">רשתות חברתיות</span>
            </div>
            <span class="buy-size-price">₪39</span>
          </button>
          <button class="buy-size-row buy-size-popular" data-size="medium" data-price="89">
            <span class="buy-size-badge" data-i18n="buy.recommended">מומלץ</span>
            <div class="buy-size-row-left">
              <span class="buy-size-name" data-i18n="buy.size.medium">קובץ הדפסה</span>
              <span class="buy-size-px">3000px</span>
              <span class="buy-size-use" data-i18n="buy.size.medium.use">הדפסה עד A4</span>
            </div>
            <span class="buy-size-price">₪89</span>
          </button>
          <button class="buy-size-row" data-size="large" data-price="179">
            <div class="buy-size-row-left">
              <span class="buy-size-name" data-i18n="buy.size.large">קובץ מלא</span>
              <span class="buy-size-px buy-size-large-px" data-i18n="buy.size.large.px">רזולוציה מקסימלית</span>
              <span class="buy-size-use" data-i18n="buy.size.large.use">הדפסה גדולה</span>
            </div>
            <span class="buy-size-price">₪179</span>
          </button>
        </div>
      </div>

      <!-- STEP 2 -->
      <div id="buy-step-2" style="display:none">
        <div class="buy-step-indicator">
          <div class="buy-step-item done">
            <div class="buy-step-dot">✓</div>
            <span class="buy-step-label" data-i18n="buy.step.size.done">רזולוציה</span>
          </div>
          <div class="buy-step-line active"></div>
          <div class="buy-step-item active">
            <div class="buy-step-dot">2</div>
            <span class="buy-step-label" data-i18n="buy.step.confirm">אישור</span>
          </div>
        </div>

        <div class="buy-confirm-row">
          <div class="buy-confirm-thumb">
            <img id="buy-confirm-img" src="" alt="" />
          </div>
          <div class="buy-confirm-details">
            <p class="buy-confirm-label" data-i18n="buy.confirm.buying">אתה קונה</p>
            <h4 class="buy-confirm-title" id="buy-confirm-title"></h4>
            <p class="buy-confirm-size" id="buy-confirm-size"></p>
          </div>
        </div>

        <div class="buy-total-row">
          <span data-i18n="buy.total">סה״כ לתשלום</span>
          <span class="buy-total-amount" id="buy-total-amount">₪89</span>
        </div>

        <button class="buy-paypal-btn" id="buy-paypal-btn">
          <span data-i18n="buy.paypal.btn">שלם עם PayPal</span>
        </button>

        <p class="buy-modal-note" style="margin-top:0.75rem">
          <span data-i18n="buy.secure.note">🔒 תועבר לדף התשלום המאובטח של PayPal</span><br>
          <span data-i18n="buy.auto.download">הקובץ יורד אוטומטית לאחר האישור</span>
        </p>

        <button class="buy-back-btn" id="buy-back-btn" data-i18n="buy.back">← חזרה</button>
      </div>

    </div>
  </div>
```

- [ ] **Step 2: Verify HTML looks correct**

Open `index.html` in browser (python -m http.server 8000), open buy modal on any photo. Step 1 should show: step indicator, photo preview, title, 3 row-style size options. Step 2 should be hidden. No JS wired yet so clicking sizes does nothing.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: buy modal 2-step wizard HTML structure"
```

---

## Task 3: Add wizard CSS to style.css

**Files:**
- Modify: `assets/css/style.css` — add after line 1252 (after `.buy-modal-note--warning`)

- [ ] **Step 1: Add step indicator + row styles**

After the `.buy-modal-note--warning` rule (around line 1252), insert:

```css
/* === BUY WIZARD: STEP INDICATOR === */
.buy-step-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  margin-bottom: 1.25rem;
  padding-top: 0.25rem;
}
.buy-step-item {
  display: flex;
  align-items: center;
  gap: 0.3rem;
}
.buy-step-dot {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #1a1a1a;
  border: 1px solid #333;
  color: #555;
  font-size: 0.62rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.buy-step-item.active .buy-step-dot {
  background: var(--accent);
  border-color: var(--accent);
  color: #0a0a0a;
}
.buy-step-item.done .buy-step-dot {
  background: #2a2a2a;
  border-color: #444;
  color: #888;
}
.buy-step-label {
  font-size: 0.65rem;
  color: #444;
}
.buy-step-item.active .buy-step-label {
  color: var(--accent);
}
.buy-step-item.done .buy-step-label {
  color: #555;
}
.buy-step-line {
  width: 24px;
  height: 1px;
  background: #333;
  flex-shrink: 0;
}

/* === BUY WIZARD: STEP 1 ROW-STYLE SIZE OPTIONS === */
.buy-size-options-v2 {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 1.25rem;
}
.buy-size-row {
  background: #1a1a1a;
  border: 1px solid #2a2a2a;
  border-radius: 4px;
  padding: 0.75rem 1rem;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  text-align: right;
  position: relative;
  transition: border-color 0.2s, background 0.2s;
  width: 100%;
}
.buy-size-row:hover {
  border-color: var(--accent);
  background: #1f1f1f;
}
.buy-size-row.buy-size-popular {
  border-color: rgba(200,169,110,0.4);
}
.buy-size-row.buy-size-unavailable {
  opacity: 0.35;
  cursor: not-allowed;
  border-color: #222 !important;
}
.buy-size-row.buy-size-unavailable:hover {
  background: #1a1a1a !important;
  border-color: #222 !important;
}
.buy-size-row-left {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.15rem;
}
.buy-size-row .buy-size-px {
  font-size: 0.68rem;
}
.buy-size-row.buy-size-unavailable .buy-size-px {
  color: #e05050;
}

/* === BUY WIZARD: STEP 2 CONFIRM === */
.buy-confirm-row {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  margin-bottom: 1.25rem;
  text-align: right;
}
.buy-confirm-thumb {
  width: 72px;
  height: 72px;
  border-radius: 4px;
  overflow: hidden;
  flex-shrink: 0;
  background: #0a0a0a;
}
.buy-confirm-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.buy-confirm-details {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.2rem;
  flex: 1;
}
.buy-confirm-label {
  font-size: 0.68rem;
  color: var(--text-muted);
}
.buy-confirm-title {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--text);
  line-height: 1.3;
}
.buy-confirm-size {
  font-size: 0.72rem;
  color: var(--accent);
}
.buy-total-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-top: 1px solid #1e1e1e;
  border-bottom: 1px solid #1e1e1e;
  padding: 0.65rem 0;
  margin-bottom: 1rem;
  font-size: 0.82rem;
  color: var(--text-muted);
}
.buy-total-amount {
  font-size: 1.2rem;
  font-weight: 700;
  color: var(--text);
}
.buy-paypal-btn {
  width: 100%;
  background: #0070ba;
  color: #fff;
  border: none;
  border-radius: 4px;
  padding: 0.8rem 1rem;
  font-size: 0.9rem;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.2s;
  margin-bottom: 0.5rem;
}
.buy-paypal-btn:hover {
  background: #005ea6;
}
.buy-back-btn {
  background: none;
  border: none;
  color: var(--accent);
  font-size: 0.8rem;
  cursor: pointer;
  padding: 0.5rem 0;
  margin-top: 0.5rem;
  display: block;
  width: 100%;
  text-align: center;
}
.buy-back-btn:hover {
  color: var(--text);
}
```

- [ ] **Step 2: Add mobile touch target for buy-size-row**

Find the media query block containing `.buy-size-btn { min-height: 44px; }` (around line 763). Add alongside it:

```css
  .buy-size-row {
    min-height: 52px;
  }
```

- [ ] **Step 3: Verify CSS visually**

Open browser with local server. Click buy on a photo. Step 1 should show:
- Centered step indicator (dot 1 gold active, dot 2 dark inactive)
- Photo preview banner
- Photo title
- 3 vertical row buttons (small/medium/large) with name+px+use on left, price on right
- "מומלץ" badge floating above medium row
- Clicking rows does nothing yet (JS not wired)

Step 2 is still hidden. Confirm no layout breakage on mobile (375px width).

- [ ] **Step 4: Commit**

```bash
git add assets/css/style.css
git commit -m "feat: buy wizard CSS — step indicator + row options + confirm layout"
```

---

## Task 4: Rewrite buy modal JS in gallery.js

**Files:**
- Modify: `assets/js/gallery.js` — `initBuyModal()` (line ~964), `openBuyModal()` (line ~985), `closeBuyModal()` (line ~1024)

- [ ] **Step 1: Replace `initBuyModal()`**

Find and replace the entire `initBuyModal` function (lines ~964–983):

```js
function initBuyModal() {
  const modal = document.getElementById('buy-modal');
  if (!modal) return;

  document.getElementById('buy-modal-close').addEventListener('click', closeBuyModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeBuyModal(); });

  // Step 1: clicking a size row auto-advances to step 2
  document.getElementById('buy-step-1').querySelectorAll('.buy-size-row').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled || btn.classList.contains('buy-size-unavailable')) return;
      const size = btn.dataset.size;
      const photo = modal._photo;
      if (!photo) return;
      showBuyStep2(photo, size);
    });
  });

  // Step 2: PayPal button
  document.getElementById('buy-paypal-btn').addEventListener('click', () => {
    const photo = modal._photo;
    const size  = modal._selectedSize;
    if (!photo || !size) return;
    redirectToPayPal(photo, size);
  });

  // Step 2: back button
  document.getElementById('buy-back-btn').addEventListener('click', () => {
    document.getElementById('buy-step-2').style.display = 'none';
    document.getElementById('buy-step-1').style.display = '';
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal.classList.contains('open')) closeBuyModal();
  });
}
```

- [ ] **Step 2: Replace `openBuyModal()`**

Find and replace the entire `openBuyModal` function (lines ~985–1022):

```js
function openBuyModal(photo) {
  if (!photo) return;
  const modal = document.getElementById('buy-modal');
  modal._photo = photo;

  // Photo preview + title
  const previewImg = document.getElementById('buy-modal-img');
  if (previewImg) {
    previewImg.alt = photo.title;
    previewImg.src = photo.thumbnail || photo.url;
    previewImg.onerror = () => { if (photo.url && previewImg.src !== photo.url) previewImg.src = photo.url; };
  }
  document.getElementById('buy-modal-title').textContent = photo.title;

  // Size availability based on source resolution
  const maxDim = Math.max(photo.width || 0, photo.height || 0);
  document.getElementById('buy-step-1').querySelectorAll('.buy-size-row').forEach(btn => {
    const size = btn.dataset.size;
    let available = true;
    if (size === 'medium' && maxDim < 3000) available = false;
    if (size === 'large'  && maxDim < 5000) available = false;

    btn.disabled = !available;
    btn.classList.toggle('buy-size-unavailable', !available);

    const pxEl = btn.querySelector('.buy-size-px');
    if (size === 'large' && pxEl) {
      pxEl.textContent = maxDim >= 5000
        ? `${photo.width}×${photo.height}px`
        : t('buy.size.requires', { min: 5000, actual: maxDim });
    }
    if (size === 'medium' && pxEl && maxDim < 3000) {
      pxEl.textContent = t('buy.size.requires', { min: 3000, actual: maxDim });
    }
  });

  // Always start at step 1
  document.getElementById('buy-step-1').style.display = '';
  document.getElementById('buy-step-2').style.display = 'none';

  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}
```

- [ ] **Step 3: Add `showBuyStep2()` after `openBuyModal()`**

After the `openBuyModal` function, add:

```js
function showBuyStep2(photo, size) {
  const modal = document.getElementById('buy-modal');
  modal._selectedSize = size;

  const s = SIZES[size];

  // Thumbnail
  const confirmImg = document.getElementById('buy-confirm-img');
  confirmImg.alt = photo.title;
  confirmImg.src = photo.thumbnail || photo.url;
  confirmImg.onerror = () => { if (photo.url && confirmImg.src !== photo.url) confirmImg.src = photo.url; };

  // Title + size label
  document.getElementById('buy-confirm-title').textContent = photo.title;

  const maxDim = Math.max(photo.width || 0, photo.height || 0);
  let pxLabel;
  if (size === 'small')  pxLabel = '1500px';
  if (size === 'medium') pxLabel = '3000px';
  if (size === 'large')  pxLabel = maxDim >= 5000 ? `${photo.width}×${photo.height}px` : t('buy.size.large.px');
  document.getElementById('buy-confirm-size').textContent = `${t('buy.size.' + size)} · ${pxLabel}`;

  // Price
  document.getElementById('buy-total-amount').textContent = `₪${s.price}`;

  // Show step 2
  document.getElementById('buy-step-1').style.display = 'none';
  document.getElementById('buy-step-2').style.display = '';
}
```

- [ ] **Step 4: Verify full flow in browser**

Open local server. Click "רכישה" on a photo.

✓ Step 1 shows with photo preview, title, 3 size rows  
✓ Clicking "קובץ רשת" (₪39) → step 2 shows: thumbnail, title, "קובץ רשת · 1500px", "סה״כ: ₪39", PayPal button  
✓ Clicking "← חזרה" → returns to step 1  
✓ Clicking "קובץ הדפסה" (₪89) → step 2 shows: "קובץ הדפסה · 3000px", "₪89"  
✓ Clicking "שלם עם PayPal" → redirects to PayPal with correct params  
✓ ESC key closes modal  
✓ Clicking outside modal closes it  
✓ Switch to English via HE|EN toggle → step labels in English, back button says "← Back"  

Also check a low-res photo (< 3000px): medium and large rows should be greyed out and unclickable.

- [ ] **Step 5: Commit**

```bash
git add assets/js/gallery.js
git commit -m "feat: buy modal wizard JS — 2-step flow with auto-advance and back"
```

---

## Task 5: Deploy and verify live

- [ ] **Step 1: Deploy to Cloudflare**

```bash
wrangler deploy
```

Expected output: `✓ Deployed` with worker URL. No errors.

- [ ] **Step 2: Hard-refresh amitphotos.com**

Open https://amitphotos.com in browser. Hard-refresh (Ctrl+Shift+R). Click buy on any photo. Verify the 2-step flow works live.

- [ ] **Step 3: Test on mobile viewport**

In DevTools, switch to 375px mobile viewport. Verify:
- Step 1 size rows are readable (name + px + price visible)
- "מומלץ" badge doesn't overlap weirdly
- Step 2 thumbnail + details row fits without overflow
- PayPal button is full width and tappable

- [ ] **Step 4: Push to git**

```bash
git push
```

---

## Notes

- `SIZES` object (gallery.js line ~958) has `{ small, medium, large }` with `.label`, `.price`, `.sz` — use `SIZES[size].price` for amount.
- `redirectToPayPal(photo, size)` is unchanged — it reads from `SIZES[size]` and builds PayPal URL.
- The `buy-size-popular` CSS class (gold border tint) now applies to the `medium` row (₪89), not `large`. This matches the mockup's "מומלץ" recommendation.
- Step 2 layout is `direction: rtl` (inherited from `.buy-modal-inner > *`), so thumbnail appears on the right in RTL and left in LTR via the `[dir="ltr"]` override already in style.css.
