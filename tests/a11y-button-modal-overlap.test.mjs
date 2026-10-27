import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../assets/css/style.css', import.meta.url), 'utf8');
const widget = readFileSync(new URL('../assets/js/accessibility-widget.js', import.meta.url), 'utf8');

test('floating accessibility button is hidden while lightbox or wall preview is open', () => {
  assert.match(widget, /#a11y-widget-btn\{position:fixed/);
  assert.match(css, /body:has\(#lightbox\.open\) #a11y-widget-btn/);
  assert.match(css, /body:has\(#wall-modal\.open\) #a11y-widget-btn/);
  assert.match(css, /#wall-modal\.open\) #a11y-widget-btn\s*\{\s*display:\s*none/);
});
