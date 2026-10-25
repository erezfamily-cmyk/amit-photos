import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const gallery = readFileSync(new URL('../assets/js/gallery.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../assets/css/style.css', import.meta.url), 'utf8');
const i18n = readFileSync(new URL('../assets/js/i18n.js', import.meta.url), 'utf8');
const catalog = JSON.parse(readFileSync(new URL('../data/photos.json', import.meta.url), 'utf8'));

const match = gallery.match(/const EXPERIENCE_PATHS = Object\.freeze\((\{[\s\S]*?\})\);/);
assert.ok(match, 'Experience paths must use a static allowlist');
const paths = JSON.parse(JSON.stringify(vm.runInNewContext('(' + match[1] + ')')));
const byId = new Map(catalog.map(photo => [String(photo.id), photo]));

test('four paths exist with 4 unique known photo candidates per path', () => {
  assert.deepEqual(Object.keys(paths).sort(), ['details', 'places', 'quiet', 'wonder']);
  const ids = Object.values(paths).flat();
  assert.equal(ids.length, 16);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) {
    const photo = byId.get(id);
    assert.ok(photo, 'Unknown photo ID: ' + id);
    assert.ok(Math.min(photo.width, photo.height) >= 1000, 'Low resolution: ' + id);
    assert.ok(photo.thumbnail, 'Missing preview: ' + id);
  }
});

test('photo choices resolve only from the current public gallery and hide unavailable paths', () => {
  assert.match(gallery, /const published = new Map\(allPhotos\.map\(photo => \[String\(photo\.id\), photo\]\)\)/);
  assert.match(gallery, /ids\.map\(id => published\.get\(id\)\)\.filter\(Boolean\)/);
  assert.match(gallery, /card\.hidden = matches\.length < 2/);
  assert.match(gallery, /img\.src = getGalleryThumbUrl\(photo\.thumbnail \|\| photo\.url\)/);
  assert.doesNotMatch(html, /\/photos\/thumb\//);
});

test('cards are localized and can be activated with keyboard buttons', () => {
  for (const id of ['quiet', 'wonder', 'details', 'places']) {
    assert.match(html, new RegExp('data-experience="' + id + '"'));
    assert.match(i18n, new RegExp("'experience\\." + id + "\\.title'"));
  }
  assert.match(html, /aria-controls="gallery-grid-wrap" aria-pressed="false" disabled/);
  assert.match(gallery, /function applyFilters\(\) \{\s*clearExperienceSelection\(\)/);
  assert.match(gallery, /if \(activeExperiencePath\) showExperiencePath\(activeExperiencePath, \{ track: false, scroll: false \}\)/);
  assert.match(gallery, /#experience-/);
});

test('discovery click sends anonymous path metadata only', () => {
  assert.match(gallery, /trackUxEvent\?\.\('experience_path_click', \{ label: pathId, result_count: matches\.length \}\)/);
  const source = gallery.slice(gallery.indexOf('function showExperiencePath('), gallery.indexOf('function initExperiencePaths('));
  assert.doesNotMatch(source, /email|phone|photo_title|description/);
});

test('cards have responsive columns and a hidden state', () => {
  assert.match(css, /\.experience-grid\s*\{[^}]*grid-template-columns:\s*repeat\(4/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /\.experience-card\s*\{[^}]*min-width:\s*0/s);
  assert.match(css, /\.experience-section\[hidden\]/);
});
