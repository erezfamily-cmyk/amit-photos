import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Follow-up to fa306e0a (camera/exposure only). Same forced-synchronous-layout pattern
// (canvas.parentElement.getBoundingClientRect() read right after a resize) existed in the other
// three canvas-based camera guides — static-source regression checks, same constraint as the
// exposure guide's tests (no canvas/DOM available under node:test).

function read(path) {
  return readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8');
}

test('camera/night: no getBoundingClientRect in resizeCanvas, sizing goes through ResizeObserver', () => {
  const src = read('camera/night/index.html');
  assert.doesNotMatch(src, /canvas\.parentElement\.getBoundingClientRect\(\)/);
  assert.match(src, /new ResizeObserver\(entries => \{/);
  assert.match(src, /\.observe\(canvas\.parentElement\)/);
  assert.doesNotMatch(src, /window\.addEventListener\('resize', resizeCanvas\)/);
  assert.match(src, /<canvas class="sim-canvas" id="simCanvas" width="640" height="360">/);
});

test('camera/composition: no getBoundingClientRect anywhere in the sizing logic, one ResizeObserver drives both the rule canvas and the compare pair', () => {
  const src = read('camera/composition/index.html');
  assert.doesNotMatch(src, /getBoundingClientRect\(\)/);
  assert.match(src, /const compositionRO = new ResizeObserver/);
  assert.match(src, /compositionRO\.observe\(canvas\.parentElement\)/);
  assert.match(src, /compositionRO\.observe\(document\.getElementById\('compareCenter'\)\.parentElement\)/);
  assert.doesNotMatch(src, /window\.addEventListener\('resize'/);
  assert.match(src, /<canvas class="rule-canvas" id="ruleCanvas" width="600" height="450">/);
  assert.match(src, /<canvas class="compare-canvas" id="compareCenter" width="280" height="210">/);
  assert.match(src, /<canvas class="compare-canvas" id="compareThirds" width="280" height="210">/);
});

test('camera/controls: no getBoundingClientRect in resizeDial (the click-to-select-mode handler keeps its own, unrelated getBoundingClientRect call for pointer coordinates)', () => {
  const src = read('camera/controls/index.html');
  assert.doesNotMatch(src, /canvas\.parentElement\.getBoundingClientRect\(\)/);
  // the click handler's own rect read (for translating pointer coordinates) is legitimate and
  // must stay — it isn't part of the resize/forced-reflow pattern being fixed here.
  assert.match(src, /const rect = canvas\.getBoundingClientRect\(\);/);
  assert.match(src, /new ResizeObserver\(entries => \{/);
  assert.match(src, /\.observe\(canvas\.parentElement\)/);
  assert.doesNotMatch(src, /window\.addEventListener\('resize', resizeDial\)/);
  assert.match(src, /<canvas class="dial-canvas" id="dialCanvas" width="360" height="200">/);
});
