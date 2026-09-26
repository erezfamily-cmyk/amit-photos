import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Follow-up to the main gallery grid fix (PR #35): the homepage's "Featured" section
// (initFeatured(), a separate 5-photo grid from the main masonry gallery) had the exact same
// missing-dimensions gap on its lazy-loaded images — confirmed live via a fresh page load,
// walking every <img loading="lazy"> and finding 14 without width/height (the "Iron Spiral Sky
// Ceiling" featured photo among them). The lightbox's "related photos" strip had the same gap
// and the same fix is trivial there (real width/height already on hand from allPhotos); the
// lightbox's Redbubble/Zazzle product thumbnails were deliberately left alone — those are
// external product images with no known dimensions.
const src = readFileSync(fileURLToPath(new URL('../assets/js/gallery.js', import.meta.url)), 'utf8');

test('initFeatured() renders width/height on its images, same as the main gallery grid', () => {
  const start = src.indexOf('async function initFeatured()');
  const end = src.indexOf('\n}', start);
  const block = src.slice(start, end);
  assert.match(block, /<img src="\$\{photo\.thumbnail \|\| photo\.url\}"[^>]*width="\$\{photo\.width \|\| 800\}"/);
  assert.match(block, /height="\$\{photo\.height \|\| 600\}"/);
});

test('the lightbox related-photos thumbnails render width/height too', () => {
  const marker = 'class="lb-related-thumb"';
  const idx = src.indexOf(marker);
  assert.ok(idx !== -1, 'lb-related-thumb template not found');
  const nearby = src.slice(idx, idx + 300);
  assert.match(nearby, /width="\$\{p\.width \|\| 800\}"/);
  assert.match(nearby, /height="\$\{p\.height \|\| 600\}"/);
});
