import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Found live during a UX review: the "About" section hardcoded "500+" photos, while the real
// live count (already shown elsewhere on the same page, in the "all" filter badge via
// allPhotos.length) was 2,311 — a visible, self-contradicting stat on the same page. loadPhotos()
// is heavily coupled to fetch()/DOM/other gallery state, so this is a static-source regression
// check (same fallback used elsewhere in this repo for similarly-coupled functions) rather than a
// full behavioral test.
const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
const gallerySrc = readFileSync(fileURLToPath(new URL('../assets/js/gallery.js', import.meta.url)), 'utf8');

test('the About section photo-count stat has a stable id to hook into', () => {
  assert.match(html, /<div class="stat-number" id="about-photo-count">/);
});

test('loadPhotos() updates #about-photo-count from the real allPhotos.length after photos load', () => {
  const start = gallerySrc.indexOf('async function loadPhotos()');
  const end = gallerySrc.indexOf('\n}', gallerySrc.indexOf('renderGallery();', start));
  const block = gallerySrc.slice(start, end);
  assert.match(block, /getElementById\('about-photo-count'\)/);
  assert.match(block, /aboutPhotoCount\.textContent = allPhotos\.length\.toLocaleString\(\)/);
  // must run after allPhotos is fully assigned (including the dedup/fallback branches above),
  // not before — otherwise it could show a stale or demo-data count
  const countUpdateIdx = block.indexOf("getElementById('about-photo-count')");
  const finalAssignIdx = block.indexOf('parent_category');
  assert.ok(countUpdateIdx > finalAssignIdx, 'count update must happen after allPhotos is fully finalized');
});
