import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// gallery.js is a plain browser script (no exports), so we extract just the self-contained
// MODAL A11Y block (getModalFocusableElements/openModalA11y/closeModalA11y) and run it in a
// vm sandbox against a minimal fake DOM, the same way other tests in this repo exercise
// client-side <script> blocks without a real browser (see free-guide-english.test.mjs).
const src = readFileSync(fileURLToPath(new URL('../assets/js/gallery.js', import.meta.url)), 'utf8');
const blockStart = src.indexOf('// ===== MODAL A11Y');
const blockEnd = src.indexOf('function trackEvent');
if (blockStart === -1 || blockEnd === -1 || blockEnd < blockStart) {
  throw new Error('MODAL A11Y block not found in gallery.js — has it moved or been renamed?');
}
const modalA11ySrc = src.slice(blockStart, blockEnd);

function fakeElement({ tag = 'button', visible = true, fixed = false, tabindex } = {}) {
  const listeners = {};
  return {
    tagName: tag.toUpperCase(),
    _visible: visible,
    _style: { visibility: 'visible' },
    _tabindex: tabindex,
    getClientRects() { return this._visible ? [{}] : []; },
    // position:fixed elements have offsetParent === null per spec even when visible — this
    // element intentionally does NOT implement offsetParent-based visibility at all, since the
    // real fix was to stop relying on it. `fixed` is recorded only for readability in tests.
    _fixed: fixed,
    addEventListener(type, fn) { listeners[type] = fn; },
    removeEventListener(type, fn) { if (listeners[type] === fn) delete listeners[type]; },
    _fire(type, evt) { if (listeners[type]) listeners[type](evt); },
    focus() { fakeDocument.activeElement = this; },
    contains() { return true; },
  };
}

let fakeDocument;

function runModalA11y() {
  const context = {
    getComputedStyle(el) { return el._style; },
    requestAnimationFrame(fn) { fn(); },
    console,
  };
  vm.createContext(context);
  fakeDocument = { activeElement: null, body: { contains: (el) => el !== null } };
  context.document = fakeDocument;
  vm.runInContext(modalA11ySrc, context);
  return context;
}

function containerWithElements(elements) {
  const listeners = {};
  return {
    querySelectorAll: () => elements,
    addEventListener(type, fn) { listeners[type] = fn; },
    removeEventListener(type, fn) { if (listeners[type] === fn) delete listeners[type]; },
    _fire(type, evt) { if (listeners[type]) listeners[type](evt); },
  };
}

test('getModalFocusableElements excludes hidden (display:none) elements', () => {
  const ctx = runModalA11y();
  const visible = fakeElement({ visible: true });
  const hidden = fakeElement({ visible: false });
  const result = ctx.getModalFocusableElements(containerWithElements([visible, hidden]));
  // result is an array from the vm sandbox's own realm, so compare by length + reference
  // per element rather than assert.deepEqual on the array itself (cross-realm Array
  // prototypes are never deepStrictEqual, even with identical elements).
  assert.equal(result.length, 1);
  assert.equal(result[0], visible);
});

test('getModalFocusableElements excludes visibility:hidden elements', () => {
  const ctx = runModalA11y();
  const visible = fakeElement({ visible: true });
  const hiddenByCss = fakeElement({ visible: true });
  hiddenByCss._style.visibility = 'hidden';
  const result = ctx.getModalFocusableElements(containerWithElements([visible, hiddenByCss]));
  assert.equal(result.length, 1);
  assert.equal(result[0], visible);
});

test('regression: getModalFocusableElements INCLUDES position:fixed elements (offsetParent-null false negative)', () => {
  // this is the exact bug: lb-close/lb-prev/lb-next are position:fixed, so offsetParent is
  // always null for them even though they are fully visible. A filter based on offsetParent
  // would silently drop them from the focus trap; getClientRects() must not.
  const ctx = runModalA11y();
  const fixedCloseBtn = fakeElement({ visible: true, fixed: true });
  assert.equal(fixedCloseBtn.offsetParent, undefined, 'sanity: fake element has no offsetParent at all, like a real fixed element would report null');
  const result = ctx.getModalFocusableElements(containerWithElements([fixedCloseBtn]));
  assert.equal(result.length, 1);
  assert.equal(result[0], fixedCloseBtn);
});

test('openModalA11y moves focus to the given selector target', () => {
  const ctx = runModalA11y();
  const closeBtn = fakeElement();
  const other = fakeElement();
  const modal = containerWithElements([other, closeBtn]);
  modal.querySelector = (sel) => (sel === '#close' ? closeBtn : null);
  ctx.openModalA11y(modal, '#close');
  assert.equal(fakeDocument.activeElement, closeBtn);
});

test('openModalA11y falls back to the first focusable element when no selector matches', () => {
  const ctx = runModalA11y();
  const first = fakeElement();
  const second = fakeElement();
  const modal = containerWithElements([first, second]);
  modal.querySelector = () => null;
  ctx.openModalA11y(modal, null);
  assert.equal(fakeDocument.activeElement, first);
});

test('Tab on the last focusable element wraps focus to the first', () => {
  const ctx = runModalA11y();
  const first = fakeElement();
  const last = fakeElement();
  const modal = containerWithElements([first, last]);
  modal.querySelector = () => null;
  ctx.openModalA11y(modal, null);
  fakeDocument.activeElement = last;
  let prevented = false;
  modal._fire('keydown', { key: 'Tab', shiftKey: false, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(fakeDocument.activeElement, first);
});

test('Shift+Tab on the first focusable element wraps focus to the last', () => {
  const ctx = runModalA11y();
  const first = fakeElement();
  const last = fakeElement();
  const modal = containerWithElements([first, last]);
  modal.querySelector = () => null;
  ctx.openModalA11y(modal, null);
  fakeDocument.activeElement = first;
  let prevented = false;
  modal._fire('keydown', { key: 'Shift+Tab'.split('+')[1], shiftKey: true, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(fakeDocument.activeElement, last);
});

test('Tab in the middle of the modal does not hijack focus', () => {
  const ctx = runModalA11y();
  const first = fakeElement();
  const middle = fakeElement();
  const last = fakeElement();
  const modal = containerWithElements([first, middle, last]);
  modal.querySelector = () => null;
  ctx.openModalA11y(modal, null);
  fakeDocument.activeElement = middle;
  let prevented = false;
  modal._fire('keydown', { key: 'Tab', shiftKey: false, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, false);
  assert.equal(fakeDocument.activeElement, middle);
});

test('closeModalA11y restores focus to the element that was focused before opening', () => {
  const ctx = runModalA11y();
  const trigger = fakeElement();
  fakeDocument.activeElement = trigger;
  const closeBtn = fakeElement();
  const modal = containerWithElements([closeBtn]);
  modal.querySelector = () => closeBtn;
  ctx.openModalA11y(modal, '#close');
  assert.equal(fakeDocument.activeElement, closeBtn);
  ctx.closeModalA11y(modal);
  assert.equal(fakeDocument.activeElement, trigger);
});

test('closeModalA11y removes the keydown listener so a stale trap cannot fire after close', () => {
  const ctx = runModalA11y();
  const only = fakeElement();
  const modal = containerWithElements([only]);
  modal.querySelector = () => null;
  ctx.openModalA11y(modal, null);
  ctx.closeModalA11y(modal);
  let firedAfterClose = false;
  modal._fire('keydown', { key: 'Tab', shiftKey: false, preventDefault: () => { firedAfterClose = true; } });
  assert.equal(firedAfterClose, false);
});
