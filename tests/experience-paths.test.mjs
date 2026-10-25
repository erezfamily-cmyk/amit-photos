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

test('details collection highlights subtle floral macro photography', () => {
  assert.deepEqual(paths.details, [
    '1c_MjQDRqBDKXXUs8J2IRYpUtq68hF0d5',
    '1T_sZuDJIECAtqscPBtZ1qoi7KECxxmLu',
    '1qAYmV4wg-5I8isvUTrP1kZnT1leAHkvA',
    '1WZUI8vzx_VBpg6yfXb_mAth6guweU2JH',
  ]);
  assert.equal(byId.get(paths.details[1]).title, 'פרחים ורודים בתקריב');
  assert.equal(byId.get(paths.details[2]).title, 'ורד ורוד עדין');
  assert.equal(byId.get(paths.details[3]).title, 'עדינות של טבע');
  assert.match(i18n, /'experience\.details\.desc': 'עדינות של הטבע'/);
  assert.match(i18n, /'experience\.details\.desc': 'The delicate beauty of nature'/);
  assert.match(html, /data-i18n="experience\.details\.desc">עדינות של הטבע/);
});

test('photo-led homepage cards keep the image dominant and text legible', () => {
  assert.match(css, /\.experience-card-media\s*\{[^}]*position:\s*absolute/s);
  assert.match(css, /\.experience-card::after\s*\{[^}]*linear-gradient/s);
  assert.match(css, /\.experience-card-copy\s*\{[^}]*z-index:\s*1/s);
  assert.match(css, /\.experience-card\s*\{[^}]*aspect-ratio:\s*3\s*\/\s*4/s);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test('hero opens the emotional discovery only when a public route exists', () => {
  assert.match(html, /href="#gallery" class="hero-cta"/);
  assert.match(gallery, /const heroCta = document\.querySelector\('\.hero-cta\[href="#gallery"\]'\)/);
  assert.match(gallery, /if \(available > 0 && heroCta\) heroCta\.setAttribute\('href', '#experience'\)/);
  assert.match(gallery, /if \(!experiencePublicGalleryVerified\) \{\s*section\.hidden = true;\s*return;/);
});

test('photo choices resolve only from the current public gallery and hide unavailable paths', () => {
  assert.match(gallery, /const published = new Map\(allPhotos\.map\(photo => \[String\(photo\.id\), photo\]\)\)/);
  assert.match(gallery, /ids\.map\(id => published\.get\(id\)\)\.filter\(Boolean\)/);
  assert.match(gallery, /card\.hidden = matches\.length < 2/);
  assert.match(html, /<section class="experience-section" id="experience"[^>]*hidden>/);
  assert.match(gallery, /section\.hidden = available === 0;/);
  assert.match(gallery, /img\.src = getGalleryThumbUrl\(photo\.thumbnail \|\| photo\.url\)/);
  assert.doesNotMatch(html, /\/photos\/thumb\//);
});

test('experience paths fail closed if the public D1 gallery cannot be verified', () => {
  assert.match(gallery, /let experiencePublicGalleryVerified = false;/);
  assert.match(gallery, /async function loadPhotos\(\) \{[\s\S]*?experiencePublicGalleryVerified = false;/);
  assert.match(gallery, /if \(Array\.isArray\(apiPhotos\) && apiPhotos\.length > 0\) \{\s*\/\/ The original D1 route or Preview's public-production proxy returns only published images\.\s*experiencePublicGalleryVerified = true;/);
  assert.match(gallery, /function showExperiencePath\([^)]*\) \{\s*if \(!experiencePublicGalleryVerified\) return;/);
  assert.match(gallery, /function initExperiencePaths\(\) \{[\s\S]*?if \(!experiencePublicGalleryVerified\) \{\s*section\.hidden = true;/);
});

test('Cloudflare Sandbox Preview reads the published public photo source without loosening production', () => {
  const worker = readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
  assert.match(gallery, /const isSandboxPreview = location\.hostname\.endsWith\('-amit-photos-paypal-sandbox\.erez-family\.workers\.dev'\)/);
  assert.match(gallery, /const publicGalleryEndpoint = isSandboxPreview \? '\/api\/experience-preview-photos' : '\/api\/photos'/);
  assert.match(worker, /if \(path === '\/api\/experience-preview-photos'\) return handleExperiencePreviewPublicPhotos\(request\)/);
  assert.match(worker, /if \(!host\.endsWith\(EXPERIENCE_PREVIEW_HOST_SUFFIX\)\)/);
  assert.match(worker, /request\.method !== 'GET'/);
  assert.match(worker, /fetch\('https:\/\/amitphotos\.com\/api\/photos'/);
  assert.match(worker, /photo\.published !== 0 && photo\.published !== false/);
  assert.match(worker, /new Response\('Not found', \{ status: 404 \}\)/);
  assert.match(worker, /'public gallery unavailable'/);
  assert.doesNotMatch(worker.slice(worker.indexOf('async function handleExperiencePreviewPublicPhotos('),
    worker.indexOf('// ===== PHOTOS =====')), /admin=1|\/api\/admin|env\.DB|\.put\(|DELETE FROM|UPDATE photos/);
});

test('direct links show the discovery once public content is loaded', () => {
  assert.match(gallery, /if \(available > 0 && window\.location\.hash === '#experience'\)/);
  assert.match(gallery, /requestAnimationFrame\(\(\) => section\.scrollIntoView\(\{ behavior: 'auto', block: 'start' \}\)\)/);
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
