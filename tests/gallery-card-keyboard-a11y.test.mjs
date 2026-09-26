import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// renderGallery() is a large function with many module-level dependencies (state, i18n, price
// helpers, other UI functions). Rather than mock all of them loosely, this extracts the real
// function body and runs it in a vm sandbox with minimal-but-real stand-ins, so the actual
// tabIndex/role/aria-label wiring and the click/keydown listeners under test are the genuine
// production code, not a re-implementation of it.
const src = readFileSync(fileURLToPath(new URL('../assets/js/gallery.js', import.meta.url)), 'utf8');
const start = src.indexOf('function renderGallery(');
const end = src.indexOf('function updateSentinel()');
if (start === -1 || end === -1 || end < start) {
  throw new Error('renderGallery() not found in gallery.js — has it moved or been renamed?');
}
const renderGallerySrc = src.slice(start, end);

function fakeElement(tag) {
  const attrs = {};
  const listeners = {};
  const el = {
    tagName: tag.toUpperCase(),
    className: '',
    dataset: {},
    _innerHTML: '',
    get innerHTML() { return this._innerHTML; },
    set innerHTML(v) { this._innerHTML = v; },
    tabIndex: -1,
    children: [],
    setAttribute(name, value) { attrs[name] = String(value); },
    getAttribute(name) { return attrs[name] ?? null; },
    addEventListener(type, fn) { listeners[type] = fn; },
    removeEventListener(type, fn) { if (listeners[type] === fn) delete listeners[type]; },
    appendChild(child) { this.children.push(child); return child; },
    querySelector() { return null; },
    style: {},
    _attrs: attrs,
    _listeners: listeners,
  };
  return el;
}

function fakeTarget(matchesSelector) {
  return { closest: (sel) => (sel === matchesSelector ? fakeTarget(matchesSelector) : null) };
}

function buildSandbox({ photos, wishlistIds = [] }) {
  const grid = fakeElement('div');
  const calls = { openLightbox: [], addToCart: [], openBuyModal: [], toggleWishlist: [] };
  const context = {
    filteredPhotos: photos,
    displayedCount: photos.length,
    PAGE_SIZE: 12,
    document: {
      getElementById: (id) => (id === 'gallery-grid' ? grid : null),
      createElement: (tag) => fakeElement(tag),
    },
    t: (key) => key,
    getLang: () => 'he',
    getCategoryLabel: (c) => c,
    canBuy: () => true,
    formatPrice: (p) => `₪${p}`,
    getEffectivePrice: () => 100,
    isNew: () => false,
    isOnSale: () => false,
    isWeekPhoto: () => false,
    getGalleryThumbUrl: (u) => u,
    getWishlist: () => new Set(wishlistIds),
    galRevealObs: { observe() {} },
    openLightbox: (idx) => calls.openLightbox.push(idx),
    addToCart: (photo, item) => calls.addToCart.push(photo.id),
    openBuyModal: (photo) => calls.openBuyModal.push(photo.id),
    toggleWishlist: (id) => calls.toggleWishlist.push(id),
    updateSentinel: () => {},
  };
  vm.createContext(context);
  vm.runInContext(renderGallerySrc + '\nthis.renderGallery = renderGallery;', context);
  context.renderGallery(false);
  return { grid, calls, context };
}

test('each gallery card is keyboard-focusable with an accessible name', () => {
  const { grid } = buildSandbox({ photos: [{ id: 'p1', title: 'נוף הרים', thumbnail: '/t.webp' }] });
  const card = grid.children[0];
  assert.equal(card.tabIndex, 0);
  assert.equal(card.getAttribute('role'), 'button');
  assert.match(card.getAttribute('aria-label'), /נוף הרים/);
});

test('regression: card image has explicit width/height so the lazy-loaded photo does not shift layout on load', () => {
  const { grid } = buildSandbox({ photos: [{ id: 'p1', title: 'נוף הרים', thumbnail: '/t.webp', width: 4000, height: 3000 }] });
  const card = grid.children[0];
  assert.match(card.innerHTML, /<img[^>]*width="4000"/);
  assert.match(card.innerHTML, /<img[^>]*height="3000"/);
});

test('card image falls back to a sensible default width/height when the photo record has none', () => {
  const { grid } = buildSandbox({ photos: [{ id: 'p1', title: 'A' }] });
  const card = grid.children[0];
  assert.match(card.innerHTML, /<img[^>]*width="\d+"/);
  assert.match(card.innerHTML, /<img[^>]*height="\d+"/);
});

test('pressing Enter on the card itself opens the lightbox at the right index', () => {
  const { grid, calls } = buildSandbox({
    photos: [{ id: 'p1', title: 'A' }, { id: 'p2', title: 'B' }],
  });
  const secondCard = grid.children[1];
  secondCard._listeners.keydown({ target: secondCard, key: 'Enter', preventDefault() {} });
  assert.deepEqual(calls.openLightbox, [1]);
});

test('pressing Space on the card opens the lightbox and prevents page scroll', () => {
  const { grid, calls } = buildSandbox({ photos: [{ id: 'p1', title: 'A' }] });
  const card = grid.children[0];
  let prevented = false;
  card._listeners.keydown({ target: card, key: ' ', preventDefault() { prevented = true; } });
  assert.deepEqual(calls.openLightbox, [0]);
  assert.equal(prevented, true);
});

test('regression: Enter/Space does not double-fire when focus is on a nested action button, not the card', () => {
  const { grid, calls } = buildSandbox({ photos: [{ id: 'p1', title: 'A' }] });
  const card = grid.children[0];
  const nestedButton = fakeElement('button');
  card._listeners.keydown({ target: nestedButton, key: 'Enter', preventDefault() {} });
  assert.deepEqual(calls.openLightbox, [], 'card keydown handler must ignore keys targeted at its own descendants');
});

test('a non-Enter/Space key on the card does nothing', () => {
  const { grid, calls } = buildSandbox({ photos: [{ id: 'p1', title: 'A' }] });
  const card = grid.children[0];
  card._listeners.keydown({ target: card, key: 'Tab', preventDefault() {} });
  assert.deepEqual(calls.openLightbox, []);
});

test('clicking the card body (not an action button) still opens the lightbox — no regression from the a11y change', () => {
  const { grid, calls } = buildSandbox({ photos: [{ id: 'p1', title: 'A' }] });
  const card = grid.children[0];
  card._listeners.click({ target: fakeTarget('__none__') });
  assert.deepEqual(calls.openLightbox, [0]);
});

test('clicking the wish/cart/buy buttons still routes to their own handlers, not openLightbox', () => {
  const { grid, calls } = buildSandbox({ photos: [{ id: 'p1', title: 'A' }] });
  const card = grid.children[0];
  card._listeners.click({ target: fakeTarget('.gallery-cart-btn') });
  card._listeners.click({ target: fakeTarget('.gallery-buy-btn') });
  assert.deepEqual(calls.addToCart, ['p1']);
  assert.deepEqual(calls.openBuyModal, ['p1']);
  assert.deepEqual(calls.openLightbox, []);
});
