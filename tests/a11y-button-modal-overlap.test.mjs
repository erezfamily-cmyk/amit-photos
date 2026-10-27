import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../assets/css/style.css', import.meta.url), 'utf8');
const gallery = readFileSync(new URL('../assets/js/gallery.js', import.meta.url), 'utf8');
const widget = readFileSync(new URL('../assets/js/accessibility-widget.js', import.meta.url), 'utf8');

test('floating accessibility button is hidden while lightbox or wall preview is open', () => {
  assert.match(widget, /#a11y-widget-btn\{position:fixed/);
  assert.match(css, /body:has\(#lightbox\.open\) #a11y-widget-btn/);
  assert.match(css, /body:has\(#wall-modal\.open\) #a11y-widget-btn/);
  // JS-synced class works without :has() support (older iOS browsers)
  assert.match(css, /body\.modal-open #a11y-widget-btn\s*\{\s*display:\s*none/);
  assert.match(gallery, /classList\.toggle\('modal-open'/);
  assert.match(gallery, /\.lightbox\.open, \.wall-modal\.open/);
});

test('mobile lightbox stage hugs the photo and the WhatsApp button is compact', () => {
  const mobile = css.slice(css.indexOf('Mobile photo viewer: navigate below the photograph'));
  const inner = mobile.slice(0, mobile.indexOf('.lightbox-inner img'));
  assert.match(inner, /height:\s*auto/);
  assert.doesNotMatch(inner, /height:\s*min\(56svh/);
  const btn = css.slice(css.indexOf('.lb-contact-btn {\n    order: -3') >= 0 ? css.indexOf('.lb-contact-btn {\n    order: -3') : css.indexOf('.lb-contact-btn {\r\n    order: -3'));
  assert.match(btn.slice(0, 400), /min-height:\s*44px/);
});
