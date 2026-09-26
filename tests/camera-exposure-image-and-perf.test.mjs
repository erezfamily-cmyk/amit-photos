import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Static-source regression checks (no canvas/DOM available under node:test — same limitation
// as camera guide tests elsewhere in this repo) for two fixes to camera/exposure/index.html:
// 1. a fetch of an image that was never uploaded (404 + console error on every visit)
// 2. a forced-synchronous-layout pattern in resizeCanvas() (measured 307ms in DevTools traces)
const src = readFileSync(fileURLToPath(new URL('../camera/exposure/index.html', import.meta.url)), 'utf8');

test('regression: no fetch of the never-uploaded sample-landscape.jpg', () => {
  // the filename may still appear in an explanatory code comment about why it was removed;
  // only the actual load attempt must be gone.
  assert.doesNotMatch(src, /\.src\s*=\s*['"][^'"]*sample-landscape\.jpg['"]/);
});

test('the procedural fallback scene is drawn directly, not gated behind an image load error handler', () => {
  assert.match(src, /if \(baseImg\) \{ ctx\.drawImage\(baseImg, 0, 0, w, h\); \} else \{ drawFallback\(\); \}/);
  assert.doesNotMatch(src, /new Image\(\)/);
});

test('canvas has explicit width/height attributes so it has a sensible size before the ResizeObserver fires', () => {
  assert.match(src, /<canvas class="sim-canvas" id="simCanvas" width="640" height="360">/);
});

test('regression: resizeCanvas no longer reads getBoundingClientRect() (the forced-reflow trigger)', () => {
  assert.doesNotMatch(src, /canvas\.parentElement\.getBoundingClientRect\(\)/);
});

test('regression: sizing is driven by ResizeObserver, not a window resize listener + manual initial call', () => {
  assert.match(src, /new ResizeObserver\(entries => \{/);
  assert.match(src, /\.observe\(canvas\.parentElement\)/);
  assert.doesNotMatch(src, /window\.addEventListener\('resize', resizeCanvas\)/);
});

test('resizeCanvas falls back to 640 when no width is provided', () => {
  assert.match(src, /function resizeCanvas\(width\) \{\s*canvas\.width = width \|\| 640;/);
});
